import { createViewport, RidgelineError } from '@ridgeline/map';
import type { ElevationSampler, MapFeature, Viewport } from '@ridgeline/map';
import { solidGlb } from './model-fixtures';

type Context = { container: HTMLDivElement; setCurrent(viewport: Viewport): void;
  until(predicate: () => boolean, description: string, timeout?: number): Promise<void> };
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const feature = (modelId = 'box'): MapFeature => ({ type: 'Feature', id: 'entity', properties: {},
  geometry: { type: 'Point', coordinates: [0, 0] }, entity: { heading: 0, model: { id: modelId, minimumSizePixels: 40 } } });
function create(context: Context, sampler: ElevationSampler = { sample: () => 0 }, errors: RidgelineError[] = []) {
  const viewport = createViewport({ container: context.container, basemap: { version: 8, sources: {}, layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }] },
    camera: { center: [0, 0], zoom: 14, pitch: 0, bearing: 0 }, features: [feature()], elevationSampler: sampler,
    style: () => ({ color: '#0000ff', radius: 8 }), logger: () => {}, onError: error => errors.push(error) });
  context.setCurrent(viewport); return viewport;
}
function distance(viewport: Viewport) { return viewport.map._camera.transform.getCameraAltitude(); }
function move(viewport: Viewport, meters: number) {
  viewport.map.jumpTo({ zoom: viewport.map.getZoom() + Math.log2(distance(viewport) / meters) });
}
function pixels(viewport: Viewport) {
  const canvas = viewport.map.getCanvas(), gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 unavailable');
  const bytes = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  let blue = 0, magenta = 0, minX = canvas.width, maxX = -1, minY = canvas.height, maxY = -1;
  for (let i = 0; i < bytes.length; i += 4) {
    const r = bytes[i]!, g = bytes[i + 1]!, b = bytes[i + 2]!;
    if (b > r + 50 && b > g + 50) blue++;
    if (r > g + 50 && b > g + 50) {
      magenta++; const x = i / 4 % canvas.width, y = Math.floor(i / 4 / canvas.width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return { blue, magenta, size: Math.max(maxX - minX + 1, maxY - minY + 1) * canvas.clientWidth / canvas.width,
    representation: viewport.getEntityState('entity')?.representation };
}
function frame(viewport: Viewport, change: () => void = () => viewport.map.triggerRepaint()) {
  return new Promise<ReturnType<typeof pixels>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Switching frame timed out')), 8000);
    viewport.map.once('render', () => { clearTimeout(timer); resolve(pixels(viewport)); });
    change();
  });
}
function only(value: ReturnType<typeof pixels>, expected: 'icon' | 'model', label: string) {
  check(value.representation === expected, `${label}: state ${value.representation}, expected ${expected}`);
  check(expected === 'model' ? value.magenta > 100 && value.blue === 0 : value.blue > 100 && value.magenta === 0,
    `${label}: blue=${value.blue}, magenta=${value.magenta}`);
}
async function ready(context: Context, viewport: Viewport, meters: number) {
  await viewport.ready;
  move(viewport, meters);
  await context.until(() => viewport.map.isSourceLoaded('rl:features') && Boolean(viewport.getEntityState('entity')), 'native entity publication');
  await viewport.registerModel('box', { bytes: solidGlb() });
  await pause(80);
}
export const modelSwitchingCases: readonly { name: string; run(context: Context): Promise<void> }[] = [
  { name: 'Model switching publishes one representation through distance and settings histories', async run(context) {
    const viewport = create(context);
    try {
      await ready(context, viewport, 2000);
      only(await frame(viewport), 'icon', 'initial band');
      viewport.setSelection(['entity']);
      for (const [meters, expected] of [[1880, 'model'], [2000, 'model'], [2090, 'model'], [2120, 'icon'], [2000, 'icon'], [1880, 'model']] as const)
        only(await frame(viewport, () => move(viewport, meters)), expected, `distance ${meters}`);
      const animated: ReturnType<typeof pixels>[] = [], capture = () => { animated.push(pixels(viewport)); };
      viewport.map.on('render', capture);
      for (const meters of [2300, 1700]) {
        const ended = new Promise<void>(resolve => viewport.map.once('moveend', () => resolve()));
        viewport.map.easeTo({ zoom: viewport.map.getZoom() + Math.log2(distance(viewport) / meters), duration: 350 });
        await ended;
      }
      viewport.map.off('render', capture);
      check(animated.length >= 4 && animated.some(value => value.representation === 'icon') && animated.some(value => value.representation === 'model'), 'Animated camera did not exercise both representations');
      for (const [index, value] of animated.entries()) only(value, value.representation === 'model' ? 'model' : 'icon', `animated frame ${index}`);
      const exact = distance(viewport);
      only(await frame(viewport, () => viewport.configure({ entityModels: { switchDistanceMeters: exact, deadZoneMeters: 0, minimumSizePixels: 40 } })), 'model', 'zero-width equality retains model');
      only(await frame(viewport, () => viewport.configure({ entityModels: { switchDistanceMeters: 1000, deadZoneMeters: 0, minimumSizePixels: 40 } })), 'icon', 'configuration exits');
      let invalid = false;
      try { viewport.configure({ entityModels: { switchDistanceMeters: 1000, deadZoneMeters: 2000, minimumSizePixels: 40 } }); }
      catch (error) { invalid = error instanceof RidgelineError && error.code === 'INVALID_CONFIGURATION'; }
      check(invalid && viewport.getConfiguration().entityModels.deadZoneMeters === 0, 'Invalid configuration changed accepted settings');
      const override = feature(); override.entity!.model!.switchDistanceMeters = 3000;
      viewport.upsert([override]);
      only(await frame(viewport), 'model', 'entity override enters');
      check(viewport.getSelection()[0] === 'entity', 'Switching changed selection');
      await viewport.registerModel('box', { bytes: solidGlb(), metersPerUnit: 2 });
      only(await frame(viewport), 'model', 'replacement draws current revision immediately');
      only(await frame(viewport, () => viewport.unregisterModel('box')), 'icon', 'unregister fallback');
    } finally { viewport.destroy(); }
  } },
  { name: 'Model switching preserves choices through temporary terrain and asset readiness', async run(context) {
    let known = true, finish: (() => void) | undefined;
    const sampler: ElevationSampler = { sample: () => known ? 0 : null,
      prepare: () => new Promise<void>(resolve => { finish = () => { known = true; resolve(); }; }) };
    const viewport = create(context, sampler);
    try {
      await ready(context, viewport, 2000);
      only(await frame(viewport), 'icon', 'loading becomes ready inside band');
      only(await frame(viewport, () => move(viewport, 1800)), 'model', 'entered before terrain loss');
      await frame(viewport, () => move(viewport, 2000));
      known = false;
      only(await frame(viewport, () => viewport.retryUpdates()), 'icon', 'unknown terrain fallback');
      await context.until(() => Boolean(finish), 'pending terrain preparation');
      finish?.();
      await context.until(() => viewport.getEntityState('entity')?.representation === 'model', 'stationary terrain recovery inside band');
      only(await frame(viewport), 'model', 'recovered prior choice');
      const unheaded = feature(); delete unheaded.entity!.heading;
      only(await frame(viewport, () => viewport.upsert([unheaded])), 'icon', 'heading loss resets');
      only(await frame(viewport, () => viewport.upsert([feature()])), 'icon', 'heading recovery inside band does not bypass entrance');
      await viewport.registerModel('other', { bytes: solidGlb() });
      only(await frame(viewport, () => viewport.upsert([feature('other')])), 'icon', 'reference change resets');
    } finally { viewport.destroy(); }
  } },
  { name: 'Model switching preflights failures and rejects reentrant stale frames', async run(context) {
    const errors: RidgelineError[] = [], viewport = create(context, undefined, errors);
    try {
      await ready(context, viewport, 1800);
      only(await frame(viewport), 'model', 'initial model');
      const gl = viewport.map.getCanvas().getContext('webgl2'); if (!gl) throw new Error('WebGL2 unavailable');
      const bufferData = gl.bufferData;
      let fail = true;
      Object.defineProperty(gl, 'bufferData', { configurable: true, writable: true, value: (...args: unknown[]) => {
        const data = args[1];
        if (fail && args[2] === gl.DYNAMIC_DRAW && data instanceof Float32Array && data.length === 17) { fail = false; throw new Error('Injected model preflight failure'); }
        return Reflect.apply(bufferData, gl, args);
      } });
      try { only(await frame(viewport, () => move(viewport, 2000)), 'icon', 'preflight failure in same frame'); }
      finally { gl.bufferData = bufferData; }
      check(errors.some(error => error.code === 'MODEL_RENDERER_FAILED'), 'Preflight failure was not reported');
      only(await frame(viewport, () => viewport.retryUpdates()), 'model', 'renderer recovery retains band choice');
      const draw = gl.drawElementsInstanced;
      gl.drawElementsInstanced = function () { throw new Error('Injected model draw failure'); };
      try { only(await frame(viewport), 'icon', 'draw failure reveals later native fallback'); }
      finally { gl.drawElementsInstanced = draw; }
      only(await frame(viewport, () => viewport.retryUpdates()), 'model', 'draw recovery');
      let replace = true;
      viewport.on('entitychange', () => {
        if (replace && viewport.getEntityState('entity')?.representation === 'icon') { replace = false; viewport.remove(['entity']); viewport.upsert([feature('missing')]); }
      });
      await frame(viewport, () => move(viewport, 2200));
      await context.until(() => viewport.getEntityState('entity')?.model?.status === 'unavailable', 'replacement callback owns current entity');
      only(await frame(viewport), 'icon', 'discarded frame cannot restore old model');
    } finally { viewport.destroy(); }
  } },
  { name: 'Model size floors use the rendered projected box and settle without idle frames', async run(context) {
    const viewport = create(context);
    try {
      await ready(context, viewport, 1800);
      viewport.configure({ entityModels: { switchDistanceMeters: 1e7, deadZoneMeters: 0, minimumSizePixels: 40 } });
      for (const zoom of [12, 14, 16]) {
        const value = await frame(viewport, () => viewport.map.jumpTo({ zoom, pitch: 35, bearing: 23 }));
        only(value, 'model', `size floor zoom ${zoom}`);
        check(value.size >= 37 && value.size <= 43, `Projected box floor was ${value.size}px at zoom ${zoom}`);
      }
      const physical = feature(); physical.entity!.model!.minimumSizePixels = 0;
      const close = await frame(viewport, () => { viewport.upsert([physical]); viewport.map.jumpTo({ zoom: 21, pitch: 0, bearing: 0 }); });
      check(close.magenta > 100 && close.size > 40, 'Physical geometry did not exceed the floor close up');
      await pause(600);
      let frames = 0; const count = () => { frames++; };
      viewport.map.on('render', count); await pause(5000); viewport.map.off('render', count);
      check(frames === 0, `Settled models rendered ${frames} idle frames`);
    } finally { viewport.destroy(); }
  } },
];
