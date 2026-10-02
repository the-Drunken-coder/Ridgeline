import type { CameraAttachment, Entity } from './types';

export type Vec3 = [number, number, number];
export type GeoPoint = [number, number, number];
export type HeightAt = ((lng: number, lat: number) => number | null) & {
  maximum?: (west: number, south: number, east: number, north: number) => number | null;
  forRange?: (range: number, lat: number) => HeightAt;
  failedAt?: (lng: number, lat: number) => boolean;
};
const R = 6_371_008.8;
const rad = Math.PI / 180;
export const normalize = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
};

export function validateEntity(entity: Entity, fail: (message: string) => never) {
  const positive = (v: number) => Number.isFinite(v) && v > 0;
  if (
    entity.altitude &&
    (!Number.isFinite(entity.altitude.meters) || !['ground', 'sea-level'].includes(entity.altitude.reference))
  )
    fail('Altitude needs finite meters and a ground or sea-level reference.');
  if (entity.groundIfNoAltitude !== undefined && typeof entity.groundIfNoAltitude !== 'boolean')
    fail('groundIfNoAltitude must be a boolean.');
  if (entity.attachments !== undefined && !Array.isArray(entity.attachments))
    fail('Attachments must be an array.');
  const ids = new Set<string>();
  for (const attachment of entity.attachments ?? []) {
    if (!attachment.id?.trim() || ids.has(attachment.id))
      fail('Attachment IDs must be nonempty and unique within their entity.');
    ids.add(attachment.id);
    switch (attachment.type) {
      case 'camera':
        if (
          !Number.isFinite(attachment.bearing) ||
          !Number.isFinite(attachment.elevation) ||
          Math.abs(attachment.elevation) > 90 ||
          !positive(attachment.range) ||
          ![attachment.fovX, attachment.fovY].every((value) => positive(value) && value < 180)
        )
          fail(
            'Camera angles must be finite, elevation within ±90°, FOV between 0° and 180°, and range positive.',
          );
        if (attachment.terrainVisibility !== undefined && typeof attachment.terrainVisibility !== 'boolean') fail('Camera terrain visibility must be a boolean.');
        if (attachment.blockedOpacity !== undefined && (!Number.isFinite(attachment.blockedOpacity) || attachment.blockedOpacity < 0 || attachment.blockedOpacity > 1)) fail('Camera blocked opacity must be between 0 and 1.');
        if (attachment.fillOpacity !== undefined && (!Number.isFinite(attachment.fillOpacity) || attachment.fillOpacity < 0 || attachment.fillOpacity > 1)) fail('Camera fill opacity must be between 0 and 1.');
        if (attachment.outline !== undefined && typeof attachment.outline !== 'boolean') fail('Camera outline must be a boolean.');
        if (attachment.wireframe !== undefined && typeof attachment.wireframe !== 'boolean') fail('Camera wireframe must be a boolean.');
        if (attachment.volumeOpacity !== undefined && (!Number.isFinite(attachment.volumeOpacity) || attachment.volumeOpacity < 0 || attachment.volumeOpacity > 1)) fail('Camera volume opacity must be between 0 and 1.');
        if (attachment.wireframeWidth !== undefined && (!Number.isFinite(attachment.wireframeWidth) || attachment.wireframeWidth < 1 || attachment.wireframeWidth > 12)) fail('Camera wireframe width must be between 1 and 12 pixels.');
        if (attachment.outlineWidth !== undefined && (!Number.isFinite(attachment.outlineWidth) || attachment.outlineWidth < 1 || attachment.outlineWidth > 12)) fail('Camera outline width must be between 1 and 12 pixels.');
        break;
      case 'sphere':
      case 'circle':
        if (!positive(attachment.radius)) fail('Zone radius must be positive and finite.');
        break;
      case 'cylinder':
        if (!positive(attachment.radius) || !positive(attachment.height))
          fail('Cylinder radius and height must be positive and finite.');
        break;
      case 'polygon':
        if (
          !Array.isArray(attachment.vertices) ||
          attachment.vertices.length < 3 ||
          attachment.vertices.some((p) => p.length !== 2 || !p.every(Number.isFinite))
        )
          fail('A ground polygon needs at least three finite east/north positions.');
        if (!triangulate(attachment.vertices).length)
          fail('A ground polygon must be a simple boundary with nonzero area.');
        break;
      default:
        fail('Unknown attachment type.');
    }
  }
}

/** Convert an east/north/up displacement to geographic coordinates on a spherical Earth. */
export function localFrame(origin: GeoPoint) {
  const lon = origin[0] * rad,
    lat = origin[1] * rad;
  const c = Math.cos(lat),
    s = Math.sin(lat),
    cl = Math.cos(lon),
    sl = Math.sin(lon);
  const base = R + origin[2];
  return (east: number, north: number, up: number): GeoPoint => {
    const x = (base + up) * c * cl - east * sl - north * s * cl;
    const y = (base + up) * c * sl + east * cl - north * s * sl;
    const z = (base + up) * s + north * c;
    return [Math.atan2(y, x) / rad, Math.atan2(z, Math.hypot(x, y)) / rad, Math.hypot(x, y, z) - R];
  };
}

/** Camera axes stay referenced to geographic north and the local level horizon. */
export function cameraRay(camera: CameraAttachment, x: number, y: number): Vec3 {
  const b = camera.bearing * rad,
    e = camera.elevation * rad;
  const tx = Math.tan((camera.fovX * rad) / 2) * x,
    ty = Math.tan((camera.fovY * rad) / 2) * y;
  return normalize([
    Math.sin(b) * Math.cos(e) + tx * Math.cos(b) - ty * Math.sin(b) * Math.sin(e),
    Math.cos(b) * Math.cos(e) - tx * Math.sin(b) - ty * Math.cos(b) * Math.sin(e),
    Math.sin(e) + ty * Math.cos(e),
  ]);
}

/** Four corner projection onto the local ground plane. Terrain only drapes the result. */
export function cameraFootprint(origin: GeoPoint, camera: CameraAttachment, ground: number) {
  if (origin[2] <= ground) return [];
  const offsets = cameraGroundCornerOffsets(origin, camera, ground);
  if (offsets.every(offset => offset[2] >= 0)) return [];
  const local = localFrame(origin);
  const corners = offsets.map(offset => {
    const point = local(offset[0], offset[1], ground - origin[2]);
    return [point[0], point[1], ground] as GeoPoint;
  });
  return corners;
}

const cameraCornerRays = (camera: CameraAttachment) =>
  ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([x, y]) => cameraRay(camera, x, y));

/** Ray endpoints stop at the flat ground plane when downward, or at range. */
export function cameraGroundCornerOffsets(origin: GeoPoint, camera: CameraAttachment, ground: number): Vec3[] {
  return cameraCornerRays(camera).map(ray => {
    const distance = ray[2] < 0
      ? Math.min(camera.range, (origin[2] - ground) / -ray[2])
      : camera.range;
    return [ray[0] * distance, ray[1] * distance, ray[2] * distance];
  });
}

export function groundZone(origin: GeoPoint, boundary: readonly [number, number][], height: HeightAt, draped = false) {
  const local = localFrame(origin),
    triangles: GeoPoint[] = [],
    lines: GeoPoint[] = [];
  let missing = false, failed = false;
  // Native draping supplies interior heights. A complete DEM bound proves the area is known,
  // so it does not need thousands of redundant CPU triangles just to follow terrain.
  const corners = boundary.map(p => local(p[0], p[1], 0));
  const reference = origin[0];
  const longitudes = corners.map(p => p[0] + Math.round((reference - p[0]) / 360) * 360);
  const complete = draped && height.maximum && height.maximum(Math.min(...longitudes), Math.min(...corners.map(p => p[1])),
    Math.max(...longitudes), Math.max(...corners.map(p => p[1]))) !== null;
  const sample = (p: [number, number]): GeoPoint => {
    const world = local(p[0], p[1], 0),
      z = height(world[0], world[1]);
    if (z === null) {
      missing = true;
      failed ||= height.failedAt?.(world[0], world[1]) ?? false;
    }
    return [world[0], world[1], z ?? 0];
  };
  const middle = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  const length = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const face = (a: [number, number], b: [number, number], c: [number, number], depth: number) => {
    if (draped) {
      // The renderer drapes the face. Probe its interior for unknown terrain
      // without turning a large circle into hundreds of thousands of vertices.
      if (!complete) {
        const steps = Math.min(64, Math.ceil(Math.max(length(a, b), length(b, c), length(c, a)) / 75));
        for (let i = 1; i < steps; i++) for (let j = 1; j < steps - i; j++)
          sample([
            a[0] + (b[0] - a[0]) * i / steps + (c[0] - a[0]) * j / steps,
            a[1] + (b[1] - a[1]) * i / steps + (c[1] - a[1]) * j / steps,
          ]);
      }
      triangles.push(sample(a), sample(b), sample(c));
    } else if (!complete && depth < 6 && Math.max(length(a, b), length(b, c), length(c, a)) > 50) {
      const ab = middle(a, b),
        bc = middle(b, c),
        ca = middle(c, a);
      face(a, ab, ca, depth + 1);
      face(ab, b, bc, depth + 1);
      face(ca, bc, c, depth + 1);
      face(ab, bc, ca, depth + 1);
    } else triangles.push(sample(a), sample(b), sample(c));
  };
  const indices = triangulate(boundary);
  for (let i = 0; i < indices.length; i += 3)
    face(boundary[indices[i]!]!, boundary[indices[i + 1]!]!, boundary[indices[i + 2]!]!, 0);
  boundary.forEach((a, i) => {
    const b = boundary[(i + 1) % boundary.length]!,
      segments = Math.min(64, Math.ceil(length(a, b) / 50));
    for (let j = 0; j < segments; j++) {
      const at = (t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      lines.push(sample(at(j / segments)), sample(at((j + 1) / segments)));
    }
  });
  return { triangles: missing ? [] : triangles, lines: missing ? [] : lines, missing, failed };
}

export function triangulate(vertices: readonly [number, number][]): number[] {
  const cross = (a: number, b: number, c: number) => {
    const p = vertices[a]!,
      q = vertices[b]!,
      r = vertices[c]!;
    return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  };
  const n = vertices.length;
  const onSegment = (a: number, b: number, p: number) => {
    const start = vertices[a]!, end = vertices[b]!, point = vertices[p]!;
    return Math.abs(cross(a, b, p)) < 1e-8 &&
      point[0] >= Math.min(start[0], end[0]) && point[0] <= Math.max(start[0], end[0]) &&
      point[1] >= Math.min(start[1], end[1]) && point[1] <= Math.max(start[1], end[1]);
  };
  for (let i = 0; i < n; i++) {
    const previous = (i + n - 1) % n, next = (i + 1) % n;
    const point = vertices[i]!, end = vertices[next]!;
    if (point[0] === end[0] && point[1] === end[1]) return [];
    // Adjacent edges may share their corner, but cannot double back over it.
    if (onSegment(previous, i, next) || onSegment(i, next, previous)) return [];
  }
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (onSegment(i, (i + 1) % n, j) || onSegment(i, (i + 1) % n, (j + 1) % n) ||
        onSegment(j, (j + 1) % n, i) || onSegment(j, (j + 1) % n, (i + 1) % n)) return [];
      if (
        cross(i, (i + 1) % n, j) * cross(i, (i + 1) % n, (j + 1) % n) < 0 &&
        cross(j, (j + 1) % n, i) * cross(j, (j + 1) % n, (i + 1) % n) < 0
      )
        return [];
    }
  const area = vertices.reduce((sum, p, i) => {
    const q = vertices[(i + 1) % n]!;
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  if (Math.abs(area) < 1e-8) return [];
  const indices = Array.from({ length: n }, (_, i) => i);
  if (area < 0) indices.reverse();
  const result: number[] = [];
  while (indices.length > 3) {
    let clipped = false;
    for (let i = 0; i < indices.length; i++) {
      const a = indices[(i + indices.length - 1) % indices.length]!,
        b = indices[i]!,
        c = indices[(i + 1) % indices.length]!;
      if (cross(a, b, c) <= 1e-8) continue;
      if (
        indices.some(
          (p) =>
            p !== a &&
            p !== b &&
            p !== c &&
            cross(a, b, p) >= 0 &&
            cross(b, c, p) >= 0 &&
            cross(c, a, p) >= 0,
        )
      )
        continue;
      result.push(a, b, c);
      indices.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) return [];
  }
  return [...result, ...indices];
}
