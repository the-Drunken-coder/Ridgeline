import { Color } from '@maplibre/maplibre-gl-style-spec';
import type { CustomRenderMethodInput } from 'maplibre-gl';
import { EntityProjection, entityProjectionShader } from './entity-projection';
import type { ParsedModel, ModelMaterial, Vec3 } from './model-glb';
import type { RegisteredModel } from './models';
import type { ModelAppearance } from './types';

type Batch = { vao: WebGLVertexArrayObject; instances: WebGLBuffer; count: number; material: ModelMaterial };
export type ModelGpu = { batches: Batch[]; readonly disposed: boolean; dispose(): void };
export type ModelDrawInstance = {
  /** Authored XYZ basis vectors in east/north/up meters per authored unit. */
  basis: [Vec3, Vec3, Vec3];
  /** entityVertex output relative to the draw origin: Mercator XY, displayed meters, units per meter. */
  anchor: [number, number, number, number];
  appearance?: ModelAppearance;
};
export type ModelDraw = { asset: RegisteredModel<ModelGpu>; origin: [number, number]; instances: ModelDrawInstance[] };
export type PreparedModelFrame = { draw(): void };
const STRIDE = 17;

/** Owns GPU allocation and submission; frame preparation completes every instance upload before publication. */
export class ModelRenderer {
  private programs = new Map<string, WebGLProgram>();
  private generation = 0;
  private destroyed = false;
  constructor(private gl: WebGL2RenderingContext) {}
  initialize(input: CustomRenderMethodInput) {
    if (this.destroyed || this.gl.isContextLost()) throw new Error('Model renderer unavailable.');
    let program = this.programs.get(input.shaderData.variantName);
    if (!program) { program = this.compile(this.gl, input); this.programs.set(input.shaderData.variantName, program); }
    return program;
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; this.generation++;
    for (const program of this.programs.values()) this.gl.deleteProgram(program);
    this.programs.clear();
  }
  upload(model: ParsedModel, current: () => boolean): ModelGpu {
    const gl = this.gl;
    if (this.destroyed || gl.isContextLost()) throw new Error('Model renderer unavailable.');
    if (model.batches.some(batch => batch.material.texture !== undefined || batch.material.alphaMode !== 'OPAQUE'))
      throw new Error('GLB_TEXTURED_OR_ALPHA_MATERIAL_UNSUPPORTED_IN_SOLID_SLICE');
    const buffers: WebGLBuffer[] = [], arrays: WebGLVertexArrayObject[] = [];
    let released = false;
    const dispose = () => {
      if (released) return;
      released = true;
      for (const array of arrays) gl.deleteVertexArray(array);
      for (const buffer of buffers) gl.deleteBuffer(buffer);
    };
    const active = () => { if (!current()) throw new Error('Model upload cancelled.'); };
    const buffer = () => { active(); const value = gl.createBuffer(); if (!value) throw new Error('Cannot allocate model buffer.'); buffers.push(value); active(); return value; };
    try {
      const batches = model.batches.map(batch => {
        active();
        const vao = gl.createVertexArray(); if (!vao) throw new Error('Cannot allocate model vertex array.'); arrays.push(vao); active();
        gl.bindVertexArray(vao);
        for (const [location, size, data] of [[0, 3, batch.positions], [1, 3, batch.normals], [2, 4, batch.colors]] as const) {
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer()); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
          gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, batch.indices, gl.STATIC_DRAW);
        const instances = buffer(); gl.bindBuffer(gl.ARRAY_BUFFER, instances);
        for (const [location, size, offset] of [[3, 3, 0], [4, 3, 3], [5, 3, 6], [6, 4, 9], [7, 4, 13]] as const) {
          gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE * 4, offset * 4); gl.vertexAttribDivisor(location, 1);
        }
        return { vao, instances, count: batch.indices.length, material: batch.material };
      });
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`Model upload failed with WebGL error ${error}.`);
      return { batches, get disposed() { return released; }, dispose };
    } catch (cause) { dispose(); throw cause; }
    finally { gl.bindVertexArray(null); }
  }
  prepareFrame(input: CustomRenderMethodInput, projection: EntityProjection, draws: ModelDraw[]): PreparedModelFrame {
    const gl = this.gl, program = this.initialize(input), generation = ++this.generation;
    const groups = new Map<RegisteredModel<ModelGpu>, number[]>();
    const prepared = draws.map(draw => {
      const values = groups.get(draw.asset) ?? [], offset = values.length / STRIDE;
      for (const instance of draw.instances) {
        const appearance = instance.appearance ?? draw.asset.definition.appearance;
        const color = Color.parse(appearance?.mode === 'color' ? appearance.color : '#ff00ff');
        if (!color) throw new Error('Invalid model appearance.');
        const [red, green, blue] = color.rgb;
        values.push(...instance.basis[0], ...instance.basis[1], ...instance.basis[2], ...instance.anchor,
          red, green, blue, appearance?.mode === 'original' ? 1 : 0);
      }
      groups.set(draw.asset, values);
      return { ...draw, offset, count: draw.instances.length };
    });
    // A model may appear in several world copies. Upload once per asset and draw each origin's range.
    for (const [asset, values] of groups) {
      const data = new Float32Array(values);
      for (const batch of asset.resources.batches) {
        gl.bindBuffer(gl.ARRAY_BUFFER, batch.instances); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      }
    }
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`Model instance upload failed with WebGL error ${error}.`);
    return { draw: () => {
      if (this.destroyed || generation !== this.generation || gl.isContextLost()) return;
      try {
        gl.useProgram(program); projection.bindFrame(gl, program);
        const uniform = (name: string) => gl.getUniformLocation(program, name);
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND);
        for (const { asset, origin, offset, count } of prepared) {
          if (asset.resources.disposed) continue;
          projection.bindOrigin(gl, program, origin);
          const { min, max } = asset.model.bounds;
          gl.uniform3f(uniform('u_center'), (min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
          for (const batch of asset.resources.batches) {
            gl.bindVertexArray(batch.vao); gl.bindBuffer(gl.ARRAY_BUFFER, batch.instances);
            for (const [location, size, start] of [[3, 3, 0], [4, 3, 3], [5, 3, 6], [6, 4, 9], [7, 4, 13]] as const)
              gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE * 4, (offset * STRIDE + start) * 4);
            gl.uniform4fv(uniform('u_base'), batch.material.baseColor); gl.uniform3fv(uniform('u_emissive'), batch.material.emissive);
            gl.uniform1i(uniform('u_unlit'), batch.material.unlit ? 1 : 0);
            if (batch.material.doubleSided) gl.disable(gl.CULL_FACE);
            else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW); }
            gl.drawElementsInstanced(gl.TRIANGLES, batch.count, gl.UNSIGNED_INT, 0, count);
          }
        }
      } finally { gl.bindVertexArray(null); gl.depthMask(true); }
    } };
  }
  private compile(gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    const program = gl.createProgram(); if (!program) throw new Error('Cannot allocate model program.');
    const shaders: WebGLShader[] = [];
    try {
      const vertex = `#version 300 es
precision highp float;
${input.shaderData.vertexShaderPrelude}
${input.shaderData.define}
layout(location=0) in vec3 a_position; layout(location=1) in vec3 a_normal; layout(location=2) in vec4 a_color;
layout(location=3) in vec3 i_rot0; layout(location=4) in vec3 i_rot1; layout(location=5) in vec3 i_rot2;
layout(location=6) in vec4 i_offset; layout(location=7) in vec4 i_color;
uniform vec3 u_center;
out vec3 v_normal; out vec4 v_color; out vec4 v_instance;
${entityProjectionShader}
void main(){vec3 p=a_position-u_center;vec3 enu=i_rot0*p.x+i_rot1*p.y+i_rot2*p.z;
gl_Position=projectPosition(vec3(i_offset.xy+vec2(enu.x,-enu.y)*i_offset.w,i_offset.z+enu.z),i_offset.w);
v_normal=a_normal;v_color=a_color;v_instance=i_color;}`;
      const fragment = `#version 300 es
precision highp float;
in vec3 v_normal;in vec4 v_color;in vec4 v_instance;uniform vec4 u_base;uniform vec3 u_emissive;uniform bool u_unlit;out vec4 color;
void main(){float light=u_unlit?1.:.52+.48*max(0.,dot(normalize(gl_FrontFacing?v_normal:-v_normal),normalize(vec3(-.4,.8,.5))));
vec3 rgb=v_instance.w>.5?u_base.rgb*v_color.rgb*light+u_emissive:v_instance.rgb*light;color=vec4(rgb,1.);}`;
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl.createShader(type); if (!shader) throw new Error('Cannot allocate model shader.'); shaders.push(shader);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Model shader failed.');
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Model program failed.');
      return program;
    } catch (cause) { gl.deleteProgram(program); throw cause; }
    finally { for (const shader of shaders) gl.deleteShader(shader); }
  }
}
