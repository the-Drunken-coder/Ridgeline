import { attachDrawing, attachInteractions, createViewport, RidgelineError, shapeGeometry } from '@ridgeline/map';
import type { FeatureStyle, MapFeature, ScreenBounds, Viewport } from '@ridgeline/map';
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
  { name: 'Feature presentation refresh discards callback replacements and removals', async run(context) {
    let action: 'replace' | 'remove' | undefined;
    const viewport = createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 },
      features: [point('subject', 0)], logger: () => {}, style: feature => {
        const next = action; action = undefined;
        if (next === 'replace') viewport.upsert([point(feature.id, .003)]);
        if (next === 'remove') viewport.remove([feature.id]);
        return { color: next ? '#ff0000' : '#0000ff' };
      } });
    context.setCurrent(viewport);
    try {
      await viewport.ready; await idle(viewport);
      action = 'replace'; viewport.refreshStyles(); await idle(viewport);
      const current = viewport.map.project([.003, 0]), old = viewport.map.project([0, 0]);
      await context.until(() => viewport.queryFeatures([{ x: current.x - 10, y: current.y - 10 }, { x: current.x + 10, y: current.y + 10 }]).features.some(feature => feature.id === 'subject'), 'replacement from refresh callback');
      const currentPixel = await pixel(viewport, current);
      check(currentPixel[2]! > 180 && currentPixel[0]! < 80, 'Obsolete refresh callback appearance overwrote the replacement');
      check(!viewport.queryFeatures([{ x: old.x - 10, y: old.y - 10 }, { x: old.x + 10, y: old.y + 10 }]).features.length, 'Refresh resurrected old geometry');
      action = 'remove'; viewport.refreshStyles(); await idle(viewport);
      check(!viewport.getFeature('subject') && !viewport.queryFeatures([{ x: current.x - 10, y: current.y - 10 }, { x: current.x + 10, y: current.y + 10 }]).features.length, 'Refresh resurrected a callback removal');
      await waitForVisible(() => pixel(viewport, current), color => color[0]! > 240 && color[1]! > 240 && color[2]! > 240, { timeout: 8000, description: 'callback removal has no remaining rendered pixels' });
      viewport.upsert([point('later', 0)]); await idle(viewport);
      const later = await pixel(viewport, old); check(later[2]! > 180 && later[0]! < 80, 'Callback retirement prevented later usable publication');
    } finally { viewport.destroy(); }
  } },
  { name: 'Optional selection remains request only until the consumer applies a filtered proposal', async run(context) {
    const viewport = createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 },
      features: [point('original', -.006), point('a', 0), point('b', .002)], logger: () => {} });
    context.setCurrent(viewport);
    const ui = attachInteractions(viewport, { boxSelection: true, picker: false, hover: false }), requests: string[][] = [];
    viewport.on('selectionrequest', event => requests.push(event.ids));
    try {
      await viewport.ready; await idle(viewport); viewport.setSelection(['original']);
      const a = viewport.map.project([0, 0]), b = viewport.map.project([.002, 0]);
      await rectangle(viewport, { x: a.x - 15, y: a.y - 15 }, { x: b.x + 15, y: b.y + 15 });
      check(requests.length === 1 && requests[0]!.join() === 'a,b', 'Rectangle did not propose the complete current IDs');
      check(viewport.getSelection().join() === 'original', 'Receiving a proposal automatically applied selection');
      viewport.setSelection(requests[0]!.filter(id => id === 'b'));
      check(viewport.getSelection().join() === 'b', 'Consumer filtered selection was not authoritative');
    } finally { ui.destroy(); viewport.destroy(); }
  } },
  { name: 'Rectangle interruptions preserve selection through real renderer loss and restoration', async run(context) {
    const viewport = createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 },
      features: [point('original', -.004), point('next', .004)], logger: () => {} });
    context.setCurrent(viewport);
    const ui = attachInteractions(viewport, { boxSelection: true, picker: false, hover: false }), bridge = input();
    let requests = 0;
    viewport.on('selectionrequest', event => { requests++; viewport.setSelection(event.ids); });
    try {
      await viewport.ready; await idle(viewport); viewport.setSelection(['original']);
      const position = viewport.map.project([.004, 0]), start = { x: position.x - 20, y: position.y - 20 }, end = { x: position.x + 20, y: position.y + 20 };
      const gl = viewport.map.getCanvas().getContext('webgl2'), extension = gl?.getExtension('WEBGL_lose_context');
      check(extension, 'Real context-loss extension is unavailable');
      await bridge.down('Alt'); await bridge.mouse('down', start.x, start.y); await bridge.mouse('move', end.x, end.y);
      check(context.container.querySelector('.rl-selection-box') && viewport.getInteractionOwner() === 'rectangle-selection', 'Loss fixture never acquired a rectangle');
      const lost = new Promise<void>(resolve => viewport.map.once('webglcontextlost', () => resolve()));
      extension.loseContext(); await lost;
      check(!context.container.querySelector('.rl-selection-box') && !viewport.getInteractionOwner(), 'Context loss retained rectangle feedback or ownership');
      check(requests === 0 && viewport.getSelection().join() === 'original', 'Context loss changed accepted selection');
      check(viewport.queryFeatures([start, end]).features.length === 0, 'Unavailable explicit query did not remain empty');
      await bridge.mouse('up', end.x, end.y); await bridge.up('Alt');
      check(requests === 0 && viewport.getSelection().join() === 'original', 'Release while lost applied an abandoned selection');
      const restored = new Promise<void>(resolve => viewport.map.once('webglcontextrestored', () => resolve()));
      extension.restoreContext(); await restored; await idle(viewport);
      await context.until(() => viewport.queryFeatures([start, end]).features.some(feature => feature.id === 'next'), 'restored selectable output');
      await rectangle(viewport, start, end);
      check(Number(requests) === 1 && viewport.getSelection().join() === 'next', 'Restoration did not permit a later usable rectangle');
    } finally { await bridge.up('Alt'); ui.destroy(); viewport.destroy(); }
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
  { name: 'Feature presentation preserves saved solids thick lines airborne highlights and map aligned icons', async run(context) {
    const shape = { kind: 'line' as const, vertices: [[-.02, .008], [.02, .008]] as [number, number][] };
    const drawing: MapFeature = { type: 'Feature', id: 'saved', properties: {}, geometry: shapeGeometry(shape),
      drawing: { version: 1, shape, style: { color: '#0000ff', fillColor: '#0000ff', lineWidth: 3, fillOpacity: .2, dashed: false, label: '' } } };
    const thick: MapFeature = { type: 'Feature', id: 'thick', properties: {}, geometry: { type: 'LineString', coordinates: [[-.02, -.008], [.02, -.008]] } };
    const area: MapFeature = { type: 'Feature', id: 'area', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-.002, -.002], [.002, -.002], [.002, .002], [-.002, .002], [-.002, -.002]]] } };
    const airborne = point('airborne', -.008); airborne.entity = { altitude: { meters: 100, reference: 'ground' } };
    const viewport = createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 13 },
      features: [drawing, thick, area, airborne, point('icon', .008)], elevationSampler: { sample: () => 0 }, logger: () => {},
      style: feature => feature.id === 'saved' ? { dashArray: [2, 2] } : feature.id === 'thick' ? { color: '#0000ff', lineWidth: 10, hover: { lineWidth: 12, color: '#0000ff' } }
        : feature.id === 'area' ? { lineWidth: 0, selected: { color: '#ff0000' }, hover: { fillOpacity: 0 } }
        : feature.id === 'airborne' ? { selected: { color: '#ff0000', radius: 16 }, hover: { color: '#00ff00', radius: 12 } }
        : { icon: 'bar', radius: 0, iconRotationAlignment: 'map', hover: { iconOpacity: 0, radius: 0 } } });
    context.setCurrent(viewport);
    try {
      await viewport.ready;
      const icon = new ImageData(10, 36);
      for (let i = 0; i < icon.data.length; i += 4) { icon.data[i + 2] = 255; icon.data[i + 3] = 255; }
      viewport.registerIcon('bar', { image: icon }); await idle(viewport);
      const saved = viewport.map.querySourceFeatures('rl:features').find(feature => feature.properties._rl_feature_id === 'saved');
      check(saved && saved.properties._rl_dashed === false, 'Accessor dash array overrode saved solid drawing');
      viewport.setSelection(['thick']);
      const linePoint = viewport.map.project([0, -.008]);
      check(linePoint.y + 6 < viewport.map.getCanvas().clientHeight, 'Thick-line pixel fixture is outside the canvas');
      const linePixel = await pixel(viewport, { x: linePoint.x, y: linePoint.y + 4 });
      check(linePixel[2]! > 180 && linePixel[0]! < 80, 'Default selection shrank a thick line');
      viewport.preview('thick');
      const hoverPixel = await pixel(viewport, { x: linePoint.x, y: linePoint.y + 5 });
      check(hoverPixel[2]! > 180 && hoverPixel[0]! < 120, `Selected line lost explicit hover width: ${[...hoverPixel]}`);
      viewport.preview(null); viewport.setSelection(['airborne']); await idle(viewport);
      const airPoint = viewport.map.project([-.008, 0]);
      const selected = await pixel(viewport, { x: airPoint.x + 10, y: airPoint.y + 8 });
      check(selected[0]! > 180 && selected[1]! < 80, 'Airborne dot ignored selected color/radius');
      viewport.setSelection([]); viewport.preview('airborne'); await idle(viewport);
      const hover = await pixel(viewport, { x: airPoint.x + 7, y: airPoint.y + 5 });
      check(hover[1]! > 180 && hover[0]! < 80, 'Airborne dot ignored hover color/radius');
      viewport.setSelection(['area']); viewport.preview('area'); await idle(viewport);
      const polygon = viewport.map.project([0, 0]);
      check(!viewport.queryFeatures([{ x: polygon.x - 2, y: polygon.y - 2 }, { x: polygon.x + 2, y: polygon.y + 2 }]).features.some(feature => feature.id === 'area'), 'Rectangle selected an invisible hovered fill under selection');
      viewport.setSelection([]);
      viewport.preview(null); viewport.setCamera({ bearing: 90 }); await idle(viewport);
      const center = viewport.map.project([.008, 0]);
      const rotated = await pixel(viewport, { x: center.x + 12, y: center.y });
      const outside = await pixel(viewport, { x: center.x, y: center.y + 12 });
      check(rotated[2]! > 180 && rotated[0]! < 80 && outside[0]! > 200, 'Map-aligned icon did not rotate with the map');
      viewport.preview('icon'); await idle(viewport);
      check(!viewport.queryFeatures([{ x: center.x + 10, y: center.y - 1 }, { x: center.x + 14, y: center.y + 1 }]).features.some(feature => feature.id === 'icon'), 'Rectangle selected an invisible map-aligned icon');
    } finally { viewport.destroy(); }
  } },
  { name: 'Optional selection rejects rectangles during ongoing camera movement', async run(context) {
    const viewport = createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 },
      features: [point('a', -.004), point('b', .004)], logger: () => {} });
    context.setCurrent(viewport);
    const ui = attachInteractions(viewport, { boxSelection: true, hover: false });
    let requests = 0; viewport.on('selectionrequest', () => { requests++; });
    try {
      await viewport.ready; await idle(viewport);
      viewport.setCamera({ center: [.01, 0] }, { duration: 3000 });
      await new Promise(r => setTimeout(r, 200));
      check(viewport.map.isMoving(), 'Camera animation not running');
      await rectangle(viewport, { x: 100, y: 100 }, { x: 900, y: 600 });

      check(requests === 0, `Rectangle during camera movement emitted ${requests} request(s)`);
    } finally { ui.destroy(); viewport.destroy(); }
  } },
  { name: 'Optional selection Shift clicks tolerate small pointer jitter', async run(context) {
    const viewport = createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 },
      features: [point('a', -.004), point('b', .004)], logger: () => {} });
    context.setCurrent(viewport);
    const ui = attachInteractions(viewport, { additiveSelection: true, boxSelection: true, hover: false });
    viewport.on('selectionrequest', event => viewport.setSelection(event.ids));
    const bridge = input();
    try {
      await viewport.ready; await idle(viewport); viewport.setSelection(['a']);
      const zoom = viewport.map.getZoom(), p = viewport.map.project([.004, 0]);
      await bridge.down('Shift');
      try { await bridge.mouse('move', p.x, p.y); await bridge.mouse('down', p.x, p.y); await bridge.mouse('move', p.x + 1, p.y); await bridge.mouse('up', p.x + 1, p.y); }
      finally { await bridge.up('Shift'); }
      await new Promise(r => setTimeout(r, 600));

      check(Math.abs(viewport.map.getZoom() - zoom) < .01, `Shift-click jitter zoomed ${zoom} -> ${viewport.map.getZoom()}`);
      check(viewport.getSelection().join() === 'a,b', `Shift-click jitter did not add: ${viewport.getSelection().join()}`);
    } finally { ui.destroy(); viewport.destroy(); }
  } },
  { name: 'Optional selection toggles Shift candidates and retains radial intent', async run(context) {
    const viewport = createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 },
      features: [point('a', -.004), point('b', .004)], logger: () => {} });
    context.setCurrent(viewport);
    const ui = attachInteractions(viewport, { additiveSelection: true, boxSelection: true, hover: false });
    const requests: string[][] = [];
    const clickCandidates: string[][] = [];
    viewport.on('click', event => clickCandidates.push(event.features.map(feature => feature.id)));
    viewport.on('selectionrequest', event => { requests.push(event.ids); viewport.setSelection(event.ids); });
    try {
      await viewport.ready; await idle(viewport); viewport.setSelection(['a']);
      await click(viewport, .004, true); check(viewport.getSelection().join() === 'a,b', 'Shift did not add a candidate');
      await click(viewport, .004, true); check(viewport.getSelection().join() === 'a', 'Shift did not toggle a selected candidate off');
      const bridge = input(); await bridge.down('Shift');
      try { await bridge.mouse('click', 25, 25); } finally { await bridge.up('Shift'); }
      check(viewport.getSelection().join() === 'a', 'Empty additive click cleared the selection');
      await click(viewport, .004); check(viewport.getSelection().join() === 'b', 'Default click stopped replacing selection');
      viewport.upsert([point('c', .004)]); await idle(viewport); viewport.setSelection(['a']);
      await click(viewport, .004);
      await context.until(() => Boolean(context.container.querySelector('.rl-picker')), 'ordinary overlapping candidates');
      const ordinaryCandidates = clickCandidates.at(-1)!;
      check(ordinaryCandidates.length === 2 && ordinaryCandidates.includes('b') && ordinaryCandidates.includes('c'), 'Ordinary overlap fixture must contain both candidates');
      const close = context.container.querySelector<HTMLButtonElement>('.rl-picker-close'); check(close, 'Ordinary picker close absent');
      close.focus(); await bridge.key('Enter');
      const clickCount = clickCandidates.length;
      await click(viewport, .004, true);
      await context.until(() => Boolean(context.container.querySelector('.rl-picker')), 'radial candidates');
      check(clickCandidates.length === clickCount + 1 && JSON.stringify(clickCandidates.at(-1)) === JSON.stringify(ordinaryCandidates), 'Shift click changed accepted candidate order or emitted more than one interaction');
      const candidate = context.container.querySelector<HTMLButtonElement>('.rl-sector[data-feature-id="b"]'); check(candidate, 'B radial choice absent');
      candidate.focus(); await bridge.key('Enter');
      check(viewport.getSelection().join() === 'a,b', 'Releasing Shift before a radial choice lost additive intent');
      const a = viewport.map.project([-.004, 0]), b = viewport.map.project([.004, 0]), camera = viewport.map.getCenter().toArray();
      await rectangle(viewport, { x: a.x - 18, y: a.y - 18 }, { x: b.x + 18, y: b.y + 18 });
      check(viewport.getSelection().join() === 'a,b,c', 'Rectangle missed or duplicated displayed features');
      check(JSON.stringify(viewport.map.getCenter().toArray()) === JSON.stringify(camera), 'Alt rectangle moved the camera');
      check(!context.container.querySelector('.rl-selection-box') && !viewport.getInteractionOwner(), 'Completed rectangle retained resources');
      viewport.setSelection(['a']);
      await rectangle(viewport, { x: b.x - 18, y: b.y - 18 }, { x: b.x + 18, y: b.y + 18 }, true);
      check(viewport.getSelection().join() === 'a,b,c', 'Alt-Shift rectangle did not add to existing selection');
      const count = requests.length, release = viewport.acquireInteraction('test-drawing');
      await rectangle(viewport, { x: a.x - 10, y: a.y - 10 }, { x: b.x + 10, y: b.y + 10 });
      check(requests.length === count, 'Selection stole active drawing input'); release();
      // Unhandled input remains available to native navigation. Restore an on-screen click subject.
      viewport.setCamera({ center: [0, 0], zoom: 15, bearing: 0, pitch: 0 }); await idle(viewport);
      ui.destroy(); ui.destroy();
      viewport.remove(['c']); await idle(viewport);
      const plain = attachInteractions(viewport, { picker: false, hover: false });
      const position = viewport.map.project([.004, 0]), canvas = viewport.map.getCanvas();
      check(position.x >= 0 && position.y >= 0 && position.x <= canvas.clientWidth && position.y <= canvas.clientHeight, 'Plain click subject must be displayed');
      viewport.setSelection(['a']); await click(viewport, .004, true);
      check(viewport.getSelection().join() === 'a', 'Disabled additive selection consumed native Shift box-zoom input');
      await click(viewport, .004); check(viewport.getSelection().join() === 'b', `Plain attachment default click stopped replacing selection: ${viewport.getSelection()}`); plain.destroy();
    } finally { ui.destroy(); viewport.destroy(); }
  } },
  { name: 'Rectangle interruptions recover and stale selection callbacks retire', async run(context) {
    const viewport = createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 }, features: [point('a', 0)], logger: () => {} });
    context.setCurrent(viewport);
    const ui = attachInteractions(viewport, { boxSelection: true, picker: false, hover: false });
    const bridge = input(); let requests = 0;
    viewport.on('selectionrequest', event => { requests++; viewport.setSelection(event.ids); });
    try {
      await viewport.ready; await idle(viewport); const center = viewport.map.project([0, 0]);
      const beforeFeatures = JSON.stringify(viewport.getFeatures()), beforeSelection = JSON.stringify(viewport.getSelection());
      const sparseBounds: ScreenBounds = [{ x: 0, y: 0 }, { x: 30, y: 30 }]; Reflect.deleteProperty(sparseBounds, '0');
      for (const bounds of [...[NaN, Infinity].map((invalid): ScreenBounds => [{ x: invalid, y: 0 }, { x: 30, y: 30 }]), sparseBounds]) {
        let failure: unknown;
        try { viewport.queryFeatures(bounds); } catch (cause) { failure = cause; }
        check(failure instanceof RidgelineError && failure.code === 'INVALID_CONFIGURATION' && failure.context.operation === 'queryFeatures' && failure.context.recoverable,
          'Invalid rectangle bounds did not produce the contextual query error');
        check(JSON.stringify(viewport.getFeatures()) === beforeFeatures && JSON.stringify(viewport.getSelection()) === beforeSelection && !viewport.getInteractionOwner() && requests === 0,
          'Invalid rectangle query changed features, selection or interaction ownership');
      }
      const start = { x: center.x - 30, y: center.y - 30 }, end = { x: center.x + 30, y: center.y + 30 };
      for (const interruption of ['Escape', 'camera'] as const) {
        const count = requests;
        await bridge.down('Alt'); await bridge.mouse('down', start.x, start.y); await bridge.mouse('move', end.x, end.y);
        check(context.container.querySelector('.rl-selection-box'), 'Interrupted fixture never acquired a rectangle');
        if (interruption === 'Escape') await bridge.key('Escape');
        else viewport.setCamera({ bearing: 15 });
        await bridge.mouse('up', end.x, end.y); await bridge.up('Alt');
        check(requests === count && !viewport.getInteractionOwner() && !context.container.querySelector('.rl-selection-box'), `${interruption} retained a stale rectangle`);
        viewport.setCamera({ bearing: 0 }); await idle(viewport); await rectangle(viewport, start, end);
        check(requests === count + 1 && viewport.getSelection().join() === 'a', `${interruption} prevented a subsequent valid rectangle`);
      }
      const count = requests;
      await bridge.down('Alt'); await bridge.mouse('down', start.x, start.y); await bridge.mouse('move', end.x, end.y);
      viewport.upsert([point('a', .03), point('b', 0)]); await idle(viewport);
      check(context.container.querySelector('.rl-selection-box'), 'Live updates cancelled rectangle feedback');
      await bridge.mouse('up', end.x, end.y); await bridge.up('Alt');
      check(requests === count + 1 && viewport.getSelection().join() === 'b', 'Rectangle used stored or obsolete positions during live updates');
      viewport.remove(['b']); viewport.upsert([point('a', 0)]); await idle(viewport);
      const zoom = viewport.map.getZoom(); await bridge.down('Shift');
      try { await bridge.mouse('down', start.x, start.y); await bridge.mouse('move', end.x, end.y); await bridge.mouse('up', end.x, end.y); }
      finally { await bridge.up('Shift'); }
      await context.until(() => viewport.map.getZoom() > zoom, 'native Shift box zoom');
      viewport.setCamera({ center: [0, 0], zoom: 15, bearing: 0 }); await idle(viewport);
      let obsolete = 0;
      const replace = viewport.on('selectionrequest', () => viewport.upsert([point('a', .04)]));
      const observe = viewport.on('selectionrequest', () => { obsolete++; });
      await click(viewport, 0); check(obsolete === 0, 'A later observer received a selection request after data replacement');
      replace(); observe(); await idle(viewport);
    } finally { await bridge.up('Alt'); await bridge.up('Shift'); ui.destroy(); viewport.destroy(); }
  } },
  { name: 'Feature presentation validates, preserves failures, and restores configurable native styles', async run(context) {
    const glyphs = new URL('./fixtures/noto-sans/0-255.pbf', import.meta.url).href + '?fontstack={fontstack}&range={range}';
    let appearance: FeatureStyle = { label: 'LABEL', labelStyle: { size: 18, color: '#0000ff', anchor: 'bottom', offset: [0, -2], haloWidth: 0 },
      icon: 'square', iconSize: 1.5, iconRotation: 45, iconAnchor: 'bottom', dashArray: [4, 1, 1, 1],
      selected: { color: '#ff0000', labelColor: '#ff0000', radius: 16 }, hover: { color: '#00ff00', radius: 12, iconOpacity: 0 } };
    const diagnostics: string[] = [];
    const line: MapFeature = { type: 'Feature', id: 'line', properties: {}, geometry: { type: 'LineString', coordinates: [[-.02, .006], [.02, .006]] } };
    const viewport = createViewport({ container: context.container, basemap: { ...basemap, glyphs }, camera: { center: [0, 0], zoom: 15 },
      features: [point('point', 0), line], style: () => appearance, elevationSampler: { sample: () => 0 }, logger: () => {}, onError: error => diagnostics.push(error.code) });
    context.setCurrent(viewport);
    try {
      await viewport.ready;
      const icon = new ImageData(12, 12); for (let i = 0; i < icon.data.length; i += 4) { icon.data[i] = 30; icon.data[i + 1] = 80; icon.data[i + 2] = 200; icon.data[i + 3] = 255; }
      viewport.registerIcon('square', { image: icon }); await idle(viewport);
      const center = viewport.map.project([0, 0]), crossing = viewport.map.project([0, .006]);
      check(viewport.queryFeatures([{ x: crossing.x - 2, y: crossing.y - 2 }, { x: crossing.x + 2, y: crossing.y + 2 }]).features.some(feature => feature.id === 'line'),
        'A rectangle missed a line crossing it with both endpoints outside');
      const source = viewport.map.getSource('rl:features'); check(source instanceof GeoJSONSource, 'Native source missing');
      const initial = viewport.map.querySourceFeatures('rl:features').find(feature => feature.properties?._rl_feature_id === 'point'); check(initial, 'Published point absent');
      check(initial.properties._rl_label_size === 18 && initial.properties._rl_icon_size === 1.5 && initial.properties._rl_icon_rotation === 45 && initial.properties._rl_icon_anchor === 'bottom', 'Configured native styles were not published');
      viewport.setSelection(['point']);
      const selected = await pixel(viewport, { x: center.x + 10, y: center.y + 10 });
      check(selected[0]! > 180 && selected[1]! < 80, 'Configured selected color/radius did not reach native pixels');
      viewport.setSelection([]); viewport.preview('point');
      const hovered = await pixel(viewport, { x: center.x + 3, y: center.y + 8 });
      check(hovered[1]! > 180 && hovered[0]! < 80, `Configured hover color/radius did not reach native pixels: ${[...hovered]}`); viewport.preview(null);
      const original = JSON.stringify(initial.properties);
      appearance.labelStyle!.size = 50;
      check(JSON.stringify(viewport.map.querySourceFeatures('rl:features').find(feature => feature.properties?._rl_feature_id === 'point')?.properties) === original, 'Mutating callback output changed accepted display');
      const sparseDash = new Array<number>(2); sparseDash[1] = 1;
      const sparseFont = new Array<string>(2); sparseFont[1] = 'Noto Sans Regular';
      const sparseOffset: [number, number] = [0, 1]; Reflect.deleteProperty(sparseOffset, '0');
      for (const invalid of [{ labelStyle: { size: -1 } }, { dashArray: sparseDash }, { labelStyle: { font: sparseFont } }, { labelStyle: { offset: sparseOffset } }] satisfies FeatureStyle[]) {
        const failures = diagnostics.filter(code => code === 'UPDATE_FAILED').length;
        appearance = invalid; viewport.upsert([point('point', .01)]);
        await context.until(() => diagnostics.filter(code => code === 'UPDATE_FAILED').length > failures, 'invalid style diagnostic'); await idle(viewport);
        check(viewport.queryFeatures([{ x: center.x - 10, y: center.y - 10 }, { x: center.x + 10, y: center.y + 10 }]).features.some(feature => feature.id === 'point'), 'Invalid styling removed the last accepted marker');
        check(JSON.stringify(viewport.map.querySourceFeatures('rl:features').find(feature => feature.properties?._rl_feature_id === 'point')?.properties) === original, 'Invalid styling partly replaced accepted presentation');
      }
      appearance = { label: 'RESTORED', labelStyle: { font: ['Noto Sans Regular'], size: 20, anchor: 'right', offset: [-1, 0] }, dashArray: [2, 2], icon: 'square', iconRotationAlignment: 'map' };
      viewport.retryUpdates(); await idle(viewport);
      viewport.configure({ basemap: { ...basemap, glyphs, layers: [{ ...basemap.layers[0]!, id: 'replacement' }] } });
      await context.until(() => viewport.map.getSource('rl:features') !== source && Boolean(viewport.map.getLayer('rl:labels')), 'native style reload'); await idle(viewport);
      const restored = viewport.map.querySourceFeatures('rl:features').find(feature => feature.properties?._rl_feature_id === 'point'); check(restored, 'Restored marker absent');
      check(restored.properties._rl_label_size === 20 && restored.properties._rl_label_anchor === 'right' && restored.properties._rl_icon_alignment === 'map', 'Style reload lost configured presentation');
      const model = point('model', -.006); model.entity = { heading: 0, model: { id: 'body', minimumSizePixels: 50 }, altitude: { meters: 10, reference: 'ground' }, attachments: [{ id: 'sphere', type: 'sphere', radius: 10 }] };
      viewport.upsert([model]); await viewport.registerModel('body', { bytes: groundModelGlb() });
      await context.until(() => viewport.getEntityState('model')?.representation === 'model', 'model rectangle subject'); await idle(viewport);
      const all = viewport.queryFeatures([{ x: 0, y: 0 }, { x: context.container.clientWidth, y: context.container.clientHeight }]);
      check(all.features.some(feature => feature.id === 'model') && all.attachments.some(hit => hit.entityId === 'model' && hit.attachmentId === 'sphere'), 'Rectangle missed model or physical attachment representations');
      check(viewport.map.querySourceFeatures('rl:features').filter(feature => feature.properties?._rl_feature_id === 'model').every(feature => feature.properties._rl_label_offset[0] < -1), 'Configured model label did not clear the body on the left');
      check(!diagnostics.some(code => code === 'STYLE_FAILED' || code === 'ASSET_FAILED'), `Renderer diagnostics during presentation: ${diagnostics}`);
    } finally { viewport.destroy(); }
  } },
  { name: 'Optional selection preserves a usable keyboard focus after picker dismissal', async run(context) {
    const viewport=createViewport({container:context.container,basemap,camera:{center:[0,0],zoom:15},features:[point('a',0),point('b',0)],logger:()=>{}});
    context.setCurrent(viewport);const ui=attachInteractions(viewport,{boxSelection:true,hover:false}),bridge=input();
    let requests=0;viewport.on('selectionrequest',()=>requests++);
    try {
      await viewport.ready;await idle(viewport);const canvas=viewport.map.getCanvas();canvas.focus();
      await click(viewport,0);await context.until(()=>Boolean(context.container.querySelector('.rl-picker')),'picker focus precondition');
      check(document.activeElement?.classList.contains('rl-sector'),'Picker did not acquire keyboard focus');
      const position=viewport.map.project([0,0]);await rectangle(viewport,{x:position.x-210,y:position.y-30},{x:position.x+210,y:position.y+30});
      check(requests===1&&!context.container.querySelector('.rl-picker'),'Rectangle did not complete picker dismissal');
      const before=viewport.map.getCenter().toArray();await bridge.key('ArrowRight');
      await new Promise<void>(resolve=>setTimeout(resolve,500));
      const after=viewport.map.getCenter().toArray();

      const focusTag=document.activeElement?.tagName;canvas.focus();await bridge.key('ArrowRight');await new Promise<void>(resolve=>setTimeout(resolve,500));const restored=viewport.map.getCenter().toArray();check(JSON.stringify(after)!==JSON.stringify(restored),'Positive control: ArrowRight did not navigate after explicit map focus');check(JSON.stringify(before)!==JSON.stringify(after),`Keyboard navigation did not continue after rectangle removed the focused picker choice: focus=${focusTag}; before=${before}; after=${after}; focused-control=${restored}`);
    } finally {ui.destroy();viewport.destroy();}
  } },
  { name: 'Optional selection model rectangle queries retain the completed displayed frame until replacement draws', async run(context) {
    const model=point('body',0);model.entity={heading:0,model:{id:'body',minimumSizePixels:60}};
    const viewport=createViewport({container:context.container,basemap,camera:{center:[0,0],zoom:15},features:[model],elevationSampler:{sample:()=>0},logger:()=>{}});context.setCurrent(viewport);
    try {
      await viewport.ready;await viewport.registerModel('body',{bytes:groundModelGlb()});
      await context.until(()=>viewport.getEntityState('body')?.representation==='model','completed visible model before query');await idle(viewport);
      const position=viewport.map.project([0,0]), bounds:ScreenBounds=[{x:position.x-35,y:position.y-35},{x:position.x+35,y:position.y+35}];
      check(viewport.queryFeatures(bounds).features.some(f=>f.id==='body'),'Baseline displayed model is not queryable');
      const evidence=await new Promise<{before:number[];after:number[];hitIds:string[];geometry:unknown}>(resolve=>{
        viewport.map.once('render',()=>{
          const canvas=viewport.map.getCanvas(),gl=canvas.getContext('webgl2');check(gl,'Model query evidence requires WebGL2');
          const color=()=>{const p=new Uint8Array(4),ratio=canvas.width/canvas.clientWidth;gl.readPixels(Math.floor(position.x*ratio),canvas.height-1-Math.floor(position.y*ratio),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];};
          const before=color();const next={...model,geometry:{type:'Point' as const,coordinates:[.004,0]}};viewport.upsert([next]);
          const result=viewport.queryFeatures(bounds);resolve({before,after:color(),hitIds:result.features.map(f=>f.id),geometry:viewport.getFeature('body')!.geometry});
        });viewport.map.triggerRepaint();
      });
      check(evidence.before[0]!<220||evidence.before[1]!<220||evidence.before[2]!<220,`Baseline model pixel was absent: ${JSON.stringify(evidence)}`);
      check(JSON.stringify(evidence.before)===JSON.stringify(evidence.after),'No-draw model update changed framebuffer unexpectedly');
      const latest=viewport.map.project([.004,0]);await context.until(()=>viewport.queryFeatures([{x:latest.x-35,y:latest.y-35},{x:latest.x+35,y:latest.y+35}]).features.some(f=>f.id==='body'),'later replacement model query recovery');
      check(evidence.hitIds.includes('body'),`Displayed model disappeared from rectangle hits before a newer frame: ${JSON.stringify(evidence)}`);
    } finally {viewport.destroy();}
  } },

  { name: 'Optional selection rejects a lease round trip during rectangle release', async run(context) {
    const viewport = createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 }, features: [point('a', 0)], logger: () => {} });
    context.setCurrent(viewport); const ui = attachInteractions(viewport, { boxSelection: true, hover: false });
    let requests = 0, roundTrip = true;
    viewport.on('selectionrequest', () => { requests++; });
    viewport.on('interactionchange', ({ owner }) => { if (!owner && roundTrip) { roundTrip = false; viewport.acquireInteraction('replacement')(); } });
    try {
      await viewport.ready; await idle(viewport); viewport.setSelection(['a']);
      const center = viewport.map.project([0, 0]);
      await rectangle(viewport, { x: center.x - 30, y: center.y - 30 }, { x: center.x + 30, y: center.y + 30 });
      check(!roundTrip && requests === 0 && viewport.getSelection().join() === 'a', 'Release ownership round trip emitted an abandoned proposal');
      await rectangle(viewport, { x: center.x - 30, y: center.y - 30 }, { x: center.x + 30, y: center.y + 30 });
      check(Number(requests) === 1, 'Ownership cancellation prevented a later rectangle');
    } finally { ui.destroy(); viewport.destroy(); }
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
