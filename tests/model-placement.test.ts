import assert from 'node:assert/strict';
import test from 'node:test';
import { modelPlacement, scaleModelPlacement } from '../src/model-placement';

const input = { bounds: { min: [-1, -1, -3] as [number, number, number], max: [1, 1, 3] as [number, number, number] },
  location: [0, 0] as [number, number], placement: 'airborne' as const, altitude: 100,
  heading: 0, metersPerUnit: 1, headingOffset: 0, terrain: false, exaggeration: 1 };
const near = (actual: number, expected: number, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('authored axes turn without reflection and pitch follows the corrected nose', () => {
  const north = modelPlacement(input, () => 0);
  assert.equal(north.status, 'ready');
  if (north.status !== 'ready') return;
  assert.deepEqual(north.basis, [[-1, 0, 0], [0, 0, 1], [0, 1, 0]]);
  const rightDown = modelPlacement({ ...input, roll: 30 }, () => 0);
  assert.equal(rightDown.status, 'ready');
  if (rightDown.status !== 'ready') return;
  near(-rightDown.basis[0][2], -.5);
  const offset = modelPlacement({ ...input, headingOffset: 90, pitch: 30 }, () => 0);
  assert.equal(offset.status, 'ready');
  if (offset.status !== 'ready') return;
  near(offset.basis[0][0], 0); near(offset.basis[0][1], Math.sqrt(3) / 2); near(offset.basis[0][2], .5);
  assert.deepEqual(offset.position, [0, 0, 100]);
});

test('ground contact follows the displayed plane without stretching the rigid model', () => {
  const metersPerDegree = 2 * Math.PI * 6371008.8 / 360;
  const height = (lng: number, lat: number) => 100 + .2 * lng * metersPerDegree + .3 *
    Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 6371008.8;
  for (const displayScale of [1, 25]) {
    const placed = modelPlacement({ ...input, placement: 'ground', altitude: undefined,
      terrain: true, exaggeration: 2, heading: 37, headingOffset: -19, displayScale }, height);
    assert.equal(placed.status, 'ready');
    if (placed.status !== 'ready') continue;
    const up = placed.basis[1].map(value => value / displayScale);
    const normal = [-.4, -.6, 1], length = Math.hypot(...normal);
    up.forEach((value, axis) => near(value, normal[axis]! / length));
    for (const basis of placed.basis) near(Math.hypot(...basis), displayScale);
    for (const corner of placed.corners.slice(0, 4))
      near(placed.position[2] + corner[2] - (200 + .4 * corner[0] + .6 * corner[1]), .02, 1e-7);
    assert.deepEqual(placed.position.slice(0, 2), input.location);
  }
});

test('size prediction keeps airborne origins fixed and ground bases on their fitted plane', () => {
  const flying = modelPlacement(input, () => 0);
  const grounded = modelPlacement({ ...input, placement: 'ground', altitude: undefined }, () => 100);
  assert.equal(flying.status, 'ready'); assert.equal(grounded.status, 'ready');
  if (flying.status !== 'ready' || grounded.status !== 'ready') return;
  const larger = scaleModelPlacement(flying, 10), resting = scaleModelPlacement(grounded, 10);
  assert.deepEqual(larger.position, [0, 0, 100]);
  assert.deepEqual(resting.position, [0, 0, 10.02]);
  assert.equal(resting.displayScale, 10);
  assert.equal(Math.hypot(...larger.basis[0]), 10);
  near(Math.min(...resting.corners.map(corner => resting.position[2] + corner[2])), .02);
  assert.deepEqual(flying.position, [0, 0, 100]);
  assert.equal(flying.displayScale, 1);
});
