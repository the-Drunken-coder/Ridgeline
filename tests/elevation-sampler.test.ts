import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RasterElevationSampler } from '../src/elevation-sampler';

test('raster readiness is local to failed tiles and resets on retry', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('tile failed'); };
  let reportFailure: (cause: unknown) => void = () => {};
  const failure = new Promise<unknown>(resolve => { reportFailure = resolve; });
  const sampler = new RasterElevationSampler(
    { tiles: ['https://example.test/{z}/{x}/{y}.png'], maxzoom: 1 },
    () => {},
    reportFailure,
  );
  try {
    assert.equal(sampler.sample(-90, -1), null);
    assert.match(String(await failure), /tile failed/);
    assert.equal(sampler.readiness([-90, -1], 1000), 'unavailable');
    assert.equal(sampler.readiness([90, -1], 1000), 'loading');
    assert.equal(sampler.readiness([179, -1], 300_000), 'unavailable');
    assert.equal(sampler.readiness([90, 86], 0), 'unavailable');
    sampler.retry();
    assert.equal(sampler.readiness([-90, -1], 1000), 'loading');
  } finally {
    sampler.destroy();
    globalThis.fetch = originalFetch;
  }
});

test('raster source failure makes every area unavailable', async () => {
  let reportFailure: (cause: unknown) => void = () => {};
  const failure = new Promise<unknown>(resolve => { reportFailure = resolve; });
  const sampler = new RasterElevationSampler({ tiles: [] }, () => {}, reportFailure);
  try {
    assert.equal(sampler.sample(0, 0), null);
    assert.match(String(await failure), /Elevation source needs tiles/);
    assert.equal(sampler.readiness([0, 0], 0), 'unavailable');
    assert.equal(sampler.readiness([90, 0], 0), 'unavailable');
  } finally {
    sampler.destroy();
  }
});

test('a no-data pixel does not settle a distant area inside the same tile', async () => {
  const originalFetch = globalThis.fetch;
  const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  const originalCanvas = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  const size = 8;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let index = 0; index < size * size; index++) rgba[index * 4 + 3] = 255;
  rgba[(1 * size + 1) * 4 + 3] = 0;
  globalThis.fetch = async () => new Response(new Blob());
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => ({ width: size, height: size, close() {} }),
  });
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    configurable: true,
    value: class {
      getContext() { return { drawImage() {}, getImageData: () => ({ data: rgba }) }; }
    },
  });
  let changes = 0;
  let tileLoaded!: () => void;
  const loaded = new Promise<void>(resolve => { tileLoaded = resolve; });
  const sampler = new RasterElevationSampler(
    { tiles: ['https://example.test/{z}/{x}/{y}.png'], maxzoom: 0 },
    () => { if (++changes === 2) tileLoaded(); },
    cause => { throw cause; },
  );
  const coordinate = (pixel: number) => {
    const fraction = (pixel + 0.5) / size;
    return [fraction * 360 - 180,
      Math.atan(Math.sinh(Math.PI * (1 - 2 * fraction))) * 180 / Math.PI] as const;
  };
  try {
    sampler.sample(0, 0);
    await Promise.resolve();
    sampler.sample(0, 0);
    await loaded;
    const missing = coordinate(1), distant = coordinate(6);
    assert.equal(sampler.sample(missing[0], missing[1]), null);
    assert.equal(sampler.readiness(missing, 0), 'unavailable');
    assert.notEqual(sampler.sample(distant[0], distant[1]), null);
    assert.equal(sampler.readiness(distant, 0), 'loading');
    sampler.retry();
    assert.equal(sampler.readiness(missing, 0), 'loading');
  } finally {
    sampler.destroy();
    globalThis.fetch = originalFetch;
    if (originalBitmap) Object.defineProperty(globalThis, 'createImageBitmap', originalBitmap);
    else Reflect.deleteProperty(globalThis, 'createImageBitmap');
    if (originalCanvas) Object.defineProperty(globalThis, 'OffscreenCanvas', originalCanvas);
    else Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
  }
});
