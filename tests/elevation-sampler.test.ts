import { DEFAULT_ENTITY_MODELS } from '../src/model-settings';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEntity } from '../src/entity-computation';
import type { MapConfiguration, MapFeature } from '../src/types';
import { Elevation } from '../src/elevation';
import { SensorCameraCoverage } from '../src/sensor-camera-coverage';
import type { SensorCameraInput } from '../src/sensor-camera-coverage';
import type { Map as GLMap } from 'maplibre-gl';
import type { GpuCamera } from '../src/gpu-cameras';
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
      getContext() { return { fillStyle: '', fillRect() {}, drawImage() {}, getImageData() { return { data: imagePixels }; } }; }
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

test('explicit retry fetches repaired missing-data tiles while retaining healthy cached zero elevation', async () => {
  const mixed = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) mixed.set([128, 0, 0, i === 5 ? 0 : 255], i * 4);
  await withTiles(async requests => {
    const sampler = new RasterElevationSampler({
      tiles: ['https://tiles.test/{z}/{x}/{y}.png'], encoding: 'terrarium', minzoom: 1, maxzoom: 1,
    }, () => {}, cause => assert.fail(String(cause)));
    const position = (x: number, y: number): [number, number] => [
      x / 2 * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - y))) * 180 / Math.PI,
    ];
    const missing = position(.375, .375), healthy = position(1.75, .75);
    try {
      assert.equal(await settle(sampler, ...healthy), 0);
      for (let i = 0; i < 20 && !sampler.unavailableAt(...missing); i++) {
        sampler.sample(...missing);
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      assert.equal(sampler.sample(...missing), null);
      assert.equal(sampler.unavailableAt(...missing), true);
      assert.equal(requests.filter(url => url.endsWith('/1/0/0.png')).length, 1);
      mixed[5 * 4 + 3] = 255;
      sampler.retry();
      assert.equal(await settle(sampler, ...missing), 0);
      assert.equal(sampler.unavailableAt(...missing), false);
      assert.equal(await settle(sampler, ...healthy), 0);
      assert.equal(requests.filter(url => url.endsWith('/1/0/0.png')).length, 2);
      assert.equal(requests.filter(url => url.endsWith('/1/1/0.png')).length, 1);
      const completed = requests.length;
      sampler.sample(...missing); sampler.sample(...healthy);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(requests.length, completed, 'Healthy recovered input must stay idle');
    } finally { sampler.destroy(); }
  }, undefined, mixed);
});

test('replacing a raster provider aborts old fetches and ignores late decoded tiles', async () => {
  await withTiles(async () => {
    const fetchTile = globalThis.fetch;
    let resume!: () => void;
    const held = new Promise<void>(resolve => { resume = resolve; });
    let oldSignal: AbortSignal | null | undefined;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes('/old/')) {
        oldSignal = init?.signal;
        await held; // The provider deliberately ignores abort to exercise late completion.
      }
      return fetchTile(input, init);
    };
    let oldChanges = 0;
    const old = new RasterElevationSampler({ tiles: ['https://tiles.test/old/{z}/{x}/{y}.png'], encoding: 'terrarium', maxzoom: 0 },
      () => { oldChanges++; }, cause => assert.fail(String(cause)));
    const replacement = new RasterElevationSampler({ tiles: ['https://tiles.test/new/{z}/{x}/{y}.png'], encoding: 'terrarium', maxzoom: 0 },
      () => {}, cause => assert.fail(String(cause)));
    try {
      old.sample(0, 0);
      await new Promise<void>(resolve => setImmediate(resolve));
      old.sample(0, 0);
      assert.ok(oldSignal);
      old.destroy();
      assert.equal(oldSignal.aborted, true);
      const retired = oldChanges;
      assert.equal(await settle(replacement, 0, 0), 0);
      resume();
      for (let i = 0; i < 3; i++) await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(oldChanges, retired);
      assert.equal(old.sample(0, 0), null);
      assert.equal(replacement.sample(0, 0), 0);
      old.destroy();
    } finally { resume(); old.destroy(); replacement.destroy(); }
  });
});

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

test('elevation notifications preserve partial progress for concurrent camera owners', async () => {
  await withTiles(async requests => {
    const provider = { tiles: ['https://tiles.test/{z}/{x}/{y}.png'], encoding: 'terrarium' as const, minzoom: 12, maxzoom: 12 };
    const elevation = new Elevation({ provider, changed: () => {}, diagnostic: cause => assert.fail(String(cause)) });
    let submitted: readonly GpuCamera[] = [];
    let complete: (camera: GpuCamera, publish: () => void) => boolean = () => false;
    const coverage = new SensorCameraCoverage({
      map: {} as GLMap, elevation, rendererDiagnostic: cause => assert.fail(String(cause)), changed: () => {},
      adapter: (_map, completed) => {
        complete = completed;
        return { set: values => { submitted = values; }, attach() {}, retry() {}, destroy() {}, pick: () => [] };
      },
    });
    const inputs: SensorCameraInput[] = [6, 16].map((lng, i) => ({
      entityId: String(i), origin: [lng, 46, 100], ground: 0, placement: 'airborne',
      cameras: [{ id: 'camera', type: 'camera', bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 50_000, terrainVisibility: true }],
      configuration: { basemap: { version: 8, sources: {}, layers: [] }, projection: 'flat', terrain: false,
        hillshade: false, hillshadeOptions: {}, exaggeration: 1, elevation: provider,
        entityModels: DEFAULT_ENTITY_MODELS, entityVisibility: { footprints: true, zones: true, groundLines: true } },
    }));
    try {
      for (let attempt = 0; attempt < 20 && submitted.length < 2; attempt++) {
        for (const input of inputs) coverage.update(input);
        coverage.flush();
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      assert.equal(submitted.length, 2, 'Both camera owners must reach GPU submission');
      for (const camera of submitted) assert.equal(complete(camera, () => {}), true);
      assert.ok(inputs.every(input => coverage.status(input.entityId) === 'ready'));
      assert.ok(requests.length <= new Set(requests).size * 3, 'Completed sample work must bound downloads');
    } finally { coverage.destroy(); elevation.destroy(); }
  });
});

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
    await Promise.resolve();
    sampler.sample(-90, -1);
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

test('a failed fine tile does not clear retained camera output awaiting coarser terrain', async () => {
  await withTiles(async () => {
    const fetchTile = globalThis.fetch;
    let hold = false;
    let resume!: () => void;
    const pending = new Promise<void>(resolve => { resume = resolve; });
    globalThis.fetch = async (input, init) => {
      if (String(input).includes('/12/')) throw new Error('Fine placement tile failed');
      if (hold) await pending;
      return fetchTile(input, init);
    };
    const provider = { tiles: ['https://tiles.test/{z}/{x}/{y}.png'], encoding: 'terrarium' as const };
    const elevation = new Elevation({ provider, changed: () => {}, diagnostic: () => {} });
    let submitted: readonly GpuCamera[] = [];
    let complete: (camera: GpuCamera, publish: () => void) => boolean = () => false;
    const coverage = new SensorCameraCoverage({
      map: {} as GLMap, elevation, rendererDiagnostic: cause => assert.fail(String(cause)), changed: () => {},
      adapter: (_map, completed) => {
        complete = completed;
        return { set: values => { submitted = values; }, attach() {}, retry() {}, destroy() {}, pick: () => [] };
      },
    });
    const value: SensorCameraInput = {
      entityId: 'camera', origin: [6, 46, 100], ground: 0, placement: 'airborne',
      cameras: [{ id: 'sensor', type: 'camera', bearing: 0, elevation: -45, fovX: 60, fovY: 40,
        range: 50_000, terrainVisibility: true, volumeOpacity: .3 }],
      configuration: { basemap: { version: 8, sources: {}, layers: [] }, projection: 'flat', terrain: false,
        hillshade: false, hillshadeOptions: {}, exaggeration: 1, elevation: provider,
        entityModels: DEFAULT_ENTITY_MODELS, entityVisibility: { footprints: true, zones: true, groundLines: true } },
    };
    try {
      for (let attempt = 0; attempt < 20 && !submitted.length; attempt++) {
        coverage.update(value); coverage.flush();
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      const initial = submitted[0]!;
      assert.ok(initial);
      assert.equal(complete(initial, () => {}), true);
      const displayed = coverage.output('camera');
      assert.ok(displayed.length);
      elevation.height(7.2, 46);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(elevation.failedAt('unregistered', 7.2, 46), true);
      hold = true;
      const result = coverage.update({ ...value, origin: [7, 46, 100] });
      coverage.flush();
      assert.equal(result.coverage, 'loading');
      assert.deepEqual(coverage.output('camera'), displayed, 'An unrelated source resolution must not invalidate displayed output');
    } finally {
      coverage.destroy(); elevation.destroy(); resume();
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  });
});

test('100 km ground zones finish at fixed zoom 12 with competing areas and remain quiet after eviction', async () => {
  const flat = new Uint8ClampedArray(256 * 256 * 4);
  for (let i = 0; i < 256 * 256; i++) flat.set([128, 0, 0, 255], i * 4);
  await withTiles(async requests => {
    const provider = { tiles: ['https://tiles.test/{z}/{x}/{y}.png'], encoding: 'terrarium' as const,
      minzoom: 12, maxzoom: 12, tileSize: 256 };
    let changes = 0;
    const elevation = new Elevation({ provider, changed: () => changes++, diagnostic: error => assert.fail(String(error)) });
    const configuration: MapConfiguration = { basemap: { version: 8, sources: {}, layers: [] },
      projection: 'flat', terrain: true, hillshade: false, hillshadeOptions: {}, exaggeration: 1,
      elevation: provider, entityModels: DEFAULT_ENTITY_MODELS,
      entityVisibility: { footprints: true, zones: true, groundLines: false } };
    const features: MapFeature[] = [6, 12].map((lng, index) => ({ type: 'Feature', id: `ground-${index}`,
      properties: {}, geometry: { type: 'Point', coordinates: [lng, 46] },
      entity: { attachments: [{ id: 'area', type: 'circle', radius: 100000 }] } }));
    const areas = features.map((feature, index) => ({ key: feature.id, center: [index === 0 ? 6 : 12, 46] as const,
      radiusMeters: 100000, groundRequirementKey: 'circle:100000' }));
    elevation.requestBatch(areas);
    const compute = (feature: MapFeature) => computeEntity({ feature, configuration, style: {}, selected: false },
      elevation.sampling(feature.id), (lng, lat) => elevation.failedAt(feature.id, lng, lat));
    const drain = async () => { await new Promise<void>(resolve => setImmediate(resolve)); };
    try {
      let results = features.map(compute);
      for (let pass = 0; pass < 12 && results.some(result => result.state.coverage !== 'ready'); pass++) {
        await drain();
        results = features.map(compute);
      }
      assert.deepEqual(results.map(result => result.state.coverage), ['ready', 'ready']);
      assert.deepEqual(results.map(result => result.state.ground), [0, 0]);
      assert.deepEqual(results.map(result => result.primitives.filter(p => p.mode === 'triangles').length), [1, 1]);
      assert.ok(new Set(requests).size > 1024, 'The actual combined tile working set exceeds the 512-tile cache');
      assert.ok(requests.every(url => url.includes('/12/')), 'Source zoom must remain 12');
      assert.ok(requests.length <= 8000, `Unexpected request growth ${requests.length}`);
      const completedRequests = requests.length, completedChanges = changes;
      for (let pass = 0; pass < 3; pass++) {
        assert.deepEqual(features.map(compute).map(result => result.state.coverage), ['ready', 'ready']);
        await drain();
      }
      assert.equal(requests.length, completedRequests, 'Completion must not fetch maximum bounds or evicted probes');
      assert.equal(changes, completedChanges);
      elevation.retry();
      assert.equal(elevation.sampling(features[0]!.id)(6, 46), null, 'Retry retires finite progress for evicted terrain');
      await drain();
      assert.equal(elevation.sampling(features[0]!.id)(6, 46), 0);
      elevation.reset(provider);
      assert.equal(elevation.sampling(features[0]!.id)(6, 46), null, 'Provider reset retires all progress');
      await drain();
      assert.equal(elevation.sampling(features[0]!.id)(6, 46), null);
      await drain();
      assert.equal(elevation.sampling(features[0]!.id)(6, 46), 0);
      const retained = elevation.sampling(features[0]!.id);
      elevation.requestBatch(areas);
      assert.equal(retained(6, 46), 0, 'Unchanged probe requirements retain finite progress');
      elevation.requestBatch([{ ...areas[0]!, groundRequirementKey: 'polygon-with-the-same-extent' }]);
      assert.equal(retained(6, 46), null, 'Shape edits within the footprint retire the old probe set');
      const replacement = elevation.sampling(features[0]!.id);
      assert.equal(replacement(6, 46), 0);
      elevation.release(features[0]!.id);
      assert.equal(replacement(6, 46), null, 'Release retires finite progress');
    } finally { elevation.destroy(); }
    assert.equal(elevation.sampling()(6, 46), null);
  }, undefined, flat);
});

test('scoped ground progress preserves mixed no-data and bilinear borders until explicit repair', async () => {
  const mixed = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) mixed.set([128, 0, 0, i === 4 ? 0 : 255], i * 4);
  await withTiles(async requests => {
    const provider = { tiles: ['https://tiles.test/{z}/{x}/{y}.png'], encoding: 'terrarium' as const,
      minzoom: 1, maxzoom: 1, tileSize: 4 };
    const position = (x: number, y: number): [number, number] => [
      x / 2 * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - y))) * 180 / Math.PI,
    ];
    const healthy = position(.75, .75), border = position(1, .375);
    const elevation = new Elevation({ provider, changed() {}, diagnostic: error => assert.fail(String(error)) });
    elevation.requestBatch([{ key: 'ground', center: healthy, radiusMeters: 1, groundRequirementKey: 'border' }]);
    const settle = async (point: [number, number]) => {
      for (let pass = 0; pass < 6; pass++) {
        const value = elevation.sampling('ground')(...point);
        if (value !== null) return value;
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      return null;
    };
    try {
      assert.equal(await settle(healthy), 0);
      assert.equal(await settle(border), null);
      assert.equal(elevation.failedAt('ground', ...border), true);
      assert.equal(elevation.sampling('ground')(...healthy), 0, 'A local gap cannot erase a finite sample');
      mixed[4 * 4 + 3] = 255;
      elevation.retry();
      assert.equal(await settle(border), 0);
      assert.equal(elevation.failedAt('ground', ...border), false);
      assert.equal(requests.filter(url => url.endsWith('/1/1/0.png')).length, 2);
    } finally { elevation.destroy(); }
  }, undefined, mixed);
});
