import { attachDrawing, attachInteractions, createViewport, RidgelineError, shapeGeometry } from '@ridgeline/map';
import type { FeatureStyle, MapFeature, ScreenBounds, Viewport } from '@ridgeline/map';
import { addProtocol, removeProtocol, GeoJSONSource } from 'maplibre-gl';
import { groundModelGlb } from './model-placement-fixtures';
import { waitForVisible } from './browser-observation';

import type { BrowserCaseContext as Context, BrowserCaseModule } from './context';
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

export const selectionWorkflowCases = {
  "Feature presentation unrelated callback updates preserve current publication": async (context) => {
    for (const action of ['control', 'upsert', 'remove'] as const) {
      let blue = false, mutate = false, triggered = false;
      const diagnostics: RidgelineError[] = [];
      const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 },
        features: [point('a', 0), point('b', .004)], logger: () => {}, onError: error => diagnostics.push(error),
        style: feature => {
          if (feature.id === 'a' && mutate) {
            mutate = false; triggered = true;
            if (action === 'upsert') viewport.upsert([point('b', .006)]);
            if (action === 'remove') viewport.remove(['b']);
          }
          return { color: blue ? '#0000ff' : '#ff0000', radius: 10 };
        } }));

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
  },
  "Feature presentation refresh inside a native click preserves later observers and selection intent": async (context) => {
    for (const refresh of [false, true]) {
      const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 }, features: [point('a', 0)], logger: () => {} }));

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
  },
  "Optional selection refuses completed-empty requests while renderer unavailable": async (context) => {
    for (const phase of ['lost', 'loading'] as const) {
      const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 }, features: [point('a', 0)], logger: () => {} }));

      const ui = attachInteractions(viewport, { boxSelection: true, picker: false, hover: false });
      const requests: string[][] = [];
      viewport.on('selectionrequest', event => { requests.push(event.ids); viewport.setSelection(event.ids); });
      let release: (() => void) | undefined;
      try {
        await viewport.ready;  await idle(viewport);  viewport.setSelection(['a']);
        const canvas = viewport.map.getCanvas(), gl = canvas.getContext('webgl2'); check(gl, 'Native WebGL2 unavailable');
        const extension = gl.getExtension('WEBGL_lose_context'); check(extension, 'Native context loss unavailable');
        if (phase === 'lost') {
          const lost = new Promise<void>(resolve => viewport.map.once('webglcontextlost', () => resolve()));
          extension.loseContext(); await lost;
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          check(gl.isContextLost() && !viewport.map.getLayer('rl:points'), 'Lost renderer precondition not reached');
        } else {
          let requested = false;
          addProtocol('heldstyle', async () => { requested = true; await new Promise<void>(resolve => { release = resolve; }); return { data: structuredClone(basemap) }; });
          viewport.configure({ basemap: 'heldstyle://renderer' });
          await context.until(() => requested && !!release && !viewport.map.getLayer('rl:points'), 'held native style loading with no owned layers');
        }
        check(!viewport.map.isMoving(), 'Camera must be stationary before unavailable-renderer selection');
        await rectangle(viewport, { x: 80, y: 80 }, { x: 120, y: 120 });
        check(JSON.stringify(requests) === '[]' && viewport.getSelection().join() === 'a', `${phase} renderer produced ${JSON.stringify(requests)} and selection ${viewport.getSelection()}`);
        if (phase === 'lost') {
          const restored = new Promise<void>(resolve => viewport.map.once('webglcontextrestored', () => resolve()));
          extension.restoreContext(); await restored;
        } else { release!(); release = undefined;  }
        await context.until(() => !!viewport.map.getLayer('rl:points'), 'usable renderer after interruption');
        const pointA = viewport.map.project([0, 0]);
        await context.until(() => viewport.queryFeatures([{ x: 0, y: 0 }, { x: canvas.clientWidth, y: canvas.clientHeight }]).features.some(feature => feature.id === 'a') && !viewport.map.isMoving(), `restored displayed feature a, phase=${phase}, center=${viewport.map.getCenter().toArray()}, point=${pointA.x}/${pointA.y}`);
        const restoredPoint = viewport.map.project([0, 0]);
        await rectangle(viewport, { x: restoredPoint.x - 30, y: restoredPoint.y - 30 }, { x: restoredPoint.x + 30, y: restoredPoint.y + 30 });
        check(requests.length === 1 && viewport.getSelection().join() === 'a', `${phase}: next valid rectangle failed to recover: ${JSON.stringify(requests)} / ${viewport.getSelection()}`);
      } finally { release?.(); removeProtocol('heldstyle'); ui.destroy(); viewport.destroy(); }
    }
  },
  "Optional selection query failures retain renderer context and recover": async (context) => {
    const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 }, features: [point('a', 0)], logger: () => {} }));

    const diagnostics: RidgelineError[] = []; viewport.on('diagnostic', error => diagnostics.push(error));
    try {
      await viewport.ready; await idle(viewport);
      const query = viewport.map.queryRenderedFeatures, failure = new Error('Native query unavailable');
      let observed: unknown;
      viewport.map.queryRenderedFeatures = () => { throw failure; };
      try { viewport.queryFeatures([{ x: 0, y: 0 }, { x: 640, y: 460 }]); }
      catch (error) { observed = error; }
      finally { viewport.map.queryRenderedFeatures = query; }
      check(observed instanceof RidgelineError && observed.context.operation === 'queryFeatures' && observed.cause === failure, 'Native query failure lost library context');
      check(diagnostics.filter(error => error.context.operation === 'queryFeatures').length === 1 && !diagnostics.some(error => error.code === 'CALLBACK_FAILED'), 'Renderer failure was duplicated or misclassified as a consumer callback');
      check(viewport.queryFeatures([{ x: 0, y: 0 }, { x: 640, y: 460 }]).features.some(feature => feature.id === 'a'), 'Next valid query failed to recover');
    } finally { viewport.destroy(); }
  },
  "Feature presentation basemap changes survive elevation preparation abort callbacks": async (context) => {
    for (const trigger of ['abort', 'native'] as const) {
    let preparing = false, patched = false, aborted = false, switching = false;
    const feature = point('pending', 0); feature.entity = { altitude: { meters: 100, reference: 'ground' } };
    const viewport = context.own(createViewport({ container: context.container, basemap: { ...basemap, name: 'First' }, camera: { center: [0, 0], zoom: 15 },
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
      } }));

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
  },
  "Feature presentation refreshes styles and controls native airborne and model feedback": async (context) => {
    let color = '#0000ff', disabled = true, brightness = 0, fail = false;
    const modeled = point('model', .004); modeled.entity = { heading: 0, model: { id: 'body', minimumSizePixels: 60 } };
    const airborne = point('air', 0); airborne.entity = { altitude: { meters: 100, reference: 'ground' } };
    const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 },
      features: [point('native', -.004), airborne, modeled], elevationSampler: { sample: () => 0 }, logger: () => {},
      style: feature => {
        if (fail && feature.id === 'native') throw new Error('palette unavailable');
        return { color, radius: 8, modelAppearance: { mode: 'color', color }, selected: { enabled: !disabled, color: '#ff0000', modelBrightness: brightness, lineWidth: 0 },
          hover: { enabled: !disabled, color: '#00ff00', radius: 16 } };
      } }));

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
  },
  "Feature presentation prioritizes selected labels without overlap or consumer replacement": async (context) => {
    const glyphs = new URL('../fixtures/noto-sans/0-255.pbf', import.meta.url).href + '?fontstack={fontstack}&range={range}';
    const viewport = context.own(createViewport({ container: context.container, basemap: { ...basemap, glyphs }, camera: { center: [0, 0], zoom: 15 },
      style: feature => ({ label: feature.id, selected: { enabled: false }, labelStyle: { size: 24, anchor: 'top', color: feature.id === 'first' ? '#ff0000' : '#0000ff', haloWidth: 0 } }), elevationSampler: { sample: () => 0 }, logger: () => {} }));

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
  },
  "Feature presentation rejects invalid callback roots and retains the working display": async (context) => {
    let invalid: unknown = { color: '#0000ff' }, failing = false, otherColor = '#0000ff';
    const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 }, features: [point('subject', -.003), point('other', .003)],
      style: feature => feature.id === 'subject' ? invalid as FeatureStyle : { color: otherColor }, logger: () => {} }));
    viewport.on('diagnostic', error => { if (error.context.featureId === 'subject' && error.code === 'UPDATE_FAILED') failing = true; });
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
  },
  "Feature presentation keeps saved solid lines thick feedback and map aligned icons visible": async (context) => {
    const shape = { kind: 'line' as const, vertices: [[-.003, -.003], [.003, -.003]] as [number, number][] };
    const saved: MapFeature = { type: 'Feature', id: 'saved', properties: {}, geometry: shapeGeometry(shape), drawing: { version: 1, shape,
      style: { color: '#00ff00', fillColor: '#00ff00', lineWidth: 8, fillOpacity: .2, dashed: false, label: '' } } };
    const line: MapFeature = { type: 'Feature', id: 'line', properties: {}, geometry: { type: 'LineString', coordinates: [[-.003, 0], [.003, 0]] } };
    const icon: MapFeature = { ...point('icon', .003), geometry: { type: 'Point', coordinates: [.003, .003] } };
    const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 }, features: [saved, line, icon], logger: () => {},
      style: feature => feature.id === 'saved' ? { dashArray: [1, 100] } : feature.id === 'line'
        ? { color: '#00ff00', lineWidth: 12, selected: { color: '#0000ff' }, hover: { color: '#ff0000' } }
        : { icon: 'orientation', iconRotationAlignment: 'map' } }));

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
  },
  "Feature presentation preserves CSS alpha in airborne feedback": async (context) => {
    const air = point('air', .003); air.entity = { altitude: { meters: 1, reference: 'ground' } };
    let color = 'rgba(0, 0, 255, .5)';
    const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 }, features: [point('native', -.003), air],
      entityVisibility: { footprints: false, zones: false, groundLines: false }, elevationSampler: { sample: () => 0 },
      style: () => ({ radius: 8, color: '#0000ff', selected: { color }, hover: { color } }), logger: () => {} }));

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
  },
  "Feature presentation refresh discards callback replacements and removals": async (context) => {
    let action: 'replace' | 'remove' | undefined;
    const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 },
      features: [point('subject', 0)], logger: () => {}, style: feature => {
        const next = action; action = undefined;
        if (next === 'replace') viewport.upsert([point(feature.id, .003)]);
        if (next === 'remove') viewport.remove([feature.id]);
        return { color: next ? '#ff0000' : '#0000ff' };
      } }));

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
  },
  "Optional selection point and rectangle queries agree on hidden native representations": async (context) => {
    const polygon: MapFeature = { type: 'Feature', id: 'fill', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-.004, -.001], [-.002, -.001], [-.002, .001], [-.004, .001], [-.004, -.001]]] } };
    let hidden = false;
    let fillStyle: FeatureStyle = { fillColor: '#00ff00', lineWidth: 0, label: '' };
    const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 }, features: [polygon, point('icon', .003)], logger: () => {},
      style: feature => feature.id === 'fill' ? fillStyle
        : { icon: 'visible', label: '', selected: { iconOpacity: hidden ? 0 : 1 } } }));

    let clickIds: string[] = [], hoverIds: string[] = [], contextIds: string[] = [];
    let clicks = 0, contexts = 0;
    viewport.on('click', event => { clicks++; clickIds = event.features.map(feature => feature.id); });
    viewport.on('hover', event => { hoverIds = event.features.map(feature => feature.id); });
    viewport.on('contextmenu', event => { contexts++; contextIds = event.features.map(feature => feature.id); });
    try {
      const bytes = new Uint8ClampedArray(80 * 80 * 4);
      for (let i = 0; i < bytes.length; i += 4) { bytes[i + 2] = 255; bytes[i + 3] = 255; }
      viewport.registerIcon('visible', { image: new ImageData(bytes, 80, 80) });
      await viewport.ready; await idle(viewport); viewport.setSelection(['fill', 'icon']);
      for (hidden of [false, true]) {
        fillStyle.selected = { fillOpacity: hidden ? 0 : 1 };
        viewport.refreshStyles();
        await context.until(() => ['fill', 'icon'].every(id => viewport.map.querySourceFeatures('rl:features').some(feature => feature.properties._rl_feature_id === id && feature.properties[id === 'fill' ? '_rl_selected_fillOpacity' : '_rl_selected_iconOpacity'] === (hidden ? 0 : 1))), 'current opacity palette publication');
        await idle(viewport);
        for (const [id, lng] of [['fill', -.003], ['icon', .003]] as const) {
          const anchor = viewport.map.project([lng, 0]);
          // The icon has an independently visible point underneath. Test its
          // outer image region beyond both the dot and click tolerance.
          const p = id === 'icon' ? { x: anchor.x + 25, y: anchor.y } : anchor;
          const color = await pixel(viewport, p);
          check(hidden ? color[0]! > 240 && color[1]! > 240 : id === 'icon' ? color[2]! > 180 && color[0]! < 70 : color[1]! > 180 && color[0]! < 70, 'Required visible/hidden representation was not painted');
          const queried = viewport.queryFeatures([{ x: p.x - 5, y: p.y - 5 }, { x: p.x + 5, y: p.y + 5 }]).features.map(feature => feature.id);
          await input().mouse('click', p.x, p.y);
          check(queried.includes(id) === !hidden && clickIds.includes(id) === !hidden, `hidden=${hidden}, ${id}: rectangle=${queried}, click=${clickIds}, layers=${viewport.map.queryRenderedFeatures([[p.x - 5, p.y - 5], [p.x + 5, p.y + 5]], { layers: ['rl:fill', 'rl:line', 'rl:icons'] }).map(hit => hit.layer.id)}`);
        }
      }
      const variants: readonly { name: string; style: FeatureStyle; selected?: boolean; hovered?: boolean; hidden: boolean; rgb: readonly [number, number, number] }[] = [
        { name: 'rgba zero', style: { fillColor: 'rgba(0,255,0,0)' }, hidden: true, rgb: [255, 255, 255] },
        { name: 'transparent', style: { fillColor: 'transparent' }, hidden: true, rgb: [255, 255, 255] },
        { name: 'hex zero', style: { fillColor: '#00ff0000' }, hidden: true, rgb: [255, 255, 255] },
        { name: 'base color fallback', style: { fillColor: undefined, color: 'transparent' }, hidden: true, rgb: [255, 255, 255] },
        { name: 'fill overrides base color', style: { color: 'transparent' }, hidden: false, rgb: [0, 255, 0] },
        { name: 'positive alpha', style: { fillColor: 'rgba(0,255,0,0.5)' }, hidden: false, rgb: [128, 255, 128] },
        { name: 'selected zero beats hover', style: { selected: { fillColor: 'transparent' }, hover: { fillColor: '#00ff00' } }, selected: true, hovered: true, hidden: true, rgb: [255, 255, 255] },
        { name: 'selected visible beats hover', style: { selected: { fillColor: '#00ff00', fillOpacity: 1 }, hover: { fillColor: 'transparent' } }, selected: true, hovered: true, hidden: false, rgb: [0, 255, 0] },
        { name: 'hover zero', style: { hover: { fillColor: '#00ff0000' } }, hovered: true, hidden: true, rgb: [255, 255, 255] },
        { name: 'omitted selected fill retains hover', style: { selected: { color: '#00ff00' }, hover: { fillColor: 'rgba(0,255,0,0)' } }, selected: true, hovered: true, hidden: true, rgb: [255, 255, 255] },
        { name: 'state color does not recolor fill', style: { fillColor: 'transparent', selected: { color: '#00ff00' } }, selected: true, hidden: true, rgb: [255, 255, 255] },
        { name: 'state color does not hide fill', style: { selected: { color: 'transparent', fillOpacity: 1 } }, selected: true, hidden: false, rgb: [0, 255, 0] },
        { name: 'disabled selection suppresses hover', style: { fillColor: 'transparent', selected: { enabled: false, fillColor: '#00ff00' }, hover: { fillColor: '#00ff00' } }, selected: true, hovered: true, hidden: true, rgb: [255, 255, 255] },
        { name: 'disabled hover retains base', style: { hover: { enabled: false, fillColor: 'transparent' } }, hovered: true, hidden: false, rgb: [0, 255, 0] },
      ];
      const { browserDrag } = window; check(browserDrag, 'Native right-click bridge unavailable');
      const center = viewport.map.project([-.003, 0]);
      const edge = viewport.map.project([-.002, 0]);
      check(edge.x - center.x > 12, 'Fill sample must be beyond the outline and pointer tolerances');
      for (const variant of variants) {
        await input().mouse('move', 10, 10);
        fillStyle = { fillColor: '#00ff00', fillOpacity: 1, lineWidth: 0, label: '', ...variant.style };
        viewport.setSelection(variant.selected ? ['fill'] : []); viewport.preview(variant.hovered ? 'fill' : null);
        viewport.refreshStyles();
        await context.until(() => viewport.map.querySourceFeatures('rl:features').some(feature => {
          const properties = feature.properties;
          return properties._rl_feature_id === 'fill' && properties._rl_fill === (fillStyle.fillColor ?? fillStyle.color ?? '#216e5b')
            && properties._rl_selected_fillColor === fillStyle.selected?.fillColor && properties._rl_hover_fillColor === fillStyle.hover?.fillColor
            && properties._rl_selected_color === fillStyle.selected?.color && properties._rl_selected_fillOpacity === fillStyle.selected?.fillOpacity
            && properties._rl_selected_enabled === (fillStyle.selected?.enabled ?? true) && properties._rl_hover_enabled === (fillStyle.hover?.enabled ?? true);
        }), `${variant.name} palette publication`);
        await idle(viewport);
        const color = await pixel(viewport, center);
        check(variant.rgb.every((channel, index) => Math.abs(color[index]! - channel) <= 2) && color[3] === 255, `${variant.name} pixels: ${[...color]}`);
        const queried = viewport.queryFeatures([{ x: center.x - 5, y: center.y - 5 }, { x: center.x + 5, y: center.y + 5 }]).features.map(feature => feature.id);
        const expected = variant.hidden ? [] : ['fill'];
        await input().mouse('move', center.x, center.y);
        const before = clicks; await input().mouse('click', center.x, center.y);
        check(clicks === before + 1, `${variant.name} native click was not delivered`);
        const canvas = viewport.map.getCanvas().getBoundingClientRect(), beforeContext = contexts;
        await browserDrag(canvas.left + center.x, canvas.top + center.y, canvas.left + center.x, canvas.top + center.y, 'right');
        check(contexts === beforeContext + 1, `${variant.name} native context menu was not delivered`);
        check(JSON.stringify(queried) === JSON.stringify(expected) && JSON.stringify(clickIds) === JSON.stringify(expected)
          && JSON.stringify(hoverIds) === JSON.stringify(expected) && JSON.stringify(contextIds) === JSON.stringify(expected),
          `${variant.name}: rectangle=${queried}, click=${clickIds}, hover=${hoverIds}, context=${contextIds}`);
      }
    } finally { viewport.destroy(); }
  },
  "Optional selection released Shift before mouseup performs one ordinary click": async (context) => {
    for (const releaseEarly of [false, true]) {
      const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 }, features: [point('a', -.004), point('b', .004)], logger: () => {} }));

      const ui = attachInteractions(viewport, { additiveSelection: true, hover: false });
      let requests = 0; viewport.on('selectionrequest', event => { requests++; viewport.setSelection(event.ids); });
      const bridge = input();
      try {
        await viewport.ready; await idle(viewport); viewport.setSelection(['a']);
        const pointB = viewport.map.project([.004, 0]), zoom = viewport.map.getZoom();
        await bridge.down('Shift');
        await bridge.mouse('down', pointB.x, pointB.y);
        await new Promise(resolve => setTimeout(resolve, 120));
        if (releaseEarly) await bridge.up('Shift');
        await bridge.mouse('up', pointB.x, pointB.y);
        if (!releaseEarly) await bridge.up('Shift');
        check(requests === 1 && viewport.getSelection().join() === (releaseEarly ? 'b' : 'a,b'), `releaseEarly=${releaseEarly}: requests=${requests}, ids=${viewport.getSelection()}`);
        check(viewport.map.getZoom() === zoom, 'Sub-threshold release changed the camera');
      } finally { await bridge.up('Shift'); ui.destroy(); viewport.destroy(); }
    }
  },
  "Optional selection remains request only until the consumer applies a filtered proposal": async (context) => {
    const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 },
      features: [point('original', -.006), point('a', 0), point('b', .002)], logger: () => {} }));

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
  },
  "Rectangle interruptions preserve selection through real renderer loss and restoration": async (context) => {
    const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 },
      features: [point('original', -.004), point('next', .004)], logger: () => {} }));

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
  },
  "Feature presentation preserves saved solids thick lines airborne highlights and map aligned icons": async (context) => {
    const shape = { kind: 'line' as const, vertices: [[-.02, .008], [.02, .008]] as [number, number][] };
    const drawing: MapFeature = { type: 'Feature', id: 'saved', properties: {}, geometry: shapeGeometry(shape),
      drawing: { version: 1, shape, style: { color: '#0000ff', fillColor: '#0000ff', lineWidth: 3, fillOpacity: .2, dashed: false, label: '' } } };
    const thick: MapFeature = { type: 'Feature', id: 'thick', properties: {}, geometry: { type: 'LineString', coordinates: [[-.02, -.008], [.02, -.008]] } };
    const area: MapFeature = { type: 'Feature', id: 'area', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-.002, -.002], [.002, -.002], [.002, .002], [-.002, .002], [-.002, -.002]]] } };
    const airborne = point('airborne', -.008); airborne.entity = { altitude: { meters: 100, reference: 'ground' } };
    const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 13 },
      features: [drawing, thick, area, airborne, point('icon', .008)], elevationSampler: { sample: () => 0 }, logger: () => {},
      style: feature => feature.id === 'saved' ? { dashArray: [2, 2] } : feature.id === 'thick' ? { color: '#0000ff', lineWidth: 10, hover: { lineWidth: 12, color: '#0000ff' } }
        : feature.id === 'area' ? { lineWidth: 0, selected: { color: '#ff0000' }, hover: { fillOpacity: 0 } }
        : feature.id === 'airborne' ? { selected: { color: '#ff0000', radius: 16 }, hover: { color: '#00ff00', radius: 12 } }
        : { icon: 'bar', radius: 0, iconRotationAlignment: 'map', hover: { iconOpacity: 0, radius: 0 } } }));

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
  },
  "Optional selection rejects rectangles during ongoing camera movement": async (context) => {
    const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 },
      features: [point('a', -.004), point('b', .004)], logger: () => {} }));

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
  },
  "Optional selection Shift clicks tolerate small pointer jitter": async (context) => {
    const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 },
      features: [point('a', -.004), point('b', .004)], logger: () => {} }));

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
  },
  "Optional selection Shift presses survive unrelated live updates": async ({ container, own, until }) => {
    const live = point('live', .02); live.entity = { altitude: { meters: 100, reference: 'ground' } };
    const viewport = own(createViewport({ container, basemap, camera: { center: [0, 0], zoom: 15 },
      features: [point('a', -.004), point('b', .004), live], logger: () => {} }));

    const ui = attachInteractions(viewport, { additiveSelection: true, boxSelection: true, hover: false });
    let requests = 0, updates = 0;
    viewport.on('selectionrequest', event => { requests++; viewport.setSelection(event.ids); });
    const bridge = input();
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      await viewport.ready; await idle(viewport); viewport.setSelection(['a']);
      const zoom = viewport.map.getZoom(), p = viewport.map.project([.004, 0]);
      const press = async (update: boolean) => {
        await bridge.down('Shift');
        try {
          await bridge.mouse('down', p.x, p.y);
          if (update) timer = setInterval(() => {
            const next = point('live', .02 + (++updates % 5) * 1e-6); next.entity = live.entity;
            viewport.upsert([next]);
          }, 33);
          await new Promise(resolve => setTimeout(resolve, 120));
          if (update) check(updates > 0, 'Live entity updates never reached the held Shift press');
          await bridge.mouse('up', p.x, p.y);
        } finally { await bridge.up('Shift'); if (timer) { clearInterval(timer); timer = undefined; } }
      };
      await press(false);
      await until(() => viewport.getSelection().join() === 'a,b', 'no-update control selected a,b');
      check(requests === 1 && Math.abs(viewport.map.getZoom() - zoom) < .01, 'No-update control emitted duplicate selection or changed camera');
      const control = { ids: viewport.getSelection(), zoom: viewport.map.getZoom(), requests };
      viewport.setSelection(['a']); requests = 0;
      await press(true);
      const observed = { ids: viewport.getSelection(), zoom: viewport.map.getZoom(), requests, updates };
      check(Math.abs(observed.zoom - zoom) < .01, `Live Shift press changed camera: ${JSON.stringify({ control, observed })}`);
      await until(() => viewport.getSelection().join() === 'a,b', `live Shift release selects a,b; ${JSON.stringify({ control, observed })}`);
      check(requests === 1, 'One live Shift gesture emitted multiple requests');
    } finally { if (timer) clearInterval(timer); ui.destroy(); viewport.destroy(); }
  },
  "Optional selection Shift release repicks display and retires lost gesture owners": async ({ container, own, until }) => {
    const viewport = own(createViewport({ container, basemap, camera: { center: [0, 0], zoom: 15 },
      features: [point('a', -.004), point('b', .004)], logger: () => {} }));

    const ui = attachInteractions(viewport, { additiveSelection: true, boxSelection: true, hover: false });
    const requests: string[] = [];
    viewport.on('selectionrequest', event => { requests.push(event.ids.join(',')); viewport.setSelection(event.ids); });
    const bridge = input();
    const focusTarget = document.createElement('button');
    focusTarget.type = 'button'; focusTarget.textContent = 'Application action';
    container.before(focusTarget);
    try {
      await viewport.ready; await idle(viewport); viewport.setSelection(['a']);
      const p = viewport.map.project([.004, 0]);
      const held = async (change: () => Promise<void>, jitter = 0) => {
        await bridge.down('Shift');
        try {
          await bridge.mouse('down', p.x, p.y);
          await change();
          await bridge.mouse('up', p.x + jitter, p.y);
        } finally { await bridge.up('Shift'); }
      };
      await held(async () => {
        viewport.upsert([point('b', .006), point('c', .004)]);
        await until(() => {
          const ids = viewport.queryFeatures([{ x: p.x - 3, y: p.y - 3 }, { x: p.x + 3, y: p.y + 3 }]).features.map(feature => feature.id);
          return ids.includes('c') && !ids.includes('b');
        }, 'replacement release target is actually displayed');
      });
      await until(() => viewport.getSelection().join() === 'a,c', 'Shift release chooses current display rather than press-time b');
      check(requests.join('|') === 'a,c', 'Release-time replacement emitted duplicate requests');
      for (const reason of ['camera', 'scene', 'focus', 'owner'] as const) {
        const previousRequests = requests.join('|');
        let expectedZoom = viewport.map.getZoom();
        if (reason === 'focus') {
          viewport.map.getCanvas().focus();
          check(document.activeElement === viewport.map.getCanvas(), 'Focus-loss precondition never focused the canvas');
        }
        await held(async () => {
          if (reason === 'camera') viewport.map.jumpTo({ center: [.000001, 0] });
          if (reason === 'scene') viewport.configure({ exaggeration: 2 });
          if (reason === 'focus') {
            const canvas = viewport.map.getCanvas();
            let blurred = false;
            const onBlur = () => { blurred = true; };
            canvas.addEventListener('blur', onBlur);
            try {
              await bridge.key('Tab');
              await until(() => blurred && document.activeElement === focusTarget, 'native Tab reaches the application control and actual canvas blur');
            } finally { canvas.removeEventListener('blur', onBlur); }
          }
          if (reason === 'owner') viewport.acquireInteraction('consumer')();
          expectedZoom = viewport.map.getZoom();
        }, 1);
        check(requests.join('|') === previousRequests && viewport.getSelection().join() === 'a,c', `${reason} loss completed an abandoned Shift gesture`);
        check(Math.abs(viewport.map.getZoom() - expectedZoom) < .01, `${reason} cancellation leaked native box zoom`);
      }
      await held(async () => {});
      await until(() => viewport.getSelection().join() === 'a', 'valid Shift gesture works after all interruption paths');
      check(requests.join('|') === 'a,c|a', 'Recovery did not emit exactly one new proposal');
    } finally { ui.destroy(); viewport.destroy(); focusTarget.remove(); }
  },
  "Optional selection toggles Shift candidates and retains radial intent": async (context) => {
    const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 },
      features: [point('a', -.004), point('b', .004)], logger: () => {} }));

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
      viewport.upsert([point('c', .004)]); viewport.setSelection(['a']);
      // Native idle can precede the queued feature publication. The click needs
      // both candidates in the current displayed snapshot, not only stored data.
      await context.until(() => {
        const p = viewport.map.project([.004, 0]);
        const ids = viewport.queryFeatures([{ x: p.x - 10, y: p.y - 10 }, { x: p.x + 10, y: p.y + 10 }]).features.map(feature => feature.id);
        return ids.includes('b') && ids.includes('c');
      }, 'published overlapping candidates');
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
      let nativeCancellations = 0; viewport.map.on('boxzoomcancel', () => { nativeCancellations++; });
      viewport.setSelection(['a']); await click(viewport, .004, true);
      check(nativeCancellations === 1, 'Disabled additive option did not preserve native Shift gesture handling');
      check(viewport.getSelection().join() === 'a', 'Disabled additive selection consumed native Shift box-zoom input');
      await click(viewport, .004); check(viewport.getSelection().join() === 'b', `Plain attachment default click stopped replacing selection: ${viewport.getSelection()}`); plain.destroy();
    } finally { ui.destroy(); viewport.destroy(); }
  },
  "Rectangle interruptions recover and stale selection callbacks retire": async (context) => {
    const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 }, features: [point('a', 0)], logger: () => {} }));

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
      viewport.setSelection(['a']);
      for (const interruption of ['Escape', 'camera', 'configuration'] as const) {
        const count = requests;
        await bridge.down('Alt'); await bridge.mouse('down', start.x, start.y); await bridge.mouse('move', end.x, end.y);
        check(context.container.querySelector('.rl-selection-box'), 'Interrupted fixture never acquired a rectangle');
        if (interruption === 'Escape') await bridge.key('Escape');
        else if (interruption === 'camera') viewport.setCamera({ bearing: 15 });
        else {
          viewport.configure({ exaggeration: 2 });
          check(requests === count && !viewport.getInteractionOwner() && !context.container.querySelector('.rl-selection-box')
            && viewport.getSelection().join() === 'a', 'Configuration did not synchronously retire the rectangle and preserve selection');
        }
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
  },
  "Feature presentation validates, preserves failures, and restores configurable native styles": async (context) => {
    const glyphs = new URL('../fixtures/noto-sans/0-255.pbf', import.meta.url).href + '?fontstack={fontstack}&range={range}';
    let appearance: FeatureStyle = { label: 'LABEL', labelStyle: { size: 18, color: '#0000ff', anchor: 'bottom', offset: [0, -2], haloWidth: 0 },
      icon: 'square', iconSize: 1.5, iconRotation: 45, iconAnchor: 'bottom', dashArray: [4, 1, 1, 1],
      selected: { color: '#ff0000', labelColor: '#ff0000', radius: 16 }, hover: { color: '#00ff00', radius: 12, iconOpacity: 0 } };
    const diagnostics: string[] = [];
    const line: MapFeature = { type: 'Feature', id: 'line', properties: {}, geometry: { type: 'LineString', coordinates: [[-.02, .006], [.02, .006]] } };
    const viewport = context.own(createViewport({ container: context.container, basemap: { ...basemap, glyphs }, camera: { center: [0, 0], zoom: 15 },
      features: [point('point', 0), line], style: () => appearance, elevationSampler: { sample: () => 0 }, logger: () => {}, onError: error => diagnostics.push(error.code) }));

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
  },
  "Optional selection preserves a usable keyboard focus after picker dismissal": async (context) => {
    const viewport=context.own(createViewport({container:context.container,basemap,camera:{center:[0,0],zoom:15},features:[point('a',0),point('b',0)],logger:()=>{}}));
    const ui=attachInteractions(viewport,{boxSelection:true,hover:false}),bridge=input();
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
  },
  "Optional selection model rectangle queries retain the completed displayed frame until replacement draws": async (context) => {
    const model=point('body',0);model.entity={heading:0,model:{id:'body',minimumSizePixels:60}};
    const viewport=context.own(createViewport({container:context.container,basemap,camera:{center:[0,0],zoom:15},features:[model],elevationSampler:{sample:()=>0},logger:()=>{}}));
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
  },
  "Optional selection rejects a lease round trip during rectangle release": async (context) => {
    const viewport = context.own(createViewport({ container: context.container, basemap, camera: { center: [0, 0], zoom: 15 }, features: [point('a', 0)], logger: () => {} }));
    const ui = attachInteractions(viewport, { boxSelection: true, hover: false });
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
  },
} satisfies BrowserCaseModule;
