import { MercatorCoordinate } from 'maplibre-gl';
import type { CustomLayerInterface, ImageSource, Map as GLMap } from 'maplibre-gl';
import type { CameraAttachment } from './types';
import type { Primitive } from './entity-layer';
import { cameraDefaults } from './camera-volume';
import type { CameraVolume } from './camera-volume';
import type { GeoPoint } from './entity-geometry';
import { TERRAIN_CELLS, terrainCoordinates, cameraRangeBounds } from './gpu-camera-terrain';
import type { CameraTerrain } from './gpu-camera-terrain';
import { SENSOR_SIZE, COVERAGE_SIZE, DISPLAY_SIZE, depthVertex, depthFragment, coverageVertex, coverageFragment, voteVertex, voteFragment, boundaryFragment, smoothRegionFragment, regionStyleFragment } from './gpu-camera-shaders';
import { parseColor } from './color';

export type GpuCamera = {
  entityId: string;
  camera: CameraAttachment;
  /** Owner lifecycle token used to reject completions from a removed attachment. */
  lifecycle: number;
  origin: GeoPoint;
  terrain: CameraTerrain;
  volume: CameraVolume;
  geometry: Primitive[];
};
type Camera = {
  value: GpuCamera;
  source: string;
  image: ImageData;
  dirty: boolean;
  // Historical displays stay visible without submitting discarded terrain.
  renderable: boolean;
  analysisKey?: string;
  analysisTerrain?: CameraTerrain;
  regionFrame?: WebGLFramebuffer;
  regionTexture?: WebGLTexture;
  submitted?: { value: GpuCamera };
  uploaded?: CameraTerrain;
  published?: GpuCamera;
  buffer?: WebGLBuffer;
  pending?: WebGLSync;
  pixels?: WebGLBuffer;
};
// Geometry and appearance have separate lifetimes. New object identities alone do not
// invalidate sensor depth, and changing opacity must never change visibility.
function analysisKey({ origin, camera, volume }: GpuCamera) {
  return JSON.stringify([origin, camera.bearing, camera.elevation, camera.fovX, camera.fovY, camera.range, volume.offsets]);
}
function appearanceKey({ camera }: Pick<GpuCamera, 'camera'>) {
  return JSON.stringify([camera.color, camera.fillOpacity, camera.blockedColor, camera.blockedOpacity, camera.outline, camera.outlineWidth,
    camera.volumeOpacity, camera.wireframe, camera.wireframeWidth]);
}
function cameraKey({ entityId, camera }: GpuCamera) {
  return JSON.stringify([entityId, camera.id]);
}
export function sameCameraAppearance(a: Pick<GpuCamera, 'camera'>, b: Pick<GpuCamera, 'camera'>) {
  return appearanceKey(a) === appearanceKey(b);
}
export function sameCamera(a: GpuCamera, b: GpuCamera) {
  return a.terrain === b.terrain && analysisKey(a) === analysisKey(b)
    && appearanceKey(a) === appearanceKey(b) && JSON.stringify(a.geometry) === JSON.stringify(b.geometry);
}
function program(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const p = gl.createProgram(); if (!p) throw new Error('Cannot allocate camera shader.');
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(type); if (!shader) throw new Error('Cannot allocate camera shader.');
      gl.shaderSource(shader, source); gl.compileShader(shader); gl.attachShader(p, shader); gl.deleteShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Camera shader failed.');
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'Camera shader link failed.');
    return p;
  } catch (error) { gl.deleteProgram(p); throw error; }
}

/** Sensor depth stays on the GPU. A small RGBA mask bridges into MapLibre's terrain-draped raster layers. */
export class GpuCameras implements CustomLayerInterface {
  readonly id = 'rl:camera-gpu';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  private cameras = new Map<string, Camera>();
  private sequence = 0;
  private gl?: WebGL2RenderingContext;
  private vao?: WebGLVertexArrayObject;
  private depthProgram?: WebGLProgram;
  private maskProgram?: WebGLProgram;
  private voteProgram?: WebGLProgram;
  private boundaryProgram?: WebGLProgram;
  private styleProgram?: WebGLProgram;
  private smoothProgram?: WebGLProgram;
  private rawRegionFrame?: WebGLFramebuffer;
  private rawRegionTexture?: WebGLTexture;
  private voteFrame?: WebGLFramebuffer;
  private voteTexture?: WebGLTexture;
  private sampleFrame?: WebGLFramebuffer;
  private sampleTexture?: WebGLTexture;
  private sensorFrame?: WebGLFramebuffer;
  private sensorDepth?: WebGLTexture;
  private sensorLinear?: WebGLTexture;
  private terrainIndices?: WebGLBuffer;
  private maskFrame?: WebGLFramebuffer;
  private maskTexture?: WebGLTexture;
  private failed = false;

  constructor(
    private map: GLMap,
    private completed: (value: GpuCamera, publish: () => void) => boolean,
    private report: (cause: unknown) => void,
  ) {}

  set(values: GpuCamera[], retained: readonly GpuCamera[] = []) {
    const active = new Set<string>();
    const requested = new Set<string>();
    for (const value of values) {
      const key = cameraKey(value); active.add(key); requested.add(key);
      let item = this.cameras.get(key);
      if (!item) {
        item = { value, source: `rl:camera-mask:${++this.sequence}`, image: new ImageData(DISPLAY_SIZE, DISPLAY_SIZE),
          dirty: true, renderable: true };
        this.cameras.set(key, item);
      }
      item.renderable = true;
      if (item.value !== value) {
        item.dirty ||= item.value.lifecycle !== value.lifecycle || !sameCamera(item.value, value);
        item.value = value;
      }
      this.attachMask(item);
    }
    for (const value of retained) {
      const key = cameraKey(value); active.add(key);
      if (requested.has(key)) continue;
      const item = this.cameras.get(key);
      if (item) {
        item.published ??= value;
        this.attachMask(item, item.published);
        this.map.getSource<ImageSource>(item.source)?.updateImage({ image: item.image, coordinates: terrainCoordinates(item.published.terrain) });
        item.renderable = false;
        item.dirty = false;
      }
    }
    for (const [key, item] of this.cameras) if (!active.has(key)) {
      this.removeMask(item); this.release(item); this.cameras.delete(key);
    }
    if (this.cameras.size) this.ensureLayer();
    else if (this.map.getLayer(this.id)) this.map.removeLayer(this.id);
    if (values.length || [...this.cameras.values()].some(item => item.pending)) this.map.triggerRepaint();
  }
  attach() {
    for (const item of this.cameras.values()) this.attachMask(item);
    this.ensureLayer();
  }
  private ensureLayer() {
    if (!this.cameras.size || (!this.map.isStyleLoaded() && !this.map.getLayer('rl:points')) || this.map.getLayer(this.id)) return;
    this.map.addLayer(this);
  }
  private attachMask(item: Camera, value = item.value) {
    if (!this.map.isStyleLoaded() && !this.map.getLayer('rl:points')) return;
    if (!value.terrain.ready) { this.removeMask(item); return; }
    if (!this.map.getSource(item.source)) {
      this.map.addSource(item.source, { type: 'image', coordinates: terrainCoordinates(value.terrain) });
      this.map.addLayer({ id: item.source, type: 'raster', source: item.source,
        paint: { 'raster-opacity': 1, 'raster-opacity-transition': {duration:0,delay:0}, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, 'rl:points');
      item.dirty = true;
    }
  }
  private removeMask(item: Camera) {
    if (this.map.getLayer(item.source)) this.map.removeLayer(item.source);
    if (this.map.getSource(item.source)) this.map.removeSource(item.source);
  }
  onAdd(_map: GLMap, gl: WebGL2RenderingContext) {
    this.gl = gl; this.failed = false;
    this.map.on('render', this.publish);
    const restore = this.saveState();
    try {
      this.vao = gl.createVertexArray()!;
      this.depthProgram = program(gl, depthVertex, depthFragment);
      this.maskProgram = program(gl, coverageVertex, coverageFragment);
      this.voteProgram = program(gl, voteVertex, voteFragment);
      this.boundaryProgram = program(gl, coverageVertex, boundaryFragment);
      this.smoothProgram = program(gl, voteVertex, smoothRegionFragment);
      this.styleProgram = program(gl, voteVertex, regionStyleFragment);
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('GPU visibility requires floating-point render targets.');
      const previous = gl.getParameter(gl.VERTEX_ARRAY_BINDING); gl.bindVertexArray(this.vao);
      this.terrainIndices = gl.createBuffer()!;
      const terrain: number[] = [];
      for (let y = 0; y < TERRAIN_CELLS; y++) for (let x = 0; x < TERRAIN_CELLS; x++) {
        const a = y * (TERRAIN_CELLS + 1) + x, b = a + 1, c = a + TERRAIN_CELLS + 1;
        terrain.push(a, b, c, b, c + 1, c);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.terrainIndices); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(terrain), gl.STATIC_DRAW);
      [this.rawRegionFrame, this.rawRegionTexture] = this.colorTarget(DISPLAY_SIZE);
      [this.maskFrame, this.maskTexture] = this.colorTarget(DISPLAY_SIZE);
      [this.voteFrame, this.voteTexture] = this.colorTarget(COVERAGE_SIZE);
      [this.sampleFrame, this.sampleTexture] = this.colorTarget(COVERAGE_SIZE * 3);
      [this.sensorFrame, this.sensorDepth, this.sensorLinear] = this.sensorTarget();
      gl.bindTexture(gl.TEXTURE_2D,this.sampleTexture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.bindVertexArray(previous); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (const item of this.cameras.values()) item.dirty = item.renderable;
    } catch (error) { this.fail(error); }
    finally { restore(); }
  }
  private colorTarget(size: number): [WebGLFramebuffer, WebGLTexture] {
    const gl = this.gl!, frame = gl.createFramebuffer(), texture = gl.createTexture();
    try {
      if (!frame || !texture) throw new Error('Cannot allocate camera framebuffer.');
      gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, frame); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Camera framebuffer is incomplete.');
      return [frame, texture];
    } catch (error) {
      gl.deleteFramebuffer(frame); gl.deleteTexture(texture);
      throw error;
    }
  }
  private sensorTarget(): [WebGLFramebuffer, WebGLTexture, WebGLTexture] {
    const gl = this.gl!, frame = gl.createFramebuffer(), depth = gl.createTexture(), linear = gl.createTexture();
    try {
      if (!frame || !depth || !linear) throw new Error('Cannot allocate camera sensor target.');
      gl.bindTexture(gl.TEXTURE_2D, depth);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SENSOR_SIZE, SENSOR_SIZE, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, linear);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, SENSOR_SIZE, SENSOR_SIZE, 0, gl.RED, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, linear, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Sensor depth framebuffer is incomplete.');
      return [frame, depth, linear];
    } catch (error) {
      gl.deleteFramebuffer(frame); gl.deleteTexture(depth); gl.deleteTexture(linear);
      throw error;
    }
  }
  private prepare(item: Camera) {
    const gl = this.gl!;
    if (!item.regionFrame) {
      [item.regionFrame, item.regionTexture] = this.colorTarget(DISPLAY_SIZE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    if (!item.buffer) {
      item.buffer = gl.createBuffer()!;
      item.pixels=gl.createBuffer()!;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER,item.pixels);
      gl.bufferData(gl.PIXEL_PACK_BUFFER,DISPLAY_SIZE*DISPLAY_SIZE*4,gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
    }
    if (item.uploaded !== item.value.terrain) {
      gl.bindBuffer(gl.ARRAY_BUFFER, item.buffer); gl.bufferData(gl.ARRAY_BUFFER, item.value.terrain.vertices, gl.STATIC_DRAW); item.uploaded = item.value.terrain;
    }
  }
  prerender() {
    if (!this.gl || this.failed) return;
    const gl = this.gl, restore = this.saveState();
    try {
      gl.bindVertexArray(this.vao!); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);
      gl.colorMask(true, true, true, true); gl.depthRange(0, 1); gl.depthFunc(gl.LEQUAL); gl.activeTexture(gl.TEXTURE0);
      for (const item of this.cameras.values()) {
        if (item.pending) { this.map.triggerRepaint(); continue; }
        if (!item.renderable || !item.dirty || !item.value.terrain.ready) continue;
        this.prepare(item);
        const analysis = analysisKey(item.value);
        if (analysis !== item.analysisKey || item.analysisTerrain !== item.value.terrain) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.sensorFrame!); gl.viewport(0, 0, SENSOR_SIZE, SENSOR_SIZE);
          gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT); gl.clearBufferfv(gl.COLOR,0,new Float32Array([item.value.camera.range,0,0,0])); gl.bindTexture(gl.TEXTURE_2D, null);
          this.uniforms(this.depthProgram!, item); this.bind(item.buffer!); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.terrainIndices!);
          gl.drawElements(gl.TRIANGLES, TERRAIN_CELLS ** 2 * 6, gl.UNSIGNED_INT, 0);
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.sampleFrame!);
          gl.activeTexture(gl.TEXTURE0);
          gl.viewport(0, 0, COVERAGE_SIZE * 3, COVERAGE_SIZE * 3);
          gl.disable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
          gl.bindTexture(gl.TEXTURE_2D, this.sensorLinear!); this.uniforms(this.maskProgram!, item);
          this.clipRange(item, COVERAGE_SIZE * 3);
          gl.drawElements(gl.TRIANGLES, TERRAIN_CELLS ** 2 * 6, gl.UNSIGNED_INT, 0);
          gl.disable(gl.SCISSOR_TEST);
          gl.bindFramebuffer(gl.FRAMEBUFFER,this.voteFrame!);
          gl.viewport(0,0,COVERAGE_SIZE,COVERAGE_SIZE);
          gl.bindTexture(gl.TEXTURE_2D,this.sampleTexture!);
          gl.useProgram(this.voteProgram!);
          gl.uniform1i(gl.getUniformLocation(this.voteProgram!,'u_samples'),0);
          gl.drawArrays(gl.TRIANGLES,0,3);
          gl.bindFramebuffer(gl.FRAMEBUFFER,this.rawRegionFrame!);
          gl.viewport(0,0,DISPLAY_SIZE,DISPLAY_SIZE);
          gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.voteTexture!);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D,this.sensorLinear!);
          this.uniforms(this.boundaryProgram!,item);
          gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
          gl.uniform1i(gl.getUniformLocation(this.boundaryProgram!,'u_votes'),1);
          gl.uniform2f(gl.getUniformLocation(this.boundaryProgram!,'u_outputSize'),DISPLAY_SIZE,DISPLAY_SIZE);
          this.clipRange(item, DISPLAY_SIZE);
          gl.drawElements(gl.TRIANGLES,TERRAIN_CELLS ** 2 * 6,gl.UNSIGNED_INT,0);
          gl.disable(gl.SCISSOR_TEST);
          gl.bindFramebuffer(gl.FRAMEBUFFER,item.regionFrame!);
          gl.bindTexture(gl.TEXTURE_2D,this.rawRegionTexture!);
          gl.useProgram(this.smoothProgram!);
          gl.uniform1i(gl.getUniformLocation(this.smoothProgram!,'u_regions'),0);
          gl.drawArrays(gl.TRIANGLES,0,3);
          item.analysisKey = analysis;
          item.analysisTerrain = item.value.terrain;
        }
        // Appearance edits reuse this camera's measured coverage, including its contour.
        gl.disable(gl.DEPTH_TEST);
        gl.viewport(0,0,DISPLAY_SIZE,DISPLAY_SIZE);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.maskFrame!);
        gl.bindTexture(gl.TEXTURE_2D,item.regionTexture!);
        gl.useProgram(this.styleProgram!);
        gl.uniform1i(gl.getUniformLocation(this.styleProgram!,'u_regions'),0);
        gl.uniform1f(gl.getUniformLocation(this.styleProgram!,'u_borderWidth'),(item.value.camera.outline??cameraDefaults.outline)?(item.value.camera.outlineWidth??cameraDefaults.outlineWidth)/2:0);
        gl.uniform4fv(gl.getUniformLocation(this.styleProgram!,'u_color'),parseColor(item.value.camera.color??cameraDefaults.visibleMaskColor,item.value.camera.fillOpacity??cameraDefaults.fillOpacity,{contextBehavior:'throw'}));
        gl.uniform4fv(gl.getUniformLocation(this.styleProgram!,'u_blocked'),parseColor(item.value.camera.blockedColor??cameraDefaults.blockedMaskColor,item.value.camera.blockedOpacity??cameraDefaults.blockedOpacity,{contextBehavior:'throw'}));
        gl.drawArrays(gl.TRIANGLES,0,3);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER,item.pixels!);
        gl.readPixels(0, 0, DISPLAY_SIZE, DISPLAY_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
        item.submitted={value:item.value};
        item.pending=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0)!;
        gl.flush();this.map.triggerRepaint();
        item.dirty = false;
      }
    } catch (error) { this.fail(error); }
    finally { restore(); }
  }
  // Publish after drawing, so MapLibre uploads the image and matching geometry together
  // during the next frame. Publishing in prerender leaves the raster one upload behind.
  private publish = () => {
    if (!this.gl || this.failed) return;
    const gl=this.gl,restore=this.saveState();
    try {
      for(const item of this.cameras.values()) {
        if (item.pending) {
          const status=gl.clientWaitSync(item.pending,0,0);
          if (status===gl.WAIT_FAILED) throw new Error('Camera GPU transfer failed.');
          if (status===gl.TIMEOUT_EXPIRED) { this.map.triggerRepaint(); continue; }
          gl.deleteSync(item.pending);item.pending=undefined;
          const submitted = item.submitted!;
          item.submitted = undefined;
          // A completed frame belongs to its submitted terrain and style, not the latest input.
          if (submitted.value.terrain.ready && this.map.getSource(item.source)) {
            this.completed(submitted.value, () => {
              gl.bindBuffer(gl.PIXEL_PACK_BUFFER,item.pixels!);
              gl.getBufferSubData(gl.PIXEL_PACK_BUFFER,0,new Uint8Array(item.image.data.buffer));
              gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
              this.map.getSource<ImageSource>(item.source)?.updateImage({image:item.image,coordinates:terrainCoordinates(submitted.value.terrain)});
              item.published=submitted.value;
            });
          }
        }
      }
    } catch(error) { this.fail(error); }
    finally { restore(); }
  };
  private clipRange(item: Camera, size: number) {
    const gl = this.gl!;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(...cameraRangeBounds(item.value.terrain, item.value.origin, item.value.camera.range, size));
  }
  render() {}
  private uniforms(p: WebGLProgram, item: Camera) {
    const gl = this.gl!, { origin, terrain, camera } = item.value;
    const position = MercatorCoordinate.fromLngLat([origin[0], origin[1]]), b = camera.bearing * Math.PI / 180, e = camera.elevation * Math.PI / 180;
    let dx = position.x - terrain.centre.x; dx -= Math.round(dx);
    gl.useProgram(p); const u = (name: string) => gl.getUniformLocation(p, name);
    gl.uniform3f(u('u_sensor'), dx / terrain.scale, (terrain.centre.y - position.y) / terrain.scale, origin[2]);
    gl.uniform3f(u('u_forward'), Math.sin(b) * Math.cos(e), Math.cos(b) * Math.cos(e), Math.sin(e));
    gl.uniform3f(u('u_right'), Math.cos(b), -Math.sin(b), 0);
    gl.uniform3f(u('u_up'), -Math.sin(b) * Math.sin(e), -Math.cos(b) * Math.sin(e), Math.cos(e));
    gl.uniform2f(u('u_tan'), Math.tan(camera.fovX * Math.PI / 360), Math.tan(camera.fovY * Math.PI / 360));
    gl.uniform1f(u('u_range'), camera.range); gl.uniform1f(u('u_near'), Math.min(1, camera.range / 1000));
    gl.uniform4fv(u('u_cap'), item.value.volume.cap);
    gl.uniform1f(u('u_half'), terrain.half);
    gl.uniform1i(u('u_depth'), 0);
  }
  private bind(buffer: WebGLBuffer) {
    const gl = this.gl!; gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
  }
  pick(x: number, y: number) {
    const point = MercatorCoordinate.fromLngLat(this.map.unproject([x, y]));
    return [...this.cameras.values()].flatMap(item => {
      const published = item.published;
      const terrain = published?.terrain;
      if (!terrain) return [];
      let dx = point.x-terrain.centre.x; dx -= Math.round(dx);
      const px = Math.floor((dx/terrain.scale/terrain.half+1)*.5*DISPLAY_SIZE);
      const py = Math.floor(((point.y-terrain.centre.y)/terrain.scale/terrain.half+1)*.5*DISPLAY_SIZE);
      return px>=0 && py>=0 && px<DISPLAY_SIZE && py<DISPLAY_SIZE && item.image.data[(py*DISPLAY_SIZE+px)*4+3]!>0
        ? [{entityId:published.entityId,attachmentId:published.camera.id}] : [];
    });
  }
  private saveState() {
    const gl = this.gl!, frame = gl.getParameter(gl.FRAMEBUFFER_BINDING), viewport = gl.getParameter(gl.VIEWPORT), range = gl.getParameter(gl.DEPTH_RANGE);
    const scissor = gl.getParameter(gl.SCISSOR_BOX);
    const vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING), p = gl.getParameter(gl.CURRENT_PROGRAM), buffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    const pack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
    const active = gl.getParameter(gl.ACTIVE_TEXTURE); gl.activeTexture(gl.TEXTURE0); const texture = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.activeTexture(gl.TEXTURE1);const secondaryTexture=gl.getParameter(gl.TEXTURE_BINDING_2D);gl.activeTexture(gl.TEXTURE0);
    const flags = [gl.DEPTH_TEST, gl.BLEND, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST].map(flag => [flag, gl.isEnabled(flag)] as const);
    const mask = gl.getParameter(gl.DEPTH_WRITEMASK), func = gl.getParameter(gl.DEPTH_FUNC), colorMask = gl.getParameter(gl.COLOR_WRITEMASK);
    const blend = [gl.BLEND_SRC_RGB, gl.BLEND_DST_RGB, gl.BLEND_SRC_ALPHA, gl.BLEND_DST_ALPHA].map(key => gl.getParameter(key));
    const clearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE), clearDepth = gl.getParameter(gl.DEPTH_CLEAR_VALUE);
    return () => {
      gl.scissor(...scissor as [number, number, number, number]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, frame); gl.viewport(...viewport as [number, number, number, number]); gl.depthRange(range[0], range[1]);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pack);
      gl.bindVertexArray(vao); gl.useProgram(p); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,secondaryTexture);gl.activeTexture(active);
      for (const [flag, enabled] of flags) { if (enabled) gl.enable(flag); else gl.disable(flag); }
      gl.depthMask(mask); gl.depthFunc(func); gl.colorMask(colorMask[0], colorMask[1], colorMask[2], colorMask[3]);
      gl.blendFuncSeparate(blend[0], blend[1], blend[2], blend[3]); gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]); gl.clearDepth(clearDepth);
    };
  }
  private fail(cause: unknown) { this.failed = true; this.report(cause); }
  private release(item: Camera, preservePublished = false) {
    const gl = this.gl; if (!gl) return;
    if(item.pending)gl.deleteSync(item.pending);if(item.pixels)gl.deleteBuffer(item.pixels);
    if(item.regionFrame)gl.deleteFramebuffer(item.regionFrame);
    if(item.regionTexture)gl.deleteTexture(item.regionTexture);
    item.regionFrame=undefined;item.regionTexture=undefined;
    item.analysisKey=undefined;item.analysisTerrain=undefined;item.submitted=undefined;
    if (!preservePublished) item.published=undefined;
    item.pending=undefined;item.pixels=undefined;
    if (item.buffer) gl.deleteBuffer(item.buffer);
    item.buffer = undefined; item.uploaded = undefined; item.dirty = true;
  }
  onRemove() {
    this.map.off('render', this.publish);
    const gl = this.gl; if (!gl) return;
    for (const item of this.cameras.values()) this.release(item, true);
    for (const p of [this.depthProgram, this.maskProgram, this.voteProgram, this.boundaryProgram, this.smoothProgram, this.styleProgram]) if (p) gl.deleteProgram(p);
    for (const b of [this.terrainIndices]) if (b) gl.deleteBuffer(b);
    for (const f of [this.maskFrame, this.sampleFrame, this.voteFrame, this.rawRegionFrame]) if (f) gl.deleteFramebuffer(f);
    for (const t of [this.maskTexture, this.sampleTexture, this.voteTexture, this.rawRegionTexture]) if (t) gl.deleteTexture(t);
    if (this.sensorFrame) gl.deleteFramebuffer(this.sensorFrame);
    if (this.sensorDepth) gl.deleteTexture(this.sensorDepth);
    if (this.sensorLinear) gl.deleteTexture(this.sensorLinear);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.depthProgram = undefined; this.maskProgram = undefined; this.voteProgram = undefined;
    this.boundaryProgram = undefined; this.smoothProgram = undefined; this.styleProgram = undefined;
    this.terrainIndices = undefined;
    this.maskFrame = undefined; this.sampleFrame = undefined; this.voteFrame = undefined; this.rawRegionFrame = undefined;
    this.maskTexture = undefined; this.sampleTexture = undefined; this.voteTexture = undefined; this.rawRegionTexture = undefined;
    this.sensorFrame = undefined; this.sensorDepth = undefined; this.sensorLinear = undefined;
    this.vao = undefined; this.gl = undefined;
  }
  retry() {
    if (!this.failed) return;
    if (this.map.getLayer(this.id)) this.map.removeLayer(this.id);
    this.attach();
  }
  destroy() {
    for (const item of this.cameras.values()) this.removeMask(item);
    if (this.map.getLayer(this.id)) this.map.removeLayer(this.id);
    this.onRemove();
    this.cameras.clear();
  }
}
