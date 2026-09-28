import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RasterElevationSampler } from '../src/elevation-sampler';
import { cameraTerrain, cameraTerrainPreparationBounds } from '../src/gpu-camera-terrain';

const pixels = new Uint8ClampedArray([
  128, 0, 0, 255, 128, 0, 0, 255,
  128, 0, 0, 255, 128, 0, 0, 255,
]);

async function withTiles(run: (requests: string[]) => Promise<void>, tileJSON?: object, imagePixels = pixels) {
  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  const originalBitmap = globalThis.createImageBitmap;
  const originalCanvas = globalThis.OffscreenCanvas;
  globalThis.fetch = async input => {
    const url = String(input);
    requests.push(url);
    return (url.endsWith('.json')
      ? { ok: true, json: async () => tileJSON }
      : { ok: true, blob: async () => new Blob() }) as unknown as Response;
  };
  globalThis.createImageBitmap = async () => ({ width: Math.sqrt(imagePixels.length / 4), height: Math.sqrt(imagePixels.length / 4), close() {} }) as ImageBitmap;
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    configurable: true,
    value: class {
      getContext() { return { drawImage() {}, getImageData() { return { data: imagePixels }; } }; }
    },
  });
  try { await run(requests); }
  finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalBitmap;
    Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: originalCanvas });
  }
}

async function settle(sampler: RasterElevationSampler, lng: number, lat: number) {
  for (let i = 0; i < 20; i++) {
    const value = sampler.sample(lng, lat);
    if (value !== null) return value;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.fail('Elevation did not settle');
}

test('TileJSON Terrarium and TMS metadata agree with raw height and geographic request', async () => {
  await withTiles(async requests => {
    const sampler = new RasterElevationSampler({ url: 'https://tiles.test/source.json', tileSize: 256 }, () => {}, cause => assert.fail(String(cause)));
    assert.equal(await settle(sampler, -45, 40), 0);
    assert.ok(requests.includes('https://tiles.test/2/1/2.png'));
    sampler.destroy();
  }, { tiles: ['https://tiles.test/{z}/{x}/{y}.png'], minzoom: 2, maxzoom: 2, encoding: 'terrarium', scheme: 'tms' });
});

test('raw URL templates resolve quadkey, prefix, and projected bounds', async () => {
  await withTiles(async requests => {
    const sampler = new RasterElevationSampler({
      tiles: ['https://tiles.test/{z}/{x}/{y}?q={quadkey}&p={prefix}&bbox={bbox-epsg-3857}'],
      encoding: 'terrarium', tileSize: 256, minzoom: 2, maxzoom: 2,
    }, () => {}, cause => assert.fail(String(cause)));
    assert.equal(await settle(sampler, -45, 40), 0);
    const request = requests.find(url => url.includes('bbox='));
    assert.ok(request);
    assert.match(request, /q=03&p=11&bbox=-10018754\.171394622,0,0,10018754\.171394622/);
    sampler.destroy();
  });
});

test('50km range uses a bounded working set that remains cached', async () => {
  await withTiles(async requests => {
    const sampler = new RasterElevationSampler({
      tiles: ['https://tiles.test/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256,
    }, () => {}, cause => assert.fail(String(cause)));
    try {
      sampler.sample(6, 46);
      await new Promise<void>(resolve => setImmediate(resolve));
      const rangeHeight = sampler.forRange(50_000, 46);
      const [west, south, east, north] = cameraTerrainPreparationBounds(6, 46, 50_000);
      const samplePatch = () => {
        let ready = true;
        for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++)
          ready = rangeHeight(west + (east - west) * (i + .5) / 24,
            south + (north - south) * (j + .5) / 24) !== null && ready;
        return ready;
      };
      for (let attempt = 0; attempt < 100 && !samplePatch(); attempt++)
        await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(samplePatch(), true);
      const firstPass = requests.length;
      samplePatch();
      assert.ok(requests.some(url => url.includes('/11/')));
      assert.equal(requests.length, firstPass, 'Loaded camera tiles should stay cached');
      assert.ok(firstPass < 256, `Unexpected ${firstPass} tile requests`);
    } finally { sampler.destroy(); }
  });
});

test('a zoom-12-only provider converges for a 50km camera patch without redownloading tiles', async () => {
  await withTiles(async requests => {
    const sampler = new RasterElevationSampler({
      tiles: ['https://tiles.test/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256,
      minzoom: 12, maxzoom: 12,
    }, () => {}, cause => assert.fail(String(cause)));
    try {
      const height = sampler.forRange(50_000, 46);
      const [west, south, east, north] = cameraTerrainPreparationBounds(6, 46, 50_000);
      const samplePatch = () => {
        let ready = true;
        for (let x = 0; x <= 32; x++) for (let y = 0; y <= 32; y++)
          ready = height(west + (east - west) * x / 32, south + (north - south) * y / 32) !== null && ready;
        return ready;
      };
      for (let attempt = 0; attempt < 500 && !samplePatch(); attempt++)
        await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(samplePatch(), true);
      assert.equal(cameraTerrain(6, 46, 50_000, height).ready, true);
      const loaded = requests.length;
      assert.ok(loaded > 256 && loaded <= 512, `Expected one bounded zoom-12 working set, got ${loaded} requests`);
      assert.equal(cameraTerrain(6, 46, 50_000, height).ready, true);
      assert.equal(requests.length, loaded, 'Repeated coverage should reuse cached tiles');
    } finally { sampler.destroy(); }
  });
});


test('missing pixels do not prevent valid terrain reloading after tile eviction', async () => {
  const mixed = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) mixed.set([128, 0, 0, i === 0 ? 0 : 255], i * 4);
  await withTiles(async requests => {
    const sampler = new RasterElevationSampler({
      tiles: ['https://tiles.test/{z}/{x}/{y}.png'], encoding: 'terrarium', minzoom: 12, maxzoom: 12,
    }, () => {}, cause => assert.fail(String(cause)));
    const position = (x: number, y: number): [number, number] => [
      x / 4096 * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 4096))) * 180 / Math.PI,
    ];
    try {
      const valid = position(100.75, 2000.75), missing = position(100.2, 2000.2);
      assert.equal(await settle(sampler, ...valid), 0);
      assert.equal(sampler.sample(...missing), null);
      assert.equal(sampler.unavailableAt(...missing), true);
      assert.equal(sampler.unavailableAt(...valid), false);
      for (let x = 101; x < 701; x++) await settle(sampler, ...position(x + .75, 2000.75));
      const count = requests.filter(url => url.endsWith('/100/2000.png')).length;
      assert.equal(await settle(sampler, ...valid), 0);
      assert.equal(requests.filter(url => url.endsWith('/100/2000.png')).length, count + 1);
    } finally { sampler.destroy(); }
  }, undefined, mixed);
});

for (const fixedZoom of [true, false]) test(`concurrent camera patches converge with bounded downloads (${fixedZoom ? 'zoom 12' : 'adaptive'})`, async () => {
  await withTiles(async requests => {
    const sampler = new RasterElevationSampler({
      tiles: ['https://tiles.test/{z}/{x}/{y}.png'], encoding: 'terrarium',
      ...(fixedZoom ? { minzoom: 12, maxzoom: 12 } : {}),
    }, () => {}, cause => assert.fail(String(cause)));
    const centers = fixedZoom ? [6, 16] : [6, 16, 26, 36, 46, 56];
    const height = Object.assign((lng: number, lat: number) => sampler.sample(lng, lat), {
      forRange: (range: number, lat: number) => sampler.forRange(range, lat),
    });
    let patches = centers.map(lng => cameraTerrain(lng, 46, 50_000, height));
    try {
      for (let attempt = 0; attempt < 20 && patches.some(patch => !patch.ready); attempt++) {
        await new Promise<void>(resolve => setImmediate(resolve));
        patches = centers.map((lng, i) => cameraTerrain(lng, 46, 50_000, height, patches[i]));
      }
      assert.ok(patches.every(patch => patch.ready), 'Every concurrent patch must finish');
      const distinct = new Set(requests).size;
      assert.ok(requests.length <= distinct * 3, `${requests.length} requests for ${distinct} distinct tiles`);
      const completed = requests.length;
      patches = centers.map((lng, i) => cameraTerrain(lng, 46, 50_000, height, patches[i]));
      assert.ok(patches.every(patch => patch.ready));
      assert.equal(requests.length, completed, 'Completed patches survive source tile eviction');
    } finally { sampler.destroy(); }
  });
});
