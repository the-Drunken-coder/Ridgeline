import { DEFAULT_ENTITY_MODELS } from '../src/model-settings';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FeatureCollection } from 'geojson';
import type { Map as GLMap } from 'maplibre-gl';
import { EntityScene, DEFAULT_ENTITY_VISIBILITY } from '../src/entities';
import type { RidgelineError } from '../src/errors';
import type { FeatureStyle, MapConfiguration, MapFeature } from '../src/types';
import type { Primitive } from '../src/entity-layer';

const configuration: MapConfiguration = {
  basemap: { version: 8, sources: {}, layers: [] }, projection: 'flat', terrain: false,
  hillshade: false, hillshadeOptions: {}, exaggeration: 1, elevation: { tiles: [] },
  entityModels: DEFAULT_ENTITY_MODELS, entityVisibility: DEFAULT_ENTITY_VISIBILITY,
};
const entity = (lng = 0): MapFeature => ({ type: 'Feature', id: 'aircraft', properties: {},
  geometry: { type: 'Point', coordinates: [lng, 0] },
  entity: { altitude: { meters: 100, reference: 'sea-level' }, attachments: [{ id: 'body', type: 'sphere', radius: 20 }] },
});

function sceneFixture(prepare: (positions: readonly [number, number][], signal: AbortSignal) => Promise<void>,
  style: (feature: MapFeature) => FeatureStyle = () => ({}),
  sample: (lng: number, lat: number) => number | null = () => 0) {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const originalCanvas = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class {
    getContext() { return { fillStyle: '#216e5b', fillRect() {}, getImageData() {
      const hex = this.fillStyle.replace('#', '');
      return { data: new Uint8ClampedArray([0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16)).concat(255)) };
    } }; }
  } });
  globalThis.requestAnimationFrame = callback => { const id = ++nextFrame; frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => { frames.delete(id); };
  const diagnostics: RidgelineError[] = [];
  let ground: FeatureCollection = { type: 'FeatureCollection', features: [] };
  const source = { setData: (data: FeatureCollection) => { ground = data; } };
  const map = { getPixelRatio: () => 1, getLayer: () => undefined,
    getSource: (id: string) => id === 'rl:entity-ground' ? source : undefined, off: () => {} } as unknown as GLMap;
  const scene = new EntityScene({ map, configuration: () => configuration, sampler: { sample, prepare },
    style, diagnostic: error => diagnostics.push(error), changed: () => {} });
  return {
    scene, diagnostics,
    groundFeatures: () => structuredClone(ground.features),
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

for (const callback of ['style', 'sample'] as const) {
  for (const action of ['remove', 'replace'] as const) {
    test(`${callback} can ${action} an entity without restoring its camera output`, () => {
      let armed = false, acted = false;
      const react = () => {
        if (!armed || acted) return;
        acted = true;
        if (action === 'remove') f.scene.set([], ['aircraft']);
        else f.scene.set([{ type: 'Feature', id: 'aircraft', properties: {},
          geometry: { type: 'Point', coordinates: [0, 0] } }]);
      };
      const f = sceneFixture(async () => {}, () => {
        if (callback === 'style') react();
        return {};
      }, () => { if (callback === 'sample') react(); return 0; });
      const camera: MapFeature = { ...entity(), entity: {
        altitude: { meters: 100, reference: 'ground' }, attachments: [
          { id: 'view', type: 'camera', range: 500, bearing: 0, elevation: -45, fovX: 60, fovY: 40 },
        ],
      } };
      try {
        f.scene.set([camera]);
        f.frame();
        assert.equal(f.groundFeatures().length, 2, 'Initial camera fill and outline must exist');
        armed = true;
        f.scene.set([{ ...camera, properties: { revision: 2 } }]);
        f.frame();
        f.frame();
        assert.ok(acted);
        assert.equal(f.scene.getState(camera.id), undefined);
        assert.deepEqual(f.groundFeatures(), []);
      } finally { f.destroy(); }
    });
  }
}

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

test('a required sampling failure removes completed camera coverage while retaining placement and unrelated ground areas', () => {
  const cause = new Error('Required elevation calculation failed');
  let broken = false;
  const f = sceneFixture(async () => {}, undefined, lng => {
    if (broken && Math.abs(lng) < .5) throw cause;
    return 0;
  });
  const camera: MapFeature = { ...entity(), entity: {
    altitude: { meters: 100, reference: 'ground' }, attachments: [
      { id: 'view', type: 'camera', range: 500, bearing: 0, elevation: -45, fovX: 60, fovY: 40 },
      { id: 'area', type: 'circle', radius: 20 },
    ],
  } };
  const other: MapFeature = { ...entity(1), id: 'other', entity: {
    altitude: { meters: 100, reference: 'ground' }, attachments: [{ id: 'other-area', type: 'circle', radius: 20 }],
  } };
  const attachments = () => f.groundFeatures().map(feature => feature.properties?.attachmentId);
  try {
    f.scene.set([camera, other]);
    f.frame();
    assert.equal(f.scene.getState(camera.id)?.coverage, 'ready');
    assert.ok(attachments().includes('view'));
    broken = true;
    f.scene.set([{ ...camera, geometry: { type: 'Point', coordinates: [.01, 0] } }]);
    f.frame();
    assert.equal(f.scene.getState(camera.id)?.coverage, 'unavailable');
    assert.equal(f.scene.getState(camera.id)?.footprintTriangles, 0);
    assert.equal(attachments().includes('view'), false);
    assert.ok(attachments().includes('area'));
    assert.ok(attachments().includes('other-area'));
    assert.deepEqual(f.scene.marker(camera).position, [0, 0]);
    assert.equal(f.diagnostics.at(-1)?.cause, cause);
    broken = false;
    f.scene.retry();
    f.frame();
    assert.equal(f.scene.getState(camera.id)?.coverage, 'ready');
    assert.deepEqual(f.scene.marker(camera).position, [.01, 0]);
    assert.ok(attachments().includes('view'));
  } finally { f.destroy(); }
});

test('selection and preview retain prepared feedback without changing physical attachments', () => {
  let broken = false;
  const f = sceneFixture(async () => {}, () => {
    if (broken) throw new Error('Current accessor is unavailable');
    return { color: '#123456', radius: 7, selected: { color: '#2468ac', radius: 11 },
      hover: { color: '#789abc', radius: 9 } };
  });
  let published: Primitive[] = [];
  const publish = f.scene.layer.set.bind(f.scene.layer);
  f.scene.layer.set = (primitives, scale) => { published = structuredClone(primitives); publish(primitives, scale); };
  const aircraft: MapFeature = { ...entity(), entity: { ...entity().entity,
    attachments: [{ id: 'body', type: 'sphere', radius: 20 }, { id: 'area', type: 'circle', radius: 30 }] } };
  try {
    f.scene.set([aircraft]);
    f.frame();
    const physical = published.filter(primitive => !primitive.marker);
    const ground = f.groundFeatures();
    assert.ok(physical.length > 0, 'Physical airborne attachment must be published');
    assert.ok(ground.length > 0, 'Ground attachment source must be published');
    const source = structuredClone(aircraft);
    function assertFeedback(size: number, rgb: [number, number, number]) {
      const fill = published.find(primitive => primitive.marker === 'fill');
      assert.ok(fill, 'Airborne fallback dot must be published');
      assert.equal(fill.size, size);
      assert.deepEqual(fill.color, [...rgb.map(channel => channel / 255), 1]);
      assert.deepEqual(published.filter(primitive => !primitive.marker), physical);
      assert.deepEqual(f.groundFeatures(), ground);
      assert.deepEqual(aircraft, source);
      assert.deepEqual(f.diagnostics, [], 'Feedback must not call a now-failing style accessor');
    }
    assertFeedback(14, [0x12, 0x34, 0x56]);
    broken = true;
    f.scene.selection(['aircraft']);
    f.frame();
    assertFeedback(22, [0x24, 0x68, 0xac]);
    f.scene.preview('aircraft');
    f.frame();
    assertFeedback(22, [0x24, 0x68, 0xac]);
    f.scene.selection([]);
    f.frame();
    assertFeedback(18, [0x78, 0x9a, 0xbc]);
    f.scene.preview(null);
    f.frame();
    assertFeedback(14, [0x12, 0x34, 0x56]);
  } finally { f.destroy(); }
});


test('unchanged unusable cameras do not restart released terrain preparation', async () => {
  for (const meters of [-1, 0, 0.005]) {
    let preparations = 0;
    const f = sceneFixture(async () => { preparations++; }, undefined,
      (lng, lat) => lng === 0 && lat === 0 ? 0 : null);
    const camera: MapFeature = { ...entity(), entity: {
      altitude: { meters, reference: 'ground' },
      attachments: [{ id: 'view', type: 'camera', terrainVisibility: true, range: 100, bearing: 0, elevation: -45, fovX: 60, fovY: 40 }],
    } };
    try {
      f.scene.set([camera]);
      await new Promise(resolve => setTimeout(resolve, 0));
      f.frame();
      await new Promise(resolve => setTimeout(resolve, 0));
      f.frame();
      const before = preparations;
      f.scene.set([camera]);
      await new Promise(resolve => setTimeout(resolve, 0));
      f.frame();
      assert.equal(preparations, before, `altitude ${meters} restarted inactive camera terrain`);
      f.scene.set([{ ...camera, entity: { ...camera.entity, altitude: { meters: 100, reference: 'ground' } } }]);
      f.frame();
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.ok(preparations > before, 'A newly usable camera must still prepare terrain');
    } finally { f.destroy(); }
  }
});
