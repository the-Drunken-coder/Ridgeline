import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RasterElevationSampler } from '../src/elevation-sampler';
import { cameraTerrainPreparationBounds } from '../src/gpu-camera-terrain';

const pixels = new Uint8ClampedArray([
  128, 0, 0, 255, 128, 0, 0, 255,
  128, 0, 0, 255, 128, 0, 0, 255,
]);

async function withTiles(run: (requests: string[]) => Promise<void>, tileJSON?: object) {
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
  globalThis.createImageBitmap = async () => ({ width: 2, height: 2, close() {} }) as ImageBitmap;
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    configurable: true,
    value: class {
      getContext() { return { drawImage() {}, getImageData() { return { data: pixels }; } }; }
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
