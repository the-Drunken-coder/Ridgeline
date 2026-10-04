import { MercatorCoordinate } from 'maplibre-gl';
import type { CustomRenderMethodInput } from 'maplibre-gl';
import type { GeoPoint } from './entity-geometry';

export type ScreenPoint = { x: number; y: number; depth: number };
export type ProjectionOrigin = readonly [number, number];
type ProjectionInput = {
  shaderData: Pick<CustomRenderMethodInput['shaderData'], 'define'>;
  defaultProjectionData: Pick<CustomRenderMethodInput['defaultProjectionData'],
    'mainMatrix' | 'fallbackMatrix' | 'clippingPlane' | 'projectionTransition'>;
};
const multiply = (m: ArrayLike<number>, v: number[]) =>
  [0, 1, 2, 3].map(row => m[row]! * v[0]! + m[row + 4]! * v[1]! + m[row + 8]! * v[2]! + m[row + 12]! * v[3]!);

function shifted(matrix: ArrayLike<number>, x: number, y: number) {
  const m = Float64Array.from(matrix);
  for (let i = 0; i < 4; i++) m[12 + i] = matrix[12 + i]! + matrix[i]! * x + matrix[i + 4]! * y;
  return new Float32Array(m);
}

/** Geographic geometry stays relative to one entity origin until after GPU multiplication. */
export function entityVertex(p: GeoPoint, origin: ProjectionOrigin): [number, number, number, number] {
  const m = MercatorCoordinate.fromLngLat([p[0], Math.max(-85.05112878, Math.min(85.05112878, p[1]))]);
  const x = m.x - origin[0];
  return [x - Math.round(x), m.y - origin[1], p[2], m.meterInMercatorCoordinateUnits()];
}

/** Position.xy is relative Mercator; position.z is displayed meters. */
export const entityProjectionShader = `
uniform mat4 u_flat; uniform float u_blend;
#ifdef GLOBE
uniform mat4 u_globe_local;
uniform vec3 u_globe_origin;
// exp(q)-1 loses meter-scale differences near zero in float32.
float expDelta(float q){
  return abs(q)<.01?q*(1.+q*(.5+q*(1./6.+q/24.))):exp(q)-1.;
}
vec3 sphereOffset(vec2 position,float height){
  float longitude=position.x*6.283185307179586;
  float delta=expDelta(-position.y*6.283185307179586);
  float tangent=u_globe_origin.z;
  float latitude=2.*atan(tangent*delta/(1.+tangent*tangent*(1.+delta)));
  float sinLatitude=sin(latitude);
  float cosLatitude=cos(latitude);
  float cosFinalLatitude=u_globe_origin.y*cosLatitude-u_globe_origin.x*sinLatitude;
  float sinHalfLongitude=sin(longitude*.5),sinHalfLatitude=sin(latitude*.5);
  float longitudeBend=2.*sinHalfLongitude*sinHalfLongitude;
  float latitudeBend=2.*sinHalfLatitude*sinHalfLatitude;
  vec3 offset=vec3(cosFinalLatitude*sin(longitude),
    sinLatitude+u_globe_origin.x*cosFinalLatitude*longitudeBend,
    -latitudeBend-u_globe_origin.y*cosFinalLatitude*longitudeBend);
  float altitude=height/6371008.8;
  return offset*(1.+altitude)+vec3(0.,0.,altitude);
}
#endif
vec4 projectPosition(vec3 position,float scale){
#ifdef GLOBE
  // Transform exact spherical deltas around the entity, avoiding large-angle
  // GPU trigonometry and cancellation against the camera's global translation.
  vec4 sphere=u_globe_local*vec4(sphereOffset(position.xy,position.z),1.0);
  vec4 flatPosition=u_flat*vec4(position.xy,position.z*scale,1.0);
  return mix(flatPosition,sphere,u_blend);
#else
  return projectTileFor3D(position.xy,position.z*scale);
#endif
}
`;

/** A rendered camera frame shared by drawing and picking. Heights are displayed meters. */
export class EntityProjection {
  private readonly data;
  private readonly globe;
  constructor(input: ProjectionInput, private readonly longitude: number,
    private readonly width: number, private readonly height: number) {
    const d = input.defaultProjectionData;
    this.data = { mainMatrix: Float64Array.from(d.mainMatrix), fallbackMatrix: Float64Array.from(d.fallbackMatrix),
      clippingPlane: Float64Array.from(d.clippingPlane), projectionTransition: d.projectionTransition };
    this.globe = input.shaderData.define.includes('GLOBE');
  }

  worldCopy(origin: ProjectionOrigin) {
    // One copy for the complete entity; unrelated geometry never changes it.
    return Math.round((this.longitude + 180) / 360 - origin[0]);
  }

  bindFrame(gl: WebGL2RenderingContext, program: WebGLProgram) {
    const d = this.data;
    const uniform = (name: string) => gl.getUniformLocation(program, name);
    gl.uniformMatrix4fv(uniform('u_projection_fallback_matrix'), false, new Float32Array(d.fallbackMatrix));
    gl.uniform4fv(uniform('u_projection_clipping_plane'), new Float32Array(d.clippingPlane));
    gl.uniform1f(uniform('u_projection_transition'), 1);
    gl.uniform1f(uniform('u_blend'), d.projectionTransition);
  }

  bindOrigin(gl: WebGL2RenderingContext, program: WebGLProgram, origin: ProjectionOrigin) {
    const d = this.data;
    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const [x, y] = origin, worldX = x + this.worldCopy(origin);
    gl.uniformMatrix4fv(uniform('u_projection_matrix'), false, this.globe
      ? new Float32Array(d.mainMatrix) : shifted(d.mainMatrix, worldX, y));
    gl.uniformMatrix4fv(uniform('u_flat'), false, shifted(d.fallbackMatrix, worldX, y));
    gl.uniform4f(uniform('u_projection_tile_mercator_coords'), x, y, 1, 1);
    if (this.globe) {
      const longitude = x * Math.PI * 2 - Math.PI, tangent = Math.exp(Math.PI - y * Math.PI * 2);
      const latitude = 2 * Math.atan(tangent) - Math.PI / 2;
      const sinLatitude = Math.sin(latitude), cosLatitude = Math.cos(latitude);
      const sinLongitude = Math.sin(longitude), cosLongitude = Math.cos(longitude);
      const east = [cosLongitude, 0, -sinLongitude];
      const north = [-sinLongitude * sinLatitude, cosLatitude, -cosLongitude * sinLatitude];
      const up = [sinLongitude * cosLatitude, sinLatitude, cosLongitude * cosLatitude];
      const local = new Float64Array(16);
      for (let row = 0; row < 4; row++) {
        const axis = (v: number[]) => d.mainMatrix[row]! * v[0]! + d.mainMatrix[row + 4]! * v[1]! + d.mainMatrix[row + 8]! * v[2]!;
        local[row] = axis(east); local[row + 4] = axis(north); local[row + 8] = axis(up);
        local[row + 12] = d.mainMatrix[row + 12]! + local[row + 8]!;
      }
      gl.uniformMatrix4fv(uniform('u_globe_local'), false, new Float32Array(local));
      gl.uniform3f(uniform('u_globe_origin'), sinLatitude, cosLatitude, tangent);
    }
  }

  clip(p: GeoPoint, origin?: ProjectionOrigin): number[] | null {
    const m = MercatorCoordinate.fromLngLat([p[0], p[1]], p[2]);
    const reference = origin ?? [m.x, m.y];
    const x = m.x - Math.round(m.x - reference[0]) + this.worldCopy(reference);
    const d = this.data;
    if (!this.globe) return multiply(d.mainMatrix, [x, m.y, m.z, 1]);
    const lon = p[0] * Math.PI / 180, lat = p[1] * Math.PI / 180, r = 1 + p[2] / 6371008.8;
    const sphere = [Math.sin(lon) * Math.cos(lat) * r, Math.sin(lat) * r, Math.cos(lon) * Math.cos(lat) * r, 1];
    const front = sphere.slice(0, 3).reduce((sum, v, i) => sum + v * d.clippingPlane[i]!, d.clippingPlane[3]!);
    if (d.projectionTransition > .99 && front < 0) return null;
    const g = multiply(d.mainMatrix, sphere), f = multiply(d.fallbackMatrix, [x, m.y, m.z, 1]);
    return g.map((v, i) => v * d.projectionTransition + f[i]! * (1 - d.projectionTransition));
  }

  screen(clip: number[]): ScreenPoint {
    return { x: (clip[0]! / clip[3]! + 1) / 2 * this.width,
      y: (1 - clip[1]! / clip[3]!) / 2 * this.height, depth: clip[2]! / clip[3]! };
  }

  project(p: GeoPoint, origin?: ProjectionOrigin): ScreenPoint | null {
    const clip = this.clip(p, origin);
    return !clip || clip[3]! <= 0 || Math.abs(clip[2]! / clip[3]!) > 1 ? null : this.screen(clip);
  }

  clippedPolygon(polygon: number[][]): ScreenPoint[] {
    let points = polygon;
    // The GPU clips faces against both depth planes before rasterization.
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
    return points.filter(point => point[3]! > 0).map(point => this.screen(point));
  }
  clippedSegment(a: number[], b: number[]): [ScreenPoint, ScreenPoint] | null {
    let start = a, end = b;
    for (const distance of [(p: number[]) => p[2]! + p[3]!, (p: number[]) => p[3]! - p[2]!]) {
      const first = distance(start), last = distance(end);
      if (first < 0 && last < 0) return null;
      if (first < 0 || last < 0) {
        const t = first / (first - last);
        const intersection = start.map((value, index) => value + t * (end[index]! - value));
        if (first < 0) start = intersection;
        else end = intersection;
      }
    }
    return start[3]! > 0 && end[3]! > 0 ? [this.screen(start), this.screen(end)] : null;
  }
}
