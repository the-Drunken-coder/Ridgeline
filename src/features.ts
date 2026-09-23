import type { Position } from 'geojson';
import { RidgelineError } from './errors';
import type { MapFeature, Properties } from './types';
import { validateEntity } from './entity-geometry';

function positionValid(position: Position) {
  const [lng, lat] = position;
  return position.length === 2 && typeof lng === 'number' && typeof lat === 'number'
    && Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90;
}

export function validateFeature<P extends Properties>(feature: MapFeature<P>) {
  const fail = (message: string): never => {
    throw new RidgelineError('INVALID_FEATURE', message, { operation: 'upsert', recoverable: true, featureId: feature.id });
  };
  if (feature.type !== 'Feature' || typeof feature.id !== 'string' || !feature.id.trim()) fail('Every feature needs a nonempty stable string ID.');
  if (!feature.properties || typeof feature.properties !== 'object' || Array.isArray(feature.properties)) fail('Feature properties must be an object.');
  const geometry = feature.geometry;
  if (!geometry) return fail('A feature needs Point, LineString, or Polygon geometry.');
  if (feature.entity) {
    if (geometry.type !== 'Point') fail('Only point features can carry entity data.');
    validateEntity(feature.entity, fail);
  }
  switch (geometry.type) {
    case 'Point':
      if (!positionValid(geometry.coordinates)) fail('Coordinates must be [longitude, latitude] within geographic bounds.');
      break;
    case 'LineString':
      if (geometry.coordinates.length < 2 || !geometry.coordinates.every(positionValid)) fail('A line needs at least two valid 2D positions.');
      break;
    case 'Polygon':
      if (!geometry.coordinates.length || !geometry.coordinates.every(ring => {
        const first = ring[0], last = ring.at(-1);
        return ring.length >= 4 && ring.every(positionValid) && first?.[0] === last?.[0] && first?.[1] === last?.[1];
      })) fail('Polygon rings must contain at least four valid positions and close on their first position.');
      break;
    default: fail('Only Point, LineString, and Polygon are supported.');
  }
}

/** Own snapshots so later consumer mutations cannot silently change the viewport. */
export class FeatureStore<P extends Properties> {
  private readonly features = new Map<string, MapFeature<P>>();
  upsert(features: readonly MapFeature<P>[]) {
    const batch = new Map<string, MapFeature<P>>();
    for (const feature of features) {
      validateFeature(feature);
      batch.set(feature.id, structuredClone(feature));
    }
    for (const [id, feature] of batch) this.features.set(id, feature);
    return [...batch.values()];
  }
  remove(ids: readonly string[]) {
    return [...new Set(ids)].filter(id => this.features.delete(id));
  }
  get(id: string) { const feature = this.features.get(id); return feature && structuredClone(feature); }
  all() { return [...this.features.values()].map(feature => structuredClone(feature)); }
  ids() { return [...this.features.keys()]; }
  has(id: string) { return this.features.has(id); }
}
