import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Elevation } from '../src/elevation';
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
    assert.deepEqual(changes.at(-1), ['left']);
    elevation.height(90, -1);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(changes.at(-1), ['right']);
  } finally {
    elevation.destroy();
    globalThis.fetch = originalFetch;
  }
});
