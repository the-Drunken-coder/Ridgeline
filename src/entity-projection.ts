import { MercatorCoordinate } from 'maplibre-gl';
import type { CustomRenderMethodInput, Map as GLMap } from 'maplibre-gl';
import type { GeoPoint } from './entity-geometry';

export type ScreenPoint = { x: number; y: number; depth: number };
export type ProjectionOrigin = readonly [number, number];
export const multiplyProjection = (m: ArrayLike<number>, v: number[]) =>
  [0, 1, 2, 3].map(row => m[row]! * v[0]! + m[row + 4]! * v[1]! + m[row + 8]! * v[2]! + m[row + 12]! * v[3]!);

export function shiftedProjection(matrix: ArrayLike<number>, x: number, y: number) {
  const m = Float64Array.from(matrix);
  for (let i = 0; i < 4; i++) m[12 + i] = matrix[12 + i]! + matrix[i]! * x + matrix[i + 4]! * y;
  return new Float32Array(m);
}

export function nearestWorldCopy(map: GLMap, x: number) {
  return Math.round((map.getCenter().lng + 180) / 360 - x);
}

/** Position.xy is relative to the coherent Mercator origin; position.z is meters. */
export const entityProjectionShader = `
uniform mat4 u_flat; uniform float u_blend;
vec4 projectPosition(vec3 position,float scale){
#ifdef GLOBE
  vec4 sphere=projectTileFor3D(position.xy,position.z);
  vec4 flatPosition=u_flat*vec4(position.xy,position.z*scale,1.0);
  return mix(flatPosition,sphere,u_blend);
#else
  return projectTileFor3D(position.xy,position.z*scale);
#endif
}`;

/** Matches the shader blend. Heights here are already displayed/exaggerated. */
export function clipEntityPosition(map: GLMap, data: CustomRenderMethodInput, p: GeoPoint, origin?: ProjectionOrigin): number[] | null {
  const height = p[2];
  const m = MercatorCoordinate.fromLngLat([p[0], p[1]], height), d = data.defaultProjectionData;
  const reference = origin?.[0] ?? m.x;
  const x = m.x - Math.round(m.x - reference) + nearestWorldCopy(map, reference);
  let clip = multiplyProjection(d.mainMatrix, [x, m.y, m.z, 1]);
  if (data.shaderData.define.includes('GLOBE')) {
    const lon = p[0] * Math.PI / 180, lat = p[1] * Math.PI / 180, r = 1 + height / 6371008.8;
    const sphere = [Math.sin(lon) * Math.cos(lat) * r, Math.sin(lat) * r, Math.cos(lon) * Math.cos(lat) * r, 1];
    const front = sphere.slice(0, 3).reduce((sum, v, i) => sum + v * d.clippingPlane[i]!, d.clippingPlane[3]);
    if (d.projectionTransition > .99 && front < 0) return null;
    const g = multiplyProjection(d.mainMatrix, sphere), f = multiplyProjection(d.fallbackMatrix, [x, m.y, m.z, 1]);
    clip = g.map((v, i) => v * d.projectionTransition + f[i]! * (1 - d.projectionTransition));
  }
  return clip;
}

export function entityScreenPoint(map: GLMap, clip: number[]): ScreenPoint {
  return { x: (clip[0]! / clip[3]! + 1) / 2 * map.getCanvas().clientWidth,
    y: (1 - clip[1]! / clip[3]!) / 2 * map.getCanvas().clientHeight, depth: clip[2]! / clip[3]! };
}

export function projectEntityPosition(map: GLMap, data: CustomRenderMethodInput, p: GeoPoint, origin?: ProjectionOrigin) {
  const clip = clipEntityPosition(map, data, p, origin);
  return !clip || clip[3]! <= 0 || Math.abs(clip[2]! / clip[3]!) > 1 ? null : entityScreenPoint(map, clip);
}

/** The GPU clips faces to these same near and far depth planes. */
export function clipEntityPolygon(polygon: number[][]): number[][] {
  let points = polygon;
  for (const distance of [(p: number[]) => p[2]! + p[3]!, (p: number[]) => p[3]! - p[2]!]) {
    const next: number[][] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!, b = points[(i + 1) % points.length]!;
      const da = distance(a), db = distance(b);
      if (da >= 0) next.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        next.push(a.map((value, index) => value + t * (b[index]! - value)));
      }
    }
    points = next;
    if (points.length < 3) return [];
  }
  return points.filter(point => point[3]! > 0);
}
