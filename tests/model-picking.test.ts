import assert from 'node:assert/strict';
import test from 'node:test';
import { EntityProjection } from '../src/entity-projection';
import { pickModelBox } from '../src/model-picking';

test('an oriented box accepts its faces while rejecting empty corners of its screen envelope', () => {
  const face = [{ x: 0, y: 10, depth: .4 }, { x: 10, y: 0, depth: .4 },
    { x: 20, y: 10, depth: .4 }, { x: 10, y: 20, depth: .4 }];
  assert.deepEqual(pickModelBox([face], 10, 10, 0), { x: 10, y: 10, depth: .4 });
  assert.equal(pickModelBox([face], 1, 1, 3), undefined);
});

test('nearby clicks use the closest oriented edge and its interpolated depth', () => {
  const face = [{ x: 0, y: 10, depth: 1 }, { x: 10, y: 0, depth: 0 },
    { x: 20, y: 10, depth: 1 }, { x: 10, y: 20, depth: 2 }];
  assert.deepEqual(pickModelBox([face], 17, 3, 3), { x: 15, y: 5, depth: .5 });
  assert.equal(pickModelBox([face], 17, 3, 2), undefined);
});

test('sampled terrain rejects a hidden nearby face at the tested edge instead of at the pointer', () => {
  const face = [{ x: 0, y: 10, depth: 1 }, { x: 10, y: 0, depth: 0 },
    { x: 20, y: 10, depth: 1 }, { x: 10, y: 20, depth: 2 }];
  assert.equal(pickModelBox([face], 17, 3, 3, point => point.x < 16 ? .4 : 1), undefined);
  assert.deepEqual(pickModelBox([face], 17, 3, 3, () => undefined), { x: 15, y: 5, depth: .5 });
});


test('near-plane clipping retains only the visible portion before box tolerance is applied', () => {
  const identity = Float64Array.from([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const projection = new EntityProjection({ shaderData:{define:''}, defaultProjectionData:{ mainMatrix:identity,
    fallbackMatrix:identity, clippingPlane:[0,0,1,1], projectionTransition:0 } }, 0, 1000, 1000);
  const visible = projection.clippedPolygon([[-.5,-.5,-2,1],[.5,-.5,0,1],[0,.5,0,1]]);
  assert.ok(pickModelBox([visible], 500, 700, 3));
  assert.equal(pickModelBox([visible], 300, 700, 12), undefined);
  const behind = projection.clippedPolygon([[-.5,-.5,-2,1],[.5,-.5,-2,1],[0,.5,-2,1]]);
  assert.equal(pickModelBox([behind], 500, 500, 12), undefined);
});
