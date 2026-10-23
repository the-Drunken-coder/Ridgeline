/** Encode actual embedded GLB bytes without a model exporter or runtime dependency. */
export function encodeGlb(json: unknown, binary: Uint8Array): ArrayBuffer {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const binaryLength = Math.ceil(binary.length / 4) * 4;
  const buffer = new ArrayBuffer(28 + jsonLength + binaryLength);
  const data = new DataView(buffer);
  data.setUint32(0, 0x46546c67, true);
  data.setUint32(4, 2, true);
  data.setUint32(8, buffer.byteLength, true);
  data.setUint32(12, jsonLength, true);
  data.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20, jsonLength).fill(32);
  new Uint8Array(buffer, 20, encoded.length).set(encoded);
  data.setUint32(20 + jsonLength, binaryLength, true);
  data.setUint32(24 + jsonLength, 0x004e4942, true);
  new Uint8Array(buffer, 28 + jsonLength, binary.length).set(binary);
  return buffer;
}

/** Opaque, outward-facing box, two units wide/deep and one unit high in glTF axes. */
export function solidGlb(): ArrayBuffer {
  const vertices = [
    [-1, 0, -1], [1, 0, -1], [1, 1, -1], [-1, 1, -1],
    [-1, 0, 1], [1, 0, 1], [1, 1, 1], [-1, 1, 1],
  ];
  const corners = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 4, 7, 0, 7, 3,
    1, 2, 6, 1, 6, 5, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2];
  const positions = Float32Array.from(corners.flatMap(index => vertices[index] ?? []));
  return encodeGlb({
    asset: { version: '2.0' },
    buffers: [{ byteLength: positions.byteLength }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 36, type: 'VEC3', min: [-1, 0, -1], max: [1, 1, 1] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  }, new Uint8Array(positions.buffer));
}
