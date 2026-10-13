import type { ModelMeasurement } from './model-measurement';
import { Color } from '@maplibre/maplibre-gl-style-spec';
import type { CustomRenderMethodInput } from 'maplibre-gl';
import { EntityProjection, entityProjectionShader } from './entity-projection';
import type { ParsedModel, ModelMaterial, Vec3 } from './model-glb';
import type { RegisteredModel } from './models';
import type { ModelAppearance } from './types';
import type { ModelFeedback } from './model-presentation';

type Batch = { vao: WebGLVertexArrayObject; instances: WebGLBuffer; count: number; material: ModelMaterial;
  texture?: WebGLTexture; sampler?: WebGLSampler };
export type ModelGpu = { batches: Batch[]; readonly disposed: boolean; dispose(): void };
export type ModelDrawInstance = {
  /** Authored XYZ basis vectors in east/north/up meters per authored unit. */
  basis: [Vec3, Vec3, Vec3];
  /** entityVertex output relative to the draw origin: Mercator XY, displayed meters, units per meter. */
  anchor: [number, number, number, number];
  appearance?: ModelAppearance;
  feedback?: ModelFeedback;
  brightness?: number;
};
export type ModelDraw = { asset: RegisteredModel<ModelGpu>; origin: [number, number]; instances: ModelDrawInstance[] };
export type PreparedModelFrame = { draw(): void };
const STRIDE = 18;
const linear = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;

/** Native decoding cannot be aborted. Reject promptly, then close any bitmap delivered after cancellation. */
function decode(image: ParsedModel['images'][number], current: () => boolean, signal: AbortSignal): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cancel = () => { settled = true; signal.removeEventListener('abort', cancel); reject(new Error('Model image decode cancelled.')); };
    if (signal.aborted || !current()) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    createImageBitmap(new Blob([image.bytes.slice().buffer], { type: image.mimeType }),
      { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).then(bitmap => {
      signal.removeEventListener('abort', cancel);
      if (settled || !current()) { bitmap.close(); cancel(); return; }
      settled = true; resolve(bitmap);
    }, cause => {
      signal.removeEventListener('abort', cancel);
      if (!settled) { settled = true; reject(new Error('GLB_IMAGE_DECODE_FAILED', { cause })); }
    });
  });
}

/** Owns GPU allocation and submission; frame preparation completes every instance upload before publication. */
export class ModelRenderer {
  private programs = new Map<string, WebGLProgram>();
  private generation = 0;
  private destroyed = false;
  constructor(private gl: WebGL2RenderingContext, private measurement?: ModelMeasurement) {}
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
  async upload(model: ParsedModel, current: () => boolean, signal: AbortSignal): Promise<ModelGpu> {
    const gl = this.gl, measuredAttempt = this.measurement?.attempt(signal);
    if (this.destroyed || gl.isContextLost()) throw new Error('Model renderer unavailable.');
    const releases: (() => void)[] = [];
    const textures: WebGLTexture[] = [], samplers = new Map<string, WebGLSampler>();
    let released = false;
    const dispose = () => {
      if (released) return;
      released = true;
      for (const release of releases) release();
      releases.length = 0;
    };
    const active = () => { if (released || signal.aborted || !current() || this.destroyed || gl.isContextLost()) throw new Error('Model upload cancelled.'); };
    const own = <T>(value: T | null, release: (value: T) => void, name: string): T => {
      if (!value) throw new Error(`Cannot allocate model ${name}.`);
      // A native allocation boundary may reenter teardown before returning its new handle.
      if (released) { release(value); active(); }
      releases.push(() => release(value)); active(); return value;
    };
    const buffer = () => { active(); return own(gl.createBuffer(), value => gl.deleteBuffer(value), 'buffer'); };
    signal.addEventListener('abort', dispose, { once: true });
    try {
      for (let imageIndex = 0; imageIndex < model.images.length; imageIndex++) {
        const image = model.images[imageIndex]!;
        active();
        const decodeStart = this.measurement?.begin();
        let bitmap: ImageBitmap;
        try { bitmap = await decode(image, current, signal); }
        finally { if (decodeStart !== undefined) this.measurement!.end('decode-wall', decodeStart, { ...measuredAttempt, image: imageIndex, cancelled: signal.aborted }); }
        const uploadStart = this.measurement?.begin();
        const binding = gl.getParameter(gl.TEXTURE_BINDING_2D);
        try {
          active();
          const texture = own(gl.createTexture(), value => gl.deleteTexture(value), 'texture'); textures.push(texture);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          // glTF texture RGB is sRGB; its alpha stays linear and unpremultiplied.
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
          gl.generateMipmap(gl.TEXTURE_2D);
          const error = gl.getError();
          if (error !== gl.NO_ERROR) throw new Error(`Model texture upload failed with WebGL error ${error}.`);
        } finally {
          bitmap.close();
          // Reentrant removal may have deleted the formerly bound registration texture.
          gl.bindTexture(gl.TEXTURE_2D, binding && gl.isTexture(binding) ? binding : null);
          if (uploadStart !== undefined) this.measurement!.end('texture-upload', uploadStart, { ...measuredAttempt, image: imageIndex });
        }
      }
      const uploadStart = this.measurement?.begin();
      try {
      const batches = model.batches.map(batch => {
        active();
        let sampler: WebGLSampler | undefined;
        if (batch.material.sampler) {
          const { magFilter, minFilter, wrapS, wrapT } = batch.material.sampler;
          const key = [magFilter, minFilter, wrapS, wrapT].join(',');
          sampler = samplers.get(key);
          if (!sampler) {
            sampler = own(gl.createSampler(), value => gl.deleteSampler(value), 'sampler');
            samplers.set(key, sampler);
            for (const [parameter, value] of [[gl.TEXTURE_MAG_FILTER, magFilter], [gl.TEXTURE_MIN_FILTER, minFilter], [gl.TEXTURE_WRAP_S, wrapS], [gl.TEXTURE_WRAP_T, wrapT]] as const)
              gl.samplerParameteri(sampler, parameter, value);
          }
        }
        const vao = own(gl.createVertexArray(), value => gl.deleteVertexArray(value), 'vertex array');
        gl.bindVertexArray(vao);
        for (const [location, size, data] of [[0, 3, batch.positions], [1, 3, batch.normals], [2, 4, batch.colors], [8, 2, batch.uvs]] as const) {
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer()); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
          gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, batch.indices, gl.STATIC_DRAW);
        const instances = buffer(); gl.bindBuffer(gl.ARRAY_BUFFER, instances);
        for (const [location, size, offset] of [[3, 3, 0], [4, 3, 3], [5, 3, 6], [6, 4, 9], [7, 4, 13], [9, 1, 17]] as const) {
          gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE * 4, offset * 4); gl.vertexAttribDivisor(location, 1);
        }
        return { vao, instances, count: batch.indices.length, material: batch.material, sampler,
          texture: batch.material.texture === undefined ? undefined : textures[batch.material.texture] };
      });
      active();
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`Model upload failed with WebGL error ${error}.`);
      return { batches, get disposed() { return released; }, dispose };
      } finally { if (uploadStart !== undefined) this.measurement!.end('geometry-upload', uploadStart, measuredAttempt); }
    } catch (cause) { dispose(); throw cause; }
    finally { signal.removeEventListener('abort', dispose); gl.bindVertexArray(null); }
  }
  prepareFrame(input: CustomRenderMethodInput, projection: EntityProjection, draws: ModelDraw[]): PreparedModelFrame {
    const gl = this.gl, program = this.initialize(input), generation = ++this.generation;
    const preparationStart = this.measurement?.begin();
    const groups = new Map<RegisteredModel<ModelGpu>, number[]>();
    const prepared = draws.map(draw => {
      const values = groups.get(draw.asset) ?? [], offset = values.length / STRIDE;
      for (const instance of draw.instances) {
        const appearance = instance.appearance ?? draw.asset.definition.appearance;
        const color = Color.parse(appearance?.mode === 'color' ? appearance.color : '#ff00ff');
        if (!color) throw new Error('Invalid model appearance.');
        const [red, green, blue] = color.rgb;
        values.push(...instance.basis[0], ...instance.basis[1], ...instance.basis[2], ...instance.anchor,
          linear(red), linear(green), linear(blue), appearance?.mode === 'original' ? 1 : 0,
          instance.brightness ?? (instance.feedback === 'selected' ? .18 : instance.feedback === 'hover' ? .08 : 0));
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
    if (preparationStart !== undefined) this.measurement!.end('instance-preparation', preparationStart);
    return { draw: () => {
      if (this.destroyed || generation !== this.generation || gl.isContextLost()) return;
      const start = this.measurement?.begin();
      try {
        gl.useProgram(program); projection.bindFrame(gl, program);
        const uniform = (name: string) => gl.getUniformLocation(program, name);
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
        // Cut-outs write depth with solids. Supported translucency is deliberately unsorted.
        for (const translucent of [false, true]) {
          gl.depthMask(!translucent);
          if (translucent) { gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
          else gl.disable(gl.BLEND);
          for (const { asset, origin, offset, count } of prepared) {
            if (asset.resources.disposed) continue;
            projection.bindOrigin(gl, program, origin);
            const { min, max } = asset.model.bounds;
            gl.uniform3f(uniform('u_center'), (min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
            for (const batch of asset.resources.batches) {
              if ((batch.material.alphaMode === 'BLEND') !== translucent) continue;
              gl.bindVertexArray(batch.vao); gl.bindBuffer(gl.ARRAY_BUFFER, batch.instances);
              for (const [location, size, start] of [[3, 3, 0], [4, 3, 3], [5, 3, 6], [6, 4, 9], [7, 4, 13], [9, 1, 17]] as const)
                gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE * 4, (offset * STRIDE + start) * 4);
              gl.uniform4fv(uniform('u_base'), batch.material.baseColor); gl.uniform3fv(uniform('u_emissive'), batch.material.emissive);
              gl.uniform1i(uniform('u_unlit'), batch.material.unlit ? 1 : 0);
              gl.uniform1i(uniform('u_alphaMode'), batch.material.alphaMode === 'OPAQUE' ? 0 : batch.material.alphaMode === 'MASK' ? 1 : 2);
              gl.uniform1f(uniform('u_alphaCutoff'), batch.material.alphaCutoff);
              gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, batch.texture ?? null); gl.bindSampler(0, batch.sampler ?? null);
              gl.uniform1i(uniform('u_texture'), 0); gl.uniform1i(uniform('u_textured'), batch.texture ? 1 : 0);
              const transform = batch.material.uvTransform;
              gl.uniform4f(uniform('u_uv'), transform?.offset[0] ?? 0, transform?.offset[1] ?? 0, transform?.scale[0] ?? 1, transform?.scale[1] ?? 1);
              gl.uniform1f(uniform('u_rotation'), transform?.rotation ?? 0);
              if (batch.material.doubleSided) gl.disable(gl.CULL_FACE);
              else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW); }
              gl.drawElementsInstanced(gl.TRIANGLES, batch.count, gl.UNSIGNED_INT, 0, count);
            }
          }
        }
      } finally {
        gl.bindSampler(0, null); gl.bindVertexArray(null); gl.depthMask(true);
        if (start !== undefined) this.measurement!.end('submit', start);
      }
    } };
  }
  private compile(gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    const start = this.measurement?.begin();
    const program = gl.createProgram(); if (!program) throw new Error('Cannot allocate model program.');
    const shaders: WebGLShader[] = [];
    try {
      const vertex = `#version 300 es
precision highp float;
${input.shaderData.vertexShaderPrelude}
${input.shaderData.define}
layout(location=0) in vec3 a_position; layout(location=1) in vec3 a_normal; layout(location=2) in vec4 a_color;
layout(location=3) in vec3 i_rot0; layout(location=4) in vec3 i_rot1; layout(location=5) in vec3 i_rot2;
layout(location=6) in vec4 i_offset; layout(location=7) in vec4 i_color; layout(location=8) in vec2 a_uv;
layout(location=9) in float i_feedback;
uniform vec3 u_center;
out vec3 v_normal; out vec4 v_color; out vec4 v_instance; out vec2 v_uv; out float v_feedback;
${entityProjectionShader}
void main(){vec3 p=a_position-u_center;vec3 enu=i_rot0*p.x+i_rot1*p.y+i_rot2*p.z;
gl_Position=projectPosition(vec3(i_offset.xy+vec2(enu.x,-enu.y)*i_offset.w,i_offset.z+enu.z),i_offset.w);
v_normal=a_normal;v_color=a_color;v_instance=i_color;v_uv=a_uv;v_feedback=i_feedback;}`;
      const fragment = `#version 300 es
precision highp float;
in vec3 v_normal;in vec4 v_color;in vec4 v_instance;in vec2 v_uv;in float v_feedback;
uniform vec4 u_base;uniform vec3 u_emissive;uniform bool u_unlit;uniform bool u_textured;
uniform int u_alphaMode;uniform float u_alphaCutoff;
uniform sampler2D u_texture;uniform vec4 u_uv;uniform float u_rotation;out vec4 color;
vec3 srgb(vec3 v){return mix(12.92*v,1.055*pow(max(v,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),v));}
void main(){float light=u_unlit?1.:.52+.48*max(0.,dot(normalize(gl_FrontFacing?v_normal:-v_normal),normalize(vec3(-.4,.8,.5))));
float c=cos(u_rotation),s=sin(u_rotation);vec2 uv=u_uv.xy+mat2(c,s,-s,c)*(v_uv*u_uv.zw);
vec4 texel=u_textured?texture(u_texture,uv):vec4(1.);
float alpha=u_base.a*v_color.a*texel.a;if(u_alphaMode==1&&alpha<u_alphaCutoff)discard;
vec3 rgb=v_instance.w>.5?u_base.rgb*v_color.rgb*texel.rgb*light+(u_unlit?vec3(0.):u_emissive):v_instance.rgb*light;
color=vec4(srgb(mix(rgb,vec3(1.),v_feedback)),u_alphaMode==2?alpha:1.);}`;
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
    finally {
      for (const shader of shaders) gl.deleteShader(shader);
      if (start !== undefined) this.measurement!.end('shader-compile', start, { variant: input.shaderData.variantName });
    }
  }
}
