import { encodeGlb } from './model-fixtures';

const triangles = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 4, 7, 0, 7, 3,
  1, 2, 6, 1, 6, 5, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2];
const cube = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];

/** Red nose +Z, green physical right -X, blue up +Y; white opposite markers center the authored bounds. */
export function axisModelGlb(authoredQuarterTurn = false) {
  const centers = [[0, 0, 3], [-3, 0, 0], [0, 3, 0], [0, 0, -3], [3, 0, 0], [0, -3, 0]];
  const chunks = centers.map(center => Float32Array.from(triangles.flatMap(index => {
    const p = cube[index]!.map((value, axis) => value * .3 + center[axis]!);
    return authoredQuarterTurn ? [p[2]!, p[1]!, -p[0]!] : p;
  })));
  const binary = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  const bufferViews: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  let offset = 0;
  for (const chunk of chunks) {
    binary.set(new Uint8Array(chunk.buffer), offset);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: chunk.byteLength }); offset += chunk.byteLength;
  }
  return encodeGlb({ asset: { version: '2.0' }, extensionsUsed: ['KHR_materials_unlit'], buffers: [{ byteLength: binary.byteLength }], bufferViews,
    accessors: chunks.map((chunk, index) => ({ bufferView: index, componentType: 5126, count: 36, type: 'VEC3',
      min: [0, 1, 2].map(axis => Math.min(...chunk.filter((_, i) => i % 3 === axis))),
      max: [0, 1, 2].map(axis => Math.max(...chunk.filter((_, i) => i % 3 === axis))) })),
    materials: [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1], [1, 1, 1, 1]].map(baseColorFactor =>
      ({ pbrMetallicRoughness: { baseColorFactor }, extensions: { KHR_materials_unlit: {} } })),
    meshes: [{ primitives: chunks.map((_, index) => ({ attributes: { POSITION: index }, material: Math.min(index, 3) })) }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 }, binary);
}

export function groundModelGlb() {
  const positions = Float32Array.from(triangles.flatMap(index => {
    const p = cube[index]!; return [p[0]! * 2, p[1]! + 1, p[2]! * 2];
  }));
  return encodeGlb({ asset: { version: '2.0' }, extensionsUsed: ['KHR_materials_unlit'], buffers: [{ byteLength: positions.byteLength }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 36, type: 'VEC3', min: [-2, 0, -2], max: [2, 2, 2] }],
    materials: [{ extensions: { KHR_materials_unlit: {} } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 }, new Uint8Array(positions.buffer));
}

/** A single zoom-16 tile. Cases stay near its center so repeated neighbor images cannot affect contact. */
export function planarTerrain(eastSlope = .12, northSlope = .08) {
  const radius = 6371008.8, n = 2 ** 16, tile = n / 2, center = (tile + .5) / n;
  const location: [number, number] = [center * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * center))) * 180 / Math.PI];
  const units = 1 / (2 * Math.PI * radius * Math.cos(location[1] * Math.PI / 180));
  const sample = (lng: number, lat: number) => {
    const x = (lng + 180) / 360, y = (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
    return 100 + eastSlope * (x - center) / units + northSlope * (center - y) / units;
  };
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
  const context = canvas.getContext('2d'); if (!context) throw new Error('Terrain fixture needs a canvas');
  const data = context.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const height = 100 + eastSlope * (((tile + (x + .5) / 256) / n) - center) / units +
      northSlope * (center - ((tile + (y + .5) / 256) / n)) / units;
    const value = Math.round((height + 32768) * 256), index = (y * 256 + x) * 4;
    data.data[index] = value >>> 16; data.data[index + 1] = value >>> 8 & 255; data.data[index + 2] = value & 255; data.data[index + 3] = 255;
  }
  context.putImageData(data, 0, 0);
  return { location, sample, eastSlope, northSlope, elevation: { tiles: [canvas.toDataURL()], encoding: 'terrarium' as const, tileSize: 256, minzoom: 16, maxzoom: 16 } };
}
