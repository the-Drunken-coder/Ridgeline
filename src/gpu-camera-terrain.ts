import { MercatorCoordinate } from 'maplibre-gl';
import type { GeoPoint, HeightAt } from './entity-geometry';

export const TERRAIN_CELLS = 256;
export type CameraTerrain = {
  centre: MercatorCoordinate;
  scale: number;
  half: number;
  vertices: Float32Array;
  ready: boolean;
};

/** Cache a patch with a movement margin; unknown samples never become visible ground. */
export function cameraTerrain(lng: number, lat: number, range: number, height: HeightAt, previous?: CameraTerrain): CameraTerrain {
  const centre = MercatorCoordinate.fromLngLat([lng, lat]);
  if (previous) {
    let dx = centre.x - previous.centre.x;
    dx -= Math.round(dx);
    const distance = Math.max(Math.abs(dx), Math.abs(centre.y - previous.centre.y)) / previous.scale;
    if (distance + range <= previous.half && previous.half <= range * 2 && previous.ready) return previous;
  }
  const scale = centre.meterInMercatorCoordinateUnits(), half = range * 1.3;
  const vertices = new Float32Array((TERRAIN_CELLS + 1) ** 2 * 3);
  let ready = true;
  for (let y = 0; y <= TERRAIN_CELLS; y++) for (let x = 0; x <= TERRAIN_CELLS; x++) {
    const east = (x / TERRAIN_CELLS * 2 - 1) * half;
    const north = (y / TERRAIN_CELLS * 2 - 1) * half;
    const p = new MercatorCoordinate(centre.x + east * scale, centre.y - north * scale).toLngLat();
    const z = height(p.lng, p.lat);
    if (z === null) ready = false;
    vertices.set([east, north, z ?? 0], (y * (TERRAIN_CELLS + 1) + x) * 3);
  }
  return { centre, scale, half, vertices, ready };
}

export function terrainCoordinates(terrain: CameraTerrain): [[number, number], [number, number], [number, number], [number, number]] {
  const point = (x: number, y: number): [number, number] => {
    const p = new MercatorCoordinate(terrain.centre.x + x * terrain.half * terrain.scale, terrain.centre.y + y * terrain.half * terrain.scale).toLngLat();
    // Image corners must stay on the same world copy when the patch crosses the dateline.
    return [p.lng, p.lat];
  };
  return [point(-1, -1), point(1, -1), point(1, 1), point(-1, 1)];
}


/** Safe ground bounds for the full camera range, independent of a flat-plane footprint. */
export function cameraRangeBounds(terrain: CameraTerrain, origin: GeoPoint, range: number, size: number): [number, number, number, number] {
  const p = MercatorCoordinate.fromLngLat([origin[0], origin[1]]);
  let dx = p.x - terrain.centre.x;
  dx -= Math.round(dx);
  const x = (dx / terrain.scale / terrain.half + 1) * size / 2;
  const y = ((p.y - terrain.centre.y) / terrain.scale / terrain.half + 1) * size / 2;
  const radius = range / terrain.half * size / 2;
  const clamp = (v: number) => Math.max(0, Math.min(size, v));
  const left = clamp(Math.floor(x - radius) - 2), bottom = clamp(Math.floor(y - radius) - 2);
  return [left, bottom, clamp(Math.ceil(x + radius) + 2) - left, clamp(Math.ceil(y + radius) + 2) - bottom];
}
