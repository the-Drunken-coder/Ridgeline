import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGlb, type ModelBatch, type ParsedModel } from '../src/model-glb';
import { encodeGlb } from '../tests/model-fixtures';
import { materialGlb, type MaterialPanel } from '../tests/model-material-fixtures';

export type ModelWorkloadVariant = 'original' | 'normalized' | '4x' | '16x';

function sha256(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }

function describe(data: ArrayBuffer) {
  const model = parseGlb(data);
  return { sha256: sha256(new Uint8Array(data)), bytes: data.byteLength, triangles: model.triangles,
    vertices: model.batches.reduce((sum, batch) => sum + batch.positions.length / 3, 0),
    materials: model.batches.length, materialDetails: model.batches.map(batch => batch.material), bounds: model.bounds,
    images: model.images.map(image => ({ sha256: sha256(image.bytes), mimeType: image.mimeType, bytes: image.bytes.byteLength })),
    samplers: new Set(model.batches.filter(batch => batch.material.sampler).map(batch => JSON.stringify(batch.material.sampler))).size,
  };
}

function subdivide(batch: ModelBatch): ModelBatch {
  const positions = Array.from(batch.positions), normals = Array.from(batch.normals);
  const uvs = Array.from(batch.uvs), colors = Array.from(batch.colors), indices: number[] = [];
  const edges = new Map<string, number>();
  const midpoint = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const existing = edges.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    for (const [values, size] of [[positions, 3], [normals, 3], [uvs, 2], [colors, 4]] as const) {
      for (let axis = 0; axis < size; axis++) values.push((values[a * size + axis]! + values[b * size + axis]!) / 2);
    }
    // Production normalizes each supplied normal. Record this smooth-shading difference in provenance.
    const length = Math.hypot(normals[index * 3]!, normals[index * 3 + 1]!, normals[index * 3 + 2]!);
    if (length) for (let axis = 0; axis < 3; axis++) normals[index * 3 + axis]! /= length;
    edges.set(key, index);
    return index;
  };
  for (let i = 0; i < batch.indices.length; i += 3) {
    const a = batch.indices[i]!, b = batch.indices[i + 1]!, c = batch.indices[i + 2]!;
    const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
    indices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs), colors: Float32Array.from(colors), indices: Uint32Array.from(indices), material: batch.material };
}

function serialize(model: ParsedModel): ArrayBuffer {
  const chunks: Uint8Array[] = [], bufferViews: { buffer: number; byteOffset: number; byteLength: number; target?: number }[] = [];
  let length = 0;
  const append = (bytes: Uint8Array, target?: number) => {
    const byteOffset = Math.ceil(length / 4) * 4;
    chunks.push(new Uint8Array(byteOffset - length), bytes);
    length = byteOffset + bytes.length;
    return bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length, target }) - 1;
  };
  const accessors: { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[] = [];
  const attribute = (values: Float32Array | Uint32Array, type: string, size: number, bounds = false) => {
    const extrema = bounds ? { min: Array.from({ length: size }, () => Infinity), max: Array.from({ length: size }, () => -Infinity) } : undefined;
    if (extrema) for (let i = 0; i < values.length; i++) {
      const axis = i % size, value = values[i]!;
      extrema.min[axis] = Math.min(extrema.min[axis]!, value);
      extrema.max[axis] = Math.max(extrema.max[axis]!, value);
    }
    return accessors.push({ bufferView: append(new Uint8Array(values.buffer, values.byteOffset, values.byteLength), values instanceof Uint32Array ? 34963 : 34962),
      componentType: values instanceof Uint32Array ? 5125 : 5126, count: values.length / size, type, ...extrema }) - 1;
  };
  const images = model.images.map(image => ({ bufferView: append(image.bytes), mimeType: image.mimeType }));
  const samplers: NonNullable<ModelBatch['material']['sampler']>[] = [];
  const textures: { source: number; sampler?: number }[] = [];
  const extensionsUsed = new Set<string>();
  const materials = model.batches.map(({ material }) => {
    let texture: number | undefined;
    if (material.texture !== undefined) {
      let sampler: number | undefined;
      if (material.sampler) {
        sampler = samplers.findIndex(value => JSON.stringify(value) === JSON.stringify(material.sampler));
        if (sampler < 0) sampler = samplers.push(material.sampler) - 1;
      }
      texture = textures.push({ source: material.texture, sampler }) - 1;
    }
    if (material.unlit) extensionsUsed.add('KHR_materials_unlit');
    if (material.uvTransform) extensionsUsed.add('KHR_texture_transform');
    return { pbrMetallicRoughness: { baseColorFactor: material.baseColor,
      baseColorTexture: texture === undefined ? undefined : { index: texture,
        extensions: material.uvTransform ? { KHR_texture_transform: material.uvTransform } : undefined } },
      alphaMode: material.alphaMode, alphaCutoff: material.alphaMode === 'MASK' || material.alphaCutoff !== 0.5 ? material.alphaCutoff : undefined,
      doubleSided: material.doubleSided,
      emissiveFactor: material.emissive, extensions: material.unlit ? { KHR_materials_unlit: {} } : undefined };
  });
  const primitives = model.batches.map((batch, material) => ({ material,
    attributes: { POSITION: attribute(batch.positions, 'VEC3', 3, true), NORMAL: attribute(batch.normals, 'VEC3', 3),
      TEXCOORD_0: attribute(batch.uvs, 'VEC2', 2), COLOR_0: attribute(batch.colors, 'VEC4', 4) },
    indices: attribute(batch.indices, 'SCALAR', 1),
  }));
  const binary = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { binary.set(chunk, offset); offset += chunk.byteLength; }
  return encodeGlb({ asset: { version: '2.0', generator: 'Ridgeline offline model workloads v1' },
    buffers: [{ byteLength: length }], bufferViews, accessors, materials,
    images: images.length ? images : undefined, textures: textures.length ? textures : undefined,
    samplers: samplers.length ? samplers : undefined,
    meshes: [{ primitives }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
    extensionsUsed: extensionsUsed.size ? [...extensionsUsed] : undefined,
  }, binary);
}

/** Real GLBs, using the same baked attributes that the production parser accepts. No runtime registry access. */
export function createModelWorkloads(bytes: ArrayBuffer) {
  const model = parseGlb(bytes);
  let batches = model.batches;
  return (['original', 'normalized', '4x', '16x'] as const).map(variant => {
    if (variant === '4x' || variant === '16x') batches = batches.map(subdivide);
    const data = variant === 'original' ? bytes.slice(0) : serialize({ ...model, batches });
    const factor: 1 | 4 | 16 = variant === '4x' ? 4 : variant === '16x' ? 16 : 1;
    return { variant, factor, data, ...describe(data) };
  });
}

const transformation = {
  version: 1,
  original: 'Byte-for-byte copy of the licensed source GLB.',
  normalized: 'Production parser bakes node transforms; serialize identity nodes in authored glTF axes with float32 attributes and uint32 indices. Preserve parsed materials, embedded images, samplers and UV transforms. Unsupported or ignored source features are not added to the renderer.',
  subdivision: 'Each indexed triangle becomes four non-overlapping triangles using shared edge midpoints within its material batch; repeat twice for 16x. Interpolate positions, UVs and vertex RGBA linearly. Normalize interpolated normals at each pass, matching production normal loading. Original corners retain their normal directions; smooth shading can differ at new vertices.',
  precision: 'Float32 attribute serialization can round baked bounds. Normalized 1x is the packing control; compare each stress variant with this control as well as the original.',
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function textField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  if (typeof field !== 'string' || !field) throw new Error(`MODEL_SOURCE_METADATA_INVALID:${key}`);
  return field;
}
function sourceMetadata(value: unknown) {
  if (!object(value)) throw new Error('MODEL_SOURCE_METADATA_INVALID');
  return { name: textField(value, 'name'), author: textField(value, 'author'), page: textField(value, 'page'),
    url: textField(value, 'url'), license: textField(value, 'license'), licenseUrl: textField(value, 'licenseUrl'),
    ...(typeof value.modification === 'string' ? { modification: value.modification } : {}),
    ...(typeof value.sourceBytes === 'number' ? { sourceBytes: value.sourceBytes } : {}),
  };
}

/** Generate measurement-consumer assets outside the library package, with complete source and derived hashes. */
export async function writeModelWorkloads(sourceDir = 'playground/public/entity-models', outputDir = '.artifacts/model-measurement/assets') {
  const provenanceBytes = await readFile(resolve(sourceDir, 'sources.json'));
  const provenance: unknown = JSON.parse(provenanceBytes.toString('utf8'));
  if (!object(provenance) || !Array.isArray(provenance.sources)) throw new Error('MODEL_SOURCE_METADATA_INVALID');
  const sources = provenance.sources.map(sourceMetadata);
  await mkdir(outputDir, { recursive: true });
  const assets = [];
  for (const id of ['drone', 'tank', 'plane', 'boat'] as const) {
    const source = sources.find(entry => entry.name === id);
    if (!source) throw new Error(`MODEL_SOURCE_METADATA_MISSING:${id}`);
    const bytes = await readFile(resolve(sourceDir, `${id}.glb`));
    const variants = [];
    for (const { data, ...variant } of createModelWorkloads(Uint8Array.from(bytes).buffer)) {
      const path = `${id}.${variant.variant}.glb`;
      await writeFile(resolve(outputDir, path), new Uint8Array(data));
      variants.push({ ...variant, path });
    }
    assets.push({ id, source: { ...source, sha256: sha256(bytes), bytes: bytes.byteLength }, variants });
  }
  const cases: { id: string; panel: MaterialPanel }[] = [
    { id: 'opaque', panel: { image: 'alpha' } },
    { id: 'mask', panel: { image: 'alpha', alphaMode: 'MASK', alphaCutoff: 0.6 } },
    { id: 'double-sided', panel: { image: 'alpha', doubleSided: true } },
    { id: 'blend', panel: { image: 'alpha', alphaMode: 'BLEND' } },
  ];
  const fixtures = [];
  for (const { id, panel } of cases) {
    const data = serialize(parseGlb(materialGlb([panel]))), path = `material-${id}.glb`;
    await writeFile(resolve(outputDir, path), new Uint8Array(data));
    fixtures.push({ id, path, ...describe(data), origin: { kind: 'synthetic',
      source: 'tests/model-material-fixtures.ts',
      description: 'Project-authored planar geometry and a 16 x 16 embedded RGBA PNG; identical geometry and image for each material cost case.',
      license: null, licenseNote: 'No separate license declaration; repository-authored test fixture, not a third-party vehicle asset.',
    } });
  }
  const provenanceFiles = [];
  for (const path of ['sources.json', 'Kenney-License.txt', 'credits.html']) {
    const bytes = await readFile(resolve(sourceDir, path));
    await copyFile(resolve(sourceDir, path), resolve(outputDir, path));
    provenanceFiles.push({ path, sha256: sha256(bytes), bytes: bytes.byteLength });
  }
  const manifest = { schemaVersion: 1, transformation, provenanceFiles, assets, fixtures };
  await writeFile(resolve(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await writeModelWorkloads(process.argv[2], process.argv[3]);
  console.log(`Generated ${manifest.assets.length * 4} vehicle GLBs and ${manifest.fixtures.length} material fixtures.`);
}
