import type { ScreenPoint } from './entity-projection';

/** Tests clipped box faces and nearby edges, preserving depth at the actual tested point. */
export function pickModelBox(polygons: readonly (readonly ScreenPoint[])[], x: number, y: number, tolerance: number,
  terrainDepth?: (point: ScreenPoint) => number | undefined) {
  let hit: ScreenPoint | undefined, distance = Infinity;
  const consider = (point: ScreenPoint, separation: number) => {
    if (separation > tolerance) return;
    const terrain = terrainDepth?.(point);
    if (terrain !== undefined && point.depth > terrain + 1e-6) return;
    if (separation < distance || separation === distance && (!hit || point.depth < hit.depth)) {
      hit = point; distance = separation;
    }
  };
  for (const polygon of polygons) {
    for (let index = 1; index + 1 < polygon.length; index++) {
      const a = polygon[0]!, b = polygon[index]!, c = polygon[index + 1]!;
      const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      if (Math.abs(denominator) < 1e-8) continue;
      const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator;
      const v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator;
      if (u >= 0 && v >= 0 && u + v <= 1)
        consider({ x, y, depth: u * a.depth + v * b.depth + (1 - u - v) * c.depth }, 0);
    }
    for (const [index, a] of polygon.entries()) {
      const b = polygon[(index + 1) % polygon.length]!;
      const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length));
      const point = { x: a.x + t * dx, y: a.y + t * dy, depth: a.depth + t * (b.depth - a.depth) };
      consider(point, Math.hypot(x - point.x, y - point.y));
    }
  }
  return hit;
}
