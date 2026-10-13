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
function input() {
  const { browserMouse, browserKey, browserKeyDown, browserKeyUp, browserClick } = window;
  check(browserMouse && browserKey && browserKeyDown && browserKeyUp && browserClick, 'Native mouse/modifier/keyboard bridge unavailable');
  return { mouse: async (action: 'down' | 'move' | 'up' | 'click', x: number, y: number) => {
    const canvas = document.querySelector('#map canvas'); check(canvas, 'Native input canvas absent');
    const bounds = canvas.getBoundingClientRect(); await browserMouse(action, bounds.left + x, bounds.top + y);
  }, key: browserKey, down: browserKeyDown, up: browserKeyUp, click: browserClick };
}
async function click(viewport: Viewport, lng: number, shift = false) {
  const bridge = input(), position = viewport.map.project([lng, 0]);
  if (shift) await bridge.down('Shift');
  try { await bridge.mouse('click', position.x, position.y); } finally { if (shift) await bridge.up('Shift'); }
}
async function rectangle(viewport: Viewport, from: { x: number; y: number }, to: { x: number; y: number }, additive = false) {
  const bridge = input();
  await bridge.down('Alt'); if (additive) await bridge.down('Shift');
  try { await bridge.mouse('move', from.x, from.y); await bridge.mouse('down', from.x, from.y);
    await bridge.mouse('move', to.x, to.y); await bridge.mouse('up', to.x, to.y); }
  finally { if (additive) await bridge.up('Shift'); await bridge.up('Alt'); }
}
export const selectionWorkflowCases: readonly { name: string; run(context: Context): Promise<void> }[] = [
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
  { name: 'Feature presentation prioritizes selected labels without overlap or consumer replacement', async run(context) {
    const glyphs = new URL('./fixtures/noto-sans/0-255.pbf', import.meta.url).href + '?fontstack={fontstack}&range={range}';
    const viewport = createViewport({ container: context.container, basemap: { ...basemap, glyphs }, camera: { center: [0, 0], zoom: 15 },
      style: feature => ({ label: feature.id, selected: { enabled: false }, labelStyle: { size: 24, anchor: 'top', color: feature.id === 'first' ? '#ff0000' : '#0000ff', haloWidth: 0 } }), elevationSampler: { sample: () => 0 }, logger: () => {} });
    context.setCurrent(viewport);
    const labels = () => [...new Set(viewport.map.queryRenderedFeatures({ layers: ['rl:labels'] }).map(feature => feature.properties._rl_feature_id))];
    try {
      await viewport.ready;
      await viewport.registerModel('body', { bytes: groundModelGlb() });
      for (const modeled of [false, true]) {
        viewport.clear(); viewport.setSelection([]);
        const features = [point('first', 0), point('second', 0)];
        if (modeled) for (const feature of features) feature.entity = { heading: 0, model: { id: 'body', minimumSizePixels: 40 } };
        viewport.upsert(features);
        if (modeled) await context.until(() => features.every(feature => viewport.getEntityState(feature.id)?.representation === 'model'), 'colliding model labels');
        await idle(viewport);
        await context.until(() => labels().length === 1, 'initial collision suppression');
        const initial = labels()[0];
        check(initial === 'first' || initial === 'second', 'Collision fixture did not place one subject label');
        await observeGlyphs(viewport, initial);
        const hidden = initial === 'first' ? 'second' : 'first';
        const snapshot = JSON.stringify(viewport.getFeatures()), camera = JSON.stringify(viewport.map.getCenter().toArray());
        viewport.setSelection([hidden]);
        await context.until(() => labels().length === 1 && labels()[0] === hidden, 'selected label priority');
        await observeGlyphs(viewport, hidden);
        viewport.setSelection(['first', 'second']);
        await idle(viewport);
        check(labels().length === 1, 'Selected labels bypassed collision suppression');
        await observeGlyphs(viewport, labels()[0]!);
        viewport.setSelection([hidden]);
        const source = viewport.map.getSource('rl:features');
        viewport.configure({ basemap: { ...basemap, glyphs, name: modeled ? 'model-reload' : 'point-reload' } });
        await context.until(() => viewport.map.getSource('rl:features') !== source && Boolean(viewport.map.getLayer('rl:labels')), 'label style restoration');
        await context.until(() => labels().length === 1 && labels()[0] === hidden, 'selected label priority after style reload');
        await observeGlyphs(viewport, hidden);
        viewport.setSelection([]);
        await context.until(() => labels().length === 1 && labels()[0] === initial, 'normal placement after deselection');
        await observeGlyphs(viewport, initial);
        check(JSON.stringify(viewport.getFeatures()) === snapshot, 'Label feedback replaced consumer data');
        check(JSON.stringify(viewport.map.getCenter().toArray()) === camera, 'Label feedback moved the camera');
      }
    } finally { viewport.destroy(); }
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
        invalid = value; failing = false; otherColor = '#00ff00'; viewport.refreshStyles();
        await context.until(() => failing, 'invalid callback root diagnostic'); await idle(viewport);
        const retained = await pixel(viewport, subject), updated = await pixel(viewport, other);
        check(retained[2]! > 180 && retained[0]! < 80, 'Invalid callback root replaced working pixels');
        check(updated[1]! > 180 && updated[0]! < 80, 'Invalid callback root blocked another feature');
      }
      invalid = { color: '#ff0000' }; viewport.refreshStyles(['subject']); await idle(viewport);
      const recovered = await pixel(viewport, subject); check(recovered[0]! > 180 && recovered[2]! < 80, 'Valid callback recovery failed');
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
