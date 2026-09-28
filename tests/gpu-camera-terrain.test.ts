import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraTerrain, terrainCoordinates, cameraRangeBounds, cameraTerrainPreparationBounds } from '../src/gpu-camera-terrain';

test('camera movement reuses terrain samples until it leaves the cached margin', () => {
  let samples = 0;
  const height = () => { samples++; return 100; };
  const original = cameraTerrain(0,0,2000,height);
  assert.equal(original.ready,true);
  const initial = samples;
  assert.equal(cameraTerrain(.0001,.0001,2000,height,original),original);
  assert.equal(samples,initial);
  assert.notEqual(cameraTerrain(.02,0,2000,height,original),original);
  assert.ok(samples>initial);
});

test('unknown terrain never becomes a ready patch and dateline corners remain local', () => {
  const unknown = cameraTerrain(179.999,0,2000,()=>null);
  assert.equal(unknown.ready,false);
  const ready = cameraTerrain(179.999,0,2000,()=>10,unknown);
  assert.equal(ready.ready,true);
  const coords=terrainCoordinates(ready);
  assert.ok(Math.abs(coords[1][0]-coords[0][0])<1);
});


test('camera range bounds include the entire range across the dateline', () => {
  const terrain = cameraTerrain(179.999, 0, 2000, () => 0);
  assert.deepEqual(cameraRangeBounds(terrain, [179.999, 0, 100], terrain.half, 1024), [0, 0, 1024, 1024]);
  const [x, y, width, height] = cameraRangeBounds(terrain, [-180.001, 0, 100], terrain.half / 4, 1024);
  assert.ok(x >= 381 && x <= 382 && y >= 381 && y <= 382);
  assert.ok(width >= 260 && width <= 262 && height >= 260 && height <= 262);
});

test('patch preparation bounds include every sampled latitude at 46 degrees', () => {
  const sampled: [number, number][] = [];
  cameraTerrain(6, 46, 50_000, (lng, lat) => { sampled.push([lng, lat]); return 0; });
  const [west, south, east, north] = cameraTerrainPreparationBounds(6, 46, 50_000);
  assert.ok(sampled.every(([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north));
});

test('camera samples use bounded longitudes across the date line', () => {
  const sampled: number[] = [];
  const patch = cameraTerrain(179.999, 0, 2000, (lng) => {
    sampled.push(lng);
    return lng >= -180 && lng < 180 ? 0 : null;
  });
  assert.equal(patch.ready, true);
  assert.ok(sampled.some(lng => lng < -179.9));
  assert.ok(sampled.every(lng => lng >= -180 && lng < 180));
});
