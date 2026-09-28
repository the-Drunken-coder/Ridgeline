import assert from 'node:assert/strict';
import test from 'node:test';
import type { Map as GLMap } from 'maplibre-gl';
import { EntityScene, DEFAULT_ENTITY_VISIBILITY } from '../src/entities';
import type { RidgelineError } from '../src/errors';
import type { FeatureStyle, MapConfiguration, MapFeature } from '../src/types';

const configuration: MapConfiguration = {
  basemap: { version: 8, sources: {}, layers: [] }, projection: 'flat', terrain: false,
  hillshade: false, hillshadeOptions: {}, exaggeration: 1, elevation: { tiles: [] },
  entityVisibility: DEFAULT_ENTITY_VISIBILITY,
};
const entity = (lng = 0): MapFeature => ({ type: 'Feature', id: 'aircraft', properties: {},
  geometry: { type: 'Point', coordinates: [lng, 0] },
  entity: { altitude: { meters: 100, reference: 'sea-level' }, attachments: [{ id: 'body', type: 'sphere', radius: 20 }] },
});

function sceneFixture(prepare: (positions: readonly [number, number][], signal: AbortSignal) => Promise<void>,
  style: (feature: MapFeature) => FeatureStyle = () => ({}),
  sample: () => number | null = () => 0) {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const originalCanvas = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class {
    getContext() { return { fillStyle: '', fillRect() {}, getImageData() { return { data: new Uint8ClampedArray([33, 110, 92, 255]) }; } }; }
  } });
  globalThis.requestAnimationFrame = callback => { const id = ++nextFrame; frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => { frames.delete(id); };
  const diagnostics: RidgelineError[] = [];
  const map = { getPixelRatio: () => 1, getLayer: () => undefined, getSource: () => undefined, off: () => {} } as unknown as GLMap;
  const scene = new EntityScene({ map, configuration: () => configuration, sampler: { sample, prepare },
    style, diagnostic: error => diagnostics.push(error), changed: () => {} });
  return {
    scene, diagnostics,
    frame() { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(0); },
    destroy() {
      scene.destroy();
      globalThis.requestAnimationFrame = originalRequest;
      globalThis.cancelAnimationFrame = originalCancel;
      if (originalCanvas) Object.defineProperty(globalThis, 'OffscreenCanvas', originalCanvas);
      else Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
    },
  };
}

test('synchronous and rejected preparation errors are reported without aborting accepted entity updates', async () => {
  for (const prepare of [
    () => { throw new Error('Immediate failure'); },
    async () => { throw new Error('Rejected preparation'); },
  ]) {
    const f = sceneFixture(prepare, undefined, () => null);
    try {
      assert.doesNotThrow(() => f.scene.set([entity()]));
      f.frame();
      await new Promise(resolve => setTimeout(resolve, 0));
      f.frame();
      assert.equal(f.scene.getState('aircraft')?.placement, 'elevation-unavailable');
      assert.equal(f.diagnostics[0]?.code, 'ELEVATION_UNAVAILABLE');
      assert.equal(f.diagnostics[0]?.context.operation, 'entities');
    } finally { f.destroy(); }
  }
});

test('a preparation callback can remove its entity without reviving geometry', async () => {
  let scene: EntityScene<Record<string, unknown>>;
  const f = sceneFixture(async () => { scene.set([], ['aircraft']); }, undefined, () => null);
  scene = f.scene;
  try {
    scene.set([entity()]);
    f.frame();
    await new Promise(resolve => setTimeout(resolve, 0));
    f.frame();
    assert.equal(scene.getState('aircraft'), undefined);
  } finally { f.destroy(); }
});

test('a failed entity style retains the last complete placement', () => {
  let broken = false;
  const f = sceneFixture(async () => {}, () => {
    if (broken) throw new Error('Style failed');
    return {};
  });
  try {
    f.scene.set([entity()]);
    f.frame();
    assert.deepEqual(f.scene.marker(entity()).position, [0, 0]);
    broken = true;
    f.scene.set([entity(1)]);
    f.frame();
    assert.deepEqual(f.scene.marker(entity(1)).position, [0, 0]);
    assert.equal(f.diagnostics.at(-1)?.code, 'CALLBACK_FAILED');
  } finally { f.destroy(); }
});

test('selection rebuilds only entities whose highlight changes', () => {
  let styles = 0;
  const f = sceneFixture(async () => {}, () => { styles++; return {}; });
  try {
    f.scene.set([entity(), { ...entity(1), id: 'other' }]);
    f.frame();
    assert.equal(styles, 2);
    f.scene.selection(['aircraft']);
    f.frame();
    assert.equal(styles, 3);
  } finally { f.destroy(); }
});
