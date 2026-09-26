import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraFootprint,
  cameraRay,
  groundZone,
  localFrame,
  triangulate,
} from '../src/entity-geometry';
import { decodeElevation, tilePosition } from '../src/elevation-sampler';
import { FeatureStore } from '../src/features';
import type { CameraAttachment, MapFeature } from '../src/types';

const camera: CameraAttachment = {
  id: 'camera',
  type: 'camera',
  bearing: 0,
  elevation: -35,
  fovX: 60,
  fovY: 40,
  range: 2000,
};
const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('camera directions use north and level, including straight down', () => {
  const north = cameraRay({ ...camera, elevation: 0 }, 0, 0);
  close(north[0], 0);
  close(north[1], 1);
  close(north[2], 0);
  const east = cameraRay({ ...camera, bearing: 90, elevation: 0 }, 0, 0);
  close(east[0], 1);
  close(east[1], 0);
  const down = cameraRay({ ...camera, elevation: -90 }, 0, 0);
  close(down[2], -1);
  const edge = cameraRay({ ...camera, elevation: 0 }, 1, 0);
  close((Math.atan2(edge[0], edge[1]) * 180) / Math.PI, 30);
});

test('local geometry crosses the antimeridian and remains finite at high latitude', () => {
  const p = localFrame([179.999, 80, 500])(1000, 0, 0);
  assert.ok(p[0] < 0);
  assert.ok(p.every(Number.isFinite));
  assert.ok(p[2] > 499);
  const a = tilePosition(180, 45, 12),
    b = tilePosition(-180, 45, 12);
  close(a.x, b.x);
});

test('concave ground polygons preserve their area and reject crossed boundaries', () => {
  const boundary: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [2, 2],
    [0, 4],
  ];
  const indices = triangulate(boundary);
  assert.equal(indices.length, 9);
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = boundary[indices[i]!]!,
      b = boundary[indices[i + 1]!]!,
      c = boundary[indices[i + 2]!]!;
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  }
  close(area, 12);
  assert.deepEqual(
    triangulate([
      [0, 0],
      [4, 4],
      [0, 4],
      [4, 0],
    ]),
    [],
  );
});

test('entity validation remains atomic and keeps zero distinct from missing altitude', () => {
  const store = new FeatureStore();
  const feature: MapFeature = {
    type: 'Feature',
    id: 'aircraft',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: {},
    entity: {
      altitude: { meters: 0, reference: 'sea-level' },
      attachments: [camera],
    },
  };
  store.upsert([feature]);
  assert.equal(store.get('aircraft')?.entity?.altitude?.meters, 0);
  assert.throws(
    () =>
      store.upsert([
        { ...feature, properties: { changed: true } },
        {
          ...feature,
          id: 'invalid',
          entity: { attachments: [camera, { ...camera }] },
        },
      ]),
    { code: 'INVALID_FEATURE' },
  );
  assert.equal(store.get('aircraft')?.properties.changed, undefined);
  assert.throws(() => store.upsert([{ ...feature, entity: { attachments: [{ ...camera, fovX: 180 }] } }]), {
    code: 'INVALID_FEATURE',
  });
});

test('camera opacity accepts both endpoints and rejects invalid styles atomically', () => {
  const store = new FeatureStore();
  const feature: MapFeature = {
    type: 'Feature', id: 'camera-style', properties: {},
    geometry: { type: 'Point', coordinates: [0, 0] },
    entity: { attachments: [{ ...camera, fillOpacity: 0, outline: false }] },
  };
  store.upsert([feature]);
  store.upsert([{ ...feature, entity: { attachments: [{ ...camera, fillOpacity: 1 }] } }]);
  for (const fillOpacity of [-0.1, 1.1, NaN, Infinity]) {
    assert.throws(() => store.upsert([
      { ...feature, properties: { changed: true } },
      { ...feature, id: 'invalid', entity: { attachments: [{ ...camera, fillOpacity }] } },
    ]), { code: 'INVALID_FEATURE' });
    assert.equal(store.get(feature.id)?.properties.changed, undefined);
  }
});

test('raw DEM decoding does not use any display exaggeration', () => {
  close(decodeElevation(128, 10, 128, 'terrarium'), 10.5);
  close(decodeElevation(1, 134, 160, 'mapbox'), 0);
  close(
    decodeElevation(2, 3, 4, 'custom', { redFactor: 100, greenFactor: 10, blueFactor: 1, baseShift: -50 }),
    184,
  );
});

test('ground zones sample hills inside their boundary and withhold incomplete terrain', () => {
  const boundary: [number, number][] = [
    [-100, -100],
    [100, -100],
    [100, 100],
    [-100, 100],
  ];
  const zone = groundZone([0, 0, 300], boundary, (lng, lat) =>
    Math.abs(lng) < 0.0003 && Math.abs(lat) < 0.0003 ? 100 : 0,
  );
  assert.ok(zone.triangles.some((p) => p[2] === 100));
  assert.equal(groundZone([0, 0, 300], boundary, () => null).triangles.length, 0);
});



test('camera overlay projects four corners, caps range, and omits skyward cameras', () => {
  const footprint = cameraFootprint([0, 0, 300], { ...camera, elevation: -90 }, 0);
  assert.equal(footprint.length, 4);
  assert.equal(new Set(footprint.map(p => JSON.stringify(p))).size, 4);
  assert.ok(footprint.every(p => p[2] === 0));
  assert.equal(cameraFootprint([0, 0, 300], { ...camera, elevation: 90 }, 0).length, 0);
  const short = cameraFootprint([0, 0, 300], { ...camera, range: 100 }, 0);
  assert.ok(short.every(p => Math.hypot(p[0], p[1]) * 111320 < 101));
});

test('camera aim and horizontal/vertical FOV remain independent', () => {
  const angle = (a: number[], b: number[]) => Math.acos(Math.max(-1, Math.min(1, a.reduce((sum, value, i) => sum + value * b[i]!, 0)))) * 180 / Math.PI;
  for (const bearing of [0, 90, 165]) for (const elevation of [-90, -30, 0, 90]) {
    const pose = { ...camera, bearing, elevation };
    close(angle(cameraRay(pose, -1, 0), cameraRay(pose, 1, 0)), pose.fovX);
    close(angle(cameraRay(pose, 0, -1), cameraRay(pose, 0, 1)), pose.fovY);
    assert.deepEqual(cameraRay({ ...pose, fovX: 110, fovY: 80 }, 0, 0), cameraRay(pose, 0, 0));
  }
});
