import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraFootprint,
  cameraRay,
  cameraVolume,
  groundZone,
  localFrame,
  terrainRay,
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

test('range limits, skyward rays, and unknown terrain never manufacture a footprint', () => {
  assert.equal(
    terrainRay([0, 0, 300], [0, 0, -1], 200, () => 0),
    null,
  );
  assert.equal(
    terrainRay([0, 0, 300], [0, 0, 1], 2000, () => 0),
    null,
  );
  assert.equal(
    terrainRay([0, 0, 300], [0, 0, -1], 2000, () => null),
    undefined,
  );
  const hit = terrainRay([0, 0, 300], [0, 0, -1], 2000, () => 0);
  assert.ok(hit);
  close(hit.distance, 300, 0.1);
  close(hit.point[2], 0);
  const footprint = cameraFootprint([0, 0, 300], camera, () => null);
  assert.equal(footprint.missing, true);
  assert.deepEqual(footprint.triangles, []);
});

test('a ridge blocks the farther ground instead of merely draping a trapezoid over it', () => {
  const flat = cameraFootprint([0, 0, 300], { ...camera, elevation: -20, fovY: 30 }, () => 0);
  const ridge = cameraFootprint([0, 0, 300], { ...camera, elevation: -20, fovY: 30 }, (_lng, lat) => {
    const north = ((lat * Math.PI) / 180) * 6371008.8;
    return north >= 300 && north <= 450 ? 400 : 0;
  });
  assert.ok(flat.triangles.some((p) => ((p[1] * Math.PI) / 180) * 6371008.8 > 450));
  assert.ok(ridge.triangles.length > 0);
  assert.ok(ridge.triangles.every((p) => ((p[1] * Math.PI) / 180) * 6371008.8 < 451));
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

test('raw DEM decoding does not use any display exaggeration', () => {
  close(decodeElevation(128, 10, 128, 'terrarium'), 10.5);
  close(decodeElevation(1, 134, 160, 'mapbox'), 0);
  close(
    decodeElevation(2, 3, 4, 'custom', { redFactor: 100, greenFactor: 10, blueFactor: 1, baseShift: -50 }),
    184,
  );
});

test('camera volume includes the centre ray at full slant range', () => {
  const volume = cameraVolume([0, 0, 300], { ...camera, elevation: -90 });
  assert.ok(volume.triangles.some((p) => Math.abs(p[2] + 1700) < 0.001));
  assert.ok(volume.triangles.every((p) => p.every(Number.isFinite)));
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
