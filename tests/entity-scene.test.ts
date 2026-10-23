import { DEFAULT_ENTITY_MODELS } from '../src/model-settings';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FeatureCollection } from 'geojson';
import type { Map as GLMap } from 'maplibre-gl';
import { EntityScene, DEFAULT_ENTITY_VISIBILITY } from '../src/entities';
import type { RidgelineError } from '../src/errors';
import type { FeatureStyle, MapConfiguration, MapFeature } from '../src/types';
import type { AirbornePrimitive } from '../src/entity-primitives';

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
  sample: (lng: number, lat: number) => number | null = () => 0,
  onDiagnostic?: (error: RidgelineError) => void) {
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
    style, diagnostic: error => { diagnostics.push(error); onDiagnostic?.(error); }, changed: () => {} });
  return {
    scene, diagnostics,
    groundFeatures: () => structuredClone(ground.features),
    frame() { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(0); return callbacks.length; },
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

for (const feedback of ['selection', 'preview'] as const) {
  test(`a style diagnostic changing ${feedback} retains complete output until explicit recovery`, () => {
    let failNext = false, styleCalls = 0;
    const f = sceneFixture(async () => {}, feature => {
      styleCalls++;
      if (failNext) { failNext = false; throw new Error('Transient style failure'); }
      return { color: feature.geometry.coordinates[0] === 0 ? '#123456' : '#abcdef',
        selected: { enabled: false }, hover: { enabled: false } };
    }, undefined, error => {
      if (error.code !== 'CALLBACK_FAILED') return;
      if (feedback === 'selection') f.scene.selection(['aircraft']);
      else f.scene.preview('aircraft');
    });
    let published: readonly AirbornePrimitive[] = [];
    const publish = f.scene.layer.set.bind(f.scene.layer);
    f.scene.layer.set = (primitives, scale) => { published = structuredClone(primitives); publish(primitives, scale); };
    const original: MapFeature = { ...entity(), entity: { ...entity().entity,
      attachments: [{ id: 'body', type: 'sphere', radius: 20 }, { id: 'area', type: 'circle', radius: 30 }] } };
    const update: MapFeature = { ...original, geometry: { type: 'Point', coordinates: [1, 0] }, entity: {
      ...original.entity, altitude: { meters: 200, reference: 'sea-level' }, heading: 90, pitch: 15, roll: 10,
      attachments: [{ id: 'body', type: 'sphere', radius: 40 }, { id: 'area', type: 'circle', radius: 60 }],
    } };
    try {
      f.scene.set([original]);
      f.frame();
      const previous = { state: f.scene.getState(original.id), marker: f.scene.marker(original),
        airborne: published, ground: f.groundFeatures() };
      assert.ok(previous.airborne.length > 0);
      assert.ok(previous.ground.length > 0);
      failNext = true;
      f.scene.set([update]);
      f.frame();
      assert.equal(styleCalls, 2);
      assert.equal(f.diagnostics.length, 1);
      for (let frame = 0; frame < 5; frame++) f.frame();
      assert.equal(styleCalls, 2, 'Feedback must not retry a failed style automatically');
      assert.deepEqual(f.scene.getState(original.id), previous.state);
      assert.deepEqual(f.scene.marker(update), previous.marker);
      assert.deepEqual(published, previous.airborne);
      assert.deepEqual(f.groundFeatures(), previous.ground);
      assert.equal(f.frame(), 0, 'Failed styling must settle without scheduled preparation');
      if (feedback === 'selection') f.scene.set([update]);
      else f.scene.retry();
      f.frame();
      assert.equal(styleCalls, 3);
      assert.deepEqual(f.scene.marker(update).position, [1, 0]);
      assert.equal(f.scene.getState(original.id)?.altitude, 200);
      assert.notDeepEqual(published, previous.airborne);
      assert.notDeepEqual(f.groundFeatures(), previous.ground);
    } finally { f.destroy(); }
  });

  for (const diagnostic of ['ALTITUDE_MISSING', 'BELOW_TERRAIN'] as const) {
    test(`${diagnostic} diagnostics changing ${feedback} report once and settle`, () => {
      let notifications = 0, styleCalls = 0;
      const f = sceneFixture(async () => {}, () => { styleCalls++; return {}; }, undefined, error => {
        if (error.code !== diagnostic) return;
        notifications++;
        if (feedback === 'selection') f.scene.selection(notifications % 2 ? ['aircraft'] : []);
        else f.scene.preview(notifications % 2 ? 'aircraft' : null);
      });
      const aircraft: MapFeature = { ...entity(), entity: diagnostic === 'ALTITUDE_MISSING'
        ? { groundIfNoAltitude: false }
        : { altitude: { meters: -1, reference: 'sea-level' } } };
      try {
        f.scene.set([aircraft]);
        f.frame();
        const previous = f.scene.getState(aircraft.id);
        assert.equal(previous?.placement, diagnostic === 'ALTITUDE_MISSING' ? 'withheld' : 'below-terrain');
        assert.equal(notifications, 1);
        for (let frame = 0; frame < 5; frame++) f.frame();
        assert.equal(notifications, 1, 'Feedback must not repeat a settled diagnostic');
        assert.equal(styleCalls, 1, 'Feedback must not recompute installed valid preparation');
        assert.deepEqual(f.scene.getState(aircraft.id), previous);
        assert.equal(f.frame(), 0, 'Diagnostics must leave no preparation loop');
        f.scene.set([entity(1)]);
        f.frame();
        assert.equal(f.scene.getState(aircraft.id)?.placement, 'airborne');
        f.scene.set([aircraft]);
        f.frame();
        assert.equal(notifications, 2, 'A new diagnostic after valid recovery must still report');
      } finally { f.destroy(); }
    });
  }
}

for (const diagnostic of ['CALLBACK_FAILED', 'BELOW_TERRAIN'] as const) {
  for (const action of ['replace', 'configure'] as const) {
    test(`${diagnostic} diagnostics preserve ${action} work scheduled by the observer`, () => {
      let styleCalls = 0, notifications = 0;
      const f = sceneFixture(async () => {}, () => {
        styleCalls++;
        if (diagnostic === 'CALLBACK_FAILED' && styleCalls === 1) throw new Error('Transient style failure');
        return {};
      }, undefined, error => {
        if (error.code !== diagnostic || ++notifications !== 1) return;
        if (action === 'replace') f.scene.set([entity(2)]);
        else f.scene.configure();
      });
      const aircraft: MapFeature = diagnostic === 'CALLBACK_FAILED' ? entity(1)
        : { ...entity(1), entity: { altitude: { meters: -1, reference: 'sea-level' } } };
      try {
        f.scene.set([aircraft]);
        f.frame();
        assert.equal(notifications, 1);
        f.frame();
        assert.equal(styleCalls, 2, 'An accepted replacement or configuration must still prepare');
        assert.deepEqual(f.scene.marker(aircraft).position, [action === 'replace' ? 2 : 1, 0]);
        assert.equal(f.scene.getState(aircraft.id)?.placement,
          action === 'configure' && diagnostic === 'BELOW_TERRAIN' ? 'below-terrain' : 'airborne');
        assert.equal(notifications, 1);
        assert.equal(f.frame(), 0);
      } finally { f.destroy(); }
    });
  }
}

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

test('a sampling callback that changes the scene before throwing cannot invalidate retained preparation', () => {
  let armed = false, interrupted = false;
  const f = sceneFixture(async () => {}, undefined, () => {
    if (armed) {
      armed = false;
      interrupted = true;
      f.scene.selection(['aircraft']);
      throw new Error('Superseded sampling failed');
    }
    return 0;
  });
  try {
    f.scene.set([entity()]);
    f.frame();
    const previous = f.scene.getState('aircraft');
    assert.equal(previous?.coverage, 'ready');
    f.scene.set([entity(1)]);
    armed = true;
    f.frame();
    assert.ok(interrupted, 'Sampling must reach the reentrant scene change');
    assert.deepEqual(f.scene.getState('aircraft'), previous);
    assert.deepEqual(f.scene.marker(entity(1)).position, [0, 0]);
    assert.deepEqual(f.diagnostics, [], 'A discarded computation must not fail the retained presentation');
    f.frame();
    assert.equal(f.scene.getState('aircraft')?.coverage, 'ready');
    assert.deepEqual(f.scene.marker(entity(1)).position, [1, 0]);
  } finally { f.destroy(); }
});

test('selection and preview retain prepared feedback without changing physical attachments', () => {
  let broken = false;
  const f = sceneFixture(async () => {}, () => {
    if (broken) throw new Error('Current accessor is unavailable');
    return { color: '#123456', radius: 7, selected: { color: '#2468ac', radius: 11 },
      hover: { color: '#789abc', radius: 9 } };
  });
  let published: readonly AirbornePrimitive[] = [];
  const publish = f.scene.layer.set.bind(f.scene.layer);
  f.scene.layer.set = (primitives, scale) => { published = structuredClone(primitives); publish(primitives, scale); };
  const aircraft: MapFeature = { ...entity(), entity: { ...entity().entity,
    attachments: [{ id: 'body', type: 'sphere', radius: 20 }, { id: 'area', type: 'circle', radius: 30 }] } };
  try {
    f.scene.set([aircraft]);
    f.frame();
    const physical = published.filter(primitive => primitive.mode !== 'points' || !primitive.marker);
    const ground = f.groundFeatures();
    assert.ok(physical.length > 0, 'Physical airborne attachment must be published');
    assert.ok(ground.length > 0, 'Ground attachment source must be published');
    const source = structuredClone(aircraft);
    function assertFeedback(size: number, rgb: [number, number, number]) {
      const fill = published.find(primitive => primitive.mode === 'points' && primitive.marker === 'fill');
      assert.ok(fill, 'Airborne fallback dot must be published');
      assert.equal(fill.size, size);
      assert.deepEqual(fill.color, [...rgb.map(channel => channel / 255), 1]);
      assert.deepEqual(published.filter(primitive => primitive.mode !== 'points' || !primitive.marker), physical);
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
