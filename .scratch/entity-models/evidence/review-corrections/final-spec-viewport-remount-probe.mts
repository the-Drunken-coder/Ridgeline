import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as native from '/home/ubuntu/.t3/worktrees/Ridgeline/t3code-7c4f2af4/node_modules/maplibre-gl/dist/maplibre-gl.mjs';
class ClassList {
  values = new Set();
  add(...values) { for (const value of values) this.values.add(value); }
  remove(...values) { for (const value of values) this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}
class NativeMap {
  listeners = new globalThis.Map(); removed = 0; cleanups = 0; renderNesting = 0; repaints = 0; duringRender;
  constructor(options) {
    this._container = options.container; this._container.classList.add('maplibregl-map');
    this._canvas = { dataset: {}, addEventListener() {}, removeEventListener() {} };
    const canvas = this._canvas;
    this._container.canvases.add(canvas);
    this._canvasContainer = { remove: () => this._container.canvases.delete(canvas) };
    this._controlContainer = { remove() {} };
    this.style = { tileManagers: {} };
  }
  _render(time) {
    this.renderNesting++;
    try {
      const action = this.duringRender; this.duringRender = undefined; action?.();
      assert.ok(this.style, 'Native style must remain owned until render returns'); return this;
    } finally { this.renderNesting--; }
  }
  _cleanupContainer() { this.cleanups++; native.Map.prototype._cleanupContainer.call(this); }
  remove() {
    assert.equal(this.renderNesting, 0, 'Native removal must wait for outer render');
    this.removed++; this._cleanupContainer(); this.style = undefined;
  }
  getCanvas() { return this._canvas; }
  getSource() { return undefined; } getLayer() { return undefined; }
  hasImage() { return false; } getPixelRatio() { return 1; }
  triggerRepaint() { this.repaints++; }
  on(type, listener) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set); return this; }
  off(type, listener) { this.listeners.get(type)?.delete(listener); return this; }
}
globalThis.__standardsNativeMap = NativeMap;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
const frames = new Map(); let nextFrame = 0;
globalThis.requestAnimationFrame = callback => { const id = ++nextFrame; frames.set(id, callback); return id; };
globalThis.cancelAnimationFrame = id => { frames.delete(id); };
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'maplibre-gl') return { url: 'file:///tmp/ridgeline-model-context/standards-viewport-maplibre-stub.mjs', shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { createViewport } = await import('/tmp/ridgeline-model-spec-review/src/viewport.ts');
const { solidGlb } = await import('/tmp/ridgeline-model-spec-review/tests/model-fixtures.ts');
const results = [];
for (const history of ['ordinary-event-remount', 'render-event-remount', 'nested-render-event-remount', 'render-after-return-remount', 'nested-render-after-return-remount', 'ordinary-throwing-event-remount']) {
  const container = { classList: new ClassList(), canvases: new Set(), removeEventListener() {} };
  const options = { container, basemap: { version: 8, sources: {}, layers: [] }, logger: () => {} };
  const old = createViewport(options); let replacement, emptyInListener = false, destroyEvents = 0;
  const pending = old.registerModel('pending', { bytes: solidGlb() });
  const ready = old.ready;
  const mount = () => { replacement = createViewport(options); };
  old.on('destroy', () => {
    destroyEvents++; emptyInListener = container.canvases.size === 0;
    assert.equal(old.map.cleanups, 1, 'Owned DOM must be retired once before delivery');
    assert.throws(() => old.upsert([]), error => error.code === 'DESTROYED');
    old.destroy();
    if (history.includes('event')) mount();
    if (history.includes('throwing')) throw new Error('consumer destroy listener failure');
  });
  const action = () => {
    old.destroy(); old.destroy();
    if (history.includes('after-return')) mount();
  };
  if (history.startsWith('ordinary')) action();
  else {
    old.map.duringRender = history.startsWith('nested') ? () => {
      old.map.duringRender = action; old.map._render(1);
      assert.equal(old.map.removed, 0, 'Nested return must not remove native state');
    } : action;
    old.map._render(0);
  }
  await assert.rejects(pending, error => error.code === 'MODEL_LOAD_CANCELLED');
  await assert.rejects(ready, error => error.code === 'DESTROYED');
  await Promise.resolve();
  assert.ok(replacement); assert.equal(emptyInListener, true); assert.equal(destroyEvents, 1);
  assert.equal(container.canvases.size, 1); assert.equal(container.classList.contains('maplibregl-map'), true);
  assert.equal(old.map.cleanups, 1); assert.equal(old.map.removed, 1);
  const oldRepaints = old.map.repaints;
  old.destroy(); await Promise.resolve();
  assert.equal(old.map.repaints, oldRepaints); assert.equal(container.canvases.size, 1);
  replacement.destroy(); replacement.destroy();
  assert.equal(container.canvases.size, 0); assert.equal(container.classList.contains('maplibregl-map'), false);
  assert.equal(replacement.map.cleanups, 1); assert.equal(replacement.map.removed, 1);
  results.push({ history, emptyInListener, destroyEvents, replacementClassRetained: true, oldCleanupCount: old.map.cleanups, oldNativeRemovalCount: old.map.removed, registration: 'MODEL_LOAD_CANCELLED', ready: 'DESTROYED' });
}
assert.equal(frames.size, 0);
console.log(JSON.stringify({ revision: 'cf09290e615dfc4809b09519fdfb0825c4642ba9', sourceTree: '04413b0db510cc12b4794ea53f98cf331003ac53', scope: 'real public viewport and registry with constructor/render/remove doubles and exact installed MapLibre6.11 DOM cleanup; no native GPU/browser or pixels claim', results, remainingScheduledFrames: frames.size }, null, 2));
