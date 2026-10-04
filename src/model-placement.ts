import type { GeoPoint, HeightAt, Vec3 } from './entity-geometry';
import type { ParsedModel } from './model-glb';
import type { EntityState } from './types';
import { entityVertex, entityVertexPosition, offsetEntityVertex } from './entity-projection';
import { normalize } from './entity-geometry';
import { wrapLongitude } from './longitude';

export type ModelPlacementInput = {
  bounds: ParsedModel['bounds'];
  location: [number, number];
  placement: EntityState['placement'];
  altitude?: number;
  heading: number;
  pitch?: number;
  roll?: number;
  metersPerUnit: number;
  headingOffset: number;
  followSlope?: boolean;
  terrain: boolean;
  exaggeration: number;
  displayScale?: number;
};
export type ModelPlacementGeometry = {
  basis: [Vec3, Vec3, Vec3];
  position: GeoPoint;
  corners: Vec3[];
  displayScale: number;
  grounded: boolean;
  /** Displayed meters: height + eastSlope * east + northSlope * north. */
  terrain?: { height: number; eastSlope: number; northSlope: number };
};
type RequiredTerrain = { requiredPositions: [number, number][]; radiusMeters: number };
export type ModelPlacement =
  | ({ status: 'ready' } & ModelPlacementGeometry & RequiredTerrain)
  | ({ status: 'unknown'; missingPositions: [number, number][] } & RequiredTerrain)
  | { status: 'ineligible'; reason: EntityState['placement'] };
const radians = Math.PI / 180;

/** Prepares a rigid display transform without changing the physical entity or its attachments. */
export function modelPlacement(input: ModelPlacementInput, height: HeightAt): ModelPlacement {
  if (input.placement !== 'ground' && input.placement !== 'airborne')
    return { status: 'ineligible', reason: input.placement };
  const requiredPositions: [number, number][] = [], missingPositions: [number, number][] = [];
  const samples = new Map<string, number | null>();
  const sample = (point: [number, number]) => {
    const position: [number, number] = [wrapLongitude(point[0]), point[1]], key = position.join(',');
    if (samples.has(key)) return samples.get(key)!;
    const value = height(...position), known = value !== null && Number.isFinite(value) ? value : null;
    samples.set(key, known); requiredPositions.push(position);
    if (known === null) missingPositions.push(position);
    return known;
  };
  const displayScale = input.displayScale ?? 1, scale = input.metersPerUnit * displayScale;
  const extent = input.bounds.max.map((value, axis) => value - input.bounds.min[axis]!);
  const grounded = input.placement === 'ground';
  const probeRadius = Math.max(.5, Math.hypot(...extent) * input.metersPerUnit / 2);
  const radiusMeters = Math.max(Math.hypot(...extent) * scale / 2, grounded && input.terrain ? probeRadius : 0);
  const unknown = (): ModelPlacement => ({ status: 'unknown', requiredPositions, missingPositions, radiusMeters });
  const ground = sample(input.location);
  if (ground === null || !grounded && input.altitude === undefined) return unknown();
  if (!grounded && input.altitude! < ground) return { status: 'ineligible', reason: 'below-terrain' };
  const anchor = entityVertex([...input.location, 0], [0, 0]);
  const terrainAt = (east: number, north: number) => {
    const point = entityVertexPosition(offsetEntityVertex(anchor, [east, north, 0]), [0, 0]);
    return sample([point[0], point[1]]);
  };
  const terrain = grounded ? { height: input.terrain ? ground * input.exaggeration : 0, eastSlope: 0, northSlope: 0 } : undefined;
  if (terrain && input.terrain) {
    const east = terrainAt(probeRadius, 0), west = terrainAt(-probeRadius, 0);
    const north = terrainAt(0, probeRadius), south = terrainAt(0, -probeRadius);
    if (east === null || west === null || north === null || south === null) return unknown();
    terrain.eastSlope = (east - west) * input.exaggeration / (2 * probeRadius);
    terrain.northSlope = (north - south) * input.exaggeration / (2 * probeRadius);
  }
  const h = input.heading * radians, p = (input.pitch ?? 0) * radians, r = (input.roll ?? 0) * radians;
  const o = input.headingOffset * radians;
  const slope = terrain && input.followSlope !== false ? terrain : undefined;
  const forwardAxis = slope ? normalize([Math.sin(h), Math.cos(h), slope.eastSlope * Math.sin(h) + slope.northSlope * Math.cos(h)]) : undefined;
  const upAxis = slope ? normalize([-slope.eastSlope, -slope.northSlope, 1]) : undefined;
  const rotate = (x: number, y: number, z: number): Vec3 => {
    // The proper glTF turn maps +X west, +Y up, +Z north. Its physical right is -X.
    const right = -x;
    const correctedRight = right * Math.cos(o) + z * Math.sin(o), forward = -right * Math.sin(o) + z * Math.cos(o);
    if (forwardAxis && upAxis) {
      const [a, b, c] = forwardAxis, [d, e, f] = upAxis;
      const rightAxis = normalize([b * f - c * e, c * d - a * f, a * e - b * d]);
      const axis = (index: number) => (correctedRight * rightAxis[index]! + y * upAxis[index]! + forward * forwardAxis[index]!) * scale;
      return [axis(0), axis(1), axis(2)];
    }
    const rolledRight = correctedRight * Math.cos(r) + y * Math.sin(r), up = -correctedRight * Math.sin(r) + y * Math.cos(r);
    const pitchedUp = up * Math.cos(p) + forward * Math.sin(p), pitchedForward = -up * Math.sin(p) + forward * Math.cos(p);
    return [(rolledRight * Math.cos(h) + pitchedForward * Math.sin(h)) * scale,
      (-rolledRight * Math.sin(h) + pitchedForward * Math.cos(h)) * scale, pitchedUp * scale];
  };
  const basis: [Vec3, Vec3, Vec3] = [rotate(1, 0, 0), rotate(0, 1, 0), rotate(0, 0, 1)];
  const corners: Vec3[] = [];
  for (const y of [-1, 1]) for (const z of [-1, 1]) for (const x of [-1, 1])
    corners.push(rotate(x * extent[0]! / 2, y * extent[1]! / 2, z * extent[2]! / 2));
  let centerHeight = (input.altitude ?? ground) * (input.terrain ? input.exaggeration : 1);
  if (terrain) {
    const requirements: number[] = [];
    for (const point of corners) {
      const raw = input.terrain ? terrainAt(point[0], point[1]) : 0;
      if (raw !== null) requirements.push(raw * (input.terrain ? input.exaggeration : 1) - point[2]);
    }
    if (missingPositions.length) return unknown();
    // Solve contact directly. A preliminary lowest-corner lift floats on a tilted plane.
    centerHeight = Math.max(...requirements) + .02;
  }
  return { status: 'ready', basis, position: [...input.location, centerHeight],
    corners, displayScale, grounded, terrain, requiredPositions, radiusMeters };
}

/** Predicts a floor scale without sampler callbacks. Final placement must still validate its terrain probes. */
export function scaleModelPlacement(placement: ModelPlacementGeometry, factor: number): ModelPlacementGeometry {
  const scaled = (point: Vec3): Vec3 => [point[0] * factor, point[1] * factor, point[2] * factor];
  const corners = placement.corners.map(scaled), position: GeoPoint = [...placement.position];
  const terrain = placement.terrain && { ...placement.terrain };
  if (terrain) position[2] = .02 + Math.max(...corners.map(point =>
    terrain.height + terrain.eastSlope * point[0] + terrain.northSlope * point[1] - point[2]));
  return { basis: [scaled(placement.basis[0]), scaled(placement.basis[1]), scaled(placement.basis[2])],
    position, corners, displayScale: placement.displayScale * factor, grounded: placement.grounded, terrain };
}
