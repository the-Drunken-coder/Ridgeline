import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelRegistry } from '../src/models';
import { RidgelineError } from '../src/errors';
import { solidGlb } from './model-fixtures';
import { DEFAULT_ENTITY_MODELS, modelSettings } from '../src/model-settings';

test('model defaults remain immutable and undefined overrides inherit accepted settings', () => {
  assert.throws(() => Object.assign(DEFAULT_ENTITY_MODELS, { minimumSizePixels: 0 }), TypeError);
  assert.deepEqual(modelSettings(DEFAULT_ENTITY_MODELS, { minimumSizePixels: undefined, switchDistanceMeters: 500 }),
    { switchDistanceMeters: 500, deadZoneMeters: 200, minimumSizePixels: 40 });
});

test('pending asynchronous uploads cancel promptly and dispose late resources without replacing the working asset', async () => {
  const errors: RidgelineError[] = [];
  let finish: (resource: { dispose(): void }) => void = () => {};
  let signal: AbortSignal | undefined;
  let disposed = 0, uploads = 0;
  const registry = new ModelRegistry({ changed: () => {}, diagnostic: error => errors.push(error) });
  registry.renderer({ upload: () => ({ dispose() {} }) });
  await registry.register('shared', { bytes: solidGlb() });
  const previous = registry.get('shared');
  registry.renderer({ upload: (_model, _current, attemptSignal) => {
    uploads++; signal = attemptSignal;
    return new Promise(resolve => { finish = resolve; });
  } });
  const replacement = registry.register('shared', { bytes: solidGlb() });
  await Promise.resolve();
  assert.equal(uploads, 1);
  assert.equal(registry.get('shared'), previous);
  registry.unregister('shared');
  await assert.rejects(replacement, { code: 'MODEL_LOAD_CANCELLED' });
  assert.equal(signal?.aborted, true);
  finish({ dispose: () => disposed++ });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, 1);
  assert.equal(registry.get('shared'), undefined);
  assert.deepEqual(errors, []);
  registry.destroy();
});

test('registration waits for a renderer and unregister cancels without an asset diagnostic', async () => {
  const errors: RidgelineError[] = [];
  const registry = new ModelRegistry({ changed: () => {}, diagnostic: error => errors.push(error) });
  const pending = registry.register('vehicle', { bytes: new ArrayBuffer(0) });
  assert.deepEqual(registry.status('vehicle'), { id: 'vehicle', status: 'loading', replacementPending: false });
  registry.unregister('vehicle');
  await assert.rejects(pending, { code: 'MODEL_LOAD_CANCELLED' });
  assert.deepEqual(registry.status('vehicle'), { id: 'vehicle', status: 'unavailable', replacementPending: false });
  assert.deepEqual(errors, []);
  registry.destroy();
});

test('a renderer change aborts its asynchronous attempt and installs only the resumed upload', async () => {
  const errors: RidgelineError[] = [];
  const registry = new ModelRegistry({ changed: () => {}, diagnostic: error => errors.push(error) });
  let finish: (resource: { dispose(): void }) => void = () => {};
  let signal: AbortSignal | undefined;
  let oldDisposals = 0, newDisposals = 0;
  registry.renderer({ upload: (_model, _current, attemptSignal) => {
    signal = attemptSignal;
    return new Promise(resolve => { finish = resolve; });
  } });
  const pending = registry.register('shared', { bytes: solidGlb() });
  await Promise.resolve();
  registry.renderer(undefined);
  assert.equal(signal?.aborted, true);
  assert.equal(registry.status('shared').status, 'loading');
  registry.renderer({ upload: () => ({ dispose: () => newDisposals++ }) });
  await pending;
  const installed = registry.get('shared');
  finish({ dispose: () => oldDisposals++ });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(registry.get('shared'), installed);
  assert.equal(oldDisposals, 1);
  assert.equal(newDisposals, 0);
  assert.deepEqual(errors, []);
  registry.destroy();
  assert.equal(newDisposals, 1);
});

test('shared registration snapshots bytes and atomically retains the working asset after a failed replacement', async () => {
  const { solidGlb } = await import('./model-fixtures');
  const disposed: object[] = [];
  const registry = new ModelRegistry({ changed: () => {}, diagnostic: () => {} });
  const bytes = solidGlb();
  const definition = { bytes, metersPerUnit: 2, headingOffset: 90 };
  const first = registry.register('shared', definition);
  new Uint8Array(bytes).fill(0); definition.metersPerUnit = 99;
  registry.renderer({ upload: () => { const resource = { dispose: () => disposed.push(resource) }; return resource; } });
  await first;
  const accepted = registry.get('shared');
  assert.ok(accepted);
  assert.equal(accepted.definition.metersPerUnit, 2);
  const replacement = registry.register('shared', { bytes: new ArrayBuffer(0) });
  assert.deepEqual(registry.status('shared'), { id: 'shared', status: 'ready', replacementPending: true });
  await assert.rejects(replacement, { code: 'MODEL_UNSUPPORTED' });
  assert.equal(registry.get('shared'), accepted);
  assert.equal(disposed.length, 0);
  registry.unregister('shared');
  assert.equal(disposed.length, 1);
  registry.destroy();
});

test('reentrant removal during upload disposes the uninstalled result and cancels the promise', async () => {
  const { solidGlb } = await import('./model-fixtures');
  let disposed = 0;
  const registry = new ModelRegistry({ changed: () => {}, diagnostic: () => {} });
  registry.renderer({ upload: () => { registry.unregister('shared'); return { dispose: () => disposed++ }; } });
  await assert.rejects(registry.register('shared', { bytes: solidGlb() }), { code: 'MODEL_LOAD_CANCELLED' });
  assert.equal(disposed, 1);
  assert.equal(registry.get('shared'), undefined);
  registry.destroy();
});

test('renderer readiness failure rejects queued registrations with their own model context', async () => {
  const errors: RidgelineError[] = [];
  const registry = new ModelRegistry({ changed: () => {}, diagnostic: error => errors.push(error) });
  const pending = registry.register('waiting', { bytes: new ArrayBuffer(0) });
  const cause = new RidgelineError('INITIALIZATION_FAILED', 'Style unavailable.', { operation: 'create', recoverable: false });
  registry.readinessFailed(cause);
  await assert.rejects(pending, error => error instanceof RidgelineError && error.context.modelId === 'waiting' &&
    error.context.operation === 'registerModel' && error.cause === cause);
  assert.equal(registry.status('waiting').status, 'failed');
  assert.equal(errors.length, 1);
  registry.destroy();
});

test('only the newest pending registration uploads and destruction cancels pending work', async () => {
  const { solidGlb } = await import('./model-fixtures');
  let uploads = 0, disposals = 0;
  const errors: RidgelineError[] = [];
  const registry = new ModelRegistry({ changed: () => {}, diagnostic: error => errors.push(error) });
  const first = registry.register('shared', { bytes: solidGlb(), metersPerUnit: 2 });
  const second = registry.register('shared', { bytes: solidGlb(), metersPerUnit: 3 });
  await assert.rejects(first, { code: 'MODEL_LOAD_CANCELLED' });
  registry.renderer({ upload: () => { uploads++; return { dispose: () => disposals++ }; } });
  await second;
  assert.equal(registry.get('shared')?.definition.metersPerUnit, 3);
  assert.equal(uploads, 1);
  registry.renderer(undefined);
  const replacement = registry.register('shared', { bytes: solidGlb() });
  registry.destroy(); registry.destroy();
  await assert.rejects(replacement, { code: 'MODEL_LOAD_CANCELLED' });
  assert.equal(disposals, 1);
  assert.equal(uploads, 1);
  assert.deepEqual(errors, []);
});

test('invalid registration settings preserve a working revision and use scoped errors', async () => {
  const { solidGlb } = await import('./model-fixtures');
  const errors: RidgelineError[] = [];
  const registry = new ModelRegistry({ changed: () => {}, diagnostic: error => errors.push(error) });
  registry.renderer({ upload: () => ({ dispose() {} }) });
  const appearance = { mode: 'color' as const, color: '#123456' };
  await registry.register('shared', { bytes: solidGlb(), appearance });
  appearance.color = '#abcdef';
  const accepted = registry.get('shared');
  assert.deepEqual(accepted?.definition.appearance, { mode: 'color', color: '#123456' });
  for (const settings of [{ metersPerUnit: 0 }, { metersPerUnit: NaN }, { headingOffset: Infinity },
    { appearance: { mode: 'color' as const, color: 'not-a-color' } }]) {
    await assert.rejects(registry.register('shared', { bytes: solidGlb(), ...settings }), { code: 'MODEL_INVALID' });
    assert.equal(registry.get('shared'), accepted);
    assert.equal(registry.status('shared').replacementPending, false);
  }
  await assert.rejects(registry.register(' ', { bytes: solidGlb() }), { code: 'MODEL_INVALID' });
  assert.equal(errors.length, 5);
  assert.equal(errors[0]?.context.modelId, 'shared');
  registry.destroy();
});
