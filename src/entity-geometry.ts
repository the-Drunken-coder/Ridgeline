import type { CameraAttachment, Entity } from './types';

export type Vec3 = [number, number, number];
export type GeoPoint = [number, number, number];
export type HeightAt = (lng: number, lat: number) => number | null;
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
        if (
          attachment.volumeOpacity !== undefined &&
          (!Number.isFinite(attachment.volumeOpacity) || attachment.volumeOpacity < 0 || attachment.volumeOpacity > 1)
        )
          fail('Camera volume opacity must be between 0 and 1.');
        if (attachment.wireframe !== undefined && typeof attachment.wireframe !== 'boolean')
          fail('Camera wireframe must be a boolean.');
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

/** First terrain crossing, with an explicit unknown result rather than a fabricated zero height. */
export function terrainRay(
  origin: GeoPoint,
  ray: Vec3,
  range: number,
  height: HeightAt,
  steps = 128,
): { point: GeoPoint; distance: number } | null | undefined {
  const point = localFrame(origin);
  let previous = 0;
  for (let step = 1; step <= steps; step++) {
    const distance = (range * step) / steps;
    const p = point(ray[0] * distance, ray[1] * distance, ray[2] * distance);
    const ground = height(p[0], p[1]);
    if (ground === null) return undefined;
    if (p[2] <= ground) {
      let lo = previous,
        hi = distance;
      for (let i = 0; i < 8; i++) {
        const middle = (lo + hi) / 2,
          q = point(ray[0] * middle, ray[1] * middle, ray[2] * middle);
        const elevation = height(q[0], q[1]);
        if (elevation === null) return undefined;
        if (q[2] > elevation) lo = middle;
        else hi = middle;
      }
      const hit = point(ray[0] * hi, ray[1] * hi, ray[2] * hi);
      const z = height(hit[0], hit[1]);
      if (z === null) return undefined;
      return { point: [hit[0], hit[1], z], distance: hi };
    }
    previous = distance;
  }
  return null;
}

export function cameraFootprint(
  origin: GeoPoint,
  camera: CameraAttachment,
  height: HeightAt,
  columns = 20,
  rows = 14,
) {
  const hits: ReturnType<typeof terrainRay>[] = [];
  let missing = false;
  for (let y = 0; y <= rows; y++)
    for (let x = 0; x <= columns; x++) {
      const hit = terrainRay(
        origin,
        cameraRay(camera, (x * 2) / columns - 1, (y * 2) / rows - 1),
        camera.range,
        height,
      );
      if (hit === undefined) missing = true;
      hits.push(hit);
    }
  // Do not bridge a near ridge to distant terrain. Retain separate visible patches.
  const triangles: GeoPoint[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const i = y * (columns + 1) + x;
      const a = hits[i],
        b = hits[i + 1],
        c = hits[i + columns + 1],
        d = hits[i + columns + 2];
      for (const tri of [
        [a, b, c],
        [b, d, c],
      ]) {
        if (!tri.every((p): p is NonNullable<typeof p> => Boolean(p))) continue;
        const distances = tri.map((p) => p.distance);
        if (Math.max(...distances) - Math.min(...distances) > camera.range / 6) continue;
        triangles.push(...tri.map((p) => p.point));
      }
    }
  return { triangles: missing ? [] : triangles, missing };
}

/** Sample the zone interior as well as its edge so large faces follow hills. */
export function groundZone(origin: GeoPoint, boundary: readonly [number, number][], height: HeightAt) {
  const local = localFrame(origin),
    triangles: GeoPoint[] = [],
    lines: GeoPoint[] = [];
  let missing = false;
  const sample = (p: [number, number]): GeoPoint => {
    const world = local(p[0], p[1], 0),
      z = height(world[0], world[1]);
    if (z === null) missing = true;
    return [world[0], world[1], z ?? 0];
  };
  const middle = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  const length = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const face = (a: [number, number], b: [number, number], c: [number, number], depth: number) => {
    if (depth < 6 && Math.max(length(a, b), length(b, c), length(c, a)) > 50) {
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
  return { triangles: missing ? [] : triangles, lines: missing ? [] : lines, missing };
}

/** A rectangular angular aperture clipped by maximum slant range. */
export function cameraVolume(origin: GeoPoint, camera: CameraAttachment) {
  const local = localFrame(origin),
    triangles: GeoPoint[] = [],
    lines: GeoPoint[] = [];
  const columns = 20,
    rows = 14;
  const point = (x: number, y: number) => {
    const ray = cameraRay(camera, (x * 2) / columns - 1, (y * 2) / rows - 1);
    return local(ray[0] * camera.range, ray[1] * camera.range, ray[2] * camera.range);
  };
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const a = point(x, y),
        b = point(x + 1, y),
        c = point(x, y + 1),
        d = point(x + 1, y + 1);
      triangles.push(a, b, c, b, d, c);
    }
  const edge = (a: GeoPoint, b: GeoPoint) => {
    triangles.push(origin, a, b);
    lines.push(a, b);
  };
  for (let x = 0; x < columns; x++) {
    edge(point(x, 0), point(x + 1, 0));
    edge(point(x, rows), point(x + 1, rows));
  }
  for (let y = 0; y < rows; y++) {
    edge(point(0, y), point(0, y + 1));
    edge(point(columns, y), point(columns, y + 1));
  }
  for (const x of [0, columns]) for (const y of [0, rows]) lines.push(origin, point(x, y));
  return { triangles, lines };
}

/** Ear clipping keeps concave ground zones intact. Reject crossed or degenerate boundaries. */
export function triangulate(vertices: readonly [number, number][]): number[] {
  const cross = (a: number, b: number, c: number) => {
    const p = vertices[a]!,
      q = vertices[b]!,
      r = vertices[c]!;
    return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  };
  const n = vertices.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
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
