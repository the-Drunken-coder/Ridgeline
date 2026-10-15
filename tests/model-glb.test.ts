import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
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

function triangleFixture() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  return {
    json: {
      asset: { version: '2.0' }, buffers: [{ byteLength: positions.byteLength }],
      bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
    },
    binary: new Uint8Array(positions.buffer),
  };
}

test('quantized positions bake small dequantization scales without rejecting a valid model', () => {
  const { json } = triangleFixture();
  const binary = new Uint8Array(24);
  const data = new DataView(binary.buffer);
  data.setUint16(8, 65535, true);
  data.setUint16(18, 65535, true);
  const model = parseGlb(encodeGlb({ ...json,
    extensionsUsed: ['KHR_mesh_quantization'], extensionsRequired: ['KHR_mesh_quantization'],
    buffers: [{ byteLength: binary.byteLength }], bufferViews: [{ buffer: 0, byteLength: 24, byteStride: 8 }],
    accessors: [{ bufferView: 0, componentType: 5123, type: 'VEC3', count: 3, min: [0, 0, 0], max: [65535, 65535, 0] }],
    nodes: [{ mesh: 0, scale: [1 / 65535, 1 / 65535, 1 / 65535] }],
  }, binary));
  assert.deepEqual(model.bounds, { min: [0, 0, 0], max: [1, 1, 0] });
  assert.deepEqual(Array.from(model.batches[0]?.normals ?? []).slice(0, 3), [0, 0, 1]);
});

test('nested mirrored transforms retain authored and generated outward normals', () => {
  const { json } = triangleFixture();
  const component = -1 / Math.sqrt(3);
  const data = new Float32Array([0, 0, 0, 1, 0, 1, 0, 1, 1,
    component, component, -component, component, component, -component, component, component, -component]);
  for (const authoredNormals of [true, false]) {
    const model = parseGlb(encodeGlb({ ...json,
      buffers: [{ byteLength: data.byteLength }],
      bufferViews: [{ buffer: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 }],
      accessors: [...json.accessors, { bufferView: 1, componentType: 5126, type: 'VEC3', count: 3 }],
      meshes: [{ primitives: [{ attributes: authoredNormals ? { POSITION: 0, NORMAL: 1 } : { POSITION: 0 } }] }],
      nodes: [{ translation: [10, 20, 30], children: [1] },
        { mesh: 0, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], scale: [-2, 3, 4] }],
    }, new Uint8Array(data.buffer)));
    const batch = model.batches[0];
    assert.ok(batch);
    const normal = Array.from(batch.normals.slice(0, 3));
    [0.5121475197, 0.7682212796, 0.3841106398].forEach((value, i) => assert.ok(Math.abs(normal[i]! - value) < 1e-7));
    const [a, b, c] = Array.from(batch.indices).map(index => Array.from(batch.positions.slice(index * 3, index * 3 + 3)));
    assert.deepEqual(a, [10, 20, 30]);
    assert.deepEqual(b, [7, 20, 34]);
    assert.deepEqual(c, [10, 18, 34]);
  }
});

test('transformed positions must remain finite in upload arrays', () => {
  const { json, binary } = triangleFixture();
  assert.throws(() => parseGlb(encodeGlb({ ...json, nodes: [{ mesh: 0, translation: [1e100, 0, 0] }] }, binary)),
    /GLB_NON_FINITE_ATTRIBUTE/);
});

test('model bounds exclude unused vertices and zero-filled colors remain valid', () => {
  const { json } = triangleFixture();
  const data = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1000, 1000, 1000,
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const binary = new Uint8Array(data.byteLength + 4);
  binary.set(new Uint8Array(data.buffer));
  binary.set([0, 1, 2], data.byteLength);
  const model = parseGlb(encodeGlb({ ...json,
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteLength: 48 }, { buffer: 0, byteOffset: 48, byteLength: 48 },
      { buffer: 0, byteOffset: 96, byteLength: 3 }],
    accessors: [{ ...json.accessors[0], count: 4, max: [1000, 1000, 1000] },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 2, componentType: 5121, count: 3, type: 'SCALAR' },
      { componentType: 5126, count: 4, type: 'VEC3' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 3 }, indices: 2 }] }],
  }, binary));
  assert.deepEqual(model.bounds, { min: [0, 0, 0], max: [1, 1, 0] });
  assert.deepEqual(Array.from(model.batches[0]?.colors ?? []), [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
});

test('implicit zero geometry cannot expand beyond the supplied GLB payload', () => {
  const { json } = triangleFixture();
  const bytes = encodeGlb({ ...json,
    buffers: [{ byteLength: 4 }], bufferViews: [],
    accessors: [{ componentType: 5126, count: 3000, type: 'VEC3' }],
  }, new Uint8Array(4));
  assert.throws(() => parseGlb(bytes), { message: 'GLB_INVALID_ACCESSOR_COUNT' });
});

test('huge implicit attributes and indices fail by name before allocating values', () => {
  const { json, binary } = triangleFixture();
  for (const [semantic, type, componentType] of [
    ['POSITION', 'VEC3', 5126], ['NORMAL', 'VEC3', 5126], ['TEXCOORD_0', 'VEC2', 5126],
    ['COLOR_0', 'VEC4', 5126], ['indices', 'SCALAR', 5125],
  ] as const) {
    const primitive = semantic === 'indices' ? { attributes: { POSITION: 0 }, indices: 1 }
      : { attributes: { POSITION: 0, [semantic]: 1 } };
    assert.throws(() => parseGlb(encodeGlb({ ...json,
      accessors: [json.accessors[0], { componentType, count: 1_000_000_000, type }],
      meshes: [{ primitives: [primitive] }],
    }, binary)), { message: 'GLB_INVALID_ACCESSOR_COUNT' });
  }
});

test('implicit zeros remain valid for small geometry and attributes backed by stored positions', () => {
  const { json, binary } = triangleFixture();
  const small = parseGlb(encodeGlb({ ...json,
    buffers: [{ byteLength: 4 }], bufferViews: [],
    accessors: [{ componentType: 5126, count: 3, type: 'VEC3' }],
  }, new Uint8Array(4)));
  assert.equal(small.triangles, 1);
  assert.deepEqual(small.bounds, { min: [0, 0, 0], max: [0, 0, 0] });

  const positions = new Float32Array(3000 * 3), triangle = new Float32Array(binary.buffer);
  for (let i = 0; i < positions.length; i += triangle.length) positions.set(triangle, i);
  const model = parseGlb(encodeGlb({ ...json,
    buffers: [{ byteLength: positions.byteLength }], bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    accessors: [{ ...json.accessors[0], count: 3000 },
      { componentType: 5126, count: 3000, type: 'VEC4' }, { componentType: 5126, count: 3000, type: 'VEC2' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1, TEXCOORD_0: 2 } }] }],
  }, new Uint8Array(positions.buffer)));
  assert.equal(model.triangles, 1000);
  const batch = model.batches[0];
  assert.ok(batch);
  assert.equal(batch.colors.length, 3000 * 4);
  assert.ok(batch.colors.every(value => value === 0));
  assert.equal(batch.uvs.length, 3000 * 2);
  assert.ok(batch.uvs.every(value => value === 0));
});

test('malformed GLB container metadata fails by name before accepting geometry', () => {
  const { json, binary } = triangleFixture();
  const badDocuments = [
    [{ ...json, asset: undefined }, 'GLB_INVALID_OBJECT'],
    [{ ...json, asset: { version: '1.0' } }, 'GLB_VERSION_2_REQUIRED'],
    [{ ...json, asset: { version: '2.0', minVersion: '2.1' } }, 'GLB_VERSION_2_REQUIRED'],
    [{ ...json, buffers: [{ byteLength: 4 }] }, 'GLB_INVALID_BUFFER_LENGTH'],
    [{ ...json, buffers: [{ byteLength: 40 }] }, 'GLB_INVALID_BUFFER_LENGTH'],
    [{ ...json, bufferViews: [{ buffer: 0, byteLength: 40 }] }, 'GLB_BUFFER_VIEW_OUT_OF_BOUNDS'],
  ] as const;
  for (const [document, message] of badDocuments) {
    assert.throws(() => parseGlb(encodeGlb(document, binary)), { message });
  }
  const original = encodeGlb(json, binary);
  const swapped = original.slice(0);
  const length = new DataView(original).getUint32(12, true);
  new Uint8Array(swapped, 12).set(new Uint8Array(original, 20 + length));
  new Uint8Array(swapped, 20 + binary.byteLength).set(new Uint8Array(original, 12, length + 8));
  assert.throws(() => parseGlb(swapped), /GLB_INVALID_CHUNK_ORDER/);
  const malformedJson = original.slice(0);
  new Uint8Array(malformedJson)[20] = 0;
  assert.throws(() => parseGlb(malformedJson), /GLB_INVALID_JSON/);
  const unaligned = original.slice(0);
  new DataView(unaligned).setUint32(12, length - 1, true);
  assert.throws(() => parseGlb(unaligned), /GLB_INVALID_CHUNK_ALIGNMENT/);
});

test('interleaved quantized attributes retain signed normals, UVs and vertex alpha', () => {
  const { json } = triangleFixture();
  const binary = new Uint8Array(3 * 20 + 4);
  const data = new DataView(binary.buffer);
  const positions = [[0, 0, 0], [0, 1, 0], [1, 0, 0]];
  positions.forEach((position, i) => {
    position.forEach((value, axis) => data.setUint16(i * 20 + axis * 2, value, true));
    data.setInt8(i * 20 + 10, -128);
    data.setUint16(i * 20 + 12, 32768, true);
    data.setUint16(i * 20 + 14, 65535, true);
    binary.set([255, 128, 0, 64], i * 20 + 16);
  });
  binary.set([0, 1, 2], 60);
  const model = parseGlb(encodeGlb({ ...json,
    extensionsRequired: ['KHR_mesh_quantization'], extensionsUsed: ['KHR_mesh_quantization'],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteLength: 60, byteStride: 20 }, { buffer: 0, byteOffset: 60, byteLength: 3 }],
    accessors: [{ bufferView: 0, componentType: 5123, type: 'VEC3', count: 3, min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 0, byteOffset: 8, componentType: 5120, type: 'VEC3', normalized: true, count: 3 },
      { bufferView: 0, byteOffset: 12, componentType: 5123, type: 'VEC2', normalized: true, count: 3 },
      { bufferView: 0, byteOffset: 16, componentType: 5121, type: 'VEC4', normalized: true, count: 3 },
      { bufferView: 1, componentType: 5121, type: 'SCALAR', count: 3 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, COLOR_0: 3 }, indices: 4 }] }],
  }, binary));
  const batch = model.batches[0];
  assert.ok(batch);
  assert.deepEqual(Array.from(batch.normals.slice(0, 3)), [0, 0, -1]);
  assert.ok(Math.abs(batch.uvs[0]! - 0.5000076295) < 1e-7);
  assert.equal(batch.uvs[1], 1);
  assert.ok(Math.abs(batch.colors[1]! - 0.5019607843) < 1e-7);
  assert.ok(Math.abs(batch.colors[3]! - 0.2509803922) < 1e-7);
});

test('indices require unsigned storage and valid triangle vertex references', () => {
  const { json, binary: positions } = triangleFixture();
  for (const indices of [new Uint8Array([0, 1, 2]), new Uint16Array([0, 1, 2]), new Uint32Array([0, 1, 2]),
    new Float32Array([0, 1, 2]), new Int8Array([0, 1, 2]), new Uint8Array([0, 1, 3])]) {
    const binary = new Uint8Array(positions.byteLength + indices.byteLength);
    binary.set(positions);
    binary.set(new Uint8Array(indices.buffer), positions.length);
    const componentType = indices instanceof Float32Array ? 5126 : indices instanceof Int8Array ? 5120
      : indices instanceof Uint32Array ? 5125 : indices instanceof Uint16Array ? 5123 : 5121;
    const glb = encodeGlb({ ...json,
      buffers: [{ byteLength: binary.length }],
      bufferViews: [...json.bufferViews, { buffer: 0, byteOffset: positions.length, byteLength: indices.byteLength }],
      accessors: [...json.accessors, { bufferView: 1, componentType, count: 3, type: 'SCALAR' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    }, binary);
    if (componentType === 5126 || componentType === 5120) assert.throws(() => parseGlb(glb), /GLB_INVALID_INDEX_ACCESSOR/);
    else if (indices[2] === 3) assert.throws(() => parseGlb(glb), /GLB_INDEX_OUT_OF_BOUNDS/);
    else assert.equal(parseGlb(glb).triangles, 1);
  }
});

test('attribute semantics and byte layout are validated before reading components', () => {
  const { json, binary } = triangleFixture();
  for (const accessor of [
    { ...json.accessors[0], normalized: true },
    { ...json.accessors[0], normalized: 'true' },
    { ...json.accessors[0], componentType: 5125 },
    { ...json.accessors[0], componentType: 5123 },
    { ...json.accessors[0], count: 0 },
    { ...json.accessors[0], count: 1.5 },
    { ...json.accessors[0], byteOffset: 1, count: 2 },
  ]) assert.throws(() => parseGlb(encodeGlb({ ...json, accessors: [accessor] }, binary)), /GLB_/);
  for (const byteStride of [0, 13, 256]) {
    assert.throws(() => parseGlb(encodeGlb({ ...json, bufferViews: [{ ...json.bufferViews[0], byteStride }] }, binary)), /GLB_/);
  }
  assert.throws(() => parseGlb(encodeGlb({ ...json,
    accessors: [json.accessors[0], { componentType: 5120, count: 3, type: 'VEC3', normalized: true }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 } }] }],
  }, binary)), /GLB_INVALID_ATTRIBUTE_COMPONENT/);
});

test('scene trees reject duplicate ownership and cycles while selecting only the requested scene', () => {
  const { json, binary } = triangleFixture();
  for (const overrides of [
    { scenes: [{ nodes: [0, 0] }] },
    { nodes: [{ children: [1, 1] }, { mesh: 0 }] },
    { nodes: [{ mesh: 0, children: [0] }] },
    { nodes: [{ children: [1] }, { children: [0] }] },
    { nodes: [{ children: [2] }, { children: [2] }, { mesh: 0 }], scenes: [{ nodes: [0, 1] }] },
    { nodes: [{ mesh: 0 }, { children: [0] }], scenes: [{ nodes: [0, 1] }] },
  ]) assert.throws(() => parseGlb(encodeGlb({ ...json, ...overrides }, binary)), /GLB_INVALID_NODE_TREE/);
  const model = parseGlb(encodeGlb({ ...json, scene: 1, scenes: [{ nodes: [0] }, { nodes: [1] }],
    nodes: [{ mesh: 0, translation: [100, 0, 0] }, { mesh: 0, translation: [10, 0, 0] }],
  }, binary));
  assert.equal(model.triangles, 1);
  assert.deepEqual(model.bounds, { min: [10, 0, 0], max: [11, 1, 0] });
  const nodes = Array.from({ length: 10000 }, (_, i) => i === 9999 ? { mesh: 0 } : { children: [i + 1] });
  assert.equal(parseGlb(encodeGlb({ ...json, nodes }, binary)).triangles, 1);
});

test('malformed local transforms are rejected instead of silently changing geometry', () => {
  const { json, binary } = triangleFixture();
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const transform of [
    { matrix, translation: [0, 0, 0] }, { rotation: [0, 0, 1, 1] },
    { matrix: [1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
  ]) assert.throws(() => parseGlb(encodeGlb({ ...json, nodes: [{ mesh: 0, ...transform }] }, binary)), /GLB_INVALID_NODE_TRANSFORM/);
});

test('unsupported model features reject by name with no partial result', () => {
  const { json, binary } = triangleFixture();
  const cases = [
    [{ ...json, extensionsRequired: ['KHR_draco_mesh_compression'] }, 'GLB_UNSUPPORTED_REQUIRED_EXTENSION:KHR_draco_mesh_compression'],
    [{ ...json, extensionsRequired: ['EXT_meshopt_compression'] }, 'GLB_UNSUPPORTED_REQUIRED_EXTENSION:EXT_meshopt_compression'],
    [{ ...json, extensionsRequired: ['KHR_texture_basisu'] }, 'GLB_UNSUPPORTED_REQUIRED_EXTENSION:KHR_texture_basisu'],
    [{ ...json, buffers: [{ byteLength: binary.length, uri: 'https://example.test/model.bin' }] }, 'GLB_EXTERNAL_OR_MULTIPLE_BUFFERS_UNSUPPORTED'],
    [{ ...json, images: [{ uri: 'texture.png' }] }, 'GLB_EXTERNAL_IMAGES_UNSUPPORTED'],
    [{ ...json, skins: [{}] }, 'GLB_SKINS_UNSUPPORTED'],
    [{ ...json, nodes: [{ mesh: 0, skin: 0 }] }, 'GLB_SKINS_UNSUPPORTED'],
    [{ ...json, accessors: [{ ...json.accessors[0], sparse: {} }] }, 'GLB_SPARSE_ACCESSORS_UNSUPPORTED'],
    [{ ...json, meshes: [{ primitives: [{ attributes: { POSITION: 0 }, targets: [{}] }] }] }, 'GLB_MORPH_TARGETS_UNSUPPORTED'],
    [{ ...json, meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 5 }] }] }, 'GLB_NON_TRIANGLES_UNSUPPORTED'],
  ] as const;
  for (const [document, message] of cases) assert.throws(() => parseGlb(encodeGlb(document, binary)), { message });
  assert.throws(() => parseGlb(new TextEncoder().encode(JSON.stringify(json)).buffer), /GLB_ONLY_EXPECTED/);
  const ignored = { ...json, animations: [{}], cameras: [{}], extensions: { KHR_lights_punctual: { lights: [{}] } } };
  assert.equal(parseGlb(encodeGlb(ignored, binary)).triangles, 1);
});

test('primitive restart values never become triangle vertices', () => {
  const { json } = triangleFixture();
  const binary = new Uint8Array(256 * 12 + 4);
  binary.set([0, 1, 255], 256 * 12);
  assert.throws(() => parseGlb(encodeGlb({ ...json,
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteLength: 256 * 12 }, { buffer: 0, byteOffset: 256 * 12, byteLength: 3 }],
    accessors: [{ ...json.accessors[0], count: 256, max: [0, 0, 0] },
      { bufferView: 1, componentType: 5121, type: 'SCALAR', count: 3 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  }, binary)), /GLB_INDEX_OUT_OF_BOUNDS/);
});

test('authored normals survive tiny scales and flattening node transforms', () => {
  const { json } = triangleFixture();
  const data = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  for (const scale of [[1e-5, 1e-5, 1e-5], [1, 1, 0]]) {
    const model = parseGlb(encodeGlb({ ...json,
      buffers: [{ byteLength: data.byteLength }],
      bufferViews: [...json.bufferViews, { buffer: 0, byteOffset: 36, byteLength: 36 }],
      accessors: [...json.accessors, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }], nodes: [{ mesh: 0, scale }],
    }, new Uint8Array(data.buffer)));
    assert.deepEqual(Array.from(model.batches[0]?.normals ?? []).slice(0, 3), [0, 0, 1]);
  }
});

test('material metadata retains alpha and emission while ignored texture channels allocate no images', () => {
  const { json, binary } = triangleFixture();
  const model = parseGlb(encodeGlb({ ...json,
    images: [{ bufferView: 0, mimeType: 'image/png' }], textures: [{ source: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.2, 0.3, 0.4, 0.5] },
      emissiveFactor: [0.8, 0.1, 0], alphaMode: 'MASK', alphaCutoff: 0.3, doubleSided: true,
      extensions: { KHR_materials_unlit: {} }, normalTexture: { index: 0 } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
  }, binary));
  assert.deepEqual(model.images, []);
  const material = model.batches[0]?.material;
  assert.deepEqual(material?.baseColor, [0.2, 0.3, 0.4, 0.5]);
  assert.deepEqual(material?.emissive, [0.8, 0.1, 0]);
  assert.equal(material?.alphaMode, 'MASK');
  assert.equal(material?.alphaCutoff, 0.3);
  assert.equal(material?.doubleSided, true);
  assert.equal(material?.unlit, true);
});

test('base images are copied and shared while texture transforms and samplers remain independent', () => {
  const { json, binary } = triangleFixture();
  const document = { ...json,
    images: [{ bufferView: 0, mimeType: 'image/webp' }, { bufferView: 0, mimeType: 'image/png' }],
    textures: [{ source: 1, sampler: 0 }, { source: 1, sampler: 1 }],
    samplers: [{ wrapS: 33071, wrapT: 33648, magFilter: 9728, minFilter: 9984 }, { wrapS: 10497 }],
    accessors: [...json.accessors, { componentType: 5126, count: 3, type: 'VEC2' }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 1,
      extensions: { KHR_texture_transform: { texCoord: 0, offset: [0.2, 0.3], scale: [2, 3], rotation: 0.4 } } } } },
      { pbrMetallicRoughness: { baseColorTexture: { index: 1 } } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 },
      { attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 1 }] }],
  };
  const glb = encodeGlb(document, binary);
  const model = parseGlb(glb);
  assert.equal(model.images.length, 1);
  assert.equal(model.images[0]?.mimeType, 'image/png');
  assert.deepEqual(model.images[0]?.bytes, binary);
  assert.equal(model.batches[0]?.material.texture, 0);
  assert.equal(model.batches[1]?.material.texture, 0);
  assert.deepEqual(model.batches[0]?.material.uvTransform, { offset: [0.2, 0.3], scale: [2, 3], rotation: 0.4 });
  assert.deepEqual(model.batches[0]?.material.sampler, { wrapS: 33071, wrapT: 33648, magFilter: 9728, minFilter: 9984 });
  assert.equal(model.batches[1]?.material.sampler?.wrapS, 10497);
  new Uint8Array(glb).fill(0);
  assert.deepEqual(model.images[0]?.bytes, binary);
});

test('malformed used materials reject without defaulting their invalid values', () => {
  const { json, binary } = triangleFixture();
  for (const material of [
    { pbrMetallicRoughness: { baseColorFactor: [-1, 2, 0, 3] } },
    { emissiveFactor: [-1, 0, 0] }, { alphaCutoff: -1 }, { alphaMode: null }, { doubleSided: 'true' },
    { extensions: { KHR_materials_unlit: null } },
  ]) assert.throws(() => parseGlb(encodeGlb({ ...json, materials: [material],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
  }, binary)), /GLB_INVALID_/);
  assert.throws(() => parseGlb(encodeGlb({ ...json,
    images: [{ bufferView: 0, mimeType: 'image/png' }], textures: [{ source: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
  }, binary)), /GLB_MISSING_TEXCOORD_0/);
});

test('floating vertex colors reject components outside their unit range', () => {
  const { json, binary: positions } = triangleFixture();
  for (const invalid of [-0.1, 1.1]) {
    const colors = new Float32Array([invalid, 0, 0, 1, 0, 0, 0, 1, 0]);
    const binary = new Uint8Array(positions.length + colors.byteLength);
    binary.set(positions);
    binary.set(new Uint8Array(colors.buffer), positions.length);
    assert.throws(() => parseGlb(encodeGlb({ ...json,
      buffers: [{ byteLength: binary.length }],
      bufferViews: [...json.bufferViews, { buffer: 0, byteOffset: positions.length, byteLength: colors.byteLength }],
      accessors: [...json.accessors, { bufferView: 1, componentType: 5126, type: 'VEC3', count: 3 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 } }] }],
    }, binary)), /GLB_INVALID_COLOR_ATTRIBUTE/);
  }
});

function repeatedGeometry(primitives: number, nodes = 1) {
  const { json, binary } = triangleFixture();
  return encodeGlb({ ...json,
    accessors: [...json.accessors, { componentType: 5125, count: 6000, type: 'SCALAR' }],
    meshes: [{ primitives: Array.from({ length: primitives }, () => ({ attributes: { POSITION: 0 }, indices: 1 })) }],
    nodes: Array.from({ length: nodes }, () => ({ mesh: 0 })),
    scenes: [{ nodes: Array.from({ length: nodes }, (_, i) => i) }],
    extras: { padding: ' '.repeat(6000) },
  }, binary);
}

test('cumulative decoded allocation rejects repeated primitives and nodes before unbounded corner expansion', () => {
  const control = parseGlb(repeatedGeometry(1));
  assert.equal(control.triangles, 2000);
  assert.equal(control.batches[0]?.indices.length, 6000);
  for (const bytes of [repeatedGeometry(40), repeatedGeometry(1, 40)]) {
    assert.throws(() => parseGlb(bytes), { message: 'GLB_DECODED_ALLOCATION_LIMIT' });
  }
});

test('shared indices retain winding independently for mirrored and ordinary nodes', () => {
  const { json, binary: positions } = triangleFixture();
  const binary = new Uint8Array(40);
  binary.set(positions);
  binary.set([0, 1, 2], 36);
  const model = parseGlb(encodeGlb({ ...json,
    buffers: [{ byteLength: 40 }],
    bufferViews: [...json.bufferViews, { buffer: 0, byteOffset: 36, byteLength: 3 }],
    accessors: [...json.accessors, { bufferView: 1, componentType: 5121, count: 3, type: 'SCALAR' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0, scale: [-1, 1, 1] }, { mesh: 0, translation: [10, 0, 0] }, { mesh: 0, scale: [-1, 1, 1] }],
    scenes: [{ nodes: [0, 1, 2] }],
  }, binary));
  const batch = model.batches[0];
  assert.ok(batch);
  assert.deepEqual(Array.from(batch.positions), [0, 0, 0, 0, 1, 0, -1, 0, 0,
    10, 0, 0, 11, 0, 0, 10, 1, 0, 0, 0, 0, 0, 1, 0, -1, 0, 0]);
  assert.equal(model.triangles, 3);
});

test('all four supported playground models fit the cumulative allocation envelope', async () => {
  for (const name of ['boat', 'drone', 'plane', 'tank']) {
    const bytes = await readFile(new URL(`../playground/public/entity-models/${name}.glb`, import.meta.url));
    const model = parseGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.ok(model.triangles >= 12, `${name} retains its geometry`);
    assert.ok(model.bounds.max.every((value, axis) => value > model.bounds.min[axis]!));
    assert.ok(model.batches.every(batch => batch.positions.length > 0 && batch.indices.length > 0));
  }
});
