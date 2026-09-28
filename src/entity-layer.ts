import { MercatorCoordinate } from 'maplibre-gl';
import type { CustomLayerInterface, CustomRenderMethodInput, Map as GLMap } from 'maplibre-gl';
import type { GeoPoint } from './entity-geometry';

export type Primitive = {
  entityId: string;
  attachmentId?: string;
  mode: 'triangles' | 'lines' | 'points' | 'polygon';
  /** Heights are raw meters in the elevation source's datum. */
  vertices: GeoPoint[];
  color: [number, number, number, number];
  size?: number;
  surface?: boolean;
};
type Draw = Primitive & { first: number; count: number };
type Program = {
  program: WebGLProgram;
  position: number;
  color: number;
  scale: number;
};
type ScreenPoint = { x: number; y: number; depth: number };
const multiply = (m: ArrayLike<number>, v: number[]) =>
  [0, 1, 2, 3].map(
    (row) => m[row]! * v[0]! + m[row + 4]! * v[1]! + m[row + 8]! * v[2]! + m[row + 12]! * v[3]!,
  );
function shifted(matrix: ArrayLike<number>, x: number, y: number) {
  const m = Float64Array.from(matrix);
  for (let i = 0; i < 4; i++) m[12 + i] = matrix[12 + i]! + matrix[i]! * x + matrix[i + 4]! * y;
  return new Float32Array(m);
}

/** Shared-depth 3D geometry using MapLibre's projection shader contract. No continuous repaint loop. */
export class EntityLayer implements CustomLayerInterface {
  readonly id = 'rl:entities';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  private map?: GLMap;
  private buffer?: WebGLBuffer;
  private programs = new Map<string, Program>();
  private draws: Draw[] = [];
  private dirty = true;
  private origin: [number, number] = [0, 0];
  private projection?: CustomRenderMethodInput;
  private gl?: WebGL2RenderingContext;
  private failed = false;
  private verticalScale = 1;
  constructor(private report: (cause: unknown) => void) {}
  private displayHeight(height: number) {
    return height * this.verticalScale;
  }
  set(primitives: Primitive[], verticalScale: number) {
    this.verticalScale = verticalScale;
    let first = 0;
    this.draws = primitives.map((p) => {
      const d = { ...p, first, count: p.mode === 'lines' ? p.vertices.length * 3 : p.vertices.length };
      first += d.count;
      return d;
    });
    this.dirty = true;
    this.map?.triggerRepaint();
  }
  onAdd(map: GLMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.gl = gl;
    this.buffer = gl.createBuffer() ?? undefined;
    this.dirty = true;
    this.failed = false;
  }
  onRemove() {
    if (this.gl) {
      if (this.buffer) this.gl.deleteBuffer(this.buffer);
      for (const p of this.programs.values()) this.gl.deleteProgram(p.program);
    }
    this.programs.clear();
    this.buffer = undefined;
    this.projection = undefined;
    this.map = undefined;
  }
  render(gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    if (!this.buffer || !this.map || this.failed || !this.draws.length) return;
    this.projection = input;
    try {
      let program = this.programs.get(input.shaderData.variantName);
      if (!program) {
        program = this.compile(gl, input);
        this.programs.set(input.shaderData.variantName, program);
      }
      gl.useProgram(program.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      if (this.dirty) {
        const first = this.draws[0]?.vertices[0];
        const center = first
          ? MercatorCoordinate.fromLngLat([first[0], first[1]])
          : new MercatorCoordinate(0, 0, 0);
        this.origin = [center.x, center.y];
        const values: number[] = [];
        const position = (p: GeoPoint) => {
          const m = MercatorCoordinate.fromLngLat([p[0], Math.max(-85.05112878, Math.min(85.05112878, p[1]))]);
          let x = m.x - center.x;
          if (x > .5) x--;
          if (x < -.5) x++;
          return [x, m.y - center.y, this.displayHeight(p[2]), m.meterInMercatorCoordinateUnits()];
        };
        for (const draw of this.draws) {
          if (draw.mode === 'lines') {
            for (let i = 0; i < draw.vertices.length; i += 2) {
              const a = position(draw.vertices[i]!), b = position(draw.vertices[i + 1]!);
              for (const [t, side] of [[0,-1],[1,-1],[0,1],[0,1],[1,-1],[1,1]])
                values.push(...a, ...draw.color, ...b, t!, side!);
            }
          } else for (const p of draw.vertices) values.push(...position(p), ...draw.color, 0,0,0,0,0,0);
        }
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.DYNAMIC_DRAW);
        this.dirty = false;
      }
      const d = input.defaultProjectionData,
        globe = input.shaderData.define.includes('GLOBE');
      const uniform = (name: string) => gl.getUniformLocation(program.program, name);
      const worldCopy = globe ? 0 : Math.round((this.map.getCenter().lng + 180) / 360 - this.origin[0]);
      gl.uniformMatrix4fv(
        uniform('u_projection_matrix'),
        false,
        globe
          ? new Float32Array(d.mainMatrix)
          : shifted(d.mainMatrix, this.origin[0] + worldCopy, this.origin[1]),
      );
      gl.uniformMatrix4fv(
        uniform('u_flat'),
        false,
        shifted(d.fallbackMatrix, this.origin[0], this.origin[1]),
      );
      gl.uniformMatrix4fv(uniform('u_projection_fallback_matrix'), false, new Float32Array(d.fallbackMatrix));
      gl.uniform4f(uniform('u_projection_tile_mercator_coords'), this.origin[0], this.origin[1], 1, 1);
      gl.uniform4fv(uniform('u_projection_clipping_plane'), d.clippingPlane);
      gl.uniform1f(uniform('u_projection_transition'), 1);
      gl.uniform1f(uniform('u_blend'), d.projectionTransition);
      gl.uniform2f(uniform('u_viewport'), gl.drawingBufferWidth, gl.drawingBufferHeight);
      for (const [location, size, offset] of [
        [program.position, 3, 0],
        [program.scale, 1, 12],
        [program.color, 4, 16],
        [gl.getAttribLocation(program.program, 'a_end'), 4, 32],
        [gl.getAttribLocation(program.program, 'a_line'), 2, 48],
      ])
        if (location !== undefined && location >= 0) {
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, size!, gl.FLOAT, false, 56, offset!);
        }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.CULL_FACE);
      gl.depthMask(false);
      for (const draw of this.draws) {
        gl.uniform1f(uniform('u_line_width'), (draw.size ?? 1) * devicePixelRatio);
        gl.uniform1f(uniform('u_point_size'), (draw.size ?? 10) * devicePixelRatio);
        gl.uniform1i(uniform('u_point'), draw.mode === 'points' ? 1 : 0);
        gl.drawArrays(
          draw.mode === 'triangles' || draw.mode === 'lines' ? gl.TRIANGLES : gl.POINTS,
          draw.first,
          draw.count,
        );
      }
      gl.depthMask(true);
    } catch (cause) {
      this.failed = true;
      this.report(cause);
    }
  }
  private compile(gl: WebGL2RenderingContext, input: CustomRenderMethodInput): Program {
    const vertex = `#version 300 es
precision highp float;
${input.shaderData.vertexShaderPrelude}
${input.shaderData.define}
in vec3 a_position; in float a_scale; in vec4 a_color; in vec4 a_end; in vec2 a_line;
uniform vec2 u_viewport; uniform float u_line_width;
uniform mat4 u_flat; uniform float u_blend; uniform float u_point_size;
out vec4 v_color;
vec4 projectPosition(vec3 position,float scale){
#ifdef GLOBE
  vec4 sphere=projectTileFor3D(position.xy,position.z);
  vec4 flatPosition=u_flat*vec4(position.xy,position.z*scale,1.0);
  return mix(flatPosition,sphere,u_blend);
#else
  return projectTileFor3D(position.xy,position.z*scale);
#endif
}
void main(){
  vec4 start=projectPosition(a_position,a_scale);
  gl_Position=start;
  if(a_line.y!=0.){
    vec4 end=projectPosition(a_end.xyz,a_end.w);
    // Clip segments to the near plane before screen-space extrusion.
    float da=start.z+start.w,db=end.z+end.w;
    if(da<0.&&db<0.){gl_Position=vec4(2.,2.,2.,1.);}
    else {
      if(da<0.)start=mix(start,end,da/(da-db));
      if(db<0.)end=mix(end,start,db/(db-max(da,0.)));
      vec2 delta=(end.xy/end.w-start.xy/start.w)*u_viewport;
      vec2 normal=vec2(-delta.y,delta.x)/max(length(delta),.0001);
      gl_Position=mix(start,end,a_line.x);
      gl_Position.xy+=normal*a_line.y*u_line_width/u_viewport*gl_Position.w;
    }
  }
  gl_PointSize=u_point_size;v_color=a_color;
}`;
    const fragment = `#version 300 es
precision highp float; in vec4 v_color;uniform bool u_point;out vec4 color;
void main(){if(u_point&&distance(gl_PointCoord,vec2(.5))>.5)discard;color=v_color;}`;
    const shaders: WebGLShader[] = [];
    const p = gl.createProgram();
    if (!p) throw new Error('Cannot allocate entity shader.');
    try {
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vertex],
        [gl.FRAGMENT_SHADER, fragment],
      ] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Cannot allocate entity shader.');
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error(gl.getShaderInfoLog(shader) ?? 'Entity shader compilation failed.');
        gl.attachShader(p, shader);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(p) ?? 'Entity shader link failed.');
      return {
        program: p,
        position: gl.getAttribLocation(p, 'a_position'),
        scale: gl.getAttribLocation(p, 'a_scale'),
        color: gl.getAttribLocation(p, 'a_color'),
      };
    } catch (cause) {
      gl.deleteProgram(p);
      throw cause;
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
  }
  private projectRaw(p: GeoPoint): ScreenPoint | null {
    return this.projectDisplayed([p[0], p[1], this.displayHeight(p[2])]);
  }
  private projectDisplayed(p: GeoPoint): ScreenPoint | null {
    const data = this.projection;
    if (!data || !this.map) return null;
    const height = p[2];
    const m = MercatorCoordinate.fromLngLat([p[0], p[1]], height),
      d = data.defaultProjectionData;
    const globe = data.shaderData.define.includes('GLOBE');
    const x = m.x + Math.round((this.map.getCenter().lng + 180) / 360 - m.x);
    let clip = multiply(d.mainMatrix, [x, m.y, m.z, 1]);
    if (globe) {
      const lon = (p[0] * Math.PI) / 180,
        lat = (p[1] * Math.PI) / 180,
        r = 1 + height / 6371008.8;
      const sphere = [
        -Math.sin(lon) * Math.cos(lat) * r,
        Math.sin(lat) * r,
        -Math.cos(lon) * Math.cos(lat) * r,
        1,
      ];
      const front = sphere
        .slice(0, 3)
        .reduce((sum, v, i) => sum + v * d.clippingPlane[i]!, d.clippingPlane[3]);
      if (d.projectionTransition > 0.99 && front < 0) return null;
      const g = multiply(d.mainMatrix, sphere),
        f = multiply(d.fallbackMatrix, [x, m.y, m.z, 1]);
      clip = g.map((v, i) => v * d.projectionTransition + f[i]! * (1 - d.projectionTransition));
    }
    if (clip[3]! <= 0 || Math.abs(clip[2]! / clip[3]!) > 1) return null;
    return {
      x: ((clip[0]! / clip[3]! + 1) / 2) * this.map.getCanvas().clientWidth,
      y: ((1 - clip[1]! / clip[3]!) / 2) * this.map.getCanvas().clientHeight,
      depth: clip[2]! / clip[3]!,
    };
  }
  pick(x: number, y: number, tolerance: number) {
    const hits: { entityId: string; attachmentId?: string; depth: number }[] = [];
    let terrainDepth: number | undefined;
    if (this.map && this.projection) {
      const location = this.map.unproject([x, y]);
      const height = this.map.getTerrain() ? this.map.queryTerrainElevation(location) : 0;
      // MapLibre's terrain query returns a height that already includes exaggeration.
      if (height !== null) terrainDepth = this.projectDisplayed([location.lng, location.lat, height])?.depth;
    }
    const visible = (depth: number) => terrainDepth === undefined || depth <= terrainDepth + 1e-6;
    for (const draw of this.draws) {
      if (draw.mode === 'lines' && !draw.attachmentId) continue;
      const points = draw.vertices.map((p) => this.projectRaw(p));
      if (draw.mode === 'lines') {
        for (let i = 0; i < points.length; i += 2) {
          const a = points[i], b = points[i + 1];
          if (!a || !b) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const lengthSquared = dx * dx + dy * dy;
          const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared));
          const depth = a.depth + t * (b.depth - a.depth);
          if (Math.hypot(x - a.x - t * dx, y - a.y - t * dy) <= tolerance && visible(depth)) {
            hits.push({ entityId: draw.entityId, attachmentId: draw.attachmentId, depth });
            break;
          }
        }
        continue;
      }
      if (draw.mode === 'points') {
        const p = points[0];
        if (
          p &&
          visible(p.depth) &&
          Math.hypot(p.x - x, p.y - y) < Math.max(tolerance, (draw.size ?? 10) / 2)
        )
          hits.push({ entityId: draw.entityId, depth: p.depth });
        continue;
      }
      for (let i = 0; i < points.length; i += 3) {
        const a = points[i],
          b = points[i + 1],
          c = points[i + 2];
        if (!a || !b || !c) continue;
        const cross = (u: ScreenPoint, v: ScreenPoint) => (x - v.x) * (u.y - v.y) - (u.x - v.x) * (y - v.y);
        const signs = [cross(a, b), cross(b, c), cross(c, a)];
        if (signs.every((v) => v >= 0) || signs.every((v) => v <= 0)) {
          const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
          if (Math.abs(denominator) < 1e-8) continue;
          const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator;
          const v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator;
          const depth = u * a.depth + v * b.depth + (1 - u - v) * c.depth;
          if (visible(depth)) {
            hits.push({
              entityId: draw.entityId,
              attachmentId: draw.attachmentId,
              depth,
            });
            break;
          }
        }
      }
    }
    return hits.sort((a, b) => a.depth - b.depth);
  }
}
