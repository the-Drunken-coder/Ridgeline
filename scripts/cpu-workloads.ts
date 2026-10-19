import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ParsedModel } from '../src/model-glb';
import type { MapFeature } from '../src/types';

export const workloads = ['glb-parse', 'feature-snapshot'] as const;
export type Workload = typeof workloads[number];
export type Side = 'base' | 'candidate';
export const settings = Object.freeze({ pairs: 6, warmups: 3, parseCycles: 10, batches: 20, features: 1000, timeoutMs: 30_000 });
export const fixtureNames = ['drone.glb', 'tank.glb', 'plane.glb', 'boat.glb'] as const;
export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const definitionPath = fileURLToPath(import.meta.url);

export type SamplePayload = {
  workload: Workload;
  elapsedMs: number;
  operations: number;
  work: Record<string, number>;
  inputSha256: string;
  definitionSha256: string;
  outputSha256: string;
};
export type Sample = SamplePayload & { side: Side; pair: number; order: number };
export type Statistics = { medianMs: number; minMs: number; maxMs: number };
export type Comparison = { workload: Workload; base: Statistics; candidate: Statistics; changePct: number };
export type Report = { status: 'complete'; samples: Sample[]; comparisons: Comparison[] }
  | { status: 'failed'; samples: Sample[]; error: string };
type SnapshotProperties = { nested: { batch: number; values: number[] }; payload: Uint8Array };
type SnapshotFeature = MapFeature<SnapshotProperties>;

export function operations(workload: Workload) {
  return workload === 'glb-parse' ? settings.parseCycles * fixtureNames.length : settings.batches;
}

export async function prepareInputs(fixtureRoot: string) {
  const glbs = await Promise.all(fixtureNames.map(async name => {
    const buffer = await readFile(join(fixtureRoot, name));
    const bytes = new Uint8Array(buffer).buffer;
    return { name, bytes, sha256: sha256(new Uint8Array(bytes)) };
  }));
  const batches = Array.from({ length: settings.batches }, (_, batch) =>
    Array.from({ length: settings.features }, (_, id): SnapshotFeature => ({
      type: 'Feature', id: `moving-${id}`,
      geometry: { type: 'Point', coordinates: [id / 100 + batch / 1000, 45 + batch / 1000] },
      properties: { nested: { batch, values: [id, batch] }, payload: new Uint8Array([id % 256, batch]) },
    })));
  const fixtures = glbs.map(({ name, bytes, sha256 }) => ({ name, bytes: bytes.byteLength, sha256 }));
  const featuresSha256 = sha256(JSON.stringify(batches));
  const inputSha256 = sha256(JSON.stringify({ settings, fixtures, featuresSha256 }));
  return { glbs, batches, fixtures, featuresSha256, inputSha256 };
}

export function parseSample(value: unknown): SamplePayload {
  assert(value && typeof value === 'object', 'Missing child sample');
  assert('workload' in value && (value.workload === 'glb-parse' || value.workload === 'feature-snapshot'), 'Invalid workload');
  assert('elapsedMs' in value && typeof value.elapsedMs === 'number' && Number.isFinite(value.elapsedMs) && value.elapsedMs > 0, 'Invalid elapsedMs');
  assert('operations' in value && value.operations === operations(value.workload), 'Invalid operation count');
  assert('work' in value && value.work && typeof value.work === 'object' && !Array.isArray(value.work), 'Invalid work counts');
  const work: Record<string, number> = {};
  for (const [key, count] of Object.entries(value.work).sort()) {
    assert(typeof count === 'number' && Number.isSafeInteger(count) && count > 0, 'Invalid work count');
    work[key] = count;
  }
  const expectedKeys = value.workload === 'glb-parse' ? ['batches', 'triangles', 'vertices'] : ['features', 'replacements'];
  assert.deepEqual(Object.keys(work), expectedKeys, 'Incomplete work counts');
  assert('inputSha256' in value && typeof value.inputSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.inputSha256), 'Invalid input hash');
  assert('definitionSha256' in value && typeof value.definitionSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.definitionSha256), 'Invalid definition hash');
  assert('outputSha256' in value && typeof value.outputSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.outputSha256), 'Invalid output digest');
  return { workload: value.workload, elapsedMs: value.elapsedMs, operations: value.operations, work,
    inputSha256: value.inputSha256, definitionSha256: value.definitionSha256, outputSha256: value.outputSha256 };
}

function mutateSnapshot(feature: SnapshotFeature) {
  feature.geometry = { type: 'Point', coordinates: [0, 0] };
  feature.properties.nested.batch = -1;
  feature.properties.nested.values.fill(-1);
  feature.properties.payload.fill(255);
}

async function runWorkload(sourceRoot: string, fixtureRoot: string, workload: Workload): Promise<SamplePayload> {
  const inputs = await prepareInputs(fixtureRoot);
  const definitionSha256 = sha256(await readFile(definitionPath));
  let elapsedMs: number;
  let work: Record<string, number>;
  let outputSha256: string;
  if (workload === 'glb-parse') {
    const { parseGlb }: typeof import('../src/model-glb') = await import(pathToFileURL(join(sourceRoot, 'src/model-glb.ts')).href);
    assert.equal(typeof parseGlb, 'function', 'Missing parseGlb');
    const parse = () => {
      const results: ParsedModel[] = [];
      for (let cycle = 0; cycle < settings.parseCycles; cycle++)
        for (const { bytes } of inputs.glbs) results.push(parseGlb(bytes));
      return results;
    };
    for (let i = 0; i < settings.warmups; i++) parse();
    const start = performance.now();
    const results = parse();
    elapsedMs = performance.now() - start;
    const digest = createHash('sha256');
    let batches = 0, trianglesTotal = 0, verticesTotal = 0;
    for (const model of results) {
      assert(model.triangles > 0 && Number.isSafeInteger(model.triangles), 'Invalid triangles');
      assert(model.batches.length > 0, 'Missing model batches');
      assert.equal(model.bounds.min.length, 3);
      assert.equal(model.bounds.max.length, 3);
      assert(model.bounds.min.every(Number.isFinite) && model.bounds.max.every(Number.isFinite), 'Invalid bounds');
      assert(model.bounds.min.every((value, i) => value <= model.bounds.max[i]!), 'Inverted bounds');
      let triangles = 0;
      for (const batch of model.batches) {
        const vertices = batch.positions.length / 3;
        assert(Number.isSafeInteger(vertices) && vertices > 0, 'Invalid vertex count');
        assert.equal(batch.normals.length, vertices * 3);
        assert.equal(batch.uvs.length, vertices * 2);
        assert.equal(batch.colors.length, vertices * 4);
        assert(batch.indices.length > 0 && batch.indices.length % 3 === 0, 'Invalid index count');
        assert(batch.indices.every(index => index < vertices), 'Index outside vertices');
        for (const values of [batch.positions, batch.normals, batch.uvs, batch.colors]) {
          assert(values.every(Number.isFinite), 'Nonfinite model attribute');
          digest.update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
        }
        digest.update(new Uint8Array(batch.indices.buffer, batch.indices.byteOffset, batch.indices.byteLength));
        assert(batch.material.baseColor.every(Number.isFinite) && batch.material.emissive.every(Number.isFinite), 'Invalid material');
        digest.update(JSON.stringify(batch.material));
        triangles += batch.indices.length / 3;
        verticesTotal += vertices;
      }
      assert.equal(triangles, model.triangles);
      for (const image of model.images) {
        assert(image.bytes.byteLength > 0 && image.mimeType.length > 0, 'Invalid image');
        digest.update(image.bytes);
        digest.update(image.mimeType);
      }
      digest.update(JSON.stringify(model.bounds));
      trianglesTotal += triangles;
      batches += model.batches.length;
    }
    work = { batches, triangles: trianglesTotal, vertices: verticesTotal };
    outputSha256 = digest.digest('hex');
  } else {
    const { FeatureStore }: typeof import('../src/features') = await import(pathToFileURL(join(sourceRoot, 'src/features.ts')).href);
    assert.equal(typeof FeatureStore, 'function', 'Missing FeatureStore');
    for (let i = 0; i < settings.warmups; i++) {
      const warm = new FeatureStore<SnapshotProperties>();
      for (const batch of inputs.batches) warm.upsert(batch);
    }
    const store = new FeatureStore<SnapshotProperties>();
    const results: SnapshotFeature[][] = [];
    const start = performance.now();
    for (const batch of inputs.batches) results.push(store.upsert(batch));
    elapsedMs = performance.now() - start;
    assert.equal(results.length, settings.batches);
    for (const [i, result] of results.entries()) assert.deepEqual(result, inputs.batches[i], 'Changed upsert snapshot');
    const expected = structuredClone(inputs.batches.at(-1)!);
    assert.deepEqual(store.all(), expected, 'Invalid final replacements');
    assert.deepEqual(store.ids(), expected.map(feature => feature.id));
    const digest = sha256(JSON.stringify(results));
    for (const batch of inputs.batches) for (const feature of batch) mutateSnapshot(feature);
    assert.deepEqual(store.all(), expected, 'Store aliases input');
    assert.equal(sha256(JSON.stringify(results)), digest, 'Returned batch aliases input');
    const read = store.all();
    for (const feature of read) mutateSnapshot(feature);
    const single = store.get('moving-0');
    assert(single);
    mutateSnapshot(single);
    assert.deepEqual(store.all(), expected, 'Store aliases returned snapshots');
    outputSha256 = digest;
    work = { features: settings.features, replacements: settings.features * settings.batches };
  }
  return parseSample({ workload, elapsedMs, operations: operations(workload), work,
    inputSha256: inputs.inputSha256, definitionSha256, outputSha256 });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [sourceRoot, fixtureRoot, workload] = process.argv.slice(2);
  assert(sourceRoot && fixtureRoot && (workload === 'glb-parse' || workload === 'feature-snapshot'), 'Invalid worker arguments');
  const sample = await runWorkload(sourceRoot, fixtureRoot, workload);
  process.stdout.write(`${JSON.stringify(sample)}\n`);
}
