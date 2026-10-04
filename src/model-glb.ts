// Static GLB subset. The registry owns asynchronous decoding, uploads and diagnostics.
export type Vec3 = [number, number, number];
type Vec2 = [number, number];
type Vec4 = [number, number, number, number];

export interface ModelMaterial {
  baseColor: Vec4;
  texture?: number;
  sampler?: { magFilter: number; minFilter: number; wrapS: number; wrapT: number };
  doubleSided: boolean;
  alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff: number;
  emissive: Vec3;
  unlit: boolean;
  uvTransform?: { offset: Vec2; scale: Vec2; rotation: number };
}

export interface ModelBatch {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  material: ModelMaterial;
}

export interface ParsedModel {
  batches: ModelBatch[];
  bounds: { min: Vec3; max: Vec3 };
  triangles: number;
  images: { bytes: Uint8Array; mimeType: string }[];
}

type JsonObject = Record<string, unknown>;
function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function object(value: unknown): JsonObject {
  if (!isObject(value)) throw new Error('GLB_INVALID_OBJECT');
  return value;
}
function list(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('GLB_INVALID_ARRAY');
  return value;
}
function number(value: unknown, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('GLB_INVALID_NUMBER');
  return value;
}
function boolean(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error('GLB_INVALID_BOOLEAN');
  return value;
}
function integer(value: unknown, fallback?: number): number {
  const result = number(value, fallback);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('GLB_INVALID_INDEX');
  return result;
}
function n(values: ArrayLike<number>, index: number): number {
  const value = values[index];
  if (value === undefined) throw new Error('GLB_INVALID_ARRAY_LENGTH');
  return value;
}
function vector(value: unknown, fallback: number[]): number[] {
  if (value === undefined) return fallback;
  const result = list(value).map((entry) => number(entry));
  if (result.length !== fallback.length) throw new Error('GLB_INVALID_VECTOR');
  return result;
}
function vec3(values: number[]): Vec3 { return [n(values, 0), n(values, 1), n(values, 2)]; }
function vec4(values: number[]): Vec4 { return [n(values, 0), n(values, 1), n(values, 2), n(values, 3)]; }
function vec2(values: number[]): Vec2 { return [n(values, 0), n(values, 1)]; }

function uploadValues(values: number[]): Float32Array {
  const result = new Float32Array(values);
  if (!result.every(Number.isFinite)) throw new Error('GLB_NON_FINITE_ATTRIBUTE');
  return result;
}

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a: number[], b: number[]): number[] {
  return Array.from({ length: 16 }, (_, i) => {
    const row = i % 4, column = Math.floor(i / 4);
    return n(a, row) * n(b, column * 4) + n(a, row + 4) * n(b, column * 4 + 1)
      + n(a, row + 8) * n(b, column * 4 + 2) + n(a, row + 12) * n(b, column * 4 + 3);
  });
}
function nodeMatrix(node: JsonObject): number[] {
  if (node.matrix !== undefined) {
    if (node.rotation !== undefined || node.scale !== undefined || node.translation !== undefined) throw new Error('GLB_INVALID_NODE_TRANSFORM');
    const matrix = vector(node.matrix, identity);
    if (matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1) throw new Error('GLB_INVALID_NODE_TRANSFORM');
    return matrix;
  }
  const [x = 0, y = 0, z = 0, w = 1] = vector(node.rotation, [0, 0, 0, 1]);
  if (Math.abs(Math.hypot(x, y, z, w) - 1) > 1e-5) throw new Error('GLB_INVALID_NODE_TRANSFORM');
  const [sx = 1, sy = 1, sz = 1] = vector(node.scale, [1, 1, 1]);
  const [tx = 0, ty = 0, tz = 0] = vector(node.translation, [0, 0, 0]);
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function point(matrix: number[], x: number, y: number, z: number): Vec3 {
  return [n(matrix, 0) * x + n(matrix, 4) * y + n(matrix, 8) * z + n(matrix, 12),
    n(matrix, 1) * x + n(matrix, 5) * y + n(matrix, 9) * z + n(matrix, 13),
    n(matrix, 2) * x + n(matrix, 6) * y + n(matrix, 10) * z + n(matrix, 14)];
}
function normalize(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}
function determinant3(m: number[]): number {
  return n(m, 0) * (n(m, 5) * n(m, 10) - n(m, 9) * n(m, 6))
    - n(m, 4) * (n(m, 1) * n(m, 10) - n(m, 9) * n(m, 2))
    + n(m, 8) * (n(m, 1) * n(m, 6) - n(m, 5) * n(m, 2));
}
function normalMatrix(m: number[]): number[] | undefined {
  const a = n(m, 0), b = n(m, 4), c = n(m, 8), d = n(m, 1), e = n(m, 5), f = n(m, 9);
  const g = n(m, 2), h = n(m, 6), i = n(m, 10);
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (determinant === 0) return undefined;
  return [(e * i - f * h) / determinant, (c * h - b * i) / determinant, (b * f - c * e) / determinant,
    (f * g - d * i) / determinant, (a * i - c * g) / determinant, (c * d - a * f) / determinant,
    (d * h - e * g) / determinant, (b * g - a * h) / determinant, (a * e - b * d) / determinant];
}

export function parseGlb(buffer: ArrayBuffer): ParsedModel {
  const data = new DataView(buffer);
  if (buffer.byteLength < 20 || data.getUint32(0, true) !== 0x46546c67) throw new Error('GLB_ONLY_EXPECTED');
  if (data.getUint32(4, true) !== 2) throw new Error('GLB_VERSION_2_REQUIRED');
  if (data.getUint32(8, true) !== buffer.byteLength) throw new Error('GLB_INVALID_LENGTH');
  let json: JsonObject | undefined, binary: Uint8Array | undefined;
  let chunk = 0;
  for (let offset = 12; offset < buffer.byteLength; chunk++) {
    if (offset + 8 > buffer.byteLength) throw new Error('GLB_TRUNCATED_CHUNK');
    const length = data.getUint32(offset, true), type = data.getUint32(offset + 4, true);
    if (length % 4) throw new Error('GLB_INVALID_CHUNK_ALIGNMENT');
    if (chunk === 0 && type !== 0x4e4f534a) throw new Error('GLB_INVALID_CHUNK_ORDER');
    offset += 8;
    if (offset + length > buffer.byteLength) throw new Error('GLB_TRUNCATED_CHUNK');
    const bytes = new Uint8Array(buffer, offset, length);
    if (type === 0x4e4f534a) {
      if (json) throw new Error('GLB_MULTIPLE_JSON_CHUNKS');
      let decoded: unknown;
      try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch (cause) { throw new Error('GLB_INVALID_JSON', { cause }); }
      json = object(decoded);
    }
    if (type === 0x004e4942) {
      if (binary) throw new Error('GLB_MULTIPLE_BINARY_BUFFERS');
      if (chunk !== 1) throw new Error('GLB_INVALID_CHUNK_ORDER');
      binary = bytes;
    }
    offset += length;
  }
  if (!json || !binary) throw new Error('GLB_MISSING_JSON_OR_BIN');
  const root = json, bin = binary;
  const asset = object(root.asset);
  if (asset.version !== '2.0' || (asset.minVersion !== undefined && asset.minVersion !== '2.0')) {
    throw new Error('GLB_VERSION_2_REQUIRED');
  }
  for (const extension of list(root.extensionsRequired)) {
    if (extension !== 'KHR_mesh_quantization' && extension !== 'KHR_texture_transform' && extension !== 'KHR_materials_unlit') {
      throw new Error(`GLB_UNSUPPORTED_REQUIRED_EXTENSION:${String(extension)}`);
    }
  }
  const buffers = list(root.buffers).map(object);
  if (buffers.length !== 1 || buffers[0]?.uri !== undefined) throw new Error('GLB_EXTERNAL_OR_MULTIPLE_BUFFERS_UNSUPPORTED');
  const bufferLength = integer(buffers[0]?.byteLength);
  if (!bufferLength || bufferLength > bin.byteLength || bin.byteLength - bufferLength > 3) throw new Error('GLB_INVALID_BUFFER_LENGTH');
  for (let i = bufferLength; i < bin.byteLength; i++) if (bin[i] !== 0) throw new Error('GLB_INVALID_BUFFER_PADDING');
  if (list(root.skins).length) throw new Error('GLB_SKINS_UNSUPPORTED');
  const views = list(root.bufferViews).map(object), accessors = list(root.accessors).map(object);
  const meshes = list(root.meshes).map(object), nodes = list(root.nodes).map(object);
  for (const accessor of accessors) if (accessor.sparse !== undefined) throw new Error('GLB_SPARSE_ACCESSORS_UNSUPPORTED');
  for (const mesh of meshes) for (const entry of list(mesh.primitives)) {
    const primitive = object(entry);
    if (primitive.targets !== undefined) throw new Error('GLB_MORPH_TARGETS_UNSUPPORTED');
    if (integer(primitive.mode, 4) !== 4) throw new Error('GLB_NON_TRIANGLES_UNSUPPORTED');
  }
  function viewBytes(index: number): Uint8Array {
    const view = views[index];
    if (!view || integer(view.buffer) !== 0) throw new Error('GLB_INVALID_BUFFER_VIEW');
    const offset = integer(view.byteOffset, 0), length = integer(view.byteLength);
    if (offset + length > bufferLength) throw new Error('GLB_BUFFER_VIEW_OUT_OF_BOUNDS');
    return bin.subarray(offset, offset + length);
  }
  function accessorValues(index: number, semantic: 'POSITION' | 'NORMAL' | 'TEXCOORD_0' | 'COLOR_0' | 'indices'): { values: number[]; count: number; width: number; component: number } {
    const accessor = accessors[index];
    if (!accessor) throw new Error('GLB_INVALID_ACCESSOR');
    const widths: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
    const width = typeof accessor.type === 'string' ? widths[accessor.type] : undefined;
    const expected = semantic === 'indices' ? 'SCALAR' : semantic === 'TEXCOORD_0' ? 'VEC2' : 'VEC3';
    if (!width || (semantic === 'COLOR_0' ? width !== 3 && width !== 4 : accessor.type !== expected)) throw new Error('GLB_ACCESSOR_TYPE_UNSUPPORTED');
    const component = integer(accessor.componentType), count = integer(accessor.count);
    if (!count || count * width > 0xffffffff) throw new Error('GLB_INVALID_ACCESSOR_COUNT');
    const normalized = boolean(accessor.normalized);
    const quantized = list(root.extensionsRequired).includes('KHR_mesh_quantization');
    const float = component === 5126 && !normalized;
    const unsigned = component === 5121 || component === 5123;
    const signed = component === 5120 || component === 5122;
    if (semantic === 'indices') {
      if (normalized || (!unsigned && component !== 5125)) throw new Error('GLB_INVALID_INDEX_ACCESSOR');
    } else {
      const valid = float || (semantic === 'COLOR_0' ? unsigned && normalized
        : semantic === 'NORMAL' ? quantized && signed && normalized
        : semantic === 'POSITION' ? quantized && (signed || unsigned)
        : unsigned && normalized || quantized && (signed || unsigned));
      if (!valid) throw new Error('GLB_INVALID_ATTRIBUTE_COMPONENT');
    }
    const sizes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    const size = sizes[component];
    if (!size) throw new Error(`GLB_COMPONENT_TYPE_UNSUPPORTED:${component}`);
    if (accessor.bufferView === undefined) {
      if (accessor.byteOffset !== undefined) throw new Error('GLB_INVALID_ACCESSOR_OFFSET');
      return { count, width, component, values: new Array<number>(count * width).fill(0) };
    }
    const viewIndex = integer(accessor.bufferView), view = views[viewIndex];
    if (!view) throw new Error('GLB_INVALID_BUFFER_VIEW');
    const bytes = viewBytes(viewIndex), reader = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const stride = integer(view.byteStride, width * size), start = integer(accessor.byteOffset, 0);
    if (start % size || (integer(view.byteOffset, 0) + start) % size) throw new Error('GLB_INVALID_ACCESSOR_ALIGNMENT');
    if (semantic === 'indices') {
      if (view.byteStride !== undefined) throw new Error('GLB_INVALID_INDEX_STRIDE');
    } else if (start % 4 || stride % 4 || (view.byteStride !== undefined && (stride < 4 || stride > 252))) {
      throw new Error('GLB_INVALID_VERTEX_STRIDE');
    }
    if (stride < width * size || start + Math.max(0, count - 1) * stride + width * size > bytes.byteLength) throw new Error('GLB_ACCESSOR_OUT_OF_BOUNDS');
    function read(offset: number): number {
      let value: number;
      switch (component) {
        case 5120: value = reader.getInt8(offset); break;
        case 5121: value = reader.getUint8(offset); break;
        case 5122: value = reader.getInt16(offset, true); break;
        case 5123: value = reader.getUint16(offset, true); break;
        case 5125: value = reader.getUint32(offset, true); break;
        case 5126: value = reader.getFloat32(offset, true); break;
        default: throw new Error('GLB_COMPONENT_TYPE_UNSUPPORTED');
      }
      if (normalized && component !== 5126) {
        const max = component === 5120 ? 127 : component === 5121 ? 255 : component === 5122 ? 32767 : component === 5123 ? 65535 : 4294967295;
        value = Math.max(-1, value / max);
      }
      if (!Number.isFinite(value)) throw new Error('GLB_NON_FINITE_ATTRIBUTE');
      return value;
    }
    return { count, width, component, values: Array.from({ length: count * width }, (_, i) => read(start + Math.floor(i / width) * stride + (i % width) * size)) };
  }
  const imageSources = list(root.images).map(object);
  for (const image of imageSources) if (image.uri !== undefined) throw new Error('GLB_EXTERNAL_IMAGES_UNSUPPORTED');
  const images: ParsedModel['images'] = [];
  const imageIndices = new Map<number, number>();
  function imageFor(index: number): number {
    const existing = imageIndices.get(index);
    if (existing !== undefined) return existing;
    const source = imageSources[index];
    if (!source) throw new Error('GLB_INVALID_TEXTURE_IMAGE');
    if (source.mimeType !== 'image/png' && source.mimeType !== 'image/jpeg') throw new Error(`GLB_IMAGE_FORMAT_UNSUPPORTED:${String(source.mimeType)}`);
    const result = images.length;
    images.push({ bytes: viewBytes(integer(source.bufferView)).slice(), mimeType: source.mimeType });
    imageIndices.set(index, result);
    return result;
  }
  const textures = list(root.textures).map(object), samplers = list(root.samplers).map(object);
  function materialFor(entry: unknown): ModelMaterial {
    const source = entry === undefined ? {} : object(entry);
    const pbr = source.pbrMetallicRoughness === undefined ? {} : object(source.pbrMetallicRoughness);
    const extensions = source.extensions === undefined ? {} : object(source.extensions);
    const alphaMode = source.alphaMode === undefined ? 'OPAQUE' : source.alphaMode;
    if (alphaMode !== 'OPAQUE' && alphaMode !== 'MASK' && alphaMode !== 'BLEND') throw new Error('GLB_INVALID_ALPHA_MODE');
    if (extensions.KHR_materials_unlit !== undefined) object(extensions.KHR_materials_unlit);
    const result: ModelMaterial = {
      baseColor: vec4(vector(pbr.baseColorFactor, [1, 1, 1, 1])), doubleSided: boolean(source.doubleSided),
      alphaMode, alphaCutoff: number(source.alphaCutoff, 0.5), emissive: vec3(vector(source.emissiveFactor, [0, 0, 0])),
      unlit: extensions.KHR_materials_unlit !== undefined,
    };
    if ([...result.baseColor, ...result.emissive].some(value => value < 0 || value > 1) || result.alphaCutoff < 0) throw new Error('GLB_INVALID_MATERIAL_FACTOR');
    if (pbr.baseColorTexture !== undefined) {
      const info = object(pbr.baseColorTexture), texture = textures[integer(info.index)];
      if (!texture) throw new Error('GLB_INVALID_TEXTURE');
      const imageIndex = imageFor(integer(texture.source));
      const textureExtensions = info.extensions === undefined ? {} : object(info.extensions);
      const transform = textureExtensions.KHR_texture_transform === undefined ? {} : object(textureExtensions.KHR_texture_transform);
      if (integer(transform.texCoord, integer(info.texCoord, 0)) !== 0) throw new Error('GLB_TEXCOORD_1_UNSUPPORTED');
      result.texture = imageIndex;
      const sampler = texture.sampler === undefined ? {} : samplers[integer(texture.sampler)];
      if (!sampler) throw new Error('GLB_INVALID_SAMPLER');
      const magFilter = integer(sampler.magFilter, 9729), minFilter = integer(sampler.minFilter, 9987);
      const wrapS = integer(sampler.wrapS, 10497), wrapT = integer(sampler.wrapT, 10497);
      if (![9728, 9729].includes(magFilter) || ![9728, 9729, 9984, 9985, 9986, 9987].includes(minFilter)
        || ![33071, 33648, 10497].includes(wrapS) || ![33071, 33648, 10497].includes(wrapT)) throw new Error('GLB_INVALID_SAMPLER');
      result.sampler = { magFilter, minFilter, wrapS, wrapT };
      result.uvTransform = { offset: vec2(vector(transform.offset, [0, 0])), scale: vec2(vector(transform.scale, [1, 1])), rotation: number(transform.rotation, 0) };
    }
    return result;
  }
  const materials = list(root.materials).map(object), defaultMaterial = materialFor(undefined);
  const grouped = new Map<number, { positions: number[]; normals: number[]; uvs: number[]; colors: number[]; indices: number[]; material: ModelMaterial }>();
  const bounds: ParsedModel['bounds'] = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let triangles = 0;
  function visit(index: number, parent: number[]): number[] {
    const node = nodes[index];
    if (!node) throw new Error('GLB_INVALID_NODE_TREE');
    if (node.skin !== undefined) throw new Error('GLB_SKINS_UNSUPPORTED');
    const matrix = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = meshes[integer(node.mesh)];
      if (!mesh) throw new Error('GLB_INVALID_MESH');
      for (const entry of list(mesh.primitives)) {
        const primitive = object(entry), attrs = object(primitive.attributes);
        const positions = accessorValues(integer(attrs.POSITION), 'POSITION');
        const normals = attrs.NORMAL === undefined ? undefined : accessorValues(integer(attrs.NORMAL), 'NORMAL');
        const uvs = attrs.TEXCOORD_0 === undefined ? undefined : accessorValues(integer(attrs.TEXCOORD_0), 'TEXCOORD_0');
        const colors = attrs.COLOR_0 === undefined ? undefined : accessorValues(integer(attrs.COLOR_0), 'COLOR_0');
        if (colors && colors.width !== 3 && colors.width !== 4) throw new Error('GLB_INVALID_COLOR_ATTRIBUTE');
        for (const optional of [normals, uvs, colors]) if (optional && optional.count !== positions.count) throw new Error('GLB_ATTRIBUTE_COUNT_MISMATCH');
        const indexAccessor = primitive.indices === undefined ? undefined : accessorValues(integer(primitive.indices), 'indices');
        const indices = indexAccessor?.values ?? Array.from({ length: positions.count }, (_, i) => i);
        if (indices.length % 3) throw new Error('GLB_INVALID_TRIANGLE_COUNT');
        const restart = indexAccessor?.component === 5121 ? 255 : indexAccessor?.component === 5123 ? 65535 : 4294967295;
        for (const value of indices) if (!Number.isInteger(value) || value < 0 || value >= positions.count || value === restart) throw new Error('GLB_INDEX_OUT_OF_BOUNDS');
        // A mirrored node must retain outward front faces when its transform is baked.
        if (determinant3(matrix) < 0) for (let i = 0; i < indices.length; i += 3) {
          const second = n(indices, i + 1);
          indices[i + 1] = n(indices, i + 2);
          indices[i + 2] = second;
        }
        const materialIndex = primitive.material === undefined ? -1 : integer(primitive.material);
        let batch = grouped.get(materialIndex);
        if (!batch) {
          const source = materials[materialIndex];
          if (materialIndex !== -1 && !source) throw new Error('GLB_INVALID_MATERIAL');
          const material = materialIndex === -1 ? defaultMaterial : materialFor(source);
          batch = { positions: [], normals: [], uvs: [], colors: [], indices: [], material };
          grouped.set(materialIndex, batch);
        }
        if (batch.material.texture !== undefined && !uvs) throw new Error('GLB_MISSING_TEXCOORD_0');
        const transformed = Array.from({ length: positions.count }, (_, i) => point(matrix, n(positions.values, i * 3), n(positions.values, i * 3 + 1), n(positions.values, i * 3 + 2)));
        const nm = normals ? normalMatrix(matrix) : undefined;
        function append(vertex: number, faceNormal?: Vec3): number {
          const p = transformed[vertex];
          if (!p || !batch) throw new Error('GLB_INVALID_VERTEX');
          const outputIndex = batch.positions.length / 3;
          batch.positions.push(...p);
          for (let axis = 0; axis < 3; axis++) { bounds.min[axis] = Math.min(n(bounds.min, axis), n(p, axis)); bounds.max[axis] = Math.max(n(bounds.max, axis), n(p, axis)); }
          if (normals && nm) {
            const x = n(normals.values, vertex * 3), y = n(normals.values, vertex * 3 + 1), z = n(normals.values, vertex * 3 + 2);
            batch.normals.push(...normalize(n(nm, 0) * x + n(nm, 3) * y + n(nm, 6) * z, n(nm, 1) * x + n(nm, 4) * y + n(nm, 7) * z, n(nm, 2) * x + n(nm, 5) * y + n(nm, 8) * z));
          } else batch.normals.push(...(faceNormal ?? [0, 1, 0]));
          batch.uvs.push(uvs ? n(uvs.values, vertex * 2) : 0, uvs ? n(uvs.values, vertex * 2 + 1) : 0);
          batch.colors.push(colors ? n(colors.values, vertex * colors.width) : 1, colors ? n(colors.values, vertex * colors.width + 1) : 1, colors ? n(colors.values, vertex * colors.width + 2) : 1, colors?.width === 4 ? n(colors.values, vertex * 4 + 3) : 1);
          return outputIndex;
        }
        if (normals && nm) {
          const vertices = new Map<number, number>();
          for (const value of indices) {
            let output = vertices.get(value);
            if (output === undefined) { output = append(value); vertices.set(value, output); }
            batch.indices.push(output);
          }
        } else {
          // Missing normals and singular transforms use the surviving faces, with separate corners.
          for (let i = 0; i < indices.length; i += 3) {
            const a = transformed[n(indices, i)], b = transformed[n(indices, i + 1)], c = transformed[n(indices, i + 2)];
            if (!a || !b || !c) throw new Error('GLB_INVALID_VERTEX');
            const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
            const face = normalize(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
            batch.indices.push(append(n(indices, i), face), append(n(indices, i + 1), face), append(n(indices, i + 2), face));
          }
        }
        triangles += indices.length / 3;
      }
    }
    return matrix;
  }
  const parents = new Map<number, number>();
  const children = nodes.map((node, index) => list(node.children).map(value => {
    const child = integer(value);
    if (!nodes[child] || parents.has(child)) throw new Error('GLB_INVALID_NODE_TREE');
    parents.set(child, index);
    return child;
  }));
  // A strict forest cannot contain a cycle if every node is reachable from a root.
  const pending = nodes.flatMap((_, index) => parents.has(index) ? [] : [index]);
  let visited = 0;
  while (pending.length) {
    const index = pending.pop();
    if (index === undefined) break;
    visited++;
    for (const child of children[index] ?? []) pending.push(child);
  }
  if (visited !== nodes.length) throw new Error('GLB_INVALID_NODE_TREE');
  const scenes = list(root.scenes).map(entry => {
    const roots = list(object(entry).nodes).map(value => integer(value));
    if (new Set(roots).size !== roots.length || roots.some(index => !nodes[index] || parents.has(index))) throw new Error('GLB_INVALID_NODE_TREE');
    return roots;
  });
  const scene = scenes[integer(root.scene, 0)];
  if (!scene) throw new Error('GLB_DEFAULT_SCENE_MISSING');
  const stack = [...scene].reverse().map(index => ({ index, parent: identity }));
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    const matrix = visit(current.index, current.parent);
    for (const index of [...(children[current.index] ?? [])].reverse()) stack.push({ index, parent: matrix });
  }
  if (!triangles) throw new Error('GLB_EMPTY_MODEL');
  return { bounds, triangles, images, batches: [...grouped.values()].map((batch) => ({
    positions: uploadValues(batch.positions), normals: uploadValues(batch.normals), uvs: uploadValues(batch.uvs),
    colors: uploadValues(batch.colors), indices: new Uint32Array(batch.indices), material: batch.material,
  })) };
}
