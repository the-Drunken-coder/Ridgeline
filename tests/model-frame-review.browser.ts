import { createViewport, RidgelineError } from '@ridgeline/map';
import type { MapFeature, Viewport } from '@ridgeline/map';
import type { CustomLayerInterface } from 'maplibre-gl';
import { solidGlb } from './model-fixtures';
import { axisModelGlb } from './model-placement-fixtures';

type Context = { container: HTMLDivElement; setCurrent(viewport: Viewport): void;
  until(predicate: () => boolean, description: string, timeout?: number): Promise<void> };
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const entity = (id = 'model', color = '#ff0000'): MapFeature => ({ type: 'Feature', id,
  properties: { color }, geometry: { type: 'Point', coordinates: [0,0] },
  entity: { heading: 0, altitude: { meters: 30, reference: 'sea-level' }, model: { id: 'asset', minimumSizePixels: 80 } } });
function create(context: Context, features: MapFeature[]) {
  const viewport = createViewport({ container: context.container, features, elevationSampler: { sample: () => 0 },
    basemap: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }] },
    camera: { center: [0,0], zoom: 17, pitch: 35, bearing: 0 },
    entityModels: { switchDistanceMeters: 1e7, deadZoneMeters: 0, minimumSizePixels: 80 },
    style: feature => ({ radius: 0, modelAppearance: { mode: 'color', color: String(feature.properties.color) } }), logger: () => {} });
  context.setCurrent(viewport);
  const canvas = viewport.map.getCanvas(); canvas.dataset.ridgelineMeasure = 'true';
  const measures: PerformanceEntry[] = [];
  const observer = new PerformanceObserver(list => measures.push(...list.getEntries())); observer.observe({ type: 'measure' });
  let layer: CustomLayerInterface | undefined, inModel = false, inOwnedLayer = false;
  let uploads = 0, draws = 0;
  const addLayer = viewport.map.addLayer;
  viewport.map.addLayer = function (value, before) {
    if ((value.id === 'rl:models' || value.id === 'rl:entities') && value.type === 'custom') {
      if (value.id === 'rl:models') layer = value;
      const render = value.render, prerender = value.prerender;
      value.render = function (...args) {
        const previous = inOwnedLayer, previousModel = inModel;
        inModel = value.id === 'rl:models'; inOwnedLayer = true;
        try { return render.apply(this, args); } finally { inModel = previousModel; inOwnedLayer = previous; }
      };
      if (prerender) value.prerender = function (...args) {
        const previous = inOwnedLayer;
        inOwnedLayer = true;
        try { return prerender.apply(this, args); } finally { inOwnedLayer = previous; }
      };
    }
    return addLayer.call(this, value, before);
  };
  const gl = canvas.getContext('webgl2'); check(gl, 'WebGL2 unavailable');
  const draw = gl.drawElementsInstanced, drawArrays = gl.drawArrays, bufferData = gl.bufferData;
  const submitted: number[] = [];
  gl.drawElementsInstanced = function (...args) { if (inOwnedLayer) draws++; if (inModel) submitted.push(args[4]); return draw.apply(this, args); };
  gl.drawArrays = function (...args) { if (inOwnedLayer) draws++; return drawArrays.apply(this, args); };
  gl.bufferData = function (target, data, usage, offset?: number, length?: number): void {
    if (inOwnedLayer) uploads++;
    Reflect.apply(bufferData, this, offset === undefined ? [target,data,usage] : [target,data,usage,offset,length]);
  };
  const take = () => { measures.push(...observer.takeRecords()); return measures.splice(0); };
  return { viewport, submitted, take, layer: () => layer, work: () => `${uploads}:${draws}`,
    destroy() {
      observer.disconnect(); gl.drawElementsInstanced = draw; gl.drawArrays = drawArrays; gl.bufferData = bufferData;
      viewport.map.addLayer = addLayer; viewport.destroy();
    } };
}
function number(entry: PerformanceEntry, key: string) {
  check(entry instanceof PerformanceMeasure, 'Expected User Timing measure');
  const detail: unknown = entry.detail;
  check(typeof detail === 'object' && detail !== null, 'Measure detail absent');
  const value: unknown = Reflect.get(detail, key); check(typeof value === 'number', `Measure ${key} absent`); return value;
}
function lastFrame(entries: PerformanceEntry[]) {
  const entry = entries.filter(item => item.name === 'ridgeline:model:frame').at(-1);
  check(entry, 'Completed model frame fact absent'); return entry;
}
function pixels(viewport: Viewport) {
  const canvas = viewport.map.getCanvas(), gl = canvas.getContext('webgl2'); check(gl, 'WebGL2 unavailable');
  const bytes = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
  const red: number[] = [], blue: number[] = [], green: number[] = [];
  let x = 0, y = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    const r = bytes[i]!, g = bytes[i+1]!, b = bytes[i+2]!;
    if (bytes[i+3]! < 16) continue;
    if (r > g + 80 && r > b + 80) red.push(i / 4);
    if (g > r + 80 && g > b + 80) green.push(i / 4);
    if (b > r + 80 && b > g + 80) { blue.push(i / 4); x += i / 4 % canvas.width; y += canvas.height - 1 - Math.floor(i / 4 / canvas.width); }
  }
  const ratio = canvas.width / canvas.clientWidth;
  return { red, blue, green, blueCenter: [x / blue.length / ratio, y / blue.length / ratio] as const };
}
function frame(viewport: Viewport, change: () => void = () => viewport.map.triggerRepaint()) {
  return new Promise<ReturnType<typeof pixels>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Model review frame timed out')), 8000);
    viewport.map.once('render', () => { clearTimeout(timer); resolve(pixels(viewport)); }); change();
  });
}
async function click(x: number, y: number) { check(window.drawingPointer, 'Actual pointer bridge unavailable'); await window.drawingPointer('click', x, y); }
export const modelFrameReviewCases: readonly { name: string; run(context: Context): Promise<void> }[] = [
  { name: 'Model frame callbacks publish only current placement and appearance', async run(context) {
    const old = entity(), other = entity('other', '#00ff00'); other.geometry = { type: 'Point', coordinates: [-.0009,0] };
    other.entity!.model!.minimumSizePixels = 35;
    const latest = entity('model', '#0000ff'); latest.geometry = { type: 'Point', coordinates: [.00025,.0001] };
    latest.entity = { ...latest.entity, heading: 73, pitch: 24, roll: -16, altitude: { meters: 80, reference: 'sea-level' } };
    const f = create(context, [old, other]), { viewport } = f;
    let preflight: (() => void) | undefined, callback: (() => void) | undefined;
    viewport.on('entitychange', () => { const action = callback; callback = undefined; action?.(); });
    try {
      await viewport.ready; await viewport.registerModel('asset', { bytes: axisModelGlb() });
      await context.until(() => viewport.getEntityState('model')?.representation === 'model', 'initial model');
      check(f.layer(), 'Real model layer was not observed');
      viewport.map.addLayer({ id: 'model-review-update', type: 'custom', prerender() {
        const action = preflight; preflight = undefined; action?.();
      }, render() {} }, 'rl:models');
      // A directly accepted update is the independent control for all pose and style fields.
      viewport.upsert([latest]); await frame(viewport); const control = await frame(viewport);
      check(control.blue.length > 50 && control.green.length > 10, 'Current control models must actually draw');
      viewport.upsert([old]); await frame(viewport);
      f.take(); f.submitted.length = 0;
      const result = await frame(viewport, () => {
        preflight = () => { callback = () => viewport.upsert([latest]); viewport.upsert([old]); };
        viewport.map.triggerRepaint();
      });
      const records = f.take(), accepted = records.filter(item => item.name === 'ridgeline:model:accepted-update');
      check(accepted.length === 2, 'The callback history must accept the older and then newer batch');
      check(viewport.getEntityState('model')?.altitude === 80, 'First completed frame retained the older altitude');
      check(result.red.length === 0 && result.blue.join(',') === control.blue.join(','),
        `Callback pose/style differs from the directly accepted control: red=${result.red.length}, blue=${result.blue.length}/${control.blue.length}`);
      check(result.green.length > 10, 'Callback replacement dropped the unrelated model');
      check(number(lastFrame(records), 'updateRevision') === number(accepted[1]!, 'revision') && number(lastFrame(records), 'drawnModels') === 2,
        'Completed frame did not attribute current geometry to the latest accepted update');
      const hits: string[][] = []; viewport.on('click', event => { hits.push(event.features.map(feature => feature.id)); });
      await click(...result.blueCenter); check(hits.at(-1)?.includes('model'), 'Current callback model pixels did not own picking');
      const below = { ...latest, entity: { ...latest.entity, altitude: { meters: -10, reference: 'sea-level' as const } } };
      f.take(); f.submitted.length = 0;
      const hidden = await frame(viewport, () => {
        preflight = () => { callback = () => viewport.upsert([below]); viewport.upsert([old]); }; viewport.map.triggerRepaint();
      });
      check(viewport.getEntityState('model')?.placement === 'below-terrain' && viewport.getEntityState('model')?.representation !== 'model', 'Below-terrain callback retained an eligible model');
      check(hidden.red.length === 0 && hidden.blue.length === 0 && hidden.green.length > 10, 'Invalid callback placement drew a stale body or lost its neighbor');
      check(number(lastFrame(f.take()), 'drawnModels') === 1 && f.submitted.every(count => count === 1), 'Withheld model was submitted or counted');
      await click(...result.blueCenter); check(!hits.at(-1)?.includes('model'), 'Withheld callback retained its old pick box');
      const removed = await frame(viewport, () => {
        preflight = () => { callback = () => viewport.remove(['model']); viewport.upsert([old]); }; viewport.map.triggerRepaint();
      });
      check(!viewport.getEntityState('model') && removed.red.length === 0 && removed.green.length > 10, 'Removal callback revived model output');
      old.entity!.attachments = [{ id: 'physical', type: 'sphere', radius: 10 }];
      viewport.upsert([old]); await frame(viewport);
      let destroyed = false, retiredSynchronously = false, workAtDestroy = '';
      let replacement: Viewport | undefined;
      preflight = () => { callback = () => {
        destroyed = true; viewport.destroy(); viewport.destroy(); workAtDestroy = f.work();
        let rejected = false;
        try { viewport.upsert([old]); } catch (error) { rejected = error instanceof RidgelineError && error.code === 'DESTROYED'; }
        retiredSynchronously = rejected && !context.container.querySelector('canvas');
        replacement = createViewport({ container: context.container,
          basemap: { version: 8, sources: {}, layers: [{ id: 'new-background', type: 'background', paint: { 'background-color': '#ffffff' } }] }, logger: () => {} });
        context.setCurrent(replacement);
      }; viewport.upsert([old]); };
      viewport.map.triggerRepaint(); await context.until(() => destroyed, 'destroy from computation callback');
      check(replacement, 'Synchronous remount was not created');
      try {
        await replacement.ready; await viewport.ready;
        check(retiredSynchronously && f.work() === workAtDestroy, 'Destroyed computation continued custom uploads/draws or retained its DOM');
        check(context.container.classList.contains('maplibregl-map') && context.container.querySelectorAll('canvas').length === 1,
          'Retiring the old native frame removed the replacement viewport DOM or styling');
      } finally { replacement.destroy(); }
      check(!context.container.querySelector('canvas'), 'Ordinary destruction must remove DOM synchronously');
    } finally { f.destroy(); }
  } },
  { name: 'Models cull off-screen bodies after enlargement and recover on camera motion', async run(context) {
    const visible = entity('visible', '#ff0000'); delete visible.entity!.altitude; visible.entity!.model!.minimumSizePixels = 40;
    const outside = entity('outside', '#0000ff'); delete outside.entity!.altitude; outside.entity!.model!.minimumSizePixels = 80;
    outside.geometry = { type: 'Point', coordinates: [.01,0] };
    const f = create(context, [visible, outside]), { viewport } = f;
    try {
      viewport.setCamera({ pitch: 0 }); await viewport.ready; await viewport.registerModel('asset', { bytes: solidGlb() });
      await context.until(() => viewport.getEntityState('visible')?.representation === 'model', 'culling baseline');
      f.take(); f.submitted.length = 0; const initial = await frame(viewport);
      let fact = lastFrame(f.take());
      check(initial.red.length > 100 && initial.blue.length === 0, 'Culling baseline pixels are not separated');
      check(f.submitted.join(',') === '1' && number(fact, 'drawnModels') === 1 && number(fact, 'clippedBoxes') === 1 && number(fact, 'triangles') === 12,
        `Off-screen model reached submission or frame counts: draws=${f.submitted}, measured=${number(fact, 'drawnModels')}`);
      check(viewport.getEntityState('outside')?.representation === 'model', 'Off-screen culling reset the retained representation');
      const canvas = viewport.map.getCanvas(), edge = viewport.map.unproject([canvas.clientWidth + 10, canvas.clientHeight / 2]);
      outside.geometry = { type: 'Point', coordinates: [edge.lng, edge.lat] };
      f.take(); f.submitted.length = 0;
      const partial = await frame(viewport, () => viewport.upsert([outside])); fact = lastFrame(f.take());
      check(partial.blue.length > 100 && number(fact, 'drawnModels') === 2 && f.submitted.join(',') === '2', 'Enlarged partially visible body was culled by its off-screen anchor');
      const hits: string[][] = []; viewport.on('click', event => { hits.push(event.features.map(feature => feature.id)); });
      await click(...partial.blueCenter); check(hits.at(-1)?.includes('outside'), 'Visible enlarged edge lost its pick box');
      viewport.setCamera({ center: [edge.lng,edge.lat] }); const centered = await frame(viewport);
      check(centered.blue.length > partial.blue.length, 'Camera motion did not reveal the complete body');
      const ratio = canvas.width / canvas.clientWidth;
      const xs = centered.blue.map(index => index % canvas.width), ys = centered.blue.map(index => Math.floor(index / canvas.width));
      check(Math.max(Math.max(...xs)-Math.min(...xs)+1,Math.max(...ys)-Math.min(...ys)+1)/ratio >= 79, 'Viewport clipping changed the minimum size floor');
      // Once both models are off screen, their logical choice remains in the dead zone.
      check(viewport.map._camera.transform.getCameraAltitude() > 100, 'Re-entry must remain above the entrance boundary');
      viewport.configure({ entityModels: { switchDistanceMeters: 5000, deadZoneMeters: 9800, minimumSizePixels: 80 } });
      f.take(); f.submitted.length = 0;
      const empty = await frame(viewport, () => viewport.setCamera({ center: [.02,0] })); fact = lastFrame(f.take());
      check(empty.red.length === 0 && empty.blue.length === 0 && f.submitted.length === 0 && number(fact, 'drawnModels') === 0 && number(fact, 'clippedBoxes') === 0 && number(fact, 'batches') === 0,
        'Empty view retained a submitted model or presentation box');
      check(viewport.getEntityState('outside')?.representation === 'model', 'Culling reset the model choice inside the dead zone');
      const returned = await frame(viewport, () => viewport.setCamera({ center: [edge.lng,edge.lat] }));
      check(returned.blue.length > 100 && viewport.getEntityState('outside')?.representation === 'model', 'Camera re-entry did not recover the current model');
      await new Promise<void>(resolve => { viewport.map.once('idle', () => resolve()); viewport.map.triggerRepaint(); });
      let idleFrames = 0; const rendered = () => { idleFrames++; }; viewport.map.on('render', rendered);
      await pause(5000); viewport.map.off('render', rendered); check(idleFrames === 0, `Culling scheduled ${idleFrames} idle frames`);
    } finally { f.destroy(); }
  } },
  { name: 'Viewport destruction preserves synchronous listener remounts', async run(context) {
    const failures: string[] = [];
    for (const activeRender of [false,true]) {
      const f = create(context, [entity()]), { viewport } = f;
      let replacement: Viewport | undefined, emptyInListener = false;
      try {
        await viewport.ready; await viewport.registerModel('asset', { bytes: solidGlb() }); await frame(viewport);
        viewport.on('destroy', () => {
          emptyInListener = !context.container.querySelector('canvas');
          replacement = createViewport({ container: context.container, logger: () => {},
            basemap: { version: 8, sources: {}, layers: [{ id: 'replacement', type: 'background', paint: { 'background-color': '#ffffff' } }] } });
          context.setCurrent(replacement);
        });
        if (activeRender) {
          let armed = true;
          viewport.map.addLayer({ id: 'destroy-in-prerender', type: 'custom', prerender() {
            if (armed) { armed = false; viewport.destroy(); }
          }, render() {} }, 'rl:models');
          viewport.map.triggerRepaint();
          await context.until(() => Boolean(replacement), 'active render destroy listener remount');
        } else viewport.destroy();
        check(replacement, 'Destroy listener did not create the replacement'); await replacement.ready;
        const label = activeRender ? 'active native render' : 'ordinary destruction';
        if (!emptyInListener) failures.push(`${label} notified destroy before removing its owned DOM`);
        if (!context.container.classList.contains('maplibregl-map') || context.container.querySelectorAll('canvas').length !== 1)
          failures.push(`${label} removed the replacement DOM or shared map class`);
        viewport.destroy();
        check(context.container.querySelectorAll('canvas').length === 1, 'Repeated old destruction removed the replacement');
      } finally { replacement?.destroy(); f.destroy(); }
    }
    check(failures.length === 0, failures.join('; '));
  } },
];
