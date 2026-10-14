import { attachDrawing, attachInteractions, createViewport, RidgelineError, shapeGeometry } from '@ridgeline/map';
import type { FeatureStyle, MapFeature, Viewport } from '@ridgeline/map';
import { GeoJSONSource } from 'maplibre-gl';
import { groundModelGlb } from './model-placement-fixtures';
import { waitForVisible } from './browser-observation';

type Context = { container: HTMLDivElement; setCurrent(viewport: Viewport): void;
  until(predicate: () => boolean, description: string, timeout?: number): Promise<void> };
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const basemap = { version: 8 as const, sources: {}, layers: [{ id: 'background', type: 'background' as const, paint: { 'background-color': '#ffffff' } }] };
const point = (id: string, lng: number): MapFeature => ({ type: 'Feature', id, properties: {}, geometry: { type: 'Point', coordinates: [lng, 0] } });
async function idle(viewport: Viewport) {
  await new Promise<void>(resolve => { viewport.map.once('idle', () => resolve()); viewport.map.triggerRepaint(); });
}
async function pixel(viewport: Viewport, position: { x: number; y: number }) {
  return new Promise<Uint8Array>((resolve, reject) => {
    viewport.map.once('render', () => {
      const canvas = viewport.map.getCanvas(), gl = canvas.getContext('webgl2');
      if (!gl) { reject(new Error('WebGL2 unavailable')); return; }
      const ratio = canvas.width / canvas.clientWidth, color = new Uint8Array(4);
      gl.readPixels(Math.floor(position.x * ratio), canvas.height - 1 - Math.floor(position.y * ratio), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, color);
      resolve(color);
    }); viewport.map.triggerRepaint();
  });
}
async function observeGlyphs(viewport: Viewport, id: string) {
  const deadline = performance.now() + 8_000;
  let counts = [0, 0];
  do {
    counts = await new Promise<number[]>(resolve => {
      viewport.map.once('render', () => {
        const canvas = viewport.map.getCanvas(), gl = canvas.getContext('webgl2');
        check(gl, 'Glyph evidence requires WebGL2');
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const red = [0, 0];
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i]! > 180 && pixels[i + 1]! < 70 && pixels[i + 2]! < 70) red[0]!++;
          if (pixels[i + 2]! > 180 && pixels[i + 1]! < 70 && pixels[i]! < 70) red[1]!++;
        }
        resolve(red);
      }); viewport.map.triggerRepaint();
    });
    const index = id === 'first' ? 0 : 1;
    if (counts[index]! > 20 && counts[1 - index]! < 5) return;
  } while (performance.now() < deadline);
  throw new Error(`Visible glyphs disagree with placed ${id} label: red/blue counts ${counts}`);
}
export const selectionWorkflowCases: readonly { name: string; run(context: Context): Promise<void> }[] = [
  { name: 'Feature presentation unrelated callback updates preserve current publication', async run(context) {
    for (const action of ['control', 'upsert', 'remove'] as const) {
      let blue = false, mutate = false, triggered = false;
      const diagnostics: RidgelineError[] = [];
      const viewport = createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 },
        features: [point('a', 0), point('b', .004)], logger: () => {}, onError: error => diagnostics.push(error),
        style: feature => {
          if (feature.id === 'a' && mutate) {
            mutate = false; triggered = true;
            if (action === 'upsert') viewport.upsert([point('b', .006)]);
            if (action === 'remove') viewport.remove(['b']);
          }
          return { color: blue ? '#0000ff' : '#ff0000', radius: 10 };
        } });
      context.setCurrent(viewport);
      try {
        await viewport.ready; await idle(viewport);
        const position = viewport.map.project([0, 0]);
        const before = await pixel(viewport, position);
        check(before[0]! > 180 && before[2]! < 70, 'Baseline feature was not visibly red');
        blue = true; mutate = true; viewport.refreshStyles(['a']); await idle(viewport);
        check(triggered, 'Styling callback did not reach the requested history');
        check(!diagnostics.some(error => error.code === 'UPDATE_FAILED' && error.context.featureId === 'a'), `${action} incorrectly failed unrelated feature a`);
        const after = await pixel(viewport, position);
        check(after[2]! > 180 && after[0]! < 70, `${action} left current feature a stale`);
        check(action !== 'remove' || !viewport.getFeature('b'), 'Reentrant removal was not accepted');
        check(action !== 'upsert' || JSON.stringify(viewport.getFeature('b')!.geometry) === JSON.stringify(point('b', .006).geometry), 'Reentrant update was not accepted');
      } finally { viewport.destroy(); }
    }
  } },
  { name: 'Feature presentation refresh inside a native click preserves later observers and selection intent', async run(context) {
    for (const refresh of [false, true]) {
      const viewport = createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 }, features: [point('a', 0)], logger: () => {} });
      context.setCurrent(viewport);
      let clicks = 0, requests = 0;
      viewport.on('click', () => { if (refresh) viewport.refreshStyles(); });
      viewport.on('click', () => { clicks++; });
      const ui = attachInteractions(viewport, { hover: false });
      viewport.on('selectionrequest', event => { requests++; viewport.setSelection(event.ids); });
      try {
        await viewport.ready; await idle(viewport);
        check(window.browserMouse, 'Native click bridge unavailable');
        const p = viewport.map.project([0, 0]), box = viewport.map.getCanvas().getBoundingClientRect();
        await window.browserMouse('click', box.left + p.x, box.top + p.y);
        check(clicks === 1 && requests === 1 && viewport.getSelection().join() === 'a', `refresh=${refresh} discarded click observers or selection: ${clicks}/${requests}/${viewport.getSelection()}`);
      } finally { ui.destroy(); viewport.destroy(); }
    }
  } },

  { name: 'Feature presentation basemap changes survive elevation preparation abort callbacks', async run(context) {
    for (const trigger of ['abort', 'native'] as const) {
    let preparing = false, patched = false, aborted = false, switching = false;
    const feature = point('pending', 0); feature.entity = { altitude: { meters: 100, reference: 'ground' } };
    const viewport = createViewport({ container: context.container, basemap: { ...basemap, name: 'First' }, camera: { center: [0, 0], zoom: 15 },
      features: [feature], logger: () => {}, entityVisibility: { footprints: false, zones: false, groundLines: false }, elevationSampler: {
        sample: () => null,
        prepare: (_positions, signal) => new Promise<void>(resolve => {
          preparing = true;
          signal.addEventListener('abort', () => {
            aborted = true;
            if (trigger === 'abort' && !patched) { patched = true; viewport.configure({ entityVisibility: { ...viewport.getConfiguration().entityVisibility, groundLines: true } }); }
            resolve();
          }, { once: true });
        }),
      } });
    context.setCurrent(viewport);
    try {
      await viewport.ready; await context.until(() => preparing, 'real pending elevation preparation');
      viewport.map.on('styledataloading', () => {
        if (trigger === 'native' && switching && !patched) { patched = true; viewport.configure({ entityVisibility: { ...viewport.getConfiguration().entityVisibility, groundLines: true } }); }
      });
      switching = true;
      viewport.configure({ basemap: { ...basemap, name: 'Second', layers: [{ ...basemap.layers[0]!, id: 'second-background' }] },
        elevation: { tiles: ['https://unused.invalid/elevation/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 512 } });
      check(aborted && patched && viewport.getConfiguration().entityVisibility.groundLines, `${trigger} callback did not retain the patch and required elevation reset`);
      await context.until(() => viewport.map.getStyle()?.name === 'Second' && Boolean(viewport.map.getLayer('second-background')) && Boolean(viewport.map.getLayer('rl:points')), 'native basemap after preparation abort reentry');
      viewport.setCamera({ center: [.001, 0] });
      check(viewport.map.getCenter().lng === .001, 'Callback reentry left the camera unusable');
    } finally { viewport.destroy(); }
    }
  } },
  { name: 'Feature presentation refreshes styles and controls native airborne and model feedback', async run(context) {
    let color = '#0000ff', disabled = true, brightness = 0, fail = false;
    const modeled = point('model', .004); modeled.entity = { heading: 0, model: { id: 'body', minimumSizePixels: 60 } };
    const airborne = point('air', 0); airborne.entity = { altitude: { meters: 100, reference: 'ground' } };
    const viewport = createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 },
      features: [point('native', -.004), airborne, modeled], elevationSampler: { sample: () => 0 }, logger: () => {},
      style: feature => {
        if (fail && feature.id === 'native') throw new Error('palette unavailable');
        return { color, radius: 8, modelAppearance: { mode: 'color', color }, selected: { enabled: !disabled, color: '#ff0000', modelBrightness: brightness, lineWidth: 0 },
          hover: { enabled: !disabled, color: '#00ff00', radius: 16 } };
      } });
    context.setCurrent(viewport);
    const drawing = attachDrawing(viewport, { createFeature: () => ({ id: 'draft', properties: {} }), submit: () => ({ accepted: false, reason: 'Observation draft' }) }); let changes = 0, failures = 0;
    viewport.on('datachange', () => changes++); viewport.on('diagnostic', error => { if (error.context.featureId === 'native') failures++; });
    try {
      await viewport.ready; await viewport.registerModel('body', { bytes: groundModelGlb() });
      await context.until(() => viewport.getEntityState('model')?.representation === 'model', 'feedback model baseline'); await idle(viewport);
      const native = viewport.map.project([-.004, 0]), air = viewport.map.project([0, 0]), model = viewport.map.project([.004, 0]);
      const baseModel = await pixel(viewport, model);
      check(baseModel[2]! > baseModel[0]! + 40, `Model baseline is not blue: ${[...baseModel]}`);
      drawing.start('line'); drawing.addPoint([0, .003]);
      const draft = JSON.stringify(drawing.getState().draft), data = JSON.stringify(viewport.getFeatures()), camera = JSON.stringify(viewport.map.getCenter().toArray());
      viewport.setSelection(['native', 'air', 'model']); viewport.preview('native'); await idle(viewport);
      for (const position of [native, air]) {
        let observed: number[] = [];
        try { await waitForVisible(async () => { const sample = await pixel(viewport, position); observed = [...sample]; return sample; }, sample => sample[2]! > 180 && sample[0]! < 80, { timeout: 8000, description: 'disabled feedback retains native/airborne blue color' }); }
        catch (cause) { throw new Error(`Disabled feedback at ${position.x} produced ${observed}`, { cause }); }
      }
      const unchanged = await pixel(viewport, model);
      check(unchanged.every((channel, index) => Math.abs(channel - baseModel[index]!) < 3), 'Disabled model feedback brightened its body');
      color = '#00ff00'; viewport.refreshStyles(); await idle(viewport);
      const green = await pixel(viewport, native); check(green[1]! > 180 && green[0]! < 80 && green[2]! < 80, 'Explicit refresh did not paint the current palette');
      check(JSON.stringify(viewport.getFeatures()) === data && changes === 0, 'Style refresh replaced application data');
      check(JSON.stringify(drawing.getState().draft) === draft && JSON.stringify(viewport.map.getCenter().toArray()) === camera && viewport.getSelection().join() === 'native,air,model', 'Style refresh changed draft, camera or selection');
      fail = true; color = '#0000ff'; viewport.refreshStyles();
      await context.until(() => failures > 0, 'isolated style refresh failure'); await idle(viewport);
      const retained = await pixel(viewport, native); check(retained[1]! > 180 && retained[2]! < 80, 'Failed refresh lost the previous working native display');
      const other = await pixel(viewport, air); check(other[2]! > 180 && other[1]! < 80, 'Failed refresh blocked unrelated appearance');
      fail = false; viewport.refreshStyles(['native']); await idle(viewport);
      const repaired = await pixel(viewport, native); check(repaired[2]! > 180 && repaired[1]! < 80, 'Current stored feature did not recover through explicit refresh');
      disabled = false; viewport.preview(null); viewport.refreshStyles(); await idle(viewport);
      const zero = await pixel(viewport, model); check(zero.every((channel, index) => Math.abs(channel - baseModel[index]!) < 3), 'Explicit zero model brightening was ignored');
      brightness = .75; viewport.refreshStyles(['model']); await idle(viewport);
      const bright = await pixel(viewport, model); check(bright[0]! > zero[0]! + 50 && bright[1]! > zero[1]! + 50, 'Configured model brightening did not reach body pixels');
      check(JSON.stringify(viewport.getFeatures()) === data && changes === 0 && JSON.stringify(drawing.getState().draft) === draft, 'Feedback refresh replaced accepted data or interrupted the draft');
    } finally { drawing.destroy(); viewport.destroy(); }
  } },

  { name: 'Feature presentation rejects invalid callback roots and retains the working display', async run(context) {
    let invalid: unknown = { color: '#0000ff' }, failing = false, otherColor = '#0000ff';
    const viewport = createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 }, features: [point('subject', -.003), point('other', .003)],
      style: feature => feature.id === 'subject' ? invalid as FeatureStyle : { color: otherColor }, logger: () => {} });
    context.setCurrent(viewport); viewport.on('diagnostic', error => { if (error.context.featureId === 'subject' && error.code === 'UPDATE_FAILED') failing = true; });
    try {
      await viewport.ready; await idle(viewport);
      const subject = viewport.map.project([-.003, 0]), other = viewport.map.project([.003, 0]);
      for (const value of [null, undefined, [], '#ff0000', 12, true]) {
        invalid = value; failing = false; otherColor = '#00ff00';
        let styleError: unknown;
        try { viewport.getStyle(viewport.getFeature('subject')!); } catch (error) { styleError = error; }
        check(styleError instanceof RidgelineError && styleError.code === 'INVALID_FEATURE' && styleError.context.operation === 'style' && styleError.context.featureId === 'subject', 'Invalid appearance did not preserve public error context');
        viewport.refreshStyles();
        await context.until(() => failing, 'invalid callback root diagnostic'); await idle(viewport);
        const retained = await pixel(viewport, subject), updated = await pixel(viewport, other);
        check(retained[2]! > 180 && retained[0]! < 80, 'Invalid callback root replaced working pixels');
        check(updated[1]! > 180 && updated[0]! < 80, 'Invalid callback root blocked another feature');
      }
      invalid = { color: '#ff0000' }; viewport.retryUpdates();
      await context.until(() => viewport.map.querySourceFeatures('rl:features').some(feature => feature.properties._rl_feature_id === 'subject' && feature.properties._rl_color === '#ff0000'), 'explicit retry published the current valid style');
      await idle(viewport);
      const recovered = await pixel(viewport, subject); check(recovered[0]! > 180 && recovered[2]! < 80, 'Valid callback recovery failed');
    } finally { viewport.destroy(); }
  } },
  { name: 'Feature presentation keeps saved solid lines thick feedback and map aligned icons visible', async run(context) {
    const shape = { kind: 'line' as const, vertices: [[-.003, -.003], [.003, -.003]] as [number, number][] };
    const saved: MapFeature = { type: 'Feature', id: 'saved', properties: {}, geometry: shapeGeometry(shape), drawing: { version: 1, shape,
      style: { color: '#00ff00', fillColor: '#00ff00', lineWidth: 8, fillOpacity: .2, dashed: false, label: '' } } };
    const line: MapFeature = { type: 'Feature', id: 'line', properties: {}, geometry: { type: 'LineString', coordinates: [[-.003, 0], [.003, 0]] } };
    const icon: MapFeature = { ...point('icon', .003), geometry: { type: 'Point', coordinates: [.003, .003] } };
    const viewport = createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 }, features: [saved, line, icon], logger: () => {},
      style: feature => feature.id === 'saved' ? { dashArray: [1, 100] } : feature.id === 'line'
        ? { color: '#00ff00', lineWidth: 12, selected: { color: '#0000ff' }, hover: { color: '#ff0000' } }
        : { icon: 'orientation', iconRotationAlignment: 'map' } });
    context.setCurrent(viewport);
    try {
      const image = new Uint8ClampedArray(16 * 16 * 4);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4; image[i] = x < 8 ? 255 : 0; image[i + 2] = x < 8 ? 0 : 255; image[i + 3] = 255;
      }
      viewport.registerIcon('orientation', { image: new ImageData(image, 16, 16), pixelRatio: 1 });
      await viewport.ready; await idle(viewport);
      for (const lng of [-.002, 0, .002]) {
        const color = await pixel(viewport, viewport.map.project([lng, -.003]));
        check(color[1]! > 180 && color[0]! < 70 && color[2]! < 70, 'Saved solid drawing acquired a consumer dash gap');
      }
      viewport.setSelection(['line']); viewport.preview('line'); await idle(viewport);
      const p = viewport.map.project([0, 0]);
      for (const dy of [0, 4]) {
        const color = await pixel(viewport, { x: p.x, y: p.y + dy });
        check(color[2]! > 180 && color[0]! < 70 && color[1]! < 70, 'Selection lost thick line width or selected precedence over hover');
      }
      for (const bearing of [0, 90]) {
        viewport.setCamera({ bearing }); await idle(viewport);
        const center = viewport.map.project([.003, .003]);
        const red = await pixel(viewport, bearing === 0 ? { x: center.x - 4, y: center.y } : { x: center.x, y: center.y + 4 });
        const blue = await pixel(viewport, bearing === 0 ? { x: center.x + 4, y: center.y } : { x: center.x, y: center.y - 4 });
        check(red[0]! > 180 && red[2]! < 70 && blue[2]! > 180 && blue[0]! < 70, `Map aligned icon did not rotate with camera bearing ${bearing}`);
      }
    } finally { viewport.destroy(); }
  } },
  { name: 'Feature presentation preserves CSS alpha in airborne feedback', async run(context) {
    const air = point('air', .003); air.entity = { altitude: { meters: 1, reference: 'ground' } };
    let color = 'rgba(0, 0, 255, .5)';
    const viewport = createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 }, features: [point('native', -.003), air],
      entityVisibility: { footprints: false, zones: false, groundLines: false }, elevationSampler: { sample: () => 0 },
      style: () => ({ radius: 8, color: '#0000ff', selected: { color }, hover: { color } }), logger: () => {} });
    context.setCurrent(viewport);
    try {
      await viewport.ready; await idle(viewport);
      for (const feedback of ['selected', 'hover'] as const) {
        viewport.setSelection(feedback === 'selected' ? ['native', 'air'] : []);
        for (const alpha of [.5, 0]) {
          color = `rgba(0, 0, 255, ${alpha})`; viewport.refreshStyles();
          if (feedback === 'hover') viewport.preview('air'); await idle(viewport);
          const airborne = await pixel(viewport, viewport.map.project([.003, 0]));
          if (feedback === 'hover') viewport.preview('native');
          const native = await pixel(viewport, viewport.map.project([-.003, 0]));
          check(airborne.every((channel, index) => Math.abs(channel - native[index]!) < 6), `Airborne ${feedback} CSS alpha differs from native: ${[...airborne]} vs ${[...native]}`);
        }
      }
    } finally { viewport.destroy(); }
  } },
];
