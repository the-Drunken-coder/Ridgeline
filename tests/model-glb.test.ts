import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGlb } from '../src/model-glb';
import { encodeGlb, solidGlb } from './model-fixtures';

test('an embedded solid model produces owned geometry with outward flat faces', () => {
  const input = solidGlb();
  const model = parseGlb(input);
  assert.equal(model.triangles, 12);
  assert.deepEqual(model.bounds, { min: [-1, 0, -1], max: [1, 1, 1] });
  assert.equal(model.batches.length, 1);
  const batch = model.batches[0];
  assert.ok(batch);
  assert.deepEqual(Array.from(batch.normals.slice(0, 3)), [0, 0, -1]);
  assert.deepEqual(batch.material.baseColor, [1, 1, 1, 1]);
  assert.equal(batch.material.alphaMode, 'OPAQUE');
  new Uint8Array(input).fill(0);
  assert.deepEqual(Array.from(batch.positions.slice(0, 3)), [-1, 0, -1]);
});
