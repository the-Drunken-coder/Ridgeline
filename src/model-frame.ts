import { EntityProjection, entityVertex, offsetEntityVertex } from './entity-projection';
import type { ProjectionOrigin, ScreenPoint } from './entity-projection';
import { scaleModelPlacement } from './model-placement';
import type { ModelPlacementGeometry } from './model-placement';

const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];

/** The clipped box uses exactly the renderer's anchor, meter offsets and world copy. */
export function modelScreenBox(projection: EntityProjection, placement: ModelPlacementGeometry, origin: ProjectionOrigin) {
  const anchor = entityVertex(placement.position, origin);
  const corners = placement.corners.map(corner => projection.clipVertex(offsetEntityVertex(anchor, corner), origin));
  const polygons: ScreenPoint[][] = [];
  for (const face of faces) {
    const points = face.map(index => corners[index]);
    if (points.every((point): point is number[] => Boolean(point))) {
      const polygon = projection.clippedPolygon(points);
      if (polygon.length) polygons.push(polygon);
    }
  }
  const points = polygons.flat();
  if (!points.length) return undefined;
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  return { minX, minY, maxX, maxY, extent: Math.max(maxX - minX, maxY - minY), polygons };
}

/** Bounded remeasurement also accounts for the contact lift of an enlarged grounded box. */
export function modelFloorScale(projection: EntityProjection, placement: ModelPlacementGeometry,
  origin: ProjectionOrigin, minimumSizePixels: number) {
  const size = (factor: number) => modelScreenBox(projection, scaleModelPlacement(placement, factor), origin)?.extent ?? 0;
  const initial = size(1);
  if (minimumSizePixels === 0 || initial === 0 || initial >= minimumSizePixels) return 1;
  let low = 1, high = Math.max(2, minimumSizePixels / initial);
  for (let step = 0; step < 16 && size(high) < minimumSizePixels; step++) high *= 2;
  for (let step = 0; step < 20; step++) {
    const middle = (low + high) / 2;
    if (size(middle) < minimumSizePixels) low = middle; else high = middle;
  }
  return high;
}
