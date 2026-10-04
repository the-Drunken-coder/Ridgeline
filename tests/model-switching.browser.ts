import { createViewport, RidgelineError } from '@ridgeline/map';
import type { ElevationSampler, MapFeature, Viewport } from '@ridgeline/map';
import { solidGlb } from './model-fixtures';

type Context = { container: HTMLDivElement; setCurrent(viewport: Viewport): void;
  until(predicate: () => boolean, description: string, timeout?: number): Promise<void> };
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const feature = (modelId = 'box'): MapFeature => ({ type: 'Feature', id: 'entity', properties: {},
  geometry: { type: 'Point', coordinates: [0, 0] }, entity: { heading: 0, model: { id: modelId, minimumSizePixels: 40 } } });
function create(context: Context, sampler: ElevationSampler = { sample: () => 0 }, errors: RidgelineError[] = [], icon = false) {
  const viewport = createViewport({ container: context.container, basemap: { version: 8, sources: {}, layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }] },
    camera: { center: [0, 0], zoom: 14, pitch: 0, bearing: 0 }, features: [feature()], elevationSampler: sampler,
    style: () => ({ color: '#0000ff', radius: icon ? 0 : 8, icon: icon ? 'blue-model-icon' : undefined }), logger: () => {}, onError: error => errors.push(error) });
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
      const combined = feature(); combined.entity!.model!.deadZoneMeters = 1500;
      viewport.upsert([combined]);
      let combinedRejected = false;
      try { viewport.configure({ entityModels: { switchDistanceMeters: 500, deadZoneMeters: 0, minimumSizePixels: 40 } }); }
      catch (error) { combinedRejected = error instanceof RidgelineError && error.code === 'INVALID_CONFIGURATION'; }
      check(combinedRejected && viewport.getConfiguration().entityModels.switchDistanceMeters === 1000 &&
        viewport.getFeature('entity')?.entity?.model?.deadZoneMeters === 1500, 'Invalid combined defaults changed accepted state');
      const invalidEntity = feature(); invalidEntity.entity!.model!.deadZoneMeters = 2000;
      let entityRejected = false;
      try { viewport.upsert([invalidEntity]); } catch (error) { entityRejected = error instanceof RidgelineError; }
      check(entityRejected && viewport.getFeature('entity')?.entity?.model?.deadZoneMeters === 1500, 'Invalid combined entity override changed stored data');
      const inherited = feature(); inherited.entity!.model!.switchDistanceMeters = undefined; inherited.entity!.model!.deadZoneMeters = undefined;
      only(await frame(viewport, () => viewport.upsert([inherited])), 'icon', 'undefined entity fields inherit viewport settings');
      const override = feature(); override.entity!.model!.switchDistanceMeters = 3000;
      viewport.upsert([override]);
      only(await frame(viewport), 'model', 'entity override enters');
      check(viewport.getSelection()[0] === 'entity', 'Switching changed selection');
      await viewport.registerModel('box', { bytes: solidGlb(), metersPerUnit: 2 });
      only(await frame(viewport), 'model', 'replacement draws current revision immediately');
      only(await frame(viewport, () => viewport.unregisterModel('box')), 'icon', 'unregister fallback');
      await viewport.registerModel('box', { bytes: solidGlb() });
      viewport.remove(['entity']);
      const shared = Array.from({ length: 20 }, (_, index) => {
        const value = feature(); value.id = `shared-${index}`;
        value.entity!.model!.switchDistanceMeters = 3000; return value;
      });
      viewport.upsert(shared);
      const gl = viewport.map.getCanvas().getContext('webgl2'); if (!gl) throw new Error('WebGL2 unavailable');
      const draw = gl.drawElementsInstanced, counts: number[] = [];
      gl.drawElementsInstanced = function (mode, count, type, offset, instances) {
        if (count === 36) counts.push(instances);
        draw.call(this, mode, count, type, offset, instances);
      };
      try { await frame(viewport); } finally { gl.drawElementsInstanced = draw; }
      check(counts.length === 1 && counts[0] === 20, `Shared solid material was not instanced: ${counts.join(',')}`);
    } finally { viewport.destroy(); }
    for (const icon of [true, false]) {
      const airborne = create(context, undefined, [], icon);
      try {
        await ready(context, airborne, 2000);
        if (icon) {
          const image = new ImageData(24, 24);
          for (let i = 0; i < image.data.length; i += 4) { image.data[i + 2] = 255; image.data[i + 3] = 255; }
          airborne.registerIcon('blue-model-icon', { image });
        }
        const value = feature(); value.entity!.altitude = { meters: 50, reference: 'ground' };
        airborne.upsert([value]);
        await context.until(() => airborne.map.isSourceLoaded('rl:features') && airborne.getEntityState('entity')?.placement === 'airborne', 'airborne native representation');
        let blend = 0;
        airborne.map.addLayer({ id: 'switch-projection-reference', type: 'custom', render(_gl, input) { blend = input.defaultProjectionData.projectionTransition; } });
        for (const [projection, zoom, expectedBlend] of [['flat', 14, 0], ['globe', 5, 1], ['globe', 11.5, .5]] as const) {
          await frame(airborne, () => { airborne.configure({ projection }); airborne.map.jumpTo({ zoom }); });
          const at = distance(airborne);
          only(await frame(airborne, () => airborne.configure({ entityModels: { switchDistanceMeters: at * 2, deadZoneMeters: 0, minimumSizePixels: 40 } })), 'model', `${icon ? 'symbol' : 'dot'} ${projection} ${zoom} model`);
          only(await frame(airborne, () => airborne.configure({ entityModels: { switchDistanceMeters: at / 2, deadZoneMeters: 0, minimumSizePixels: 40 } })), 'icon', `${icon ? 'symbol' : 'dot'} ${projection} ${zoom} fallback`);
          check(Math.abs(blend - expectedBlend) < .01, `Expected blend ${expectedBlend}, received ${blend}`);
        }
      } finally { airborne.destroy(); }
    }
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
    const pending: AbortSignal[] = [];
    let knownRadius = 0, unrelatedPrepared = false, onAbort: (() => void) | undefined;
    const footprint = create(context, { sample: (lng, lat) => Math.abs(lng) <= knownRadius && Math.abs(lat) <= knownRadius ? 0 : null,
      prepare: (positions, signal) => {
        unrelatedPrepared ||= positions.some(([lng, lat]) => Math.abs(lng - .001) < 1e-9 && lat === 0);
        pending.push(signal);
        signal.addEventListener('abort', () => { const action = onAbort; onAbort = undefined; action?.(); });
        return new Promise<void>(() => {});
      } });
    try {
      await ready(context, footprint, 2000);
      const tile = document.createElement('canvas'); tile.width = 256; tile.height = 256;
      const paint = tile.getContext('2d'); if (!paint) throw new Error('Terrain fixture needs a canvas');
      paint.fillStyle = 'rgb(128,0,0)'; paint.fillRect(0, 0, 256, 256);
      footprint.configure({ terrain: true, elevation: { tiles: [tile.toDataURL()], encoding: 'terrarium', tileSize: 256, maxzoom: 0 } });
      only(await frame(footprint, () => move(footprint, 1800)), 'icon', 'unknown footprint keeps fallback');
      await context.until(() => pending.some(signal => !signal.aborted), 'pending exact model footprint');
      only(await frame(footprint, () => move(footprint, 2200)), 'icon', 'far switch retires footprint');
      check(pending.every(signal => signal.aborted), 'Far icon retained irrelevant model preparation');
      knownRadius = .00005;
      only(await frame(footprint, () => { footprint.upsert([feature()]); move(footprint, 1800); }), 'icon', 'unknown enlarged footprint keeps fallback');
      await context.until(() => pending.some(signal => !signal.aborted), 'pending enlarged model footprint');
      let removed = false;
      onAbort = () => { removed = true; footprint.remove(['entity']); };
      const enlarged = feature(); enlarged.entity!.model!.minimumSizePixels = 80;
      await frame(footprint, () => footprint.upsert([enlarged]));
      check(removed && !footprint.getEntityState('entity'), 'Terrain abort callback did not own removal');
      const beforeReset = pending.length;
      footprint.configure({ elevation: { ...footprint.getConfiguration().elevation, attribution: 'replacement after removal' } });
      await pause(100);
      check(pending.length === beforeReset, 'Removed model resurrected terrain preparation after provider reset');
      const ownershipFailures: string[] = [];
      await footprint.registerModel('other', { bytes: solidGlb() });
      await frame(footprint, () => { footprint.upsert([feature()]); move(footprint, 2200); footprint.retryUpdates(); });
      await frame(footprint, () => move(footprint, 1800));
      await context.until(() => pending.some(signal => !signal.aborted), 'reference-change pending footprint');
      let referenceAborted = false;
      onAbort = () => { referenceAborted = true; footprint.remove(['entity']); };
      const unaffected = feature('missing'); unaffected.id = 'unaffected'; unaffected.geometry.coordinates = [.001, 0];
      footprint.upsert([feature('other'), unaffected]);
      await frame(footprint);
      check(referenceAborted, 'Reference change did not abort model-owned preparation');
      if (footprint.getFeature('entity') || footprint.getEntityState('entity')) ownershipFailures.push('Reference change restored entity removed by abort callback');
      check(Boolean(footprint.getFeature('unaffected') && footprint.getEntityState('unaffected')), 'Cancelled entity dropped another accepted batch member');
      await context.until(() => unrelatedPrepared, 'unaffected batch member retains terrain preparation');
      if (!ownershipFailures.length) await context.until(() => footprint.map.isSourceLoaded('rl:features') &&
        !footprint.map.querySourceFeatures('rl:features').some(item => item.properties._rl_feature_id === 'entity'), 'removed reference retires native publication');
      footprint.remove(['unaffected']);
      await frame(footprint, () => { footprint.upsert([feature()]); move(footprint, 2200); footprint.retryUpdates(); });
      await frame(footprint, () => move(footprint, 1800));
      await context.until(() => pending.some(signal => !signal.aborted), 'removal pending footprint');
      let removalAborted = false;
      onAbort = () => { removalAborted = true; footprint.upsert([feature('missing')]); };
      footprint.remove(['entity']);
      await frame(footprint);
      check(removalAborted, 'Removal did not abort model-owned preparation');
      if (footprint.getFeature('entity')?.entity?.model?.id !== 'missing' || footprint.getEntityState('entity')?.model?.id !== 'missing')
        ownershipFailures.push('Removal discarded entity reintroduced by abort callback');
      check(ownershipFailures.length === 0, ownershipFailures.join('; '));
      await context.until(() => footprint.map.isSourceLoaded('rl:features') &&
        footprint.map.querySourceFeatures('rl:features').some(item => item.properties._rl_feature_id === 'entity'), 'reintroduced entity reaches native publication');
      only(await frame(footprint), 'icon', 'reintroduced entity owns native pixels');
    } finally { footprint.destroy(); }
  } },
  { name: 'Model switching preflights failures and rejects reentrant stale frames', async run(context) {
    let onSample: (() => void) | undefined;
    const sampler: ElevationSampler = { sample: () => { const action = onSample; onSample = undefined; action?.(); return 0; } };
    const errors: RidgelineError[] = [], viewport = create(context, sampler, errors);
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
      onSample = () => viewport.configure({ entityModels: { switchDistanceMeters: 1000, deadZoneMeters: 0, minimumSizePixels: 40 } });
      only(await frame(viewport, () => viewport.retryUpdates()), 'icon', 'sampling callback replaces current settings');
      only(await frame(viewport, () => viewport.configure({ entityModels: { switchDistanceMeters: 2000, deadZoneMeters: 200, minimumSizePixels: 40 } })), 'icon', 'latest settings keep the reset choice inside band');
      only(await frame(viewport, () => move(viewport, 1800)), 'model', 'fresh entrance after callback');
      let replace = true;
      viewport.on('entitychange', () => {
        if (replace && viewport.getEntityState('entity')?.representation === 'icon') { replace = false; viewport.remove(['entity']); viewport.upsert([feature('missing')]); }
      });
      await frame(viewport, () => move(viewport, 2200));
      await context.until(() => viewport.getEntityState('entity')?.model?.status === 'unavailable', 'replacement callback owns current entity');
      only(await frame(viewport), 'icon', 'discarded frame cannot restore old model');
    } finally { viewport.destroy(); }
    const disposed = create(context);
    try {
      await ready(context, disposed, 1800);
      let cancelled = false, followups = 0;
      const repaint = disposed.map.triggerRepaint;
      disposed.map.triggerRepaint = function () { if (cancelled) followups++; return repaint.call(this); };
      disposed.on('entitychange', () => {
        if (disposed.getEntityState('entity')?.model?.replacementPending) { disposed.destroy(); cancelled = true; }
      });
      let rejected = false;
      try { await disposed.registerModel('box', { bytes: solidGlb() }); }
      catch (error) { rejected = error instanceof RidgelineError && error.code === 'MODEL_LOAD_CANCELLED'; }
      await pause(50);
      check(cancelled && rejected && followups === 0, 'Destroyed registration callback retained later render work');
    } finally { disposed.destroy(); }
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
