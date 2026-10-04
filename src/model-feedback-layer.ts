import type { CustomLayerInterface, Map as GLMap } from 'maplibre-gl';
import { modelPresentationGeometry } from './model-presentation';
import type { ModelPresentation } from './model-presentation';

/** Readable, static decoration over physical geometry; the scene owns all repaint scheduling. */
export class ModelFeedbackLayer implements CustomLayerInterface {
  readonly id = 'rl:model-feedback';
  readonly type = 'custom' as const;
  private records: readonly ModelPresentation[] = [];
  private current: () => boolean = () => false;
  private map?: GLMap;
  private gl?: WebGL2RenderingContext;
  private program?: WebGLProgram;
  private buffer?: WebGLBuffer;
  private vao?: WebGLVertexArrayObject;
  private destroyed = false;
  constructor(private diagnostic: (cause: unknown) => void) {}
  set(records: readonly ModelPresentation[], current: () => boolean) {
    if (this.destroyed || !current()) return;
    this.records = records; this.current = current;
  }
  clear() { this.records = []; this.current = () => false; }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.onRemove(); }
  onAdd(map: GLMap, context: WebGLRenderingContext | WebGL2RenderingContext) {
    if (this.destroyed || !(context instanceof WebGL2RenderingContext)) return;
    // MapLibre live style replacement reattaches custom layers without calling onRemove.
    if (this.gl === context && this.program && context.isProgram(this.program) && this.buffer && this.vao) {
      this.map = map; return;
    }
    this.release();
    this.map = map; this.gl = context;
    const gl = context, shaders: WebGLShader[] = [];
    try {
      this.program = gl.createProgram() ?? undefined;
      this.buffer = gl.createBuffer() ?? undefined; this.vao = gl.createVertexArray() ?? undefined;
      if (!this.program || !this.buffer || !this.vao) throw new Error('Cannot allocate model feedback resources.');
      const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec4 a_ring; uniform vec2 u_size;
out vec2 v_point; flat out float v_radius; flat out float v_selected;
void main(){vec2 corner=vec2(float(gl_VertexID&1),float((gl_VertexID>>1)&1))*2.-1.;
v_point=corner*(a_ring.z+5.);v_radius=a_ring.z;v_selected=a_ring.w;
vec2 p=(a_ring.xy+v_point)/u_size;gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);}`;
      const fragment = `#version 300 es
precision highp float;
in vec2 v_point;flat in float v_radius;flat in float v_selected;out vec4 color;
void main(){float d=abs(length(v_point)-v_radius),halfWidth=mix(.75,1.5,v_selected);
float outer=1.-smoothstep(halfWidth+1.,halfWidth+2.,d);
float inner=1.-smoothstep(halfWidth-.5,halfWidth+.5,d);
vec3 rgb=mix(vec3(.06,.08,.08),mix(vec3(1.),vec3(1.,.58,.13),v_selected),inner);
color=vec4(rgb*outer,outer);}`;
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl.createShader(type); if (!shader) throw new Error('Cannot allocate model feedback shader.');
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Model feedback shader failed.');
        gl.attachShader(this.program, shader);
      }
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) ?? 'Model feedback program failed.');
      gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(0, 1);
    } catch (cause) { this.release(); this.diagnostic(cause); }
    finally { for (const shader of shaders) gl.deleteShader(shader); gl.bindVertexArray(null); }
  }
  render() {
    const gl = this.gl, map = this.map;
    if (!gl || !map || !this.program || !this.buffer || !this.vao || gl.isContextLost() || !this.current()) return;
    const values = this.records.flatMap(record => {
      if (!record.feedback) return [];
      const geometry = modelPresentationGeometry(record);
      return [...geometry.center, geometry.radius, record.feedback === 'selected' ? 1 : 0];
    });
    if (!values.length) return;
    try {
      gl.useProgram(this.program); gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.DYNAMIC_DRAW);
      const canvas = map.getCanvas();
      gl.uniform2f(gl.getUniformLocation(this.program, 'u_size'), canvas.clientWidth, canvas.clientHeight);
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, values.length / 4);
    } finally { gl.depthMask(true); gl.bindVertexArray(null); }
  }
  onRemove() { this.clear(); this.release(); this.map = undefined; this.gl = undefined; }
  private release() {
    if (this.program) this.gl?.deleteProgram(this.program);
    if (this.buffer) this.gl?.deleteBuffer(this.buffer);
    if (this.vao) this.gl?.deleteVertexArray(this.vao);
    this.program = undefined; this.buffer = undefined; this.vao = undefined;
  }
}
