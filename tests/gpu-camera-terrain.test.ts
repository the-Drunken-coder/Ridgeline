import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraTerrain, terrainCoordinates, cameraRangeBounds } from '../src/gpu-camera-terrain';

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
