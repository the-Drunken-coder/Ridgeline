import { createViewport, RidgelineError } from '@ridgeline/map';
import type { MapFeature, ModelAppearance, Viewport } from '@ridgeline/map';
import { MercatorCoordinate } from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { solidGlb } from './model-fixtures';
import { materialGlb } from './model-material-fixtures';

type Context = { container: HTMLDivElement; setCurrent(viewport: Viewport): void;
  until(predicate: () => boolean, description: string, timeout?: number): Promise<void> };
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const basemap = (color = '#ffffff'): StyleSpecification => ({ version: 8, sources: {}, layers: [
  { id: 'background', type: 'background', paint: { 'background-color': color } }] });
const feature = (id = 'instance', longitude = 0, modelId = 'material'): MapFeature => ({ type: 'Feature', id, properties: {},
  geometry: { type: 'Point', coordinates: [longitude, 0] }, entity: { heading: 0,
    model: { id: modelId, minimumSizePixels: 0 }, altitude: { meters: 20, reference: 'ground' } } });
function create(context: Context, features = [feature()], appearances = new Map<string, ModelAppearance>(), onError: (error: RidgelineError) => void = () => {}) {
  const viewport = createViewport({ container: context.container, basemap: basemap(),
    camera: { center: [0, 0], zoom: 19, pitch: 0, bearing: 0 }, features, elevationSampler: { sample: () => 0 },
    style: feature => ({ color: '#00ffff', modelAppearance: appearances.get(feature.id) }), logger: () => {}, onError });
  context.setCurrent(viewport); return viewport;
}
function context(viewport: Viewport) {
  const gl = viewport.map.getCanvas().getContext('webgl2');
  if (!gl) throw new Error('WebGL2 unavailable');
  const extension = gl.getExtension('WEBGL_lose_context');
  if (!extension) throw new Error('Unsupported automation capability: WEBGL_lose_context');
  return { gl, extension };
}
async function lose(viewport: Viewport, test: Context) {
  const { extension } = context(viewport);
  let lost = false;
  viewport.map.once('webglcontextlost', () => { lost = true; });
  extension.loseContext();
  await test.until(() => lost, 'actual WebGL context loss');
  return extension;
}
async function restore(viewport: Viewport, test: Context, extension: WEBGL_lose_context) {
  let restored = false;
  viewport.map.once('webglcontextrestored', () => { restored = true; });
  extension.restoreContext();
  await test.until(() => restored && Boolean(viewport.map.getLayer('rl:models')), 'actual context restoration and model layer attachment');
}
async function capture(viewport: Viewport) {
  await new Promise<void>(resolve => { viewport.map.once('render', () => resolve()); viewport.map.triggerRepaint(); });
  return new Promise<{ bytes: Uint8Array; width: number }>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Recovery pixel capture timed out')), 8000);
    viewport.map.once('render', () => {
      clearTimeout(timeout);
      const { gl } = context(viewport), canvas = viewport.map.getCanvas();
      const bytes = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      resolve({ bytes, width: canvas.width });
    });
    viewport.map.triggerRepaint();
  });
}
function count(image: { bytes: Uint8Array; width: number }, color: 'magenta' | 'blue' | 'red' | 'green' | 'cyan', side?: 'left' | 'right') {
  let found = 0;
  for (let i = 0; i < image.bytes.length; i += 4) {
    const x = i / 4 % image.width;
    if (side === 'left' && x >= image.width / 2 || side === 'right' && x < image.width / 2) continue;
    const r = image.bytes[i]!, g = image.bytes[i + 1]!, b = image.bytes[i + 2]!;
    if (color === 'magenta' ? r > g + 80 && b > g + 80 : color === 'blue' ? b > r + 80 && b > g + 80 :
      color === 'red' ? r > b + 80 && r > g + 80 : color === 'green' ? g > r + 30 && g > b + 30 : g > r + 80 && b > r + 80) found++;
  }
  return found;
}
async function failure(promise: Promise<void>, code: string) {
  try { await promise; } catch (error) { check(error instanceof RidgelineError && error.code === code, `Expected ${code}, got ${String(error)}`); return; }
  throw new Error(`Expected ${code} rejection`);
}
function holdImages() {
  const original = globalThis.createImageBitmap;
  const held: { bitmap: ImageBitmap; release(): void }[] = [];
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, writable: true,
    value: (source: ImageBitmapSource, options?: ImageBitmapOptions) => original(source, options).then(bitmap =>
      new Promise<ImageBitmap>(resolve => { held.push({ bitmap, release: () => resolve(bitmap) }); })) });
  return { held, stop() { globalThis.createImageBitmap = original; }, release() { for (const image of held) image.release(); } };
}

export const modelRecoveryCases: readonly { name: string; run(context: Context): Promise<void> }[] = [
  { name: 'models retain resources through basemap replacement', async run(test) {
    const errors: RidgelineError[] = [];
    const viewport = create(test, [feature('first', -.0002), feature('second', .0002)], undefined, error => errors.push(error));
    const original = globalThis.createImageBitmap;
    let decodes = 0;
    Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, writable: true,
      value: (source: ImageBitmapSource, options?: ImageBitmapOptions) => { decodes++; return original(source, options); } });
    try {
      await viewport.ready;
      await viewport.registerModel('material', { bytes: materialGlb([{ image: 'png', unlit: true }]), metersPerUnit: 10 });
      const initial = await capture(viewport);
      check(count(initial, 'magenta', 'left') > 100 && count(initial, 'magenta', 'right') > 100, 'Shared initial model pixels missing');
      const loaded = decodes;
      viewport.setSelection(['first']);
      viewport.configure({ basemap: basemap('#fefefe') });
      await test.until(() => Boolean(viewport.map.isStyleLoaded() && viewport.map.getLayer('rl:models')), 'basemap model attachment');
      check(count(await capture(viewport), 'magenta') > 1000, 'Basemap replacement lost shared pixels');
      check(decodes === loaded, 'Basemap replacement duplicated accepted model uploads');
      check(viewport.getSelection()[0] === 'first', 'Basemap replacement lost selection');
      const held = holdImages();
      try {
        const pending = viewport.registerModel('material', { bytes: materialGlb([{ image: 'jpeg', unlit: true }]), metersPerUnit: 8 });
        await test.until(() => held.held.length === 1, 'replacement native JPEG decode');
        viewport.configure({ basemap: basemap('#ffffff') });
        await test.until(() => Boolean(viewport.map.isStyleLoaded() && viewport.map.getLayer('rl:models')), 'style restored during pending decode');
        check(viewport.getEntityState('first')?.model?.replacementPending, 'Basemap replacement lost the pending revision');
        held.stop(); held.release(); await pending;
        await test.until(() => held.held.every(image => image.bitmap.width === 0), 'detached and resumed bitmaps closed');
        check(count(await capture(viewport), 'magenta') > 1000, 'Current replacement did not render after style replacement');
      } finally { held.stop(); held.release(); }
      viewport.remove(['first']);
      check(count(await capture(viewport), 'magenta', 'right') > 100, 'Removing one entity disposed its shared registration');
    } finally { globalThis.createImageBitmap = original; viewport.destroy(); }
  } },
  { name: 'models rebuild current presentation after real context loss', async run(test) {
    const appearances = new Map<string, ModelAppearance>([['solid', { mode: 'color', color: 'red' }]]);
    const textured = feature('textured', -.0002);
    if (textured.entity) textured.entity.attachments = [{ id: 'area', type: 'circle', radius: 18, color: '#00ff00' }];
    const errors: RidgelineError[] = [], viewport = create(test, [textured, feature('solid', .0002, 'solid')], appearances, error => errors.push(error));
    try {
      const completed = viewport.registerModel('material', { bytes: materialGlb([{ image: 'png', unlit: true }]), metersPerUnit: 10 });
      await viewport.ready; await completed;
      await viewport.registerModel('solid', { bytes: solidGlb(), metersPerUnit: 8 });
      await test.until(() => viewport.getEntityState('textured')?.representation === 'model' && viewport.getEntityState('solid')?.representation === 'model', 'solid and textured models');
      const before = await capture(viewport);
      check(count(before, 'magenta', 'left') > 100 && count(before, 'red', 'right') > 100, 'Initial material pixels missing');
      const camera = viewport.map._camera.transform, point = MercatorCoordinate.fromLngLat([-.0002, 0]), eye = MercatorCoordinate.fromLngLat(camera.getCameraLngLat());
      const distance = Math.hypot((point.x - eye.x) / point.meterInMercatorCoordinateUnits(), camera.getCameraAltitude() - 20);
      viewport.configure({ entityModels: { switchDistanceMeters: distance, deadZoneMeters: 40, minimumSizePixels: 0 } });
      viewport.setSelection(['textured']); await capture(viewport);
      const extension = await lose(viewport, test);
      check(viewport.getEntityState('textured')?.representation === 'withheld' && viewport.getEntityState('solid')?.representation === 'withheld', 'Actual loss did not publish withheld representations');
      check(viewport.getEntityState('textured')?.model?.status === 'ready', 'Actual loss discarded accepted model readiness');
      appearances.set('textured', { mode: 'color', color: 'blue' });
      const moved = feature('textured', -.00016); moved.entity!.attachments = textured.entity!.attachments;
      viewport.upsert([moved]); viewport.setSelection(['solid']);
      let installed = false;
      const replacement = viewport.registerModel('material', { bytes: materialGlb([{ image: 'jpeg', unlit: true }]), metersPerUnit: 10 }).then(() => { installed = true; });
      await pause(60);
      check(!installed, 'Registration installed while its renderer was lost');
      await restore(viewport, test, extension); await replacement; await completed;
      await test.until(() => viewport.getEntityState('textured')?.representation === 'model' && viewport.getEntityState('solid')?.representation === 'model', 'inside-band choices return after restoration');
      const restored = await capture(viewport);
      check(count(restored, 'blue', 'left') > 100 && count(restored, 'magenta', 'left') === 0, 'Restoration used stale per-entity color');
      check(count(restored, 'red', 'right') > 100, 'Solid model resources did not rebuild');
      check(count(restored, 'green') > 100, 'Current ground attachment did not recover');
      check(viewport.getFeature('textured')?.geometry.coordinates[0] === -.00016 && viewport.getSelection()[0] === 'solid', 'Restoration lost current entity location or selection');
      check(!errors.some(error => error.code.startsWith('MODEL_') && error.code !== 'MODEL_UNAVAILABLE'), 'Successful restoration emitted a model failure');
      await test.until(() => viewport.map.loaded(), 'restored map settles');
      await pause(250);
      let frames = 0; const rendered = () => { frames++; }; viewport.map.on('render', rendered);
      await pause(5000); viewport.map.off('render', rendered);
      check(frames === 0, `Restored scene scheduled ${frames} frames during five idle seconds`);
    } finally { viewport.destroy(); }
  } },
  { name: 'model recovery cancels stale native image completions', async run(test) {
    const errors: RidgelineError[] = [], viewport = create(test, undefined, undefined, error => errors.push(error));
    try {
      await viewport.ready;
      await viewport.registerModel('material', { bytes: materialGlb(), metersPerUnit: 10 });
      await capture(viewport);
      const held = holdImages();
      try {
        const pending = viewport.registerModel('material', { bytes: materialGlb([{ image: 'jpeg' }]), metersPerUnit: 10 });
        const cancelled = failure(pending, 'MODEL_LOAD_CANCELLED');
        await test.until(() => held.held.length === 1, 'native decode begins before actual loss');
        const extension = await lose(viewport, test);
        const newest = viewport.registerModel('material', { bytes: materialGlb([{ unlit: true }]), metersPerUnit: 8 });
        await cancelled;
        held.stop(); await restore(viewport, test, extension); await newest;
        held.release(); await test.until(() => held.held.every(image => image.bitmap.width === 0), 'superseded native image closes after restoration');
        check(count(await capture(viewport), 'magenta') > 1000, 'Stale decode displaced the newest registration');
      } finally { held.stop(); held.release(); }
      for (const action of ['unregister', 'destroy'] as const) {
        await viewport.registerModel('material', { bytes: materialGlb([{ image: 'png' }]), metersPerUnit: 10 });
        await capture(viewport);
        const held = holdImages();
        try {
          const extension = await lose(viewport, test); await restore(viewport, test, extension);
          await test.until(() => held.held.length === 1, `${action}: accepted asset rebuild is decoding`);
          if (action === 'unregister') viewport.unregisterModel('material'); else viewport.destroy();
          held.stop(); held.release();
          await test.until(() => held.held.every(image => image.bitmap.width === 0), `${action}: late restore bitmap closes`);
          if (action === 'unregister') check(viewport.getEntityState('instance')?.model?.status === 'unavailable', 'Late restoration resurrected an unregistered asset');
          else check(!viewport.getFeature('instance'), 'Late restoration resurrected a destroyed viewport');
        } finally { held.stop(); held.release(); }
      }
      check(!errors.some(error => error.code === 'MODEL_LOAD_FAILED'), 'Intentional restore cancellation emitted an asset failure');
    } finally { viewport.destroy(); }
  } },
  { name: 'model recovery reports allocation failure and retries explicitly', async run(test) {
    const errors: RidgelineError[] = [], viewport = create(test, undefined, undefined, error => errors.push(error));
    const nativeDecode = globalThis.createImageBitmap;
    try {
      await viewport.ready;
      await viewport.registerModel('material', { bytes: materialGlb([{ image: 'png' }]), metersPerUnit: 10 });
      await capture(viewport);
      const { gl } = context(viewport), createBuffer = gl.createBuffer, deleteBuffer = gl.deleteBuffer;
      const buffers = new Set<WebGLBuffer>(); let attempted = 0;
      const extension = await lose(viewport, test);
      Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, writable: true,
        value: (source: ImageBitmapSource, options?: ImageBitmapOptions) => nativeDecode(source, options).then(bitmap => {
          Object.defineProperty(gl, 'createBuffer', { configurable: true, writable: true, value: () => {
            if (++attempted === 3) { gl.createBuffer = createBuffer; return null; }
            const buffer = createBuffer.call(gl); if (buffer) buffers.add(buffer); return buffer; } });
          return bitmap;
        }) });
      gl.deleteBuffer = function (buffer) { if (buffer) buffers.delete(buffer); deleteBuffer.call(this, buffer); };
      try {
        await restore(viewport, test, extension);
        await test.until(() => errors.some(error => error.context.operation === 'restoreModel'), 'scoped restore allocation failure');
        check(attempted === 3 && buffers.size === 0, 'Partial restore leaked allocated buffers');
        check(viewport.getEntityState('instance')?.model?.status === 'ready', 'Failed restore discarded accepted CPU registration');
        await test.until(() => viewport.getEntityState('instance')?.representation === 'icon', 'eligible icon after model restore failure');
        check(count(await capture(viewport), 'cyan') > 30, 'Failed restore hid usable icon fallback');
        await pause(200); check(errors.filter(error => error.context.operation === 'restoreModel').length === 1, 'Failed restore retried without an explicit request');
      } finally { globalThis.createImageBitmap = nativeDecode; gl.createBuffer = createBuffer; gl.deleteBuffer = deleteBuffer; }
      viewport.retryUpdates();
      await test.until(() => viewport.getEntityState('instance')?.representation === 'model', 'explicit retry restores retained asset');
      check(count(await capture(viewport), 'magenta') > 1000, 'Explicit retry did not rebuild model pixels');
      const failedExtension = await lose(viewport, test);
      const waiting = failure(viewport.registerModel('waiting', { bytes: solidGlb() }), 'MODEL_LOAD_FAILED');
      const canvas = viewport.map.getCanvas(), getContext = canvas.getContext;
      Object.defineProperty(canvas, 'getContext', { configurable: true, writable: true, value: (kind: string, ...args: unknown[]) =>
        kind === 'webgl2' ? null : Reflect.apply(getContext, canvas, [kind, ...args]) });
      try {
        failedExtension.restoreContext();
        let rejected = false; void waiting.then(() => { rejected = true; });
        await test.until(() => rejected, 'failed native painter recreation rejects queued registrations');
        await waiting;
      } finally { canvas.getContext = getContext; }
    } finally { globalThis.createImageBitmap = nativeDecode; viewport.destroy(); }
  } },
  { name: 'model frames recover from consumer prerender mutations', async run(test) {
    const viewport = create(test);
    try {
      await viewport.ready;
      await viewport.registerModel('material', { bytes: materialGlb([{ unlit: true }]), metersPerUnit: 10 });
      await test.until(() => viewport.getEntityState('instance')?.representation === 'model', 'initial representation before consumer mutation');
      await capture(viewport);
      let mutate = false;
      viewport.map.addLayer({ id: 'consumer-prerender', type: 'custom', renderingMode: '3d', render() {}, prerender() {
        if (!mutate) return;
        mutate = false;
        viewport.configure({ entityModels: { switchDistanceMeters: 1, deadZoneMeters: 0, minimumSizePixels: 0 } });
      } });
      const next = new Promise<{ bytes: Uint8Array; width: number }>(resolve => viewport.map.once('render', () => {
        const { gl } = context(viewport), canvas = viewport.map.getCanvas(), bytes = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        resolve({ bytes, width: canvas.width });
      }));
      mutate = true; viewport.map.triggerRepaint();
      const image = await next;
      check(count(image, 'cyan') > 30 && count(image, 'magenta') === 0,
        `Consumer prerender mutation produced stale or blank representation: ${count(image, 'cyan')} icon pixels, ${count(image, 'magenta')} model pixels`);
      check(viewport.getEntityState('instance')?.representation === 'icon', 'Mutation frame did not publish its drawn fallback');
    } finally { viewport.destroy(); }
  } },
];
