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

test('unknown required terrain withholds geometry until the exact probes become known', () => {
  const known = new Map<string, number>();
  const at = (lng: number, lat: number) => known.get(`${lng},${lat}`) ?? null;
  const ground = { ...input, placement: 'ground' as const, altitude: undefined, terrain: true, displayScale: 20 };
  let result = modelPlacement(ground, at), rounds = 0;
  while (result.status === 'unknown' && rounds++ < 4) {
    assert.ok(result.missingPositions.length > 0);
    for (const point of result.requiredPositions) known.set(point.join(','), 100);
    result = modelPlacement(ground, at);
  }
  assert.equal(rounds, 3, 'Center, physical slope, then enlarged contact each require known terrain');
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  near(result.position[2], 120.02);
  assert.ok(result.requiredPositions.length > 5);
  assert.equal(modelPlacement(input, () => Number.NaN).status, 'unknown');
  assert.deepEqual(modelPlacement({ ...input, altitude: -1 }, () => 0), { status: 'ineligible', reason: 'below-terrain' });
  assert.deepEqual(modelPlacement({ ...input, placement: 'withheld' }, () => 0), { status: 'ineligible', reason: 'withheld' });
});

test('explicit ground orientation overrides slope only when following is disabled', () => {
  const placed = modelPlacement({ ...input, placement: 'ground', altitude: undefined, pitch: 30, roll: 30,
    followSlope: false, displayScale: 2 }, () => 100);
  assert.equal(placed.status, 'ready');
  if (placed.status !== 'ready') return;
  near(placed.basis[2][2], 1);
  near(-placed.basis[0][2], -Math.sqrt(3) / 2);
  near(Math.min(...placed.corners.map(corner => placed.position[2] + corner[2])), .02);
});

test('size prediction retains the support height above an uneven fitted plane', () => {
  const metersPerDegree = 2 * Math.PI * 6371008.8 / 360;
  const placed = modelPlacement({ ...input, placement: 'ground', altitude: undefined, terrain: true },
    lng => 100 + Math.abs(lng * metersPerDegree));
  assert.equal(placed.status, 'ready');
  if (placed.status !== 'ready') return;
  const same = scaleModelPlacement(placed, 1), doubled = scaleModelPlacement(placed, 2);
  assert.deepEqual(same.position, placed.position);
  assert.deepEqual(same.corners, placed.corners);
  near(doubled.position[2] - placed.position[2], 1);
  assert.deepEqual(scaleModelPlacement(doubled, .5).position, placed.position);
});
