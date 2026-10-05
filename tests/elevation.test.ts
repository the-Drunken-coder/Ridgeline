import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Elevation, modelAreaKey, entityIdForAreaKey } from '../src/elevation';
import type { ElevationSampler } from '../src/types';
import type { RidgelineError } from '../src/errors';

function deferred() {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function controlled() {
  const calls: { positions: readonly [number, number][]; signal: AbortSignal; completion: ReturnType<typeof deferred> }[] = [];
  const heights = new Map<string, number | null>();
  const sampler: ElevationSampler = {
    sample(lng, lat) { return heights.get(`${lng},${lat}`) ?? null; },
    prepare(positions, signal) {
      assert.equal(this, sampler);
      const completion = deferred();
      calls.push({ positions, signal, completion });
      return completion.promise;
    },
  };
  return { sampler, heights, calls };
}

function fixture(sampler: ElevationSampler) {
  const changes: string[][] = [];
  const diagnostics: RidgelineError[] = [];
  const elevation = new Elevation({
    provider: { tiles: ['unused'] }, sampler,
    changed: keys => changes.push([...keys]),
    diagnostic: error => diagnostics.push(error),
  });
  return { elevation, changes, diagnostics };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test('batch requests share one preparation, retain unknown as settled, and retry explicitly', async () => {
  const source = controlled();
  const { elevation, changes } = fixture(source.sampler);
  elevation.requestBatch([
    { key: 'first', center: [10, 20], radiusMeters: 100 },
    { key: 'second', center: [11, 21], radiusMeters: 0 },
  ]);
  assert.equal(elevation.readiness('first'), 'loading');
  await flush();
  assert.equal(source.calls.length, 1);
  assert.equal(source.calls[0]!.positions.length, 11);
  assert.deepEqual(source.calls[0]!.positions[0], [10, 20]);
  assert.deepEqual(source.calls[0]!.positions.at(-1), [11, 21]);
  source.calls[0]!.completion.resolve();
  await flush();
  assert.equal(elevation.readiness('first'), 'unavailable');
  assert.equal(elevation.readiness('second'), 'unavailable');
  assert.deepEqual(changes.at(-1), ['first', 'second']);
  elevation.request('first', [10, 20], 100);
  await flush();
  assert.equal(source.calls.length, 1);
  elevation.retry();
  assert.equal(elevation.readiness('first'), 'loading');
  await flush();
  assert.equal(source.calls.length, 2);
  elevation.destroy();
});

test('releasing one requester keeps shared preparation alive; releasing all aborts it', async () => {
  const source = controlled();
  const { elevation, changes, diagnostics } = fixture(source.sampler);
  elevation.request('placement', [10, 20], 100);
  elevation.request('camera', [10, 20], 1000);
  await flush();
  assert.equal(source.calls.length, 1);
  elevation.release('placement');
  assert.equal(source.calls[0]!.signal.aborted, false);
  source.calls[0]!.completion.resolve();
  await flush();
  assert.deepEqual(changes.at(-1), ['camera']);
  assert.equal(elevation.readiness('camera'), 'unavailable');
  elevation.retry();
  await flush();
  elevation.release('camera');
  assert.equal(source.calls[1]!.signal.aborted, true);
  source.calls[1]!.completion.reject(new Error('late failure'));
  await flush();
  assert.deepEqual(diagnostics, []);
  elevation.destroy();
});

test('replacement, reset, and destroy abort obsolete work and ignore late completion', async () => {
  const source = controlled();
  const { elevation, changes, diagnostics } = fixture(source.sampler);
  elevation.request('entity', [0, 0], 0);
  await flush();
  elevation.request('entity', [1, 0], 0);
  await flush();
  assert.equal(source.calls[0]!.signal.aborted, true);
  source.calls[0]!.completion.reject(new Error('obsolete'));
  await flush();
  assert.deepEqual(diagnostics, []);
  elevation.reset({ tiles: ['another-unused-source'] });
  await flush();
  assert.equal(source.calls[1]!.signal.aborted, true);
  source.calls[1]!.completion.resolve();
  await flush();
  assert.equal(elevation.readiness('entity'), 'loading');
  const changesBeforeDestroy = changes.length;
  elevation.destroy();
  elevation.destroy();
  assert.equal(source.calls[2]!.signal.aborted, true);
  source.calls[2]!.completion.reject(new Error('after destroy'));
  await flush();
  assert.equal(changes.length, changesBeforeDestroy);
  assert.deepEqual(diagnostics, []);
});

test('preparation rejection settles once with the original cause and can be retried', async () => {
  const source = controlled();
  const { elevation, changes, diagnostics } = fixture(source.sampler);
  elevation.request('entity', [0, 0], 0);
  await flush();
  const cause = new Error('service failed');
  source.calls[0]!.completion.reject(cause);
  await flush();
  assert.equal(elevation.readiness('entity'), 'unavailable');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]!.code, 'ELEVATION_UNAVAILABLE');
  assert.deepEqual(diagnostics[0]!.context, { operation: 'entities', recoverable: true });
  assert.equal(diagnostics[0]!.cause, cause);
  assert.deepEqual(changes.at(-1), ['entity']);
  elevation.request('entity', [0, 0], 0);
  await flush();
  assert.equal(source.calls.length, 1);
  elevation.retry();
  await flush();
  assert.equal(source.calls.length, 2);
  elevation.destroy();
});

test('a sampler throwing during an eager probe settles the area and reports its cause', async () => {
  const cause = new Error('sample failed');
  let probes = 0;
  let preparations = 0;
  const { elevation, diagnostics, changes } = fixture({
    sample() { probes++; throw cause; },
    prepare() { preparations++; return Promise.resolve(); },
  });
  elevation.request('entity', [0, 0], 0);
  await flush();
  assert.equal(elevation.readiness('entity'), 'unavailable');
  assert.equal(probes, 1);
  assert.equal(preparations, 0);
  assert.deepEqual(changes, [['entity']]);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]!.code, 'ELEVATION_UNAVAILABLE');
  assert.equal(diagnostics[0]!.cause, cause);
  elevation.requirePreparation('entity');
  await flush();
  assert.equal(probes, 1, 'A callback failure must not start an automatic retry');
  elevation.destroy();
});

test('moving a settled area prepares its new location and a removed scheduled area never starts', async () => {
  const source = controlled();
  const { elevation } = fixture(source.sampler);
  elevation.request('entity', [0, 0], 0);
  await flush();
  source.calls[0]!.completion.resolve();
  await flush();
  elevation.request('entity', [1, 0], 0);
  await flush();
  assert.equal(source.calls.length, 2);
  assert.deepEqual(source.calls[1]!.positions, [[1, 0]]);
  elevation.request('removed', [2, 0], 0);
  elevation.release('removed');
  await flush();
  assert.equal(source.calls.length, 2);
  elevation.destroy();
});

test('known consumer heights skip preparation and unknown remains distinct from zero', async () => {
  const source = controlled();
  const { elevation } = fixture(source.sampler);
  source.heights.set('0,0', 0);
  elevation.request('known', [0, 0], 0);
  await flush();
  assert.equal(source.calls.length, 0);
  assert.equal(elevation.height(0, 0), 0);
  assert.equal(elevation.height(1, 0), null);
  assert.equal(elevation.maximum(-1, -1, 1, 1), null);
  elevation.destroy();
});

test('an unknown interior sample can require preparation after a known area grid was skipped', async () => {
  const completion = deferred();
  let calls = 0;
  const sampler: ElevationSampler = {
    sample(lng, lat) { return lng === 0 && lat === 0.0001 ? null : 12; },
    prepare() { calls++; return completion.promise; },
  };
  const { elevation } = fixture(sampler);
  elevation.request('camera', [0, 0], 100);
  await flush();
  assert.equal(calls, 0);
  assert.equal(elevation.height(0, 0.0001), null);
  elevation.requirePreparation('camera');
  assert.equal(elevation.readiness('camera'), 'loading');
  await flush();
  assert.equal(calls, 1);
  completion.resolve();
  await flush();
  assert.equal(elevation.readiness('camera'), 'unavailable');
  elevation.requirePreparation('camera');
  await flush();
  assert.equal(calls, 1);
  elevation.destroy();
});

test('consumer without prepare is settled until explicit retry notification', () => {
  const { elevation, changes } = fixture({ sample: () => null });
  elevation.request('entity', [0, 0], 0);
  assert.equal(elevation.readiness('entity'), 'unavailable');
  elevation.retry();
  assert.deepEqual(changes, [['entity']]);
  elevation.destroy();
});

test('deferred placement batches avoid probes until missing geometry requires one shared preparation', async () => {
  const completion = deferred();
  let samples = 0;
  let preparations = 0;
  const sampler: ElevationSampler = {
    sample() { samples++; return 12; },
    prepare(positions) {
      preparations++;
      assert.deepEqual(positions, [[0, 0], [1, 0]]);
      return completion.promise;
    },
  };
  const { elevation } = fixture(sampler);
  elevation.requestBatch([
    { key: 'first', center: [0, 0], radiusMeters: 0 },
    { key: 'second', center: [1, 0], radiusMeters: 0 },
  ], { deferProbe: true });
  await flush();
  assert.equal(samples, 0);
  assert.equal(preparations, 0);
  elevation.requirePreparation('first');
  elevation.requirePreparation('second');
  await flush();
  assert.equal(preparations, 1);
  assert.equal(samples, 0);
  completion.resolve();
  await flush();
  assert.equal(elevation.readiness('first'), 'unavailable');
  elevation.requirePreparation('first');
  await flush();
  assert.equal(preparations, 1);
  elevation.destroy();
});

test('a raster tile failure notifies only area keys that use that tile', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('tile failed'); };
  const changes: string[][] = [];
  const elevation = new Elevation({
    provider: { tiles: ['https://example.test/{z}/{x}/{y}.png'], maxzoom: 1 },
    changed: keys => changes.push([...keys]),
    diagnostic: () => {},
  });
  try {
    elevation.request('left', [-90, -1], 1000);
    elevation.request('right', [90, -1], 1000);
    elevation.height(-90, -1);
    await new Promise<void>(resolve => setImmediate(resolve));
    elevation.height(-90, -1);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(changes.at(-1), ['left']);
    elevation.height(90, -1);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(changes.at(-1), ['right']);
  } finally {
    elevation.destroy();
    globalThis.fetch = originalFetch;
  }
});

test('an active no-data area retains failure knowledge without pinning its source tile', async () => {
  const originalFetch = globalThis.fetch;
  const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  const originalCanvas = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  const size = 8, zoom = 10, n = 2 ** zoom;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let index = 0; index < size * size; index++) rgba[index * 4 + 3] = 255;
  rgba[(size + 1) * 4 + 3] = 0;
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; return new Response(new Blob()); };
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
  const point = (tileX: number, pixel: number): [number, number] => {
    const x = (tileX + (pixel + 0.5) / size) / n;
    const y = (256 + (pixel + 0.5) / size) / n;
    return [x * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI];
  };
  const missing = point(0, 1);
  const elevation = new Elevation({
    provider: { tiles: ['https://example.test/{z}/{x}/{y}.png'], maxzoom: zoom, tileSize: size },
    changed: () => {}, diagnostic: error => { throw error; },
  });
  try {
    elevation.request('active', missing, 0);
    elevation.height(...missing);
    await new Promise<void>(resolve => setImmediate(resolve));
    elevation.height(...missing);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(elevation.height(...missing), null);
    assert.equal(elevation.readiness('active'), 'unavailable');
    for (let x = 1; x <= 513; x++) elevation.height(...point(x, 4));
    for (let attempt = 0; attempt < 20 && fetches < 514; attempt++)
      await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(fetches, 514);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(fetches, 514, 'Settled failed areas do not trigger automatic requests');
    assert.equal(elevation.readiness('active'), 'unavailable');
    elevation.release('active');
    elevation.request('new', missing, 0);
    assert.equal(elevation.readiness('new'), 'loading', 'Released history should leave the bounded cache');
    elevation.height(...missing);
    assert.equal(fetches, 515, 'A new area should be able to load an evicted tile');
  } finally {
    elevation.destroy();
    globalThis.fetch = originalFetch;
    if (originalBitmap) Object.defineProperty(globalThis, 'createImageBitmap', originalBitmap);
    else Reflect.deleteProperty(globalThis, 'createImageBitmap');
    if (originalCanvas) Object.defineProperty(globalThis, 'OffscreenCanvas', originalCanvas);
    else Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
  }
});

test('a contained requester still prepares when its scheduled covering requester is released', async () => {
  const source = controlled();
  const { elevation, changes } = fixture(source.sampler);
  try {
    elevation.request('outer', [0, 0], 1000);
    elevation.request('inner', [0, 0], 100);
    elevation.release('outer');
    await flush();
    assert.equal(source.calls.length, 1, 'The remaining area must start preparation');
    const call = source.calls[0]!;
    assert.ok(call.positions.length > 0);
    assert.equal(call.signal.aborted, false);
    assert.equal(elevation.readiness('inner'), 'loading');
    for (const [lng, lat] of call.positions) source.heights.set(`${lng},${lat}`, 42);
    call.completion.resolve();
    await flush();
    assert.equal(elevation.height(0, 0), 42);
    assert.deepEqual(changes.at(-1), ['inner']);
  } finally { elevation.destroy(); }
});

test('preparation and sampling use identical normalized center coordinates', async () => {
  const prepared = new Map<string, number>();
  const { elevation } = fixture({
    sample: (lng, lat) => prepared.get(`${lng},${lat}`) ?? null,
    prepare: async positions => {
      for (const [lng, lat] of positions) prepared.set(`${lng},${lat}`, 42);
    },
  });
  try {
    elevation.request('placement', [.01, 0], 0);
    await flush();
    assert.equal(elevation.height(.01, 0), 42);
  } finally { elevation.destroy(); }
});

test('exact terrain probes are snapshotted and included in consumer preparation', async () => {
  const source = controlled(), { elevation } = fixture(source.sampler);
  const requiredPositions: [number, number][] = [[180.0001, 20.0001]];
  try {
    elevation.requestBatch([{ key: 'model:one', center: [179.9999, 20], radiusMeters: 100, requiredPositions }]);
    requiredPositions[0]![1] = 40;
    await flush();
    assert.equal(source.calls.length, 1);
    const call = source.calls[0]!;
    assert.ok(call.positions.some(([lng, lat]) => Math.abs(lng + 179.9999) < 1e-10 && lat === 20.0001));
    for (const point of call.positions) source.heights.set(point.join(','), 42);
    call.completion.resolve();
    await flush();
    assert.equal(elevation.height(180.0001, 20.0001), 42);
  } finally { elevation.destroy(); }
});

test('changing exact probes replaces pending area work even at the same center and radius', async () => {
  const source = controlled(), { elevation, changes } = fixture(source.sampler);
  const center: [number, number] = [0, 0], first: [number, number] = [.0001, 0], second: [number, number] = [0, .0001];
  try {
    elevation.requestBatch([{ key: 'model:one', center, radiusMeters: 100, requiredPositions: [first] }]);
    await flush();
    elevation.requestBatch([{ key: 'model:one', center, radiusMeters: 100, requiredPositions: [second] }]);
    assert.equal(source.calls[0]!.signal.aborted, true);
    await flush();
    assert.equal(source.calls.length, 2);
    assert.ok(source.calls[1]!.positions.some(point => point[0] === second[0] && point[1] === second[1]));
    source.calls[0]!.completion.resolve(); await flush();
    assert.deepEqual(changes, []);
    elevation.requestBatch([{ key: 'model:one', center, radiusMeters: 100, requiredPositions: [second, second] }]);
    await flush(); assert.equal(source.calls.length, 2);
    elevation.release('model:one');
    assert.equal(source.calls[1]!.signal.aborted, true);
    source.calls[1]!.completion.resolve(); await flush();
    assert.deepEqual(changes, []);
  } finally { elevation.destroy(); }
});

test('pending shared preparations only cover exact probes already sent to the sampler', async () => {
  for (const pending of [false, true]) {
    const source = controlled(), { elevation } = fixture(source.sampler);
    try {
      elevation.requestBatch([{ key: 'outer', center: [0, 0], radiusMeters: 1000, requiredPositions: [[.0001, 0]] }]);
      if (pending) await flush();
      elevation.requestBatch([{ key: 'inner', center: [0, 0], radiusMeters: 100, requiredPositions: [[0, .0001]] }]);
      await flush();
      assert.equal(source.calls.length, pending ? 2 : 1);
      assert.ok(source.calls.at(-1)!.positions.some(([lng, lat]) => lng === 0 && lat === .0001));
      elevation.release('outer');
      assert.equal(source.calls.at(-1)!.signal.aborted, false);
      elevation.release('inner');
      assert.ok(source.calls.every(call => call.signal.aborted));
    } finally { elevation.destroy(); }
  }
});

test('model area notifications preserve entity identity and provider reset retains exact probes', async () => {
  const source = controlled(), { elevation, changes } = fixture(source.sampler);
  const key = modelAreaKey('vehicle:one'), requiredPositions: [number, number][] = [[.0001, .0002]];
  try {
    elevation.requestBatch([{ key, center: [0, 0], radiusMeters: 100, requiredPositions }]);
    await flush();
    elevation.reset({ tiles: ['replacement'] });
    assert.equal(source.calls[0]!.signal.aborted, true);
    await flush();
    assert.equal(source.calls.length, 2);
    assert.ok(source.calls[1]!.positions.some(([lng, lat]) => Math.abs(lng - .0001) < 1e-12 && lat === .0002));
    assert.deepEqual(changes.map(keys => keys.map(entityIdForAreaKey)), [['vehicle:one']]);
  } finally { elevation.destroy(); }
});

test('a sampler changing provider cannot publish the obsolete preparation result', async () => {
  let elevation: Elevation, first = true, prepares = 0;
  const changes: string[][] = [];
  elevation = new Elevation({ provider: { tiles: ['first'] }, sampler: {
    sample() {
      if (first) { first = false; elevation.reset({ tiles: ['second'] }); return 42; }
      return null;
    },
    prepare: async () => { prepares++; await new Promise(() => {}); },
  }, changed: keys => changes.push([...keys]), diagnostic: () => {} });
  try {
    elevation.request(modelAreaKey('current'), [0, 0], 0);
    await flush();
    assert.deepEqual(changes, [[modelAreaKey('current')]], 'Only the provider reset should publish until current preparation settles');
    assert.equal(prepares, 1);
    assert.equal(elevation.readiness(modelAreaKey('current')), 'loading');
  } finally { elevation.destroy(); }
});

test('abort callbacks keep newer terrain ownership and discard a partially accepted batch', async () => {
  for (const action of ['release', 'replace', 'destroy'] as const) {
    const source = controlled(), { elevation } = fixture(source.sampler), key = modelAreaKey('current');
    try {
      elevation.request(key, [0, 0], 1); await flush();
      source.calls[0]!.signal.addEventListener('abort', () => {
        if (action === 'release') elevation.release(key);
        else if (action === 'replace') elevation.request(key, [3, 3], 1);
        else elevation.destroy();
      });
      elevation.requestBatch([{ key: 'partial', center: [0, 0], radiusMeters: 1 },
        { key, center: [1, 1], radiusMeters: 1 }], { deferProbe: true });
      await flush();
      assert.equal(elevation.revision('partial'), 0, `${action} retained part of the obsolete batch`);
      assert.equal(elevation.revision(key) > 0, action === 'replace');
      elevation.reset({ tiles: ['replacement'] }); await flush();
      assert.deepEqual(source.calls.slice(1).map(call => call.positions[0]), action === 'replace' ? [[3, 3], [3, 3]] : []);
    } finally { elevation.destroy(); }
  }
});

test('provider reset retires only old work when an abort callback replaces one requester', async () => {
  const source = controlled(), { elevation } = fixture(source.sampler);
  try {
    elevation.request('changed', [0, 0], 1); elevation.request('retained', [10, 10], 1); await flush();
    source.calls[0]!.signal.addEventListener('abort', () => elevation.request('changed', [3, 3], 1));
    elevation.reset({ tiles: ['replacement'] }); await flush();
    assert.deepEqual(source.calls.slice(2).map(call => call.positions[0]), [[3, 3], [10, 10]]);
    assert.equal(source.calls[2]!.signal.aborted, false);
    assert.equal(source.calls[3]!.signal.aborted, false);
    assert.ok(elevation.revision('changed') > 0 && elevation.revision('retained') > 0);
  } finally { elevation.destroy(); }
});
