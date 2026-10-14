import type { ScreenPoint } from './entity-projection';
import type { ScreenBounds } from './types';

export type ScreenRectangle = { minX: number; minY: number; maxX: number; maxY: number };
export function screenRectangle(bounds: ScreenBounds): ScreenRectangle {
  if (!Array.isArray(bounds) || bounds.length !== 2 || Array.from(bounds).some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)))
    throw new Error('Screen bounds need two finite CSS-pixel points.');
  return { minX: Math.min(bounds[0].x, bounds[1].x), minY: Math.min(bounds[0].y, bounds[1].y),
    maxX: Math.max(bounds[0].x, bounds[1].x), maxY: Math.max(bounds[0].y, bounds[1].y) };
}
export function rectangleBounds(rectangle: ScreenRectangle): [[number, number], [number, number]] {
  return [[rectangle.minX, rectangle.minY], [rectangle.maxX, rectangle.maxY]];
}
export function expandRectangle(rectangle: ScreenRectangle, amount: number): ScreenRectangle {
  return { minX: rectangle.minX - amount, minY: rectangle.minY - amount, maxX: rectangle.maxX + amount, maxY: rectangle.maxY + amount };
}
export function circleIntersectsRectangle(point: ScreenPoint, radius: number, rectangle: ScreenRectangle) {
  return Math.hypot(point.x - Math.max(rectangle.minX, Math.min(rectangle.maxX, point.x)),
    point.y - Math.max(rectangle.minY, Math.min(rectangle.maxY, point.y))) <= radius;
}

/** Clip projected geometry continuously; narrow edges and large containing faces cannot fall between samples. */
export function clipToRectangle(points: readonly ScreenPoint[], rectangle: ScreenRectangle) {
  let clipped = [...points];
  for (const [axis, value, sign] of [['x', rectangle.minX, 1], ['x', rectangle.maxX, -1], ['y', rectangle.minY, 1], ['y', rectangle.maxY, -1]] as const) {
    const input = clipped; clipped = [];
    for (const [index, b] of input.entries()) {
      const a = input[(index + input.length - 1) % input.length]!;
      const da = (a[axis] - value) * sign, db = (b[axis] - value) * sign;
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        clipped.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), depth: a.depth + t * (b.depth - a.depth) });
      }
      if (db >= 0) clipped.push(b);
    }
    if (!clipped.length) break;
  }
  return clipped;
}
