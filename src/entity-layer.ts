import { MercatorCoordinate } from 'maplibre-gl';
import type { CustomLayerInterface, CustomRenderMethodInput, Map as GLMap } from 'maplibre-gl';
import type { GeoPoint } from './entity-geometry';
import { EntityProjection, entityProjectionShader, entityVertex } from './entity-projection';
import type { ProjectionOrigin, ScreenPoint } from './entity-projection';

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
type Draw = Primitive & { first: number; count: number; origin: ProjectionOrigin };
type Program = {
  program: WebGLProgram;
  position: number;
  color: number;
  scale: number;
};
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
  private projection?: EntityProjection;
  private gl?: WebGL2RenderingContext;
  private failed = false;
  private verticalScale = 1;
  private hiddenPoints: ReadonlySet<string> = new Set();
  constructor(private report: (cause: unknown) => void) {}
  suppressPoints(ids: ReadonlySet<string>) { this.hiddenPoints = ids; }
  private displayHeight(height: number) {
    return height * this.verticalScale;
  }
  set(primitives: Primitive[], verticalScale: number) {
    this.verticalScale = verticalScale;
    const origins = new Map<string, [number, number]>();
    for (const primitive of primitives) {
      const first = primitive.vertices[0];
      if (first && (!origins.has(primitive.entityId) || primitive.mode === 'points')) {
        const center = MercatorCoordinate.fromLngLat([first[0], first[1]]);
        origins.set(primitive.entityId, [center.x, center.y]);
      }
    }
    let first = 0;
    this.draws = primitives.map((p) => {
      const d: Draw = { ...p, first, count: p.mode === 'lines' ? p.vertices.length * 3 : p.vertices.length,
        origin: origins.get(p.entityId) ?? [0, 0] };
      first += d.count;
      return d;
    });
    this.dirty = true;
    this.map?.triggerRepaint();
  }
  onAdd(map: GLMap, gl: WebGL2RenderingContext) {
    this.onRemove();
    this.map = map;
    this.gl = gl;
    this.dirty = true;
    this.failed = false;
    this.allocateBuffer();
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
    this.gl = undefined;
  }
  retry() {
    if (!this.map) return;
    this.failed = false;
    this.dirty = true;
    this.allocateBuffer();
    this.map?.triggerRepaint();
  }
  private allocateBuffer() {
    if (this.buffer || !this.gl || !this.map) return;
    try {
      const buffer = this.gl.createBuffer();
      if (!buffer) throw new Error('Cannot allocate entity vertex buffer.');
      this.buffer = buffer;
    } catch (cause) {
      this.failed = true;
      this.report(cause);
    }
  }
  render(gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    if (!this.buffer || !this.map || this.failed || !this.draws.length) return;
    const canvas = this.map.getCanvas();
    this.projection = new EntityProjection(input, this.map.getCenter().lng, canvas.clientWidth, canvas.clientHeight);
    try {
      let program = this.programs.get(input.shaderData.variantName);
      if (!program) {
        program = this.compile(gl, input);
        this.programs.set(input.shaderData.variantName, program);
      }
      gl.useProgram(program.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      if (this.dirty) {
        const values: number[] = [];
        const position = (p: GeoPoint, origin: ProjectionOrigin) =>
          entityVertex([p[0], p[1], this.displayHeight(p[2])], origin);
        for (const draw of this.draws) {
          if (draw.mode === 'lines') {
            for (let i = 0; i < draw.vertices.length; i += 2) {
              const a = position(draw.vertices[i]!, draw.origin), b = position(draw.vertices[i + 1]!, draw.origin);
              for (const [t, side] of [[0,-1],[1,-1],[0,1],[0,1],[1,-1],[1,1]])
                values.push(...a, ...draw.color, ...b, t!, side!);
            }
          } else for (const p of draw.vertices) values.push(...position(p, draw.origin), ...draw.color, 0,0,0,0,0,0);
        }
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.DYNAMIC_DRAW);
        this.dirty = false;
      }
      const uniform = (name: string) => gl.getUniformLocation(program.program, name);
      this.projection.bindFrame(gl, program.program);
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
        if (draw.mode === 'points' && this.hiddenPoints.has(draw.entityId)) continue;
        this.projection.bindOrigin(gl, program.program, draw.origin);
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
      try { gl.depthMask(true); } catch { /* Preserve the original rendering failure. */ }
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
uniform float u_point_size;
out vec4 v_color;
${entityProjectionShader}
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
  project(p: GeoPoint, origin?: ProjectionOrigin) {
    return this.projection?.project([p[0], p[1], this.displayHeight(p[2])], origin) ?? null;
  }
  private clippedTriangle(vertices: GeoPoint[], origin: ProjectionOrigin) {
    const projection = this.projection;
    if (!projection) return [];
    const polygon = vertices.map(p => projection.clip([p[0], p[1], this.displayHeight(p[2])], origin));
    if (polygon.some(point => !point)) return [];
    return projection.clippedPolygon(polygon.filter((point): point is number[] => point !== null));
  }
  private clippedSegment(a: GeoPoint, b: GeoPoint, origin: ProjectionOrigin) {
    const projection = this.projection;
    if (!projection) return null;
    const start = projection.clip([a[0], a[1], this.displayHeight(a[2])], origin);
    const end = projection.clip([b[0], b[1], this.displayHeight(b[2])], origin);
    return start && end ? projection.clippedSegment(start, end) : null;
  }
  pick(x: number, y: number, tolerance: number) {
    const hits: { entityId: string; attachmentId?: string; depth: number }[] = [];
    let terrainDepth: number | undefined;
    if (this.map && this.projection) {
      const location = this.map.unproject([x, y]);
      const height = this.map.getTerrain() ? this.map.queryTerrainElevation(location) : 0;
      // MapLibre's terrain query returns a height that already includes exaggeration.
      if (height !== null) terrainDepth = this.projection.project([location.lng, location.lat, height])?.depth;
    }
    const visible = (depth: number) => terrainDepth === undefined || depth <= terrainDepth + 1e-6;
    for (const draw of this.draws) {
      if (draw.mode === 'points' && this.hiddenPoints.has(draw.entityId)) continue;
      if (draw.mode === 'lines' && !draw.attachmentId) continue;
      if (draw.mode === 'lines') {
        for (let i = 0; i < draw.vertices.length; i += 2) {
          const segment = this.clippedSegment(draw.vertices[i]!, draw.vertices[i + 1]!, draw.origin);
          if (!segment) continue;
          const [a, b] = segment;
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
        const p = this.project(draw.vertices[0]!, draw.origin);
        if (
          p &&
          visible(p.depth) &&
          Math.hypot(p.x - x, p.y - y) < Math.max(tolerance, (draw.size ?? 10) / 2)
        )
          hits.push({ entityId: draw.entityId, depth: p.depth });
        continue;
      }
      triangles: for (let i = 0; i < draw.vertices.length; i += 3) {
        const clipped = this.clippedTriangle(draw.vertices.slice(i, i + 3), draw.origin);
        for (let vertex = 1; vertex + 1 < clipped.length; vertex++) {
          const a = clipped[0], b = clipped[vertex], c = clipped[vertex + 1];
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
              hits.push({ entityId: draw.entityId, attachmentId: draw.attachmentId, depth });
              break triangles;
            }
          }
        }
      }
    }
    return hits.sort((a, b) => a.depth - b.depth);
  }
}
