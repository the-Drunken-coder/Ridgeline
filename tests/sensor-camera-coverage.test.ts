import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Map as GLMap } from 'maplibre-gl';
import type { CameraAttachment, MapConfiguration } from '../src/types';
import type { GpuCamera } from '../src/gpu-cameras';
import type { ElevationSampler } from '../src/types';
import { Elevation } from '../src/elevation';
import {
  SensorCameraCoverage,
  type SensorCameraAdapterFactory,
  type SensorCameraInput,
} from '../src/sensor-camera-coverage';

// SensorCameraCoverage uses this browser primitive only to parse attachment colors.
// The controlled adapter keeps these lifecycle tests independent of WebGL and the DOM.
Object.defineProperty(globalThis, 'OffscreenCanvas', {
  configurable: true,
  value: class {
    getContext() {
      return {
        fillStyle: '',
        fillRect() {},
        getImageData() { return { data: new Uint8ClampedArray([40, 139, 89, 255]) }; },
      };
    }
  },
});

const configuration: MapConfiguration = {
  basemap: { version: 8, sources: {}, layers: [] },
  projection: 'flat',
  terrain: false,
  hillshade: false,
  hillshadeOptions: {},
  exaggeration: 1,
  elevation: { tiles: [], encoding: 'terrarium', tileSize: 256 },
  entityVisibility: { footprints: true, zones: true, groundLines: true },
};

const camera = (id = 'camera', bearing = 0): CameraAttachment => ({
  id,
  type: 'camera',
  bearing,
  elevation: -45,
  fovX: 60,
  fovY: 40,
  range: 300,
  terrainVisibility: true,
  volumeOpacity: 0.2,
  wireframe: true,
});

function input(overrides: Partial<SensorCameraInput> = {}): SensorCameraInput {
  return {
    entityId: 'entity',
    origin: [0, 0, 100],
    ground: 0,
    placement: 'airborne',
    cameras: [camera()],
    configuration,
    ...overrides,
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type ControlledAdapter = {
  factory: SensorCameraAdapterFactory;
  values: () => GpuCamera[];
  retained: () => readonly GpuCamera[];
  history: GpuCamera[][];
  complete: (value: GpuCamera) => boolean;
  fail: (cause: unknown) => void;
  published: GpuCamera[];
  retries: number;
};

const elevations = new WeakMap<SensorCameraCoverage, Elevation>();

function controlledAdapter(): ControlledAdapter {
  let complete!: (value: GpuCamera, publish: () => void) => boolean;
  let fail!: (cause: unknown) => void;
  let current: GpuCamera[] = [];
  let retained: readonly GpuCamera[] = [];
  const history: GpuCamera[][] = [];
  const published: GpuCamera[] = [];
  const adapter: ControlledAdapter = {
    factory: (_map, onComplete, onFailure) => {
      complete = onComplete;
      fail = onFailure;
      return {
        set(values, previous = []) { current = [...values]; retained = previous; history.push(current); },
        attach() {},
        pick() { return []; },
        retry() { adapter.retries++; },
        destroy() {},
      };
    },
    values: () => current,
    retained: () => retained,
    history,
    complete: value => complete(value, () => published.push(value)),
    fail: cause => fail(cause),
    published,
    retries: 0,
  };
  return adapter;
}

function owner(
  controlled: ControlledAdapter,
  options: { height?: ElevationSampler['sample']; prepare?: ElevationSampler['prepare']; changed?: () => void } = {},
) {
  const changed: string[] = [];
  const diagnostics: unknown[] = [];
  const elevation = new Elevation({
    provider: configuration.elevation,
    sampler: { sample: options.height ?? (() => 0), prepare: options.prepare },
    changed: keys => { for (const key of keys) changed.push(key); options.changed?.(); },
    diagnostic: cause => diagnostics.push(cause),
  });
  const coverage = new SensorCameraCoverage({
    map: {} as GLMap,
    elevation,
    rendererDiagnostic: cause => diagnostics.push(cause),
    changed: entityId => changed.push(entityId),
    adapter: controlled.factory,
  });
  elevations.set(coverage, elevation);
  return { coverage, elevation, changed, diagnostics };
}

// One owner update followed by the scene's submission boundary.
function update(coverage: SensorCameraCoverage, value: SensorCameraInput) {
  const elevation = elevations.get(coverage)!;
  const center: [number, number] = [value.origin[0], value.origin[1]];
  coverage.requestAreas(value.entityId, center, value.cameras, value.configuration.entityVisibility.footprints);
  elevation.request(`placement:${value.entityId}`, center, 0);
  const output = coverage.update(value);
  coverage.flush();
  return output;
}

function updateCameraOnly(coverage: SensorCameraCoverage, value: SensorCameraInput) {
  coverage.requestAreas(value.entityId, [value.origin[0], value.origin[1]], value.cameras,
    value.configuration.entityVisibility.footprints);
  const output = coverage.update(value);
  coverage.flush();
  return output;
}

function latestRequest(adapter: ControlledAdapter, entityId = 'entity', cameraId = 'camera') {
  const value = [...adapter.values()].find(item => item.entityId === entityId && item.camera.id === cameraId);
  assert.ok(value, `No active request for ${entityId}/${cameraId}`);
  return value;
}

test('failed required scene calculation clears plain and terrain coverage and rejects late GPU completion', () => {
  const adapter = controlledAdapter();
  const { coverage, elevation } = owner(adapter);
  const value = input({ cameras: [camera(), { ...camera('plain'), terrainVisibility: false }] });
  try {
    update(coverage, value);
    const completed = latestRequest(adapter);
    assert.equal(adapter.complete(completed), true);
    assert.equal(coverage.status(value.entityId), 'ready');
    assert.ok(coverage.output(value.entityId).length);
    coverage.unavailable(value.entityId);
    coverage.flush();
    assert.equal(coverage.status(value.entityId), 'unavailable');
    assert.deepEqual(coverage.output(value.entityId), []);
    assert.deepEqual(adapter.values(), []);
    assert.equal(adapter.complete(completed), false);
    coverage.retry();
    update(coverage, { ...value, origin: [.01, 0, 100] });
    assert.equal(adapter.complete(completed), false);
    assert.equal(adapter.complete(latestRequest(adapter)), true);
    assert.equal(coverage.status(value.entityId), 'ready');
  } finally { coverage.destroy(); elevation.destroy(); }
});

test('publishes matching geometry and leaves initial coverage absent', () => {
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter);
  const first = update(coverage, input());
  assert.equal(first.coverage, 'loading');
  assert.deepEqual(first.geometry, []);

  const request = latestRequest(adapter);
  assert.equal(adapter.complete(request), true);
  assert.equal(adapter.published.length, 1);
  const ready = update(coverage, input());
  assert.equal(ready.coverage, 'ready', 'An equivalent update should remain current');
  assert.deepEqual(ready.geometry, request.geometry, 'Displayed primitives must come from the completed request');
  assert.deepEqual(coverage.output('entity'), request.geometry);
  assert.ok(ready.geometry.some(primitive => primitive.mode === 'triangles'));
  assert.ok(ready.geometry.some(primitive => primitive.mode === 'lines'));
});

test('retains the completed unit while moving and accepts an intermediate result without making a newer request ready', () => {
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter);
  update(coverage, input());
  const initial = latestRequest(adapter);
  assert.equal(adapter.complete(initial), true);
  const previous = coverage.output('entity');

  const moved = input({ origin: [0.001, 0, 100] });
  assert.equal(update(coverage, moved).coverage, 'loading');
  assert.deepEqual(coverage.output('entity'), previous, 'A delayed replacement must retain the old geometry');
  const intermediate = latestRequest(adapter);

  const latest = input({ origin: [0.002, 0, 100] });
  assert.equal(update(coverage, latest).coverage, 'loading');
  const current = latestRequest(adapter);
  assert.notEqual(current, intermediate);

  assert.equal(adapter.complete(intermediate), true, 'A completed intermediate result is still displayable');
  assert.deepEqual(coverage.output('entity'), intermediate.geometry);
  assert.equal(coverage.status('entity'), 'loading', 'Intermediate display must not report the newer request ready');
  assert.equal(adapter.complete(current), true);
  assert.equal(coverage.status('entity'), 'ready');
  assert.deepEqual(coverage.output('entity'), current.geometry);
});

test('owner suppresses an obsolete appearance while retaining a valid intermediate pose', () => {
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter);
  update(coverage, input());
  const initial = latestRequest(adapter);
  assert.equal(adapter.complete(initial), true);
  const previous = coverage.output('entity');

  update(coverage, input({ origin: [0.001, 0, 100] }));
  const intermediate = latestRequest(adapter);
  update(coverage, input({ origin: [0.002, 0, 100], cameras: [{ ...camera(), color: '#ff0000' }] }));
  const current = latestRequest(adapter);

  assert.equal(adapter.complete(intermediate), false, 'An obsolete appearance must not publish');
  assert.deepEqual(coverage.output('entity'), previous, 'Rejecting an obsolete appearance must retain the last complete unit');
  assert.equal(coverage.status('entity'), 'loading');
  assert.equal(adapter.complete(current), true);
  assert.deepEqual(coverage.output('entity'), current.geometry);
  assert.equal(coverage.status('entity'), 'ready');
});

test('publishes attached cameras independently while readiness waits for all current results', () => {
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter);
  const two = input({ cameras: [camera('first'), camera('second', 90)] });
  assert.equal(update(coverage, two).coverage, 'loading');
  const first = latestRequest(adapter, 'entity', 'first');
  const second = latestRequest(adapter, 'entity', 'second');

  assert.equal(adapter.complete(first), true);
  assert.equal(coverage.status('entity'), 'loading');
  assert.equal(coverage.output('entity').filter(value => value.attachmentId === 'first').length, first.geometry.length);
  assert.equal(adapter.complete(second), true);
  assert.equal(coverage.status('entity'), 'ready');
  assert.equal(coverage.output('entity').filter(value => value.attachmentId === 'second').length, second.geometry.length);
});

test('keeps a near camera current when a farther camera lacks terrain', async () => {
  const adapter = controlledAdapter();
  const preparation = deferred();
  const { coverage } = owner(adapter, {
    height: (lng, lat) => Math.hypot(lng * 111195, lat * 111195) <= 20 ? 0 : null,
    prepare: () => preparation.promise,
  });
  const near = camera('near');
  const far = { ...camera('far', 90), range: 100 };
  const two = input({ cameras: [{ ...near, range: 10 }, far] });

  assert.equal(update(coverage, two).coverage, 'loading');
  const nearRequest = latestRequest(adapter, 'entity', 'near');
  assert.equal([...adapter.values()].some(value => value.camera.id === 'far'), false, 'Unknown far terrain submitted a fabricated request');
  assert.equal(adapter.complete(nearRequest), true);
  assert.equal(coverage.status('entity'), 'loading', 'A far pending camera incorrectly made the entity ready');
  assert.ok(coverage.output('entity').some(value => value.attachmentId === 'near'), 'Near camera did not publish independently');

  preparation.resolve();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(update(coverage, two).coverage, 'unavailable');
  assert.ok(coverage.output('entity').some(value => value.attachmentId === 'near'), 'Far unavailability removed completed near coverage');

  const moved = input({ origin: [0.00005, 0, 100], cameras: [{ ...near, range: 10 }, far] });
  assert.equal(update(coverage, moved).coverage, 'loading');
  const movedNear = latestRequest(adapter, 'entity', 'near');
  assert.equal(adapter.complete(movedNear), true);
  assert.equal(coverage.status('entity'), 'loading');
  assert.ok(coverage.output('entity').some(value => value.attachmentId === 'near'), 'Near camera could not advance while far terrain was unavailable');
});

test('keeps a pending terrain replacement loading, then settles prepared terrain without polling', async () => {
  let missing = false;
  let resolvePreparation!: () => void;
  const preparation = new Promise<void>(resolve => { resolvePreparation = resolve; });
  const adapter = controlledAdapter();
  const settled = deferred();
  const { coverage } = owner(adapter, {
    height: () => missing ? null : 0,
    prepare: async () => { await preparation; },
    changed: settled.resolve,
  });

  update(coverage, input());
  const initial = latestRequest(adapter);
  assert.equal(adapter.complete(initial), true);
  const previous = coverage.output('entity');

  missing = true;
  const pending = input({ origin: [0.02, 0, 100] });
  assert.equal(update(coverage, pending).coverage, 'loading');
  assert.deepEqual(coverage.output('entity'), previous, 'Pending terrain keeps the previous completed unit');
  await Promise.resolve();

  resolvePreparation();
  await preparation;
  await settled.promise;
  assert.equal(update(coverage, input({
    origin: [0.02, 0, 100],
    placement: 'elevation-unavailable',
  })).coverage, 'unavailable');
  assert.deepEqual(coverage.output('entity'), []);
});

test('failure clears displayed camera output, retry uses current input, and stale identity cannot return', () => {
  const adapter = controlledAdapter();
  const { coverage, diagnostics } = owner(adapter);
  update(coverage, input());
  const initial = latestRequest(adapter);
  assert.equal(adapter.complete(initial), true);
  assert.ok(coverage.output('entity').length);

  adapter.fail(new Error('renderer failed'));
  assert.equal(coverage.status('entity'), 'unavailable');
  assert.deepEqual(coverage.output('entity'), []);
  assert.equal(diagnostics.length, 1);
  coverage.resetElevation();
  assert.equal(coverage.status('entity'), 'unavailable', 'An elevation reset cannot recover a failed renderer');

  coverage.retry();
  coverage.flush();
  assert.deepEqual(adapter.values(), [], 'Retry must wait for a newly built request');
  update(coverage, input());
  assert.equal(adapter.retries, 1);
  const retry = latestRequest(adapter);
  assert.equal(coverage.status('entity'), 'loading');
  assert.equal(adapter.complete(retry), true);
  assert.equal(coverage.status('entity'), 'ready');

  update(coverage, input({ cameras: [] }));
  assert.deepEqual(coverage.output('entity'), []);
  const publicationCount = adapter.published.length;
  assert.equal(adapter.complete(initial), false);
  assert.equal(adapter.published.length, publicationCount);

  const replacement = input({ cameras: [camera('camera', 90)] });
  assert.equal(update(coverage, replacement).coverage, 'loading');
  assert.equal(adapter.complete(retry), false, 'A reused attachment identity must reject the old result');
  const current = latestRequest(adapter);
  assert.equal(adapter.complete(current), true);
  assert.equal(coverage.status('entity'), 'ready');
});

test('hiding coverage removes all camera geometry and showing it requests the current state again', () => {
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter);
  update(coverage, input());
  const initial = latestRequest(adapter);
  assert.equal(adapter.complete(initial), true);

  const hidden = input({ configuration: {
    ...configuration,
    entityVisibility: { ...configuration.entityVisibility, footprints: false },
  } });
  assert.equal(update(coverage, hidden).coverage, 'ready');
  assert.deepEqual(coverage.output('entity'), []);

  const shown = input({ configuration });
  assert.equal(update(coverage, shown).coverage, 'loading');
  assert.equal(adapter.complete(initial), false, 'Hidden work must not restore an obsolete result');
  const current = latestRequest(adapter);
  assert.equal(adapter.complete(current), true);
  assert.equal(coverage.status('entity'), 'ready');
});

for (const action of ['retry', 'reset elevation'] as const) test(`${action} cannot republish discarded terrain while current terrain is being prepared`, async () => {
  let height: number | null = 0;
  const preparation = deferred();
  const adapter = controlledAdapter();
  const { coverage, elevation } = owner(adapter, {
    height: () => height,
    prepare: () => preparation.promise,
  });
  update(coverage, input());
  const original = latestRequest(adapter);
  adapter.complete(original);
  const previous = coverage.output('entity');

  height = null;
  if (action === 'retry') elevation.retry();
  else elevation.reset(configuration.elevation);
  coverage.retry();
  coverage.flush();
  assert.equal(adapter.values().length, 0, 'Retry must not resubmit the discarded terrain');
  assert.deepEqual(adapter.retained(), [original], 'The adapter must retain only the accepted historical display');
  assert.equal(adapter.complete(original), false, 'Pre-retry work must no longer be eligible');
  assert.deepEqual(coverage.output('entity'), previous, 'Historical display remains coherent while retry waits');
  const moved = input({ origin: [0.02, 0, 100] });
  assert.equal(update(coverage, moved).coverage, 'loading');
  assert.equal(adapter.values().length, 0, 'Missing current terrain must not submit historical terrain');
  assert.equal(coverage.status('entity'), 'loading');
  await Promise.resolve();
  height = 20;
  preparation.resolve();
  await new Promise<void>(resolve => setImmediate(resolve));
  update(coverage, moved);
  const current = latestRequest(adapter);
  assert.notEqual(current.terrain, original.terrain);
  assert.deepEqual(current.origin, moved.origin);
  assert.equal(adapter.complete(current), true);
  assert.equal(coverage.status('entity'), 'ready');
  coverage.destroy();
});

test('confirmed unavailability takes precedence over a pending camera in either attachment order', () => {
  const near = { ...camera('near'), range: 10 };
  const far = { ...camera('far'), range: 100 };
  for (const cameras of [[far, near], [near, far]]) {
    const adapter = controlledAdapter();
    const { coverage } = owner(adapter, {
      height: (lng, lat) => Math.hypot(lng * 111195, lat * 111195) <= 20 ? 0 : null,
    });
    const result = update(coverage, input({ cameras }));
    assert.equal(result.coverage, 'unavailable', `Attachment order: ${cameras.map(camera => camera.id)}`);
    assert.equal(adapter.complete(latestRequest(adapter, 'entity', 'near')), true);
    assert.equal(coverage.status('entity'), 'unavailable', 'Completing the near camera must not hide far unavailability');
    coverage.destroy();
  }
});

test('a newly pending camera can recover a center whose earlier placement request settled missing', async () => {
  const pending: ReturnType<typeof deferred>[] = [];
  const { coverage, elevation } = owner(controlledAdapter(), {
    height: () => null,
    prepare: () => { const work = deferred(); pending.push(work); return work.promise; },
  });
  elevation.request('placement:entity', [0, 0], 0);
  await new Promise<void>(resolve => setImmediate(resolve));
  pending[0]!.resolve();
  await new Promise<void>(resolve => setImmediate(resolve));

  const unresolved = input({ placement: 'elevation-unavailable' });
  assert.equal(update(coverage, unresolved).coverage, 'loading');
  await new Promise<void>(resolve => setImmediate(resolve));
  pending[1]!.resolve();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(update(coverage, unresolved).coverage, 'unavailable');
  coverage.destroy();
  elevation.destroy();
});

test('a batch submits the full camera collection once and still publishes cameras independently', () => {
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter);
  const inputs = Array.from({ length: 100 }, (_, index) => input({
    entityId: `entity-${index}`,
    cameras: [{ ...camera(), range: 10, wireframe: false, volumeOpacity: 0 }],
  }));
  for (const value of inputs) coverage.update(value);
  coverage.flush();
  adapter.history.length = 0;

  for (const value of inputs) coverage.update({ ...value, origin: [0, 0, 101] });
  coverage.flush();
  assert.equal(adapter.history.length, 1, 'A scene batch must synchronize the adapter once');
  assert.equal(adapter.history.reduce((total, values) => total + values.length, 0), 100);
  const first = latestRequest(adapter, 'entity-0');
  assert.equal(adapter.complete(first), true);
  assert.equal(coverage.status('entity-0'), 'ready');
  assert.equal(coverage.status('entity-1'), 'loading');

  coverage.flush();
  assert.equal(adapter.history.length, 1, 'An idle flush must not resubmit cameras');
  for (const value of inputs) coverage.remove(value.entityId);
  coverage.flush();
  assert.deepEqual(adapter.values(), [], 'The removal batch must release every camera');
  coverage.destroy();
});

test('small movements reuse a completed terrain patch without resampling its elevation area', async () => {
  let samples = 0;
  const { coverage } = owner(controlledAdapter(), {
    height: () => { samples++; return 0; },
  });
  update(coverage, input());
  await new Promise<void>(resolve => setImmediate(resolve));
  samples = 0;

  for (let step = 1; step <= 24; step++) {
    update(coverage, input({ origin: [step * .00001, 0, 100] }));
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.ok(samples <= 30, `Movement resampled cached terrain: ${samples} elevation samples`);
  coverage.destroy();
});

test('an incomplete camera patch is sampled again only after elevation changes or movement', () => {
  let samples = 0;
  const { coverage, elevation } = owner(controlledAdapter(), {
    height: () => { samples++; return null; },
  });
  updateCameraOnly(coverage, input());
  const first = samples;
  assert.ok(first > 60_000);
  coverage.invalidate();
  updateCameraOnly(coverage, input({ configuration: { ...configuration, projection: 'globe' } }));
  assert.equal(samples, first, 'Display-only rebuild resampled unchanged terrain');
  elevation.retry();
  updateCameraOnly(coverage, input());
  assert.ok(samples > first + 60_000, 'Retry did not resample the incomplete patch');
  const afterRetry = samples;
  updateCameraOnly(coverage, input({ origin: [.001, 0, 100] }));
  assert.ok(samples > afterRetry + 60_000, 'Movement did not resample the incomplete patch');
  coverage.destroy();
  elevation.destroy();
});

test('an obsolete camera range cannot clear retained output after its late failure', async () => {
  let missing = false;
  const pending: ReturnType<typeof deferred>[] = [];
  const adapter = controlledAdapter();
  const { coverage, diagnostics } = owner(adapter, {
    height: () => missing ? null : 0,
    prepare: () => { const work = deferred(); pending.push(work); return work.promise; },
  });
  updateCameraOnly(coverage, input());
  const original = latestRequest(adapter);
  adapter.complete(original);
  const displayed = coverage.output('entity');
  missing = true;
  const range400 = input({ origin: [.02, 0, 100], cameras: [{ ...camera(), range: 400 }] });
  assert.equal(updateCameraOnly(coverage, range400).coverage, 'loading');
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(pending.length, 1);
  const range500 = input({ origin: [.02, 0, 100], cameras: [{ ...camera(), range: 500 }] });
  assert.equal(updateCameraOnly(coverage, range500).coverage, 'loading');
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(pending.length, 2);
  pending[0]!.reject(new Error('obsolete range failed'));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(coverage.status('entity'), 'loading');
  assert.deepEqual(coverage.output('entity'), displayed);
  assert.deepEqual(diagnostics, []);
  pending[1]!.resolve();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(updateCameraOnly(coverage, range500).coverage, 'unavailable');
  assert.deepEqual(coverage.output('entity'), []);
  coverage.destroy();
});

test('removing one camera keeps its shared range pending for the remaining camera', async () => {
  let missing = true;
  const preparation = deferred();
  let calls = 0;
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter, {
    height: () => missing ? null : 0,
    prepare: () => { calls++; return preparation.promise; },
  });
  const both = input({ cameras: [camera('removed'), camera('remaining', 90)] });
  assert.equal(updateCameraOnly(coverage, both).coverage, 'loading');
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  const remaining = input({ cameras: [camera('remaining', 90)] });
  assert.equal(updateCameraOnly(coverage, remaining).coverage, 'loading');
  missing = false;
  preparation.resolve();
  await new Promise<void>(resolve => setImmediate(resolve));
  updateCameraOnly(coverage, remaining);
  const request = latestRequest(adapter, 'entity', 'remaining');
  assert.equal(adapter.values().some(value => value.camera.id === 'removed'), false);
  assert.equal(adapter.complete(request), true);
  assert.equal(coverage.status('entity'), 'ready');
  assert.ok(coverage.output('entity').every(primitive => primitive.attachmentId === 'remaining'));
  coverage.destroy();
});

test('hiding or removing a camera before preparation starts leaves no output', async () => {
  for (const action of ['hide', 'remove'] as const) {
    let calls = 0;
    const { coverage } = owner(controlledAdapter(), {
      height: () => null,
      prepare: async () => { calls++; },
    });
    updateCameraOnly(coverage, input());
    if (action === 'hide') updateCameraOnly(coverage, input({ configuration: {
      ...configuration,
      entityVisibility: { ...configuration.entityVisibility, footprints: false },
    } }));
    else coverage.remove('entity');
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(calls, 0, `${action} started obsolete preparation`);
    assert.deepEqual(coverage.output('entity'), []);
    coverage.destroy();
  }
});

for (const action of ['hide', 'retry', 'reset', 'destroy'] as const)
  test(`${action} keeps obsolete preparation from restoring camera output`, async () => {
    let missing = false;
    const pending: ReturnType<typeof deferred>[] = [];
    const adapter = controlledAdapter();
    const { coverage, elevation } = owner(adapter, {
      height: () => missing ? null : 0,
      prepare: () => { const work = deferred(); pending.push(work); return work.promise; },
    });
    updateCameraOnly(coverage, input());
    const original = latestRequest(adapter);
    adapter.complete(original);
    const displayed = coverage.output('entity');
    missing = true;
    updateCameraOnly(coverage, input({ origin: [.02, 0, 100] }));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(pending.length, 1);
    if (action === 'hide') updateCameraOnly(coverage, input({ configuration: {
      ...configuration,
      entityVisibility: { ...configuration.entityVisibility, footprints: false },
    } }));
    else if (action === 'retry') { elevation.retry(); coverage.retry(); coverage.flush(); }
    else if (action === 'reset') { elevation.reset(configuration.elevation); coverage.retry(); coverage.flush(); }
    else { coverage.destroy(); elevation.destroy(); }
    const expected = action === 'hide' || action === 'destroy' ? [] : displayed;
    assert.deepEqual(coverage.output('entity'), expected);
    pending[0]!.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(coverage.output('entity'), expected, 'Obsolete completion restored camera output');
    assert.equal(adapter.complete(original), false, 'Obsolete GPU work regained publication rights');
    coverage.destroy();
    elevation.destroy();
  });

for (const available of [true, false]) test(`cached terrain waits for placement preparation that ${available ? 'resolves' : 'remains missing'}`, async () => {
  let missing = false;
  let prepareCalls = 0;
  const preparation = deferred();
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter, {
    height: () => missing ? null : 0,
    prepare: async () => { prepareCalls++; await preparation.promise; },
  });
  update(coverage, input());
  const initial = latestRequest(adapter);
  adapter.complete(initial);
  const previous = coverage.output('entity');
  await new Promise<void>(resolve => setImmediate(resolve));
  missing = true;
  const unresolved = input({ origin: [.00001, 0, 0], placement: 'elevation-unavailable' });
  assert.equal(update(coverage, unresolved).coverage, 'loading');
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(prepareCalls, 1, 'A cached camera patch must leave the new center to placement preparation');
  assert.ok(adapter.values().every(value => value.origin[2] === 100), 'Unknown placement must not produce a zero-altitude request');
  assert.deepEqual(coverage.output('entity'), previous);
  missing = !available;
  preparation.resolve();
  await new Promise<void>(resolve => setImmediate(resolve));
  if (available) {
    update(coverage, input({ origin: [.00001, 0, 100] }));
    const current = latestRequest(adapter);
    assert.equal(current.origin[2], 100);
    assert.equal(adapter.complete(current), true);
    assert.equal(coverage.status('entity'), 'ready');
  } else {
    assert.equal(update(coverage, unresolved).coverage, 'unavailable');
    assert.deepEqual(coverage.output('entity'), []);
    assert.deepEqual(adapter.values(), []);
    assert.equal(adapter.complete(initial), false);
  }
  coverage.destroy();
});

test('a settled missing camera range clears only its output while another range is pending', async () => {
  let missing = false;
  const pending: ReturnType<typeof deferred>[] = [];
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter, {
    height: () => missing ? null : 0,
    prepare: () => { const work = deferred(); pending.push(work); return work.promise; },
  });
  const cameras = [camera('near'), { ...camera('far'), range: 600 }];
  update(coverage, input({ cameras }));
  const near = latestRequest(adapter, 'entity', 'near');
  const far = latestRequest(adapter, 'entity', 'far');
  adapter.complete(near); adapter.complete(far);
  await Promise.resolve();
  missing = true;
  const moved = input({ cameras, origin: [.02, 0, 100] });
  coverage.requestAreas('entity', [.02, 0], [cameras[0]!], true);
  await Promise.resolve();
  update(coverage, moved);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(pending.length, 2);
  pending[0]!.resolve();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(update(coverage, moved).coverage, 'unavailable');
  assert.deepEqual(coverage.output('entity'), far.geometry, 'Only the still-pending camera retains its display');
  assert.equal(adapter.complete(near), false, 'A settled missing range must not regain old coverage');
  coverage.destroy();
  pending[1]!.resolve();
});

const appearanceChanges: Record<string, Partial<CameraAttachment>> = {
  color: { color: '#0000ff' },
  volume: { volumeOpacity: .8 },
  wireframe: { wireframe: false },
  width: { wireframeWidth: 8 },
  unchanged: {},
};
for (const [name, appearance] of Object.entries(appearanceChanges)) test(`pending replacement terrain checks current appearance: ${name}`, async () => {
  const changedAppearance = name !== 'unchanged';
  let missing = false;
  const preparation = deferred();
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter, {
    height: () => missing ? null : 0,
    prepare: () => preparation.promise,
  });
  const red = { ...camera(), color: '#ff0000' };
  update(coverage, input({ cameras: [red] }));
  const initial = latestRequest(adapter);
  adapter.complete(initial);
  update(coverage, input({ cameras: [red], origin: [.00001, 0, 100] }));
  const intermediate = latestRequest(adapter);
  missing = true;
  const latest = input({ cameras: [{ ...red, ...appearance }], origin: [.02, 0, 100] });
  assert.equal(update(coverage, latest).coverage, 'loading');
  assert.equal(adapter.complete(intermediate), !changedAppearance);
  assert.deepEqual(coverage.output('entity'), changedAppearance ? initial.geometry : intermediate.geometry);
  assert.equal(coverage.status('entity'), 'loading');
  coverage.destroy();
  preparation.resolve();
});

test('a failed required tile clears only its camera while another region remains pending', () => {
  let missing = false;
  const height = Object.assign((lng: number, _lat: number) => missing && lng > 0.01 ? null : 0,
    { failedAt: (lng: number, _lat: number) => missing && lng > 0.01 });
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter, { height });
  update(coverage, input());
  const previous = latestRequest(adapter);
  adapter.complete(previous);
  missing = true;
  const failed = input({ origin: [0.02, 0, 100] });
  assert.equal(update(coverage, failed).coverage, 'unavailable');
  assert.deepEqual(coverage.output('entity'), []);
  assert.equal(adapter.complete(previous), false);
  coverage.destroy();
});

test('a failed region leaves a completed camera elsewhere ready', () => {
  const height = Object.assign((lng: number, _lat: number) => lng > .01 ? null : 0,
    { failedAt: (lng: number, _lat: number) => lng > .01 });
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter, { height });
  update(coverage, input({ entityId: 'healthy' }));
  adapter.complete(latestRequest(adapter, 'healthy'));
  assert.equal(coverage.status('healthy'), 'ready');
  assert.equal(update(coverage, input({ entityId: 'failed', origin: [.02, 0, 100] })).coverage, 'unavailable');
  assert.equal(coverage.status('healthy'), 'ready');
  assert.ok(coverage.output('healthy').length);
  coverage.destroy();
});

test('camera computation failure clears obsolete output and retry can recover', () => {
  let fail = false;
  const adapter = controlledAdapter();
  const { coverage, diagnostics } = owner(adapter, {
    height: () => { if (fail) throw new Error('sampling failed'); return 0; },
  });
  update(coverage, input());
  const previous = latestRequest(adapter);
  adapter.complete(previous);
  fail = true;
  assert.equal(update(coverage, input({ origin: [0.02, 0, 100] })).coverage, 'unavailable');
  assert.deepEqual(coverage.output('entity'), []);
  assert.equal(diagnostics.length, 1);
  fail = false;
  coverage.retry();
  assert.equal(update(coverage, input({ origin: [0.02, 0, 100] })).coverage, 'loading');
  const current = latestRequest(adapter);
  assert.equal(adapter.complete(current), true);
  assert.equal(coverage.status('entity'), 'ready');
  coverage.destroy();
});


for (const center of [6, 179.999]) test(`camera completes from exactly prepared coverage at ${center},46`, async () => {
  let bounds: [number, number, number, number] | undefined;
  const unwrapped = (lng: number) => lng + Math.round((center - lng) / 360) * 360;
  const adapter = controlledAdapter();
  const { coverage, elevation } = owner(adapter, {
    height: (lng, lat) => {
      assert.ok(lng >= -180 && lng < 180, `Sampler received ${lng}`);
      const x = unwrapped(lng);
      return bounds && x >= bounds[0] && x <= bounds[2] && lat >= bounds[1] && lat <= bounds[3] ? 0 : null;
    },
    prepare: async positions => {
      assert.ok(positions.every(([lng]) => lng >= -180 && lng < 180));
      const xs = positions.map(([lng]) => unwrapped(lng)), ys = positions.map(([, lat]) => lat);
      bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    },
  });
  try {
    const value = input({ origin: [center, 46, 100], cameras: [{ ...camera(), range: 50_000 }] });
    assert.equal(update(coverage, value).coverage, 'loading');
    await new Promise<void>(resolve => setImmediate(resolve));
    update(coverage, value);
    assert.equal(adapter.complete(latestRequest(adapter)), true);
    assert.equal(coverage.status('entity'), 'ready');
  } finally { coverage.destroy(); elevation.destroy(); }
});

test('switching to a plain camera during unresolved placement discards terrain work', () => {
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter);
  update(coverage, input());
  const displayed = latestRequest(adapter);
  assert.equal(adapter.complete(displayed), true);

  const moved = input({ origin: [.001, 0, 100] });
  assert.equal(update(coverage, moved).coverage, 'loading');
  const inFlight = latestRequest(adapter);
  const plain = input({
    origin: [.001, 0, 0],
    placement: 'elevation-unavailable',
    cameras: [{ ...camera(), terrainVisibility: false }],
  });
  update(coverage, plain);

  assert.deepEqual(adapter.values(), [], 'A plain camera must not submit the old terrain request');
  assert.deepEqual(coverage.output('entity'), [], 'Terrain output must not remain on the plain camera');
  assert.equal(adapter.complete(inFlight), false, 'Late terrain completion must be rejected');
  assert.deepEqual(coverage.output('entity'), []);
  coverage.destroy();
});

test('invalidation restamps an in-flight request while placement is unresolved', () => {
  const adapter = controlledAdapter();
  const preparation = deferred();
  const { coverage } = owner(adapter, {
    height: lng => lng > .01 ? null : 0,
    prepare: () => preparation.promise,
  });
  update(coverage, input());
  const displayed = latestRequest(adapter);
  assert.equal(adapter.complete(displayed), true);
  const previous = coverage.output('entity');

  const moved = input({ origin: [.001, 0, 100] });
  assert.equal(update(coverage, moved).coverage, 'loading');
  const inFlight = latestRequest(adapter);
  const waiting = input({
    origin: [.02, 0, 0],
    placement: 'elevation-unavailable',
  });
  assert.equal(update(coverage, waiting).coverage, 'loading');
  coverage.invalidate('entity');
  update(coverage, waiting);

  const restamped = latestRequest(adapter);
  assert.notEqual(restamped.lifecycle, inFlight.lifecycle);
  assert.deepEqual(coverage.output('entity'), previous, 'Invalidation retains completed output while waiting');
  assert.equal(adapter.complete(inFlight), false, 'The old token must not publish');
  assert.deepEqual(coverage.output('entity'), previous);
  assert.equal(adapter.complete(restamped), true, 'The restamped in-flight request may publish');
  assert.deepEqual(coverage.output('entity'), restamped.geometry);
  assert.equal(coverage.status('entity'), 'loading', 'Placement is still unresolved');
  coverage.destroy();
});

test('moving and changing camera kind while preparation is pending rejects obsolete completion', async () => {
  const preparation = deferred();
  let prepared = false;
  const adapter = controlledAdapter();
  const { coverage, elevation } = owner(adapter, {
    height: lng => prepared || lng < .01 ? 0 : null,
    prepare: async () => { await preparation.promise; prepared = true; },
  });
  try {
    update(coverage, input());
    const original = latestRequest(adapter);
    adapter.complete(original);
    const moved = input({ origin: [.02, 0, 100], cameras: [{ ...camera(), color: '#ff0000' }] });
    assert.equal(update(coverage, moved).coverage, 'loading');
    await Promise.resolve();
    assert.equal(adapter.complete(original), false, 'The old appearance must not publish');
    const plain = { ...moved, cameras: moved.cameras.map(camera => ({ ...camera, terrainVisibility: false })) };
    update(coverage, plain);
    assert.equal(adapter.complete(original), false);
    preparation.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    update(coverage, plain);
    assert.equal(adapter.values().length, 0, 'Late preparation must not submit the old terrain camera');
    assert.ok(coverage.output('entity').length > 0, 'The current plain camera should render');
    assert.equal(adapter.complete(original), false);
  } finally { coverage.destroy(); elevation.destroy(); }
});
