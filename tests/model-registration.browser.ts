import { createViewport, RidgelineError } from '@ridgeline/map';
import type { MapFeature, Viewport } from '@ridgeline/map';
import { encodeGlb, solidGlb } from './model-fixtures';

type Context = { container: HTMLDivElement; setCurrent(viewport: Viewport): void;
  until(predicate: () => boolean, description: string, timeout?: number): Promise<void> };
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const feature = (id: string, longitude = 0): MapFeature => ({ type: 'Feature', id, properties: {},
  geometry: { type: 'Point', coordinates: [longitude, 0] }, entity: { heading: 0,
    model: { id: 'box', minimumSizePixels: 0 }, altitude: { meters: 20, reference: 'ground' } } });
function topFaceGlb() {
  const positions = new Float32Array([-1, 0, -1, -1, 0, 2, 2, 0, -1]);
  return encodeGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: positions.byteLength }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, 0, -1], max: [2, 0, 2] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  }, new Uint8Array(positions.buffer));
}
function create(context: Context, features: MapFeature[] = [], onError: (error: RidgelineError) => void = () => {}) {
  const viewport = createViewport({ container: context.container, basemap: { version: 8, sources: {}, layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }] },
    camera: { center: [0, 0], zoom: 19, pitch: 0, bearing: 0 }, features, elevationSampler: { sample: () => 0 }, logger: () => {}, onError });
  context.setCurrent(viewport); return viewport;
}
async function failure(promise: Promise<void>, code: string) {
  try { await promise; } catch (error) { check(error instanceof RidgelineError && error.code === code, `Expected ${code}, received ${String(error)}`); return; }
  throw new Error(`Expected ${code} rejection`);
}
async function magentaPixels(viewport: Viewport, side?: 'left' | 'right') {
  return new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Model pixel capture timed out.')), 8000);
    viewport.map.once('render', () => {
      clearTimeout(timeout);
      const canvas = viewport.map.getCanvas(), gl = canvas.getContext('webgl2');
      if (!gl) { reject(new Error('WebGL2 unavailable')); return; }
      const bytes = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      let count = 0;
      for (let i = 0; i < bytes.length; i += 4) {
        const x = i / 4 % canvas.width;
        if (side === 'left' && x >= canvas.width / 2 || side === 'right' && x < canvas.width / 2) continue;
        if (bytes[i]! > bytes[i + 1]! + 40 && bytes[i + 2]! > bytes[i + 1]! + 40) count++;
      }
      resolve(count);
    });
    viewport.map.triggerRepaint();
  });
}
export const modelRegistrationCases: readonly { name: string; run(context: Context): Promise<void> }[] = [
  { name: 'Shared solid models register replace and remove through the public viewport', async run(context) {
    const viewport = create(context, [feature('first', -.0004), feature('second', .0004)]);
    try {
      const bytes = solidGlb(), definition = { bytes, metersPerUnit: 10 };
      const registration = viewport.registerModel('box', definition);
      new Uint8Array(bytes).fill(0); definition.metersPerUnit = 100;
      await viewport.ready; await registration;
      await context.until(() => viewport.getEntityState('first')?.representation === 'model' && viewport.getEntityState('second')?.representation === 'model', 'both shared model instances');
      check(await magentaPixels(viewport, 'left') > 100, 'First shared instance did not draw in its region');
      check(await magentaPixels(viewport, 'right') > 100, 'Second shared instance did not draw in its region');
      viewport.setSelection(['first']);
      const snapshot = viewport.getEntityState('first');
      if (snapshot?.model) snapshot.model.status = 'failed';
      check(viewport.getEntityState('first')?.model?.status === 'ready', 'State read leaked mutable model status');
      const replacement = viewport.registerModel('box', { bytes: new ArrayBuffer(0) });
      check(viewport.getEntityState('first')?.model?.replacementPending, 'Replacement did not retain ready asset status');
      await failure(replacement, 'MODEL_UNSUPPORTED');
      check(viewport.getEntityState('first')?.model?.status === 'ready', 'Failed replacement discarded shared model');
      check(await magentaPixels(viewport) > 100, 'Failed replacement removed working model pixels');
      check(viewport.getSelection()[0] === 'first', 'Failed replacement changed selection');
      const invalid = feature('invalid');
      invalid.entity = { heading: 0, model: { id: 'box', switchDistanceMeters: 1, deadZoneMeters: 3 } };
      let rejected = false;
      try { viewport.upsert([feature('first', 0), invalid]); } catch (error) { rejected = error instanceof RidgelineError && error.code === 'INVALID_FEATURE'; }
      check(rejected && viewport.getFeature('first')?.geometry.coordinates[0] === -.0004 && !viewport.getFeature('invalid'), 'Invalid effective model settings partially changed the feature batch');
      viewport.remove(['first']);
      check(viewport.getEntityState('second')?.model?.status === 'ready', 'Removing one entity destroyed its shared asset');
      check(await magentaPixels(viewport, 'right') > 100, 'Removing the first instance hid the remaining shared geometry');
      check(await magentaPixels(viewport, 'left') === 0, 'Removed instance retained geometry');
      viewport.setSelection(['second']);
      viewport.unregisterModel('box');
      await context.until(() => viewport.getEntityState('second')?.representation === 'icon', 'icon fallback after unregister');
      check(viewport.getFeature('second') && viewport.getSelection()[0] === 'second', 'Unregister changed entity identity or selection');
      check(await magentaPixels(viewport) === 0, 'Unregister retained model pixels');
      viewport.unregisterModel('absent');
      await viewport.registerModel('box', { bytes: solidGlb(), metersPerUnit: 10 });
      await context.until(() => viewport.getEntityState('second')?.representation === 'model', 'registration recovers existing reference');
      await viewport.registerModel('box', { bytes: topFaceGlb(), metersPerUnit: 10 });
      check(await magentaPixels(viewport, 'right') > 100, 'Single-sided upward face was culled after the authored-axis turn');
    } finally { viewport.destroy(); }
  } },
  { name: 'Model registration waits cancels and isolates allocation failures', async run(context) {
    const errors: RidgelineError[] = [], viewport = create(context, [feature('instance')], error => errors.push(error));
    try {
      const cancelled = viewport.registerModel('pending', { bytes: solidGlb() });
      viewport.unregisterModel('pending'); await failure(cancelled, 'MODEL_LOAD_CANCELLED');
      check(!errors.some(error => error.context.modelId === 'pending'), 'Cancellation emitted an asset error');
      await viewport.ready;
      const broken = feature('broken'); broken.entity = { heading: 0, model: { id: 'broken', minimumSizePixels: 0 } };
      viewport.upsert([broken]);
      await failure(viewport.registerModel('broken', { bytes: new ArrayBuffer(0) }), 'MODEL_UNSUPPORTED');
      await context.until(() => viewport.getEntityState('broken')?.model?.status === 'failed' && viewport.getEntityState('broken')?.representation === 'icon', 'failed initial asset uses an icon');
      const unheaded = feature('unheaded'); if (unheaded.entity) delete unheaded.entity.heading;
      viewport.upsert([unheaded]);
      await viewport.registerModel('box', { bytes: solidGlb(), metersPerUnit: 10 });
      await context.until(() => viewport.getEntityState('instance')?.representation === 'model', 'initial model');
      await context.until(() => viewport.getEntityState('unheaded')?.representation === 'icon' && errors.some(error => error.code === 'MODEL_HEADING_MISSING' && error.context.featureId === 'unheaded'), 'missing heading retains icon with a scoped diagnostic');
      viewport.remove(['broken', 'unheaded']);
      const gl = viewport.map.getCanvas().getContext('webgl2'); if (!gl) throw new Error('WebGL2 unavailable');
      const createBuffer = gl.createBuffer, deleteBuffer = gl.deleteBuffer, createArray = gl.createVertexArray, deleteArray = gl.deleteVertexArray;
      let attempted = 0, allocated = 0, deleted = 0, allocatedArrays = 0, deletedArrays = 0;
      Object.defineProperty(gl, 'createBuffer', { configurable: true, writable: true, value: () => { attempted++; if (attempted === 3) return null; const value = createBuffer.call(gl); if (value) allocated++; return value; } });
      gl.deleteBuffer = function (buffer) { if (buffer) deleted++; deleteBuffer.call(this, buffer); };
      gl.createVertexArray = function () { const value = createArray.call(this); if (value) allocatedArrays++; return value; };
      gl.deleteVertexArray = function (array) { if (array) deletedArrays++; deleteArray.call(this, array); };
      try { await failure(viewport.registerModel('box', { bytes: solidGlb() }), 'MODEL_LOAD_FAILED'); }
      finally { gl.createBuffer = createBuffer; gl.deleteBuffer = deleteBuffer; gl.createVertexArray = createArray; gl.deleteVertexArray = deleteArray; }
      check(allocated === 2 && deleted === allocated, 'Partial upload did not release newly allocated buffers');
      check(allocatedArrays === 1 && deletedArrays === allocatedArrays, 'Partial upload did not release its vertex array');
      check(viewport.getEntityState('instance')?.model?.status === 'ready', 'Allocation failure removed working revision');
      check(await magentaPixels(viewport) > 100, 'Allocation failure hid the previous working model');
      check(errors.some(error => error.code === 'MODEL_LOAD_FAILED' && error.context.modelId === 'box'), 'Failure diagnostic omitted model ID');
    } finally { viewport.destroy(); }
  } },
  { name: 'Model callbacks cannot restore removed registrations or destroyed viewports', async run(context) {
    const viewport = create(context, [feature('instance')]);
    try {
      await viewport.ready;
      await context.until(() => Boolean(viewport.getEntityState('instance')), 'initial entity state');
      let remove = true;
      viewport.on('entitychange', () => {
        if (viewport.getEntityState('instance')?.model?.status === 'loading') {
          if (remove) viewport.unregisterModel('box'); else viewport.destroy();
        }
      });
      await failure(viewport.registerModel('box', { bytes: solidGlb() }), 'MODEL_LOAD_CANCELLED');
      check(viewport.getEntityState('instance')?.model?.status === 'unavailable', 'Cancelled registration restored model state');
      remove = false;
      await failure(viewport.registerModel('box', { bytes: solidGlb() }), 'MODEL_LOAD_CANCELLED');
      check(!viewport.getFeature('instance'), 'Destroyed viewport retained accepted entities');
    } finally { viewport.destroy(); }
    let staleDiagnostic = false;
    const cancelled = create(context, [], error => { if (error.code === 'MODEL_UNSUPPORTED') cancelled.destroy(); });
    cancelled.on('diagnostic', () => { staleDiagnostic = true; });
    try {
      await cancelled.ready;
      await failure(cancelled.registerModel('broken', { bytes: new ArrayBuffer(0) }), 'MODEL_UNSUPPORTED');
      check(!staleDiagnostic, 'Destroyed viewport emitted a later diagnostic callback');
    } finally { cancelled.destroy(); }
  } },
];
