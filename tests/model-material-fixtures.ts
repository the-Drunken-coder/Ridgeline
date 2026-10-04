import { encodeGlb } from './model-fixtures';

// Real 16 x 16 quadrant images. Alpha PNG: left transparent, upper right half opaque.
const images = {
  "png": "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAPUlEQVR4AeySuw0AQAhC37n/zhwDGBobCz8kFsaIUAIloJzFMG4BLPjBs8wJ9ognbBbL3fULKPiyUR0F+AAAAP//kNsVGQAAAAZJREFUAwAtpC/57Dab5AAAAABJRU5ErkJggg==",
  "alpha": "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAM0lEQVR4AeySwQkAAAgCjxavzWsDe/UQEvwKpwabmkJ4D0DrA8Cgg4ZUNkDQP7RY4RxhAAAA//8Gu/VdAAAABklEQVQDAKikGAkbC4/FAAAAAElFTkSuQmCC",
  "jpeg": "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAAQABADAREAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAACgkL/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABYBAQEBAAAAAAAAAAAAAAAAAAkLCv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIvinb+CUBboV4G60w1YNihAHKg//9k="
};

export type MaterialPanel = {
  image?: keyof typeof images | 'invalid';
  baseColor?: [number, number, number, number];
  vertexColor?: [number, number, number, number];
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff?: number;
  doubleSided?: boolean;
  unlit?: boolean;
  emissive?: [number, number, number];
  backFace?: boolean;
  bounds?: [number, number];
  height?: number;
  sampler?: { magFilter: number; minFilter: number; wrapS: number; wrapT: number };
  uvScale?: number;
  transform?: { offset?: [number, number]; scale?: [number, number]; rotation?: number };
};

/** Adjacent upward-facing panels with independently specified imported materials. */
export function materialGlb(panels: MaterialPanel[] = [{ image: 'png', unlit: true }]): ArrayBuffer {
  const chunks: Uint8Array[] = [], bufferViews: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  let length = 0;
  const append = (bytes: Uint8Array) => {
    const byteOffset = Math.ceil(length / 4) * 4;
    chunks.push(new Uint8Array(byteOffset - length), bytes);
    length = byteOffset + bytes.length;
    return bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length }) - 1;
  };
  const accessors: { bufferView: number; componentType: number; count: number; type: string }[] = [];
  const attribute = (values: number[], type: string, size: number) => {
    const data = Float32Array.from(values);
    return accessors.push({ bufferView: append(new Uint8Array(data.buffer)), componentType: 5126, count: values.length / size, type }) - 1;
  };
  const imageIds = new Map<NonNullable<MaterialPanel['image']>, number>();
  const embedded: { bufferView: number; mimeType: string }[] = [];
  const textures: { source: number; sampler: number }[] = [];
  const samplers: NonNullable<MaterialPanel['sampler']>[] = [];
  const materials: unknown[] = [];
  const primitives = panels.map((panel, index) => {
    const left = panel.bounds?.[0] ?? -1 + index * 2 / panels.length, right = panel.bounds?.[1] ?? left + 2 / panels.length, y = panel.height ?? 0;
    const corners = [[left, y, -1], [left, y, 1], [right, y, -1], [right, y, -1], [left, y, 1], [right, y, 1]];
    const scale = panel.uvScale ?? 1;
    const uv = [[0, 0], [0, scale], [scale, 0], [scale, 0], [0, scale], [scale, scale]];
    if (panel.backFace) { corners.reverse(); uv.reverse(); }
    const attributes = { POSITION: attribute(corners.flat(), 'VEC3', 3), TEXCOORD_0: attribute(uv.flat(), 'VEC2', 2),
      COLOR_0: attribute(corners.flatMap(() => panel.vertexColor ?? [1, 1, 1, 1]), 'VEC4', 4) };
    let texture: number | undefined;
    if (panel.image) {
      let source = imageIds.get(panel.image);
      if (source === undefined) {
        const bytes = panel.image === 'invalid' ? new Uint8Array([0, 1, 2, 3]) : Uint8Array.from(atob(images[panel.image]), c => c.charCodeAt(0));
        source = embedded.push({ bufferView: append(bytes), mimeType: panel.image === 'jpeg' ? 'image/jpeg' : 'image/png' }) - 1;
        imageIds.set(panel.image, source);
      }
      const sampler = samplers.push(panel.sampler ?? { magFilter: 9728, minFilter: 9984, wrapS: 10497, wrapT: 10497 }) - 1;
      texture = textures.push({ source, sampler }) - 1;
    }
    materials.push({ pbrMetallicRoughness: { baseColorFactor: panel.baseColor,
      baseColorTexture: texture === undefined ? undefined : { index: texture,
        extensions: panel.transform ? { KHR_texture_transform: panel.transform } : undefined } },
      alphaMode: panel.alphaMode, alphaCutoff: panel.alphaCutoff, doubleSided: panel.doubleSided, emissiveFactor: panel.emissive,
      extensions: panel.unlit ? { KHR_materials_unlit: {} } : undefined });
    return { attributes, material: index };
  });
  const binary = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { binary.set(chunk, offset); offset += chunk.length; }
  return encodeGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: length }], bufferViews, accessors, images: embedded,
    textures, samplers, materials, meshes: [{ primitives }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
    extensionsUsed: ['KHR_materials_unlit', 'KHR_texture_transform'] }, binary);
}
