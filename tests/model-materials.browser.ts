import { createViewport, RidgelineError } from '@ridgeline/map';
import type { MapFeature, ModelAppearance, Viewport } from '@ridgeline/map';
import { materialGlb } from './model-material-fixtures';
import type { MaterialPanel } from './model-material-fixtures';

type Context = { container: HTMLDivElement; setCurrent(viewport: Viewport): void;
  until(predicate: () => boolean, description: string, timeout?: number): Promise<void> };
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const feature = (id: string, longitude = 0): MapFeature => ({ type: 'Feature', id, properties: {},
  geometry: { type: 'Point', coordinates: [longitude, 0] }, entity: { heading: 0,
    model: { id: 'material', minimumSizePixels: 0 }, altitude: { meters: 20, reference: 'ground' } } });
function create(context: Context, features = [feature('instance')], appearances = new Map<string, ModelAppearance>(), errors: RidgelineError[] = []) {
  const viewport = createViewport({ container: context.container, basemap: { version: 8, sources: {}, layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }] },
    camera: { center: [0, 0], zoom: 19, pitch: 0, bearing: 0 }, features, elevationSampler: { sample: () => 0 },
    style: feature => ({ color: '#00ffff', modelAppearance: appearances.get(feature.id) }), logger: () => {}, onError: error => errors.push(error) });
  context.setCurrent(viewport); return viewport;
}
type Pixels = { bytes: Uint8Array; width: number; height: number };
async function pixels(viewport: Viewport): Promise<Pixels> {
  // Registration and upsert publish entity frames asynchronously; sample the settled material frame.
  await new Promise<void>(resolve => { viewport.map.once('render', () => resolve()); viewport.map.triggerRepaint(); });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Model pixel capture timed out.')), 8000);
    viewport.map.once('render', () => {
      clearTimeout(timeout);
      const canvas = viewport.map.getCanvas(), gl = canvas.getContext('webgl2');
      if (!gl) { reject(new Error('WebGL2 unavailable')); return; }
      const bytes = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      resolve({ bytes, width: canvas.width, height: canvas.height });
    });
    viewport.map.triggerRepaint();
  });
}
function count(image: Pixels, predicate: (r: number, g: number, b: number) => boolean, side?: 'left' | 'right') {
  let found = 0;
  for (let i = 0; i < image.bytes.length; i += 4) {
    const x = i / 4 % image.width;
    if (side === 'left' && x >= image.width / 2 || side === 'right' && x < image.width / 2) continue;
    if (predicate(image.bytes[i]!, image.bytes[i + 1]!, image.bytes[i + 2]!)) found++;
  }
  return found;
}
const red = (r: number, g: number, b: number) => r > 180 && g < 60 && b < 60;
const blue = (r: number, g: number, b: number) => b > 180 && r < 60 && g < 60;
const magenta = (r: number, g: number, b: number) => r > 180 && b > 180 && g < 60;
async function failure(promise: Promise<void>, code: string) {
  try { await promise; } catch (error) { check(error instanceof RidgelineError && error.code === code, `Expected ${code}, received ${String(error)}`); return; }
  throw new Error(`Expected ${code} rejection`);
}
export const modelMaterialCases: readonly { name: string; run(context: Context): Promise<void> }[] = [
  { name: 'Embedded PNG and JPEG preserve original and independent assigned appearances', async run(context) {
    const appearances = new Map<string, ModelAppearance>([['first', { mode: 'color', color: 'rgba(255, 0, 255, .2)' }], ['second', { mode: 'original' }]]);
    const viewport = create(context, [feature('first', -.0002), feature('second', .0002)], appearances);
    try {
      await viewport.ready;
      for (const image of ['png', 'jpeg'] as const) {
        await viewport.registerModel('material', { bytes: materialGlb([{ image, unlit: true }]), metersPerUnit: 10, appearance: { mode: 'color', color: '#00ffff' } });
        await context.until(() => viewport.getEntityState('first')?.representation === 'model' && viewport.getEntityState('second')?.representation === 'model', 'textured shared models');
        let captured = await pixels(viewport);
        check(count(captured, magenta, 'left') > 100, `${image}: assigned RGB was premultiplied by CSS alpha or source RGB`);
        check(count(captured, red, 'right') > 100 && count(captured, blue, 'right') > 100, `${image}: explicit original did not bypass the registered color (red ${count(captured, red, 'right')}, blue ${count(captured, blue, 'right')})`);
        appearances.set('first', { mode: 'color', color: 'blue' }); viewport.upsert([feature('first', -.0002)]);
        captured = await pixels(viewport);
        check(count(captured, blue, 'left') > 100 && count(captured, magenta, 'left') === 0, 'Appearance update did not replace only the current instance');
        check(count(captured, red, 'right') > 100, 'Updating a shared instance damaged original textures');
        appearances.set('first', { mode: 'color', color: 'rgba(255, 0, 255, .2)' }); viewport.upsert([feature('first', -.0002)]);
      }
      appearances.set('first', { mode: 'original' }); viewport.upsert([feature('first', -.0002)]);
      const restored = await pixels(viewport);
      check(count(restored, red, 'left') > 100 && count(restored, blue, 'left') > 100, 'Switching an assigned instance back to original did not restore its texture');
      appearances.delete('first'); viewport.upsert([feature('first', -.0002)]);
      check(count(await pixels(viewport), (r, g, b) => r < 10 && g > 245 && b > 245, 'left') > 100,
        'Absent per-entity appearance did not inherit the registered model color');
      await viewport.registerModel('material', { bytes: materialGlb(), metersPerUnit: 10 });
      check(count(await pixels(viewport), magenta, 'left') > 100, 'Generic style.color replaced the magenta model fallback');
    } finally { viewport.destroy(); }
  } },
  { name: 'Model alpha modes unlit emission and double sided materials render their supported appearance', async run(context) {
    const appearances = new Map<string, ModelAppearance>([['instance', { mode: 'color', color: '#ff00ff' }]]);
    const viewport = create(context, undefined, appearances);
    const load = async (panel: MaterialPanel) => {
      await viewport.registerModel('material', { bytes: materialGlb([panel]), metersPerUnit: 10 });
      return pixels(viewport);
    };
    try {
      await viewport.ready;
      const alpha: MaterialPanel = { image: 'alpha', unlit: true, baseColor: [0, 1, 0, .8], vertexColor: [0, 0, 1, .5] };
      const opaque = count(await load({ ...alpha, alphaMode: 'OPAQUE' }), magenta);
      check(opaque > 1000, 'Opaque material did not ignore source alpha');
      const mask = count(await load({ ...alpha, alphaMode: 'MASK', alphaCutoff: .3 }), magenta);
      check(mask > opaque * .2 && mask < opaque * .3, `Mask did not multiply image, base and vertex alpha: ${mask}/${opaque}`);
      const widerMask = count(await load({ ...alpha, alphaMode: 'MASK', alphaCutoff: .15 }), magenta);
      check(widerMask > opaque * .45 && widerMask < opaque * .55, 'Alpha cutoff did not preserve the half-transparent region');
      const blended = await load({ ...alpha, alphaMode: 'BLEND' });
      check(count(blended, (r, g, b) => r > 245 && b > 245 && g > 145 && g < 160) > opaque * .2,
        'Blend did not preserve combined .4 source alpha');
      check(count(blended, (r, g, b) => r > 245 && b > 245 && g > 198 && g < 210) > opaque * .2,
        'Blend did not preserve half-transparent texture alpha');
      check(count(await load({ unlit: true, backFace: true }), magenta) === 0, 'Single-sided back faces were visible');
      check(count(await load({ unlit: true, backFace: true, doubleSided: true }), magenta) > opaque * .9, 'Double-sided back faces were culled');
      const lit = await load({});
      check(count(lit, (r, g, b) => r > 220 && r < 250 && b > 220 && b < 250 && g < 10) > opaque * .9,
        'Assigned color lost simple directional lighting');
      appearances.set('instance', { mode: 'original' }); viewport.upsert([feature('instance')]);
      const emission = await load({ baseColor: [0, 0, 0, 1], emissive: [0, 1, 0] });
      check(count(emission, (r, g, b) => r < 10 && g > 245 && b < 10) > opaque * .9, 'Original colored emission did not render');
      appearances.set('instance', { mode: 'color', color: 'blue' }); viewport.upsert([feature('instance')]);
      check(count(await pixels(viewport), blue) > opaque * .9, 'Assigned RGB retained colored emission');
      appearances.set('instance', { mode: 'original' }); viewport.upsert([feature('instance')]);
      const unlit = await load({ unlit: true, baseColor: [.25, .25, .25, 1], vertexColor: [.5, 1, 1, 1], emissive: [1, 0, 0] });
      check(count(unlit, (r, g, b) => r > 94 && r < 104 && g > 133 && g < 143 && b > 133 && b < 143) > opaque * .9,
        'Unlit original did not preserve linear base/vertex factors while ignoring emission');
      await viewport.registerModel('material', { bytes: materialGlb([
        { bounds: [-1, 1], height: 1, unlit: true, baseColor: [1, 0, 0, .5], alphaMode: 'BLEND' },
        { bounds: [-1, 1], unlit: true, baseColor: [0, 0, 1, 1] },
      ]), metersPerUnit: 10 });
      check(count(await pixels(viewport), (r, g, b) => r > 110 && r < 145 && g < 10 && b > 110 && b < 145) > opaque * .8,
        'Translucent material did not draw after the opaque surface behind it');
    } finally { viewport.destroy(); }
  } },
  { name: 'Shared model images retain independent texture samplers and UV transforms', async run(context) {
    const viewport = create(context, undefined, new Map([['instance', { mode: 'original' }]]));
    try {
      await viewport.ready;
      const gl = viewport.map.getCanvas().getContext('webgl2'); if (!gl) throw new Error('WebGL2 unavailable');
      const createTexture = gl.createTexture, createSampler = gl.createSampler;
      let textures = 0, samplers = 0;
      gl.createTexture = function () { textures++; return createTexture.call(this); };
      gl.createSampler = function () { samplers++; return createSampler.call(this); };
      const repeat = { magFilter: 9728, minFilter: 9984, wrapS: 10497, wrapT: 10497 };
      try {
        await viewport.registerModel('material', { bytes: materialGlb([
          { image: 'png', unlit: true, uvScale: 2, sampler: repeat },
          { image: 'png', unlit: true, uvScale: 2, sampler: { ...repeat, wrapS: 33071, wrapT: 33071 } },
        ]), metersPerUnit: 10 });
      } finally { gl.createTexture = createTexture; gl.createSampler = createSampler; }
      check(textures === 1 && samplers === 2, `Shared image should own one texture and two samplers, got ${textures}/${samplers}`);
      const captured = await pixels(viewport), repeatingRed = count(captured, red, 'right'), clampedRed = count(captured, red, 'left');
      check(clampedRed > 100 && repeatingRed > clampedRed * 3 && repeatingRed < clampedRed * 5,
        `Independent repeat and clamp settings were lost: ${repeatingRed}/${clampedRed}`);
      await viewport.registerModel('material', { bytes: materialGlb([
        { image: 'png', unlit: true, transform: { scale: [.4, .4] } },
        { image: 'png', unlit: true, transform: { offset: [1, 1], scale: [.4, .4], rotation: Math.PI } },
      ]), metersPerUnit: 10 });
      const transformed = await pixels(viewport);
      check(count(transformed, red, 'right') > repeatingRed * 3, 'Texture transform scale did not select the red quadrant');
      check(count(transformed, (r, g, b) => r > 240 && g > 240 && b < 10, 'left') > repeatingRed * 3,
        'Texture transform offset and rotation did not select the yellow quadrant');
    } finally { viewport.destroy(); }
  } },
  { name: 'Model decoding cancellation and failed replacement release owned resources', async run(context) {
    const errors: RidgelineError[] = [], viewport = create(context, undefined, undefined, errors);
    const nativeDecode = globalThis.createImageBitmap;
    try {
      await viewport.ready;
      await viewport.registerModel('material', { bytes: materialGlb(), metersPerUnit: 10 });
      check(count(await pixels(viewport), magenta) > 1000, 'Initial textured model did not render');
      const gl = viewport.map.getCanvas().getContext('webgl2'); if (!gl) throw new Error('WebGL2 unavailable');
      const createTexture = gl.createTexture, deleteTexture = gl.deleteTexture, createSampler = gl.createSampler, deleteSampler = gl.deleteSampler;
      const texImage2D = gl.texImage2D;
      const textures = new Set<WebGLTexture>(), deletedTextures = new Set<WebGLTexture>(), samplers = new Set<WebGLSampler>(), decoded: ImageBitmap[] = [];
      // MapLibre may allocate its own frame textures while images decode. Track uploads from these actual decoded images.
      Object.defineProperty(gl, 'texImage2D', { configurable: true, writable: true, value: (...args: unknown[]) => {
        const source = args.at(-1), result = Reflect.apply(texImage2D, gl, args);
        if (source instanceof ImageBitmap && decoded.includes(source)) {
          const texture: unknown = gl.getParameter(gl.TEXTURE_BINDING_2D);
          if (texture instanceof WebGLTexture) textures.add(texture);
        }
        return result;
      } });
      gl.deleteTexture = function (texture) { if (texture) { textures.delete(texture); deletedTextures.add(texture); } deleteTexture.call(this, texture); };
      gl.createSampler = function () { const value = createSampler.call(this); if (value) samplers.add(value); return value; };
      gl.deleteSampler = function (sampler) { if (sampler) samplers.delete(sampler); deleteSampler.call(this, sampler); };
      Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, writable: true,
        value: (source: ImageBitmapSource, options?: ImageBitmapOptions) => nativeDecode(source, options).then(bitmap => { decoded.push(bitmap); return bitmap; }) });
      try {
        await failure(viewport.registerModel('material', { bytes: materialGlb([{ image: 'png' }, { image: 'invalid' }]) }), 'MODEL_LOAD_FAILED');
        check(decoded.length === 1 && decoded.every(bitmap => bitmap.width === 0), 'Partial decode retained its successful bitmap');
        check(textures.size === 0 && samplers.size === 0, 'Partial decode retained newly owned GPU resources');
        check(count(await pixels(viewport), magenta) > 1000, 'Malformed-image replacement removed working pixels');
        let attempts = 0;
        Object.defineProperty(gl, 'createSampler', { configurable: true, writable: true, value: function () {
          if (++attempts === 2) return null;
          const value = createSampler.call(gl); if (value) samplers.add(value); return value;
        } });
        await failure(viewport.registerModel('material', { bytes: materialGlb([{ image: 'png' }, { image: 'png',
          sampler: { magFilter: 9728, minFilter: 9984, wrapS: 33071, wrapT: 33071 } }]) }), 'MODEL_LOAD_FAILED');
        check(attempts === 2 && textures.size === 0 && samplers.size === 0, `Partial sampler allocation retained new shared resources (${attempts} attempts, ${textures.size} textures, ${samplers.size} samplers)`);
        check(decoded.every(bitmap => bitmap.width === 0), 'Failed GPU upload retained decoded bitmaps');
        check(count(await pixels(viewport), magenta) > 1000, 'Failed upload replacement removed working pixels');
        let cancelledTexture: WebGLTexture | undefined;
        Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, writable: true,
          value: (source: ImageBitmapSource, options?: ImageBitmapOptions) => nativeDecode(source, options).then(bitmap => {
            decoded.push(bitmap);
            gl.createTexture = function () {
              gl.createTexture = createTexture;
              const value = createTexture.call(this); if (value) cancelledTexture = value;
              viewport.unregisterModel('material');
              return value;
            };
            return bitmap;
          }) });
        await failure(viewport.registerModel('material', { bytes: materialGlb() }), 'MODEL_LOAD_CANCELLED');
        check(cancelledTexture && deletedTextures.has(cancelledTexture) && decoded.every(bitmap => bitmap.width === 0), 'Reentrant removal during texture allocation leaked the newly returned handle');
      } finally {
        gl.createTexture = createTexture; gl.deleteTexture = deleteTexture; gl.createSampler = createSampler; gl.deleteSampler = deleteSampler; gl.texImage2D = texImage2D;
        globalThis.createImageBitmap = nativeDecode;
      }
      await viewport.registerModel('material', { bytes: materialGlb(), metersPerUnit: 10 });
      await pixels(viewport);
      const assetErrors = () => errors.filter(error => ['MODEL_LOAD_FAILED', 'MODEL_UNSUPPORTED', 'MODEL_RENDERER_FAILED'].includes(error.code));
      const errorCount = assetErrors().length;
      for (const action of ['replace', 'remove', 'callback', 'destroy'] as const) {
        let release: (() => void) | undefined, late: ImageBitmap | undefined;
        Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, writable: true,
          value: (source: ImageBitmapSource, options?: ImageBitmapOptions) => nativeDecode(source, options).then(bitmap => {
            late = bitmap;
            return new Promise<ImageBitmap>(resolve => { release = () => resolve(bitmap); });
          }) });
        const pending = viewport.registerModel('material', { bytes: materialGlb(), metersPerUnit: 10 });
        const rejected = failure(pending, 'MODEL_LOAD_CANCELLED');
        await context.until(() => Boolean(release), `${action}: actual image decode reaches delayed delivery`);
        // The native decoder has completed, but its Promise still belongs to the cancelled revision.
        globalThis.createImageBitmap = nativeDecode;
        if (action === 'replace') await viewport.registerModel('material', { bytes: materialGlb([{ image: 'jpeg', unlit: true }]), metersPerUnit: 10 });
        else if (action === 'destroy') viewport.destroy();
        else if (action === 'callback') {
          const remove = () => viewport.unregisterModel('material');
          const unsubscribe = viewport.on('entitychange', remove);
          viewport.upsert([feature('instance', .00001)]);
          await context.until(() => viewport.getEntityState('instance')?.model?.status === 'unavailable', 'callback removes decoding registration');
          unsubscribe();
        } else viewport.unregisterModel('material');
        let settled = false; void rejected.then(() => { settled = true; });
        await context.until(() => settled, `${action}: cancellation rejects before late decode delivery`);
        release?.();
        await context.until(() => late?.width === 0, `${action}: late bitmap is closed`);
        check(assetErrors().length === errorCount, `${action}: intentional decode cancellation emitted an asset-failure diagnostic`);
        if (action === 'replace') check(count(await pixels(viewport), magenta) > 1000, 'Stale PNG completion replaced the newer JPEG registration');
        if (action !== 'destroy') {
          await viewport.registerModel('material', { bytes: materialGlb(), metersPerUnit: 10 });
          await pixels(viewport);
        }
      }
    } finally { globalThis.createImageBitmap = nativeDecode; viewport.destroy(); }
  } },
];
