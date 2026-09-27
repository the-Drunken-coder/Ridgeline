import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Map as GLMap } from 'maplibre-gl';
import type { CameraAttachment, MapConfiguration } from '../src/types';
import type { GpuCamera } from '../src/gpu-cameras';
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
    elevationUnavailable: false,
    elevationPreparing: false,
    ...overrides,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(value => { resolve = value; });
  return { promise, resolve };
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
  options: Partial<ConstructorParameters<typeof SensorCameraCoverage>[0]> = {},
) {
  const changed: string[] = [];
  const diagnostics: unknown[] = [];
  const coverage = new SensorCameraCoverage({
    map: {} as GLMap,
    height: () => 0,
    diagnostic: cause => diagnostics.push(cause),
    changed: entityId => changed.push(entityId),
    elevationUnavailable: () => false,
    adapter: controlled.factory,
    ...options,
  });
  return { coverage, changed, diagnostics };
}

// One owner update followed by the scene's submission boundary.
function update(coverage: SensorCameraCoverage, value: SensorCameraInput) {
  const output = coverage.update(value);
  coverage.flush();
  return output;
}

function latestRequest(adapter: ControlledAdapter, entityId = 'entity', cameraId = 'camera') {
  const value = [...adapter.values()].find(item => item.entityId === entityId && item.camera.id === cameraId);
  assert.ok(value, `No active request for ${entityId}/${cameraId}`);
  return value;
}

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

test('keeps a near camera current when a farther camera lacks terrain', () => {
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter, {
    height: (lng, lat) => Math.hypot(lng * 111195, lat * 111195) <= 20 ? 0 : null,
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

  const unavailable = input({ cameras: [{ ...near, range: 10 }, far], placement: 'elevation-unavailable', elevationUnavailable: true });
  assert.equal(update(coverage, unavailable).coverage, 'unavailable');
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
  let prepareCalls = 0;
  let resolvePreparation!: () => void;
  const preparation = new Promise<void>(resolve => { resolvePreparation = resolve; });
  const adapter = controlledAdapter();
  const settled = deferred();
  const { coverage } = owner(adapter, {
    height: () => missing ? null : 0,
    prepare: async () => { prepareCalls++; await preparation; },
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
  assert.equal(prepareCalls, 1);

  resolvePreparation();
  await preparation;
  await settled.promise;
  assert.equal(update(coverage, input({
    origin: [0.02, 0, 100],
    placement: 'elevation-unavailable',
    elevationUnavailable: true,
  })).coverage, 'unavailable');
  assert.equal(prepareCalls, 1, 'Settled unknown terrain must not repeatedly prepare');
  assert.deepEqual(coverage.output('entity'), []);
});

test('cancels preparation for an obsolete camera range and suppresses its late failure', async () => {
  let rejectPreparation!: (cause: unknown) => void;
  let signal: AbortSignal | undefined;
  const preparation = new Promise<void>((_resolve, reject) => { rejectPreparation = reject; });
  const adapter = controlledAdapter();
  const { coverage, diagnostics } = owner(adapter, {
    height: () => null,
    prepare: async (_positions, preparationSignal) => { signal = preparationSignal; await preparation; },
  });

  update(coverage, input());
  await Promise.resolve();
  assert.equal(coverage.isPreparing('entity'), true);

  update(coverage, input({ cameras: [] }));
  assert.equal(coverage.isPreparing('entity'), false);
  assert.equal(signal?.aborted, true, 'The consumer must be able to release obsolete preparation work');

  rejectPreparation(new Error('obsolete range failed'));
  await preparation.catch(() => {});
  await Promise.resolve();
  assert.deepEqual(diagnostics, [], 'Detached preparation must not report a diagnostic');
});

test('cancels obsolete ranges without cancelling terrain shared by remaining cameras or other entities', async () => {
  const signals: AbortSignal[] = [];
  const preparation = deferred();
  const { coverage } = owner(controlledAdapter(), {
    height: () => null,
    prepare: (_positions, signal) => { signals.push(signal); return preparation.promise; },
  });
  const first = camera('first');
  const second = camera('second');
  const far = { ...camera('far'), range: 600 };
  update(coverage, input({ cameras: [first, second] }));
  await Promise.resolve();
  assert.equal(signals.length, 1, 'Equal ranges should share pending preparation');
  const shared = signals[0]!;

  update(coverage, input({ cameras: [first, second, far] }));
  await Promise.resolve();
  const farther = signals[1]!;
  update(coverage, input({ entityId: 'other' }));
  await Promise.resolve();
  const other = signals[2]!;

  update(coverage, input({ cameras: [second, far] }));
  assert.equal(shared.aborted, false, 'A remaining camera still needs the shared range');
  update(coverage, input({ cameras: [second] }));
  assert.equal(farther.aborted, true, 'Removing the last camera using a range should cancel it');
  assert.equal(shared.aborted, false);
  assert.equal(other.aborted, false);

  coverage.remove('entity');
  assert.equal(shared.aborted, true);
  assert.equal(other.aborted, false, 'Another entity must retain its preparation');
  coverage.destroy();
  assert.equal(other.aborted, true);
  preparation.resolve();
});

test('hiding, retrying, resetting elevation, and destruction cancel preparation and ignore late completion', async () => {
  for (const action of ['hide', 'retry', 'reset', 'destroy'] as const) {
    const preparation = deferred();
    let signal: AbortSignal | undefined;
    const { coverage, changed, diagnostics } = owner(controlledAdapter(), {
      height: () => null,
      prepare: (_positions, value) => { signal = value; return preparation.promise; },
    });
    update(coverage, input());
    await Promise.resolve();
    assert.ok(signal);
    if (action === 'hide') update(coverage, input({ configuration: {
      ...configuration,
      entityVisibility: { ...configuration.entityVisibility, footprints: false },
    } }));
    else if (action === 'retry') coverage.retry();
    else if (action === 'reset') coverage.resetElevation();
    else coverage.destroy();
    assert.equal(signal.aborted, true, `${action} must cancel pending preparation`);
    const changesAfterAction = changed.length;
    preparation.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(changed.length, changesAfterAction, `${action} must ignore obsolete completion`);
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(coverage.output('entity'), []);
    coverage.destroy();
  }
});

test('removing a camera before preparation starts prevents the consumer call', async () => {
  let calls = 0;
  const { coverage } = owner(controlledAdapter(), {
    height: () => null,
    prepare: async () => { calls++; },
  });
  update(coverage, input());
  coverage.remove('entity');
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(calls, 0);
  coverage.destroy();
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
  const { coverage } = owner(adapter, {
    height: () => height,
    prepare: () => preparation.promise,
  });
  update(coverage, input());
  const original = latestRequest(adapter);
  adapter.complete(original);
  const previous = coverage.output('entity');

  height = null;
  if (action === 'retry') coverage.retry();
  else { coverage.invalidate(); coverage.resetElevation(); }
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
    const result = update(coverage, input({ cameras, elevationUnavailable: true }));
    assert.equal(result.coverage, 'unavailable', `Attachment order: ${cameras.map(camera => camera.id)}`);
    assert.equal(adapter.complete(latestRequest(adapter, 'entity', 'near')), true);
    assert.equal(coverage.status('entity'), 'unavailable', 'Completing the near camera must not hide far unavailability');
    coverage.destroy();
  }
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
