import assert from 'node:assert/strict';
import test from 'node:test';
import { EntityProjection } from '../src/entity-projection';
import { modelFloorScale, modelScreenBox } from '../src/model-frame';
import { modelPlacement, scaleModelPlacement } from '../src/model-placement';

test('viewport culling follows the enlarged depth-clipped box without changing its size', () => {
  const matrix = Float64Array.from([100000,0,0,0,0,100000,0,0,0,0,1000,0,-50000,-50000,0,1]);
  const projection = new EntityProjection({ shaderData: { define: '' }, defaultProjectionData: {
    mainMatrix: matrix, fallbackMatrix: matrix, clippingPlane: [0,0,1,1], projectionTransition: 0,
  } }, 0, 1000, 1000);
  const origin = [.5, .5] as const;
  const input = { bounds: { min: [-1,0,-1] as [number,number,number], max: [1,1,1] as [number,number,number] },
    location: [0,0] as [number,number], placement: 'ground' as const, heading: 0,
    metersPerUnit: 1, headingOffset: 0, terrain: false, exaggeration: 1 };
  for (const [longitude, visible] of [[0,true],[.01,false],[-.01,false]] as const) {
    const placement = modelPlacement({ ...input, location: [longitude,0] }, () => 0);
    assert.equal(placement.status, 'ready'); if (placement.status !== 'ready') continue;
    const box = modelScreenBox(projection, placement, origin);
    assert.ok(box);
    assert.equal(projection.intersectsViewport(box), visible);
  }
  // The physical anchor is 10 CSS px beyond the right edge. Enlargement makes
  // its body visible, and the floor remains 40 px even though only 10 px show.
  const edge = modelPlacement({ ...input, location: [.003672,0] }, () => 0);
  assert.equal(edge.status, 'ready'); if (edge.status !== 'ready') return;
  const small = modelScreenBox(projection, edge, origin);
  assert.ok(small); assert.equal(projection.intersectsViewport(small), false);
  const scale = modelFloorScale(projection, edge, origin, 40);
  const large = modelScreenBox(projection, scaleModelPlacement(edge, scale), origin);
  assert.ok(large); assert.equal(projection.intersectsViewport(large), true);
  assert.ok(Math.abs(large.extent - 40) < .0001);
  assert.ok(large.maxX > 1000 && large.minX < 1000);
});
