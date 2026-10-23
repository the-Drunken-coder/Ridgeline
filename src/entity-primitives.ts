import type { GeoPoint } from './entity-geometry';

type Primitive = {
  entityId: string;
  /** Heights are raw meters in the elevation source's datum. */
  vertices: GeoPoint[];
  color: [number, number, number, number];
  size?: number;
};

export type GroundPrimitive = Primitive & { attachmentId: string } & (
  | { mode: 'polygon' }
  | { mode: 'triangles' }
  | { mode: 'lines' }
);

export type AirbornePrimitive = Primitive & { attachmentId?: string } & (
  | { mode: 'triangles' }
  | { mode: 'lines' }
  | {
    mode: 'points';
    /** Hollow marker stroke's inner diameter as a fraction of its outer diameter. */
    innerRadius?: number;
    /** Fallback dot parts can change feedback without recomputing physical attachments. */
    marker?: 'fill' | 'stroke';
  }
);

export type EntityGeometry = {
  ground: GroundPrimitive[];
  airborne: AirbornePrimitive[];
};
