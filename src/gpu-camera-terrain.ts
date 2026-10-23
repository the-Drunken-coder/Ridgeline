import { MercatorCoordinate } from 'maplibre-gl';
import type { GeoPoint, HeightAt } from './entity-geometry';
import { wrapLongitude } from './longitude';

export const TERRAIN_CELLS = 256;
export type CameraTerrain = {
  centre: MercatorCoordinate;
  scale: number;
  half: number;
  vertices: Float32Array;
  ready: boolean;
  failed: boolean;
};

export function cameraTerrainHalfExtent(range: number) {
  return range * 1.3;
}

export function cameraTerrainCovers(patch: CameraTerrain, center: readonly [number, number], range: number) {
  if (!patch.ready) return false;
  const point = MercatorCoordinate.fromLngLat([center[0], center[1]]);
  let dx = point.x - patch.centre.x;
  dx -= Math.round(dx);
  const distance = Math.max(Math.abs(dx), Math.abs(point.y - patch.centre.y)) / patch.scale;
  return distance + range <= patch.half && patch.half <= range * 2;
}

/** Geographic bounds of the same Mercator square sampled by cameraTerrain. */
export function cameraTerrainPreparationBounds(lng: number, lat: number, range: number): [number, number, number, number] {
  const centre = MercatorCoordinate.fromLngLat([lng, lat]);
  const margin = cameraTerrainHalfExtent(range) * centre.meterInMercatorCoordinateUnits();
  const west = new MercatorCoordinate(centre.x - margin, centre.y).toLngLat().lng;
  const east = new MercatorCoordinate(centre.x + margin, centre.y).toLngLat().lng;
  const south = new MercatorCoordinate(centre.x, centre.y + margin).toLngLat().lat;
  const north = new MercatorCoordinate(centre.x, centre.y - margin).toLngLat().lat;
  // Allow for floating-point roundoff between corner and grid coordinate paths.
  return [west - 1e-10, south - 1e-10, east + 1e-10, north + 1e-10];
}

/** Cache a patch with a movement margin; unknown samples never become visible ground. */
export function cameraTerrain(lng: number, lat: number, range: number, height: HeightAt, previous?: CameraTerrain): CameraTerrain {
  if (previous && cameraTerrainCovers(previous, [lng, lat], range)) return previous;
  const centre = MercatorCoordinate.fromLngLat([lng, lat]);
  const scale = centre.meterInMercatorCoordinateUnits(), half = cameraTerrainHalfExtent(range);
  // Preserve completed samples while tiles for the remaining samples load.
  // Other cameras may evict those source tiles before this patch completes.
  const continuing = previous && !previous.ready && previous.centre.x === centre.x &&
    previous.centre.y === centre.y && previous.half === half;
  const vertices = continuing ? previous.vertices.slice() : new Float32Array((TERRAIN_CELLS + 1) ** 2 * 3);
  let ready = true, failed = false;
  const sample = height.forRange?.(range, lat) ?? height;
  for (let y = 0; y <= TERRAIN_CELLS; y++) for (let x = 0; x <= TERRAIN_CELLS; x++) {
    const index = (y * (TERRAIN_CELLS + 1) + x) * 3;
    if (continuing && Number.isFinite(vertices[index + 2])) continue;
    const east = (x / TERRAIN_CELLS * 2 - 1) * half;
    const north = (y / TERRAIN_CELLS * 2 - 1) * half;
    const p = new MercatorCoordinate(centre.x + east * scale, centre.y - north * scale).toLngLat();
    const boundedLng = wrapLongitude(p.lng);
    const z = sample(boundedLng, p.lat);
    if (z === null) {
      ready = false;
      failed ||= sample.failedAt?.(boundedLng, p.lat) ?? false;
    }
    vertices.set([east, north, z ?? NaN], index);
  }
  return { centre, scale, half, vertices, ready, failed };
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
