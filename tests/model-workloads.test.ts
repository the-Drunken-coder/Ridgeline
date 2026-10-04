import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createModelWorkloads, writeModelWorkloads } from '../scripts/model-workloads';
import { parseGlb } from '../src/model-glb';
import { encodeGlb } from './model-fixtures';
import { materialGlb } from './model-material-fixtures';

function triangle() {
  const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
  return encodeGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: positions.byteLength }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0, translation: [3, 4, 5], scale: [-2, 1, 1] }], scenes: [{ nodes: [0] }], scene: 0,
  }, new Uint8Array(positions.buffer));
}

test('workload variants subdivide actual triangles without changing shape or winding', () => {
  const source = triangle(), variants = createModelWorkloads(source);
  assert.deepEqual(variants.map(v => [v.variant, v.factor, v.triangles]), [
    ['original', 1, 1], ['normalized', 1, 1], ['4x', 4, 4], ['16x', 16, 16],
  ]);
  assert.deepEqual(variants[0]?.data, source);
  for (const variant of variants) {
    const model = parseGlb(variant.data);
    assert.deepEqual(model.bounds, { min: [-1, 4, 5], max: [3, 6, 5] });
    let area = 0;
    for (const batch of model.batches) {
      for (let i = 0; i < batch.indices.length; i += 3) {
        const corners = Array.from(batch.indices.slice(i, i + 3), index => Array.from(batch.positions.slice(index * 3, index * 3 + 3)));
        const [a, b, c] = corners;
        assert.ok(a && b && c);
        const crossZ = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
        assert.ok(crossZ > 0, 'every child retains front-face winding');
        area += crossZ / 2;
      }
    }
    assert.equal(area, 4, 'subdivision covers the original face exactly once');
  }
  const quarter = variants.find(v => v.variant === '4x');
  assert.ok(quarter);
  assert.equal(quarter.vertices, 6, 'shared edge midpoints need only three additional vertices');
});

test('generated GLBs retain embedded images, independent samplers, material alpha and source attributes', () => {
  const source = materialGlb([
    { image: 'alpha', alphaMode: 'MASK', alphaCutoff: 0.7, unlit: true, vertexColor: [0.2, 0.4, 0.6, 0.5],
      baseColor: [0.8, 0.7, 0.6, 0.9], transform: { offset: [0.2, 0.3], scale: [2, 3], rotation: 0.4 } },
    { image: 'alpha', alphaMode: 'BLEND', doubleSided: true, emissive: [0.3, 0.2, 0.1],
      sampler: { magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33648 } },
    { image: 'jpeg' },
  ]);
  const original = parseGlb(source), variants = createModelWorkloads(source);
  assert.equal(original.images.length, 2);
  for (const variant of variants) {
    const model = parseGlb(variant.data);
    assert.deepEqual(model.images, original.images);
    assert.deepEqual(model.bounds, original.bounds);
    assert.equal(model.triangles, original.triangles * variant.factor);
    assert.equal(variant.samplers, 2);
    for (const [i, batch] of model.batches.entries()) {
      const before = original.batches[i];
      assert.ok(before);
      assert.deepEqual(batch.material, before.material);
      for (let corner = 0; corner < before.positions.length / 3; corner++) {
        const matches = Array.from({ length: batch.positions.length / 3 }, (_, index) => index).some(index =>
          ([['positions', 3], ['normals', 3], ['uvs', 2], ['colors', 4]] as const).every(([attribute, size]) =>
            Array.from({ length: size }, (_, axis) => axis).every(axis =>
              Math.abs(batch[attribute][index * size + axis]! - before[attribute][corner * size + axis]!) < 1e-6)));
        assert.ok(matches, 'each original corner retains all attributes regardless of packing order');
      }
    }
  }
  assert.deepEqual(createModelWorkloads(source), variants, 'generation is deterministic, including metadata and bytes');
  const quarter = variants.find(v => v.variant === '4x');
  assert.ok(quarter);
  const batch = parseGlb(quarter.data).batches[0];
  assert.ok(batch);
  const midpoint = Array.from({ length: batch.positions.length / 3 }, (_, index) => index).find(index =>
    batch.positions[index * 3] === -1 && batch.positions[index * 3 + 2] === 0);
  assert.notEqual(midpoint, undefined);
  assert.deepEqual(Array.from(batch.uvs.slice(midpoint! * 2, midpoint! * 2 + 2)), [0, 0.5]);
  assert.throws(() => createModelWorkloads(new ArrayBuffer(20)), /GLB_/);
});

test('offline workflow writes four licensed vehicles and separate material cases with verifiable provenance', async () => {
  const output = await mkdtemp(resolve(tmpdir(), 'ridgeline-workloads-'));
  try {
    const manifest = await writeModelWorkloads(resolve(import.meta.dirname, '../playground/public/entity-models'), output);
    assert.deepEqual(JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8')), manifest);
    assert.deepEqual(manifest.assets.map(asset => asset.id), ['drone', 'tank', 'plane', 'boat']);
    for (const [i, asset] of manifest.assets.entries()) {
      assert.ok(asset.source.author && asset.source.license && asset.source.licenseUrl);
      assert.equal(asset.variants[0]?.sha256, asset.source.sha256);
      assert.equal(asset.variants[0]?.triangles, [4564, 760, 1434, 156][i]);
      const original = parseGlb(Uint8Array.from(await readFile(resolve(output, asset.variants[0]!.path))).buffer);
      for (const variant of asset.variants) {
        const bytes = await readFile(resolve(output, variant.path)), parsed = parseGlb(Uint8Array.from(bytes).buffer);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), variant.sha256);
        assert.equal(bytes.byteLength, variant.bytes);
        assert.equal(parsed.triangles, original.triangles * variant.factor);
        assert.deepEqual(parsed.images, original.images);
        assert.deepEqual(parsed.batches.map(batch => batch.material), original.batches.map(batch => batch.material));
        for (const bound of ['min', 'max'] as const) for (let axis = 0; axis < 3; axis++) {
          assert.ok(Math.abs(parsed.bounds[bound][axis]! - original.bounds[bound][axis]!) < 1e-6);
        }
      }
    }
    assert.deepEqual(manifest.fixtures.map(fixture => fixture.id), ['opaque', 'mask', 'double-sided', 'blend']);
    for (const fixture of manifest.fixtures) {
      const bytes = await readFile(resolve(output, fixture.path)), parsed = parseGlb(Uint8Array.from(bytes).buffer);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.sha256);
      assert.equal(parsed.triangles, 2);
      assert.equal(parsed.images[0]?.mimeType, 'image/png');
      const material = parsed.batches[0]?.material;
      assert.equal(material?.doubleSided, fixture.id === 'double-sided');
      assert.equal(material?.alphaMode, fixture.id === 'mask' ? 'MASK' : fixture.id === 'blend' ? 'BLEND' : 'OPAQUE');
      assert.equal(fixture.origin.kind, 'synthetic');
    }
    assert.match(await readFile(resolve(output, 'Kenney-License.txt'), 'utf8'), /Creative Commons/);
  } finally { await rm(output, { recursive: true, force: true }); }
});
