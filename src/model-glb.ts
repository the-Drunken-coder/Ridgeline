// Static GLB subset. The registry owns asynchronous decoding, uploads and diagnostics.
export type Vec3 = [number, number, number];
type Vec2 = [number, number];
type Vec4 = [number, number, number, number];

export interface ModelMaterial {
  baseColor: Vec4;
  texture?: number;
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
function integer(value: unknown, fallback?: number): number {
  const result = number(value, fallback);
  if (!Number.isInteger(result) || result < 0) throw new Error('GLB_INVALID_INDEX');
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

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a: number[], b: number[]): number[] {
  return Array.from({ length: 16 }, (_, i) => {
    const row = i % 4, column = Math.floor(i / 4);
    return n(a, row) * n(b, column * 4) + n(a, row + 4) * n(b, column * 4 + 1)
      + n(a, row + 8) * n(b, column * 4 + 2) + n(a, row + 12) * n(b, column * 4 + 3);
  });
}
function nodeMatrix(node: JsonObject): number[] {
  if (node.matrix !== undefined) return vector(node.matrix, identity);
  const [x = 0, y = 0, z = 0, w = 1] = vector(node.rotation, [0, 0, 0, 1]);
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
function normalMatrix(m: number[]): number[] {
  const a = n(m, 0), b = n(m, 4), c = n(m, 8), d = n(m, 1), e = n(m, 5), f = n(m, 9);
  const g = n(m, 2), h = n(m, 6), i = n(m, 10);
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(determinant) < 1e-12) throw new Error('GLB_SINGULAR_NODE_TRANSFORM');
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
  for (let offset = 12; offset < buffer.byteLength;) {
    if (offset + 8 > buffer.byteLength) throw new Error('GLB_TRUNCATED_CHUNK');
    const length = data.getUint32(offset, true), type = data.getUint32(offset + 4, true);
    offset += 8;
    if (offset + length > buffer.byteLength) throw new Error('GLB_TRUNCATED_CHUNK');
    const bytes = new Uint8Array(buffer, offset, length);
    if (type === 0x4e4f534a) {
      if (json) throw new Error('GLB_MULTIPLE_JSON_CHUNKS');
      const decoded: unknown = JSON.parse(new TextDecoder().decode(bytes).replace(/\0+$/, ''));
      json = object(decoded);
    }
    if (type === 0x004e4942) {
      if (binary) throw new Error('GLB_MULTIPLE_BINARY_BUFFERS');
      binary = bytes;
    }
    offset += length;
  }
  if (!json || !binary) throw new Error('GLB_MISSING_JSON_OR_BIN');
  const root = json, bin = binary;
  for (const extension of list(root.extensionsRequired)) {
    if (extension !== 'KHR_mesh_quantization' && extension !== 'KHR_texture_transform' && extension !== 'KHR_materials_unlit') {
      throw new Error(`GLB_UNSUPPORTED_REQUIRED_EXTENSION:${String(extension)}`);
    }
  }
  const buffers = list(root.buffers).map(object);
  if (buffers.length !== 1 || buffers[0]?.uri !== undefined) throw new Error('GLB_EXTERNAL_OR_MULTIPLE_BUFFERS');
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
    if (!view || integer(view.buffer, 0) !== 0) throw new Error('GLB_INVALID_BUFFER_VIEW');
    const offset = integer(view.byteOffset, 0), length = integer(view.byteLength);
    if (offset + length > bin.byteLength) throw new Error('GLB_BUFFER_VIEW_OUT_OF_BOUNDS');
    return bin.subarray(offset, offset + length);
  }
  function accessorValues(index: number, expected?: string): { values: number[]; count: number; width: number } {
    const accessor = accessors[index];
    if (!accessor) throw new Error('GLB_INVALID_ACCESSOR');
    const widths: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
    const width = typeof accessor.type === 'string' ? widths[accessor.type] : undefined;
    if (!width || (expected && accessor.type !== expected)) throw new Error('GLB_ACCESSOR_TYPE_UNSUPPORTED');
    const component = integer(accessor.componentType), count = integer(accessor.count);
    const normalized = accessor.normalized === true;
    const sizes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    const size = sizes[component];
    if (!size) throw new Error(`GLB_COMPONENT_TYPE_UNSUPPORTED:${component}`);
    const viewIndex = integer(accessor.bufferView), view = views[viewIndex];
    if (!view) throw new Error('GLB_INVALID_BUFFER_VIEW');
    const bytes = viewBytes(viewIndex), reader = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const stride = integer(view.byteStride, width * size), start = integer(accessor.byteOffset, 0);
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
    return { count, width, values: Array.from({ length: count * width }, (_, i) => read(start + Math.floor(i / width) * stride + (i % width) * size)) };
  }
  const images = list(root.images).map((entry) => {
    const image = object(entry);
    if (image.uri !== undefined) throw new Error('GLB_EXTERNAL_IMAGES_UNSUPPORTED');
    if (image.mimeType !== 'image/png' && image.mimeType !== 'image/jpeg') throw new Error(`GLB_IMAGE_FORMAT_UNSUPPORTED:${String(image.mimeType)}`);
    return { bytes: viewBytes(integer(image.bufferView)).slice(), mimeType: image.mimeType };
  });
  const textures = list(root.textures).map(object);
  function materialFor(entry: unknown): ModelMaterial {
    const source = entry === undefined ? {} : object(entry);
    const pbr = source.pbrMetallicRoughness === undefined ? {} : object(source.pbrMetallicRoughness);
    const extensions = source.extensions === undefined ? {} : object(source.extensions);
    const alphaMode = source.alphaMode ?? 'OPAQUE';
    if (alphaMode !== 'OPAQUE' && alphaMode !== 'MASK' && alphaMode !== 'BLEND') throw new Error('GLB_INVALID_ALPHA_MODE');
    const result: ModelMaterial = {
      baseColor: vec4(vector(pbr.baseColorFactor, [1, 1, 1, 1])), doubleSided: source.doubleSided === true,
      alphaMode, alphaCutoff: number(source.alphaCutoff, 0.5), emissive: vec3(vector(source.emissiveFactor, [0, 0, 0])),
      unlit: extensions.KHR_materials_unlit !== undefined,
    };
    if (pbr.baseColorTexture !== undefined) {
      const info = object(pbr.baseColorTexture), texture = textures[integer(info.index)];
      if (!texture) throw new Error('GLB_INVALID_TEXTURE');
      const imageIndex = integer(texture.source);
      if (!images[imageIndex]) throw new Error('GLB_INVALID_TEXTURE_IMAGE');
      const textureExtensions = info.extensions === undefined ? {} : object(info.extensions);
      const transform = textureExtensions.KHR_texture_transform === undefined ? {} : object(textureExtensions.KHR_texture_transform);
      if (integer(transform.texCoord, integer(info.texCoord, 0)) !== 0) throw new Error('GLB_TEXCOORD_1_UNSUPPORTED');
      result.texture = imageIndex;
      result.uvTransform = { offset: vec2(vector(transform.offset, [0, 0])), scale: vec2(vector(transform.scale, [1, 1])), rotation: number(transform.rotation, 0) };
    }
    return result;
  }
  const materials = list(root.materials).map(materialFor), defaultMaterial = materialFor(undefined);
  const grouped = new Map<number, { positions: number[]; normals: number[]; uvs: number[]; colors: number[]; indices: number[]; material: ModelMaterial }>();
  const bounds: ParsedModel['bounds'] = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let triangles = 0;
  function visit(index: number, parent: number[], ancestors: Set<number>): void {
    const node = nodes[index];
    if (!node || ancestors.has(index)) throw new Error('GLB_INVALID_NODE_TREE');
    if (node.skin !== undefined) throw new Error('GLB_SKINS_UNSUPPORTED');
    const matrix = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = meshes[integer(node.mesh)];
      if (!mesh) throw new Error('GLB_INVALID_MESH');
      for (const entry of list(mesh.primitives)) {
        const primitive = object(entry), attrs = object(primitive.attributes);
        const positions = accessorValues(integer(attrs.POSITION), 'VEC3');
        const normals = attrs.NORMAL === undefined ? undefined : accessorValues(integer(attrs.NORMAL), 'VEC3');
        const uvs = attrs.TEXCOORD_0 === undefined ? undefined : accessorValues(integer(attrs.TEXCOORD_0), 'VEC2');
        const colors = attrs.COLOR_0 === undefined ? undefined : accessorValues(integer(attrs.COLOR_0));
        if (colors && colors.width !== 3 && colors.width !== 4) throw new Error('GLB_INVALID_COLOR_ATTRIBUTE');
        for (const optional of [normals, uvs, colors]) if (optional && optional.count !== positions.count) throw new Error('GLB_ATTRIBUTE_COUNT_MISMATCH');
        const indices = primitive.indices === undefined ? Array.from({ length: positions.count }, (_, i) => i) : accessorValues(integer(primitive.indices), 'SCALAR').values;
        if (indices.length % 3) throw new Error('GLB_INVALID_TRIANGLE_COUNT');
        for (const value of indices) if (!Number.isInteger(value) || value < 0 || value >= positions.count) throw new Error('GLB_INDEX_OUT_OF_BOUNDS');
        // A mirrored node must retain outward front faces when its transform is baked.
        if (determinant3(matrix) < 0) for (let i = 0; i < indices.length; i += 3) {
          const second = n(indices, i + 1);
          indices[i + 1] = n(indices, i + 2);
          indices[i + 2] = second;
        }
        const materialIndex = primitive.material === undefined ? -1 : integer(primitive.material);
        const material = materialIndex === -1 ? defaultMaterial : materials[materialIndex];
        if (!material) throw new Error('GLB_INVALID_MATERIAL');
        let batch = grouped.get(materialIndex);
        if (!batch) { batch = { positions: [], normals: [], uvs: [], colors: [], indices: [], material }; grouped.set(materialIndex, batch); }
        const transformed = Array.from({ length: positions.count }, (_, i) => point(matrix, n(positions.values, i * 3), n(positions.values, i * 3 + 1), n(positions.values, i * 3 + 2)));
        const nm = normalMatrix(matrix);
        function append(vertex: number, faceNormal?: Vec3): number {
          const p = transformed[vertex];
          if (!p || !batch) throw new Error('GLB_INVALID_VERTEX');
          const outputIndex = batch.positions.length / 3;
          batch.positions.push(...p);
          for (let axis = 0; axis < 3; axis++) { bounds.min[axis] = Math.min(n(bounds.min, axis), n(p, axis)); bounds.max[axis] = Math.max(n(bounds.max, axis), n(p, axis)); }
          if (normals) {
            const x = n(normals.values, vertex * 3), y = n(normals.values, vertex * 3 + 1), z = n(normals.values, vertex * 3 + 2);
            batch.normals.push(...normalize(n(nm, 0) * x + n(nm, 3) * y + n(nm, 6) * z, n(nm, 1) * x + n(nm, 4) * y + n(nm, 7) * z, n(nm, 2) * x + n(nm, 5) * y + n(nm, 8) * z));
          } else batch.normals.push(...(faceNormal ?? [0, 1, 0]));
          batch.uvs.push(uvs ? n(uvs.values, vertex * 2) : 0, uvs ? n(uvs.values, vertex * 2 + 1) : 0);
          batch.colors.push(colors ? n(colors.values, vertex * colors.width) : 1, colors ? n(colors.values, vertex * colors.width + 1) : 1, colors ? n(colors.values, vertex * colors.width + 2) : 1, colors?.width === 4 ? n(colors.values, vertex * 4 + 3) : 1);
          return outputIndex;
        }
        if (normals) {
          const base = batch.positions.length / 3;
          for (let vertex = 0; vertex < positions.count; vertex++) append(vertex);
          for (const value of indices) batch.indices.push(base + value);
        } else {
          // Missing normals need separate triangle corners to retain flat faces.
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
    const next = new Set(ancestors).add(index);
    for (const child of list(node.children)) visit(integer(child), matrix, next);
  }
  const scenes = list(root.scenes).map(object), scene = scenes[integer(root.scene, 0)];
  if (!scene) throw new Error('GLB_DEFAULT_SCENE_MISSING');
  for (const node of list(scene.nodes)) visit(integer(node), identity, new Set());
  if (!triangles) throw new Error('GLB_EMPTY_MODEL');
  return { bounds, triangles, images, batches: [...grouped.values()].map((batch) => ({
    positions: new Float32Array(batch.positions), normals: new Float32Array(batch.normals), uvs: new Float32Array(batch.uvs),
    colors: new Float32Array(batch.colors), indices: new Uint32Array(batch.indices), material: batch.material,
  })) };
}
