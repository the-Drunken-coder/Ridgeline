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

type ControlledAdapter = {
  factory: SensorCameraAdapterFactory;
  values: () => GpuCamera[];
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
  const history: GpuCamera[][] = [];
  const published: GpuCamera[] = [];
  const adapter: ControlledAdapter = {
    factory: (_map, onComplete, onFailure) => {
      complete = onComplete;
      fail = onFailure;
      return {
        set(values) { current = [...values]; history.push(current); },
        attach() {},
        pick() { return []; },
        retry() { adapter.retries++; },
        destroy() {},
      };
    },
    values: () => current,
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

function latestRequest(adapter: ControlledAdapter, entityId = 'entity', cameraId = 'camera') {
  const value = [...adapter.values()].find(item => item.entityId === entityId && item.camera.id === cameraId);
  assert.ok(value, `No active request for ${entityId}/${cameraId}`);
  return value;
}

test('publishes matching geometry and leaves initial coverage absent', () => {
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter);
  const first = coverage.update(input());
  assert.equal(first.coverage, 'loading');
  assert.deepEqual(first.geometry, []);

  const request = latestRequest(adapter);
  assert.equal(adapter.complete(request), true);
  assert.equal(adapter.published.length, 1);
  const ready = coverage.update(input());
  assert.equal(ready.coverage, 'ready', 'An equivalent update should remain current');
  assert.deepEqual(ready.geometry, request.geometry, 'Displayed primitives must come from the completed request');
  assert.deepEqual(coverage.output('entity'), request.geometry);
  assert.ok(ready.geometry.some(primitive => primitive.mode === 'triangles'));
  assert.ok(ready.geometry.some(primitive => primitive.mode === 'lines'));
});

test('retains the completed unit while moving and accepts an intermediate result without making a newer request ready', () => {
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter);
  coverage.update(input());
  const initial = latestRequest(adapter);
  assert.equal(adapter.complete(initial), true);
  const previous = coverage.output('entity');

  const moved = input({ origin: [0.001, 0, 100] });
  assert.equal(coverage.update(moved).coverage, 'loading');
  assert.deepEqual(coverage.output('entity'), previous, 'A delayed replacement must retain the old geometry');
  const intermediate = latestRequest(adapter);

  const latest = input({ origin: [0.002, 0, 100] });
  assert.equal(coverage.update(latest).coverage, 'loading');
  const current = latestRequest(adapter);
  assert.notEqual(current, intermediate);

  assert.equal(adapter.complete(intermediate), true, 'A completed intermediate result is still displayable');
  assert.deepEqual(coverage.output('entity'), intermediate.geometry);
  assert.equal(coverage.status('entity'), 'loading', 'Intermediate display must not report the newer request ready');
  assert.equal(adapter.complete(current), true);
  assert.equal(coverage.status('entity'), 'ready');
  assert.deepEqual(coverage.output('entity'), current.geometry);
});

test('publishes attached cameras independently while readiness waits for all current results', () => {
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter);
  const two = input({ cameras: [camera('first'), camera('second', 90)] });
  assert.equal(coverage.update(two).coverage, 'loading');
  const first = latestRequest(adapter, 'entity', 'first');
  const second = latestRequest(adapter, 'entity', 'second');

  assert.equal(adapter.complete(first), true);
  assert.equal(coverage.status('entity'), 'loading');
  assert.equal(coverage.output('entity').filter(value => value.attachmentId === 'first').length, first.geometry.length);
  assert.equal(adapter.complete(second), true);
  assert.equal(coverage.status('entity'), 'ready');
  assert.equal(coverage.output('entity').filter(value => value.attachmentId === 'second').length, second.geometry.length);
});

test('keeps a pending terrain replacement loading, then settles prepared terrain without polling', async () => {
  let missing = false;
  let prepareCalls = 0;
  let resolvePreparation!: () => void;
  const preparation = new Promise<void>(resolve => { resolvePreparation = resolve; });
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter, {
    height: () => missing ? null : 0,
    prepare: async () => { prepareCalls++; await preparation; },
  });

  coverage.update(input());
  const initial = latestRequest(adapter);
  assert.equal(adapter.complete(initial), true);
  const previous = coverage.output('entity');

  missing = true;
  const pending = input({ origin: [0.02, 0, 100] });
  assert.equal(coverage.update(pending).coverage, 'loading');
  assert.deepEqual(coverage.output('entity'), previous, 'Pending terrain keeps the previous completed unit');
  assert.equal(prepareCalls, 1);

  resolvePreparation();
  await preparation;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(coverage.update(input({
    origin: [0.02, 0, 100],
    placement: 'elevation-unavailable',
    elevationUnavailable: true,
  })).coverage, 'unavailable');
  assert.equal(prepareCalls, 1, 'Settled unknown terrain must not repeatedly prepare');
  assert.deepEqual(coverage.output('entity'), []);
});

test('failure clears displayed camera output, retry uses current input, and stale identity cannot return', () => {
  const adapter = controlledAdapter();
  const { coverage, diagnostics } = owner(adapter);
  coverage.update(input());
  const initial = latestRequest(adapter);
  assert.equal(adapter.complete(initial), true);
  assert.ok(coverage.output('entity').length);

  adapter.fail(new Error('renderer failed'));
  assert.equal(coverage.status('entity'), 'unavailable');
  assert.deepEqual(coverage.output('entity'), []);
  assert.equal(diagnostics.length, 1);

  coverage.retry();
  assert.equal(adapter.retries, 1);
  const retry = latestRequest(adapter);
  assert.equal(coverage.status('entity'), 'loading');
  assert.equal(adapter.complete(retry), true);
  assert.equal(coverage.status('entity'), 'ready');

  coverage.update(input({ cameras: [] }));
  assert.deepEqual(coverage.output('entity'), []);
  const publicationCount = adapter.published.length;
  assert.equal(adapter.complete(initial), false);
  assert.equal(adapter.published.length, publicationCount);

  const replacement = input({ cameras: [camera('camera', 90)] });
  assert.equal(coverage.update(replacement).coverage, 'loading');
  assert.equal(adapter.complete(retry), false, 'A reused attachment identity must reject the old result');
  const current = latestRequest(adapter);
  assert.equal(adapter.complete(current), true);
  assert.equal(coverage.status('entity'), 'ready');
});

test('hiding coverage removes all camera geometry and showing it requests the current state again', () => {
  const adapter = controlledAdapter();
  const { coverage } = owner(adapter);
  coverage.update(input());
  const initial = latestRequest(adapter);
  assert.equal(adapter.complete(initial), true);

  const hidden = input({ configuration: {
    ...configuration,
    entityVisibility: { ...configuration.entityVisibility, footprints: false },
  } });
  assert.equal(coverage.update(hidden).coverage, 'ready');
  assert.deepEqual(coverage.output('entity'), []);

  const shown = input({ configuration });
  assert.equal(coverage.update(shown).coverage, 'loading');
  assert.equal(adapter.complete(initial), false, 'Hidden work must not restore an obsolete result');
  const current = latestRequest(adapter);
  assert.equal(adapter.complete(current), true);
  assert.equal(coverage.status('entity'), 'ready');
});
