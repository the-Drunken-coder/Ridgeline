import assert from 'node:assert/strict';
import test from 'node:test';
import { EntityProjection } from '../src/entity-projection';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function input(mainMatrix: number[], fallbackMatrix = mainMatrix, transition = 0): ConstructorParameters<typeof EntityProjection>[0] {
  return {
    shaderData: { define: transition ? '#define GLOBE' : '' },
    defaultProjectionData: { mainMatrix: Float64Array.from(mainMatrix), fallbackMatrix: Float64Array.from(fallbackMatrix), clippingPlane: [0, 0, 1, 1], projectionTransition: transition },
  };
}

test('a projection frame keeps a coherent attachment on its entity world copy', () => {
  const matrix = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, -1, -1, 0, 1];
  const frame = new EntityProjection(input(matrix), 179, 1000, 1000);
  const origin = [0.5, 0.5] as const;
  const west = frame.project([-2, 0, 0], origin);
  const east = frame.project([2, 0, 0], origin);
  assert.ok(west && east);
  assert.ok(Math.abs(west.x - 494.44444444444446) < 1e-8);
  assert.ok(Math.abs(east.x - 505.55555555555554) < 1e-8);
  assert.equal(west.y, 500);
  assert.equal(east.y, 500);
  // Independent points select their own nearby copy; an attachment keeps its origin.
  assert.ok(frame.project([-2, 0, 0])!.x > 1400);
  assert.equal(new EntityProjection(input(identity), -541, 1000, 1000).worldCopy(origin), -2);
});

test('depth clipping retains the visible face and segment across the near plane', () => {
  const frame = new EntityProjection(input(identity), 0, 1000, 1000);
  const face = frame.clippedPolygon([[-.5, -.5, -2, 1], [.5, -.5, 0, 1], [0, .5, 0, 1]]);
  assert.deepEqual(face, [{ x: 500, y: 750, depth: -1 }, { x: 750, y: 750, depth: 0 },
    { x: 500, y: 250, depth: 0 }, { x: 375, y: 500, depth: -1 }]);
  assert.deepEqual(frame.clippedSegment([-.5, 0, -2, 1], [.5, 0, 0, 1]),
    [{ x: 500, y: 500, depth: -1 }, { x: 750, y: 500, depth: 0 }]);
  assert.deepEqual(frame.clippedPolygon([[0, 0, -2, 1], [.5, 0, -2, 1], [0, .5, -2, 1]]), []);
  assert.equal(frame.clippedSegment([0, 0, 2, 1], [1, 0, 2, 1]), null);
});

test('picking retains the drawn camera matrices until a new projection frame is published', () => {
  const camera = input([...identity]);
  const frame = new EntityProjection(camera, 0, 1000, 1000);
  const before = frame.project([0, 0, 0]);
  camera.defaultProjectionData.mainMatrix[12] = 100;
  assert.deepEqual(frame.project([0, 0, 0]), before);
});

test('globe blending preserves local up and the back-of-globe clipping boundary', () => {
  for (const [transition, expected] of [[.25, [.375, .375, .25, 1]], [.5, [.25, .25, .5, 1]], [.75, [.125, .125, .75, 1]]] as const) {
    const frame = new EntityProjection(input(identity, identity, transition), 0, 1000, 1000);
    assert.deepEqual(frame.clip([0, 0, 0]), expected);
  }
  const camera = input(identity, identity, 1);
  camera.defaultProjectionData.clippingPlane = [0, 0, 1, 0];
  const frame = new EntityProjection(camera, 0, 1000, 1000);
  assert.equal(frame.clip([180, 0, 0]), null);
  const up = frame.clip([90, 0, 6371008.8]);
  assert.ok(up);
  assert.ok(Math.abs(up[0]! - 2) < 1e-12);
  assert.equal(up[1], 0);
  assert.ok(Math.abs(up[2]!) < 1e-12);
});
