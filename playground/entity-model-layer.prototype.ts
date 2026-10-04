import { MercatorCoordinate } from 'maplibre-gl';
import type { CustomLayerInterface, CustomRenderMethodInput, Map as GLMap } from 'maplibre-gl';
import { clipEntityPosition, clipEntityPolygon, entityScreenPoint, entityProjectionShader, nearestWorldCopy, projectEntityPosition, shiftedProjection } from '../src/entity-projection';
import type { ScreenPoint } from '../src/entity-projection';
import type { ModelBatch, ModelMaterial, ParsedModel, Vec3 } from './entity-model-glb.prototype';

export type RegisteredModel = { model: ParsedModel; images: ImageBitmap[]; metersPerUnit: number; headingOffset: number };
export type ModelEntity = { id: string; modelId: string; lng: number; lat: number; height: number; heading?: number; pitch?: number; roll?: number; grounded?: boolean; tint?: Vec3; selected?: boolean; hovered?: boolean };
export type ModelOptions = { sizeMode: 'enlarged' | 'real'; targetPixels: number; thresholdMeters: number; deadZoneMeters: number; transition: 'instant' | 'fade'; tint: boolean; treatment: 'ring' | 'box' | 'bright'; slope: boolean };
export type ProjectedModelBox = { entityId: string; corners: ScreenPoint[]; clippedFaces: ScreenPoint[][]; center: ScreenPoint; minX: number; minY: number; maxX: number; maxY: number; depth: number; scale: number; cameraDistance: number; opacity: number; selected: boolean; hovered: boolean };
type GpuBatch = { vao: WebGLVertexArrayObject; buffers: WebGLBuffer[]; instances: WebGLBuffer; count: number; material: ModelMaterial; mode: number };
type GpuModel = { batches: GpuBatch[]; box: GpuBatch; ring: GpuBatch; textures: WebGLTexture[] };
type Program = { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> };
type TimerExtension = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
const radians = (degrees: number) => degrees * Math.PI / 180;
const instanceStride = 18;
const faces = [[0,1,3],[0,3,2],[4,6,7],[4,7,5],[0,4,5],[0,5,1],[2,3,7],[2,7,6],[0,2,6],[0,6,4],[1,5,7],[1,7,3]];

/** Throwaway renderer for #76. It shares projection and world-copy handling with EntityLayer. */
export class ModelLayer implements CustomLayerInterface {
  readonly id = 'rl:entity-models-prototype';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  readonly options: ModelOptions = { sizeMode: 'enlarged', targetPixels: 56, thresholdMeters: 2000, deadZoneMeters: 200, transition: 'instant', tint: false, treatment: 'ring', slope: false };
  readonly metrics = { cpuPassMs: 0, renderSubmitMs: 0, gpuMs: null as number | null, gpuSequence: 0, drawCalls: 0, instances: 0, triangles: 0, frames: 0, uploads: 0, uploadMs: 0, contextRestores: 0, programCompiles: 0 };
  projectedBoxes: ProjectedModelBox[] = [];
  private map?: GLMap;
  private gl?: WebGL2RenderingContext;
  private models = new Map<string, RegisteredModel>();
  private entities: ModelEntity[] = [];
  private gpuModels = new Map<string, GpuModel>();
  private programs = new Map<string, Program>();
  private states = new Map<string, { near: boolean; opacity: number; time: number }>();
  private reportedHeading = new Set<string>();
  private projection?: CustomRenderMethodInput;
  private timerExtension?: TimerExtension;
  private timerQueries: { query: WebGLQuery; sequence: number }[] = [];
  private completedGpuTimes: { sequence: number; gpuMs: number }[] = [];
  private querySequence = 0;
  private canvas?: HTMLCanvasElement;
  constructor(private report: (cause: unknown) => void, private visibility: (id: string, modelOpacity: number) => void) {}
  setModels(models: Map<string, RegisteredModel>) {
    if (this.models !== models) this.releaseModels();
    this.models = models;
    this.map?.triggerRepaint();
  }
  setEntities(entities: ModelEntity[]) {
    const retained = new Set(entities.map(entity => entity.id));
    for (const previous of this.entities) if (!retained.has(previous.id)) {
      this.visibility(previous.id, 0);
      this.states.delete(previous.id);
      this.reportedHeading.delete(previous.id);
    }
    this.entities = entities;
    this.projectedBoxes = this.projectedBoxes.filter(box => retained.has(box.entityId));
    this.map?.triggerRepaint();
  }
  setOptions(options: Partial<ModelOptions>) { Object.assign(this.options, options); this.map?.triggerRepaint(); }
  private contextLost = () => {
    this.gpuModels.clear(); this.programs.clear(); this.timerQueries = []; this.completedGpuTimes = []; this.metrics.gpuMs = null; this.projection = undefined;
  };
  private contextRestored = () => {
    this.metrics.contextRestores++;
    this.contextLost();
    if (this.gl) this.acquireTimerExtension(this.gl);
    this.map?.triggerRepaint();
  };
  onAdd(map: GLMap, gl: WebGL2RenderingContext) {
    if (this.gl && this.gl !== gl) this.dispose();
    this.map = map; this.gl = gl;
    const canvas = map.getCanvas();
    if (this.canvas !== canvas) {
      this.canvas?.removeEventListener('webglcontextlost', this.contextLost);
      this.canvas?.removeEventListener('webglcontextrestored', this.contextRestored);
      this.canvas = canvas;
      canvas.addEventListener('webglcontextlost', this.contextLost);
      canvas.addEventListener('webglcontextrestored', this.contextRestored);
    }
    this.acquireTimerExtension(gl);
  }
  private acquireTimerExtension(gl: WebGL2RenderingContext) {
    this.timerExtension = undefined;
    const extension: unknown = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (extension && typeof extension === 'object' && 'TIME_ELAPSED_EXT' in extension && 'GPU_DISJOINT_EXT' in extension && typeof extension.TIME_ELAPSED_EXT === 'number' && typeof extension.GPU_DISJOINT_EXT === 'number')
      this.timerExtension = { TIME_ELAPSED_EXT: extension.TIME_ELAPSED_EXT, GPU_DISJOINT_EXT: extension.GPU_DISJOINT_EXT };
  }
  // A style rebuild detaches this layer but retains its context-owned model cache.
  onRemove() { this.map = undefined; this.projection = undefined; this.projectedBoxes = []; }
  dispose() {
    this.releaseModels();
    for (const program of this.programs.values()) this.gl?.deleteProgram(program.program);
    for (const pending of this.timerQueries) this.gl?.deleteQuery(pending.query);
    this.programs.clear(); this.timerQueries = []; this.completedGpuTimes = [];
    this.canvas?.removeEventListener('webglcontextlost', this.contextLost);
    this.canvas?.removeEventListener('webglcontextrestored', this.contextRestored);
    this.canvas = undefined; this.map = undefined; this.gl = undefined;
  }
  private releaseModels() {
    for (const model of this.gpuModels.values()) {
      for (const batch of [...model.batches, model.box, model.ring]) {
        this.gl?.deleteVertexArray(batch.vao);
        for (const buffer of batch.buffers) this.gl?.deleteBuffer(buffer);
        this.gl?.deleteBuffer(batch.instances);
      }
      for (const texture of model.textures) this.gl?.deleteTexture(texture);
    }
    this.gpuModels.clear();
  }
  getMetrics() { this.pollTimers(); return { ...this.metrics }; }
  drainGpuTimes() {
    this.pollTimers();
    return this.completedGpuTimes.splice(0);
  }
  private pollTimers() {
    const gl = this.gl, extension = this.timerExtension;
    if (!gl || !extension) return;
    const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT);
    const remaining: typeof this.timerQueries = [];
    for (const pending of this.timerQueries) {
      if (disjoint || gl.getQueryParameter(pending.query, gl.QUERY_RESULT_AVAILABLE)) {
        if (!disjoint) {
          const gpuMs = Number(gl.getQueryParameter(pending.query, gl.QUERY_RESULT)) / 1e6;
          this.metrics.gpuMs = gpuMs;
          this.metrics.gpuSequence = pending.sequence;
          this.completedGpuTimes.push({ sequence: pending.sequence, gpuMs });
          if (this.completedGpuTimes.length > 600) this.completedGpuTimes.shift();
        }
        gl.deleteQuery(pending.query);
      } else remaining.push(pending);
    }
    if (disjoint) { this.metrics.gpuMs = null; this.completedGpuTimes = []; }
    this.timerQueries = remaining;
  }
  private compile(gl: WebGL2RenderingContext, input: CustomRenderMethodInput): Program {
    const vertex = `#version 300 es
precision highp float;
${input.shaderData.vertexShaderPrelude}
${input.shaderData.define}
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_normal;
layout(location=2) in vec2 a_uv;
layout(location=3) in vec4 a_color;
layout(location=4) in vec3 i_rot0;
layout(location=5) in vec3 i_rot1;
layout(location=6) in vec3 i_rot2;
layout(location=7) in vec4 i_offset;
layout(location=8) in vec4 i_tint;
layout(location=9) in float i_effect;
uniform vec3 u_mesh_center;
out vec3 v_normal; out vec2 v_uv; out vec4 v_color; out vec4 v_tint; out float v_effect;
${entityProjectionShader}
void main(){
 vec3 p=a_position-u_mesh_center;
 vec3 enu=i_rot0*p.x+i_rot1*p.y+i_rot2*p.z;
 gl_Position=projectPosition(vec3(i_offset.xy+vec2(enu.x,-enu.y)*i_offset.w,i_offset.z+enu.z),i_offset.w);
 v_normal=a_normal; v_uv=a_uv; v_color=a_color; v_tint=i_tint; v_effect=i_effect;
}`;
    const fragment = `#version 300 es
precision highp float;
in vec3 v_normal; in vec2 v_uv; in vec4 v_color; in vec4 v_tint; in float v_effect;
uniform vec4 u_base; uniform vec3 u_emissive; uniform sampler2D u_texture;
uniform bool u_textured; uniform bool u_unlit; uniform int u_alpha_mode; uniform float u_cutoff;
uniform vec2 u_uv_offset; uniform vec2 u_uv_scale; uniform float u_uv_rotation;
out vec4 color;
void main(){
 vec2 uv=v_uv*u_uv_scale;
 float c=cos(u_uv_rotation),s=sin(u_uv_rotation);
 uv=mat2(c,s,-s,c)*uv+u_uv_offset;
 vec4 base=u_base*v_color*(u_textured?texture(u_texture,uv):vec4(1.));
 if(u_alpha_mode==1&&base.a<u_cutoff)discard;
 float light=u_unlit?1.:.52+.48*max(0.,dot(normalize(v_normal),normalize(vec3(-.4,.8,.5))));
 vec3 rgb=base.rgb*light*v_tint.rgb+u_emissive;
 rgb=mix(rgb,vec3(1.,.83,.22),v_effect);
 color=vec4(rgb,(u_alpha_mode==0?1.:base.a)*v_tint.a);
}`;
    const program = gl.createProgram(); if (!program) throw new Error('Cannot allocate model shader.');
    const shaders: WebGLShader[] = [];
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl.createShader(type); if (!shader) throw new Error('Cannot allocate model shader.');
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Model shader compilation failed.');
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Model shader link failed.');
      this.metrics.programCompiles++;
      return { program, uniforms: new Map() };
    } catch (cause) { gl.deleteProgram(program); throw cause; }
    finally { for (const shader of shaders) gl.deleteShader(shader); }
  }
  private uploadBatch(gl: WebGL2RenderingContext, batch: ModelBatch, mode: number = gl.TRIANGLES): GpuBatch {
    const vao = gl.createVertexArray(), instances = gl.createBuffer();
    if (!vao || !instances) throw new Error('Cannot allocate model batch.');
    gl.bindVertexArray(vao);
    const buffers: WebGLBuffer[] = [];
    for (const [location, size, data] of [[0,3,batch.positions],[1,3,batch.normals],[2,2,batch.uvs],[3,4,batch.colors]] as const) {
      const buffer = gl.createBuffer(); if (!buffer) throw new Error('Cannot allocate model buffer.');
      buffers.push(buffer); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }
    const indices = gl.createBuffer(); if (!indices) throw new Error('Cannot allocate model indices.');
    buffers.push(indices); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, batch.indices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    for (const [location,size,offset] of [[4,3,0],[5,3,3],[6,3,6],[7,4,9],[8,4,13],[9,1,17]]) {
      gl.enableVertexAttribArray(location!); gl.vertexAttribPointer(location!,size!,gl.FLOAT,false,instanceStride*4,offset!*4); gl.vertexAttribDivisor(location!,1);
    }
    gl.bindVertexArray(null);
    return { vao, buffers, instances, count: batch.indices.length, material: batch.material, mode };
  }
  private decoration(model: ParsedModel, ring: boolean): ModelBatch {
    const { min, max } = model.bounds;
    const positions: number[] = [], indices: number[] = [];
    if (ring) {
      const cx=(min[0]+max[0])/2, cz=(min[2]+max[2])/2, rx=(max[0]-min[0])*.65, rz=(max[2]-min[2])*.65;
      for (let i=0;i<40;i++) { const a=i*Math.PI/20; positions.push(cx+Math.cos(a)*rx,min[1]+.035,cz+Math.sin(a)*rz); indices.push(i,(i+1)%40); }
    } else {
      for (let i=0;i<8;i++) positions.push(i&1?max[0]:min[0],i&2?max[1]:min[1],i&4?max[2]:min[2]);
      for (let i=0;i<8;i++) for (const bit of [1,2,4]) if (!(i&bit)) indices.push(i,i|bit);
    }
    const count=positions.length/3;
    return { positions: new Float32Array(positions), normals: new Float32Array(count*3).fill(1), uvs: new Float32Array(count*2), colors: new Float32Array(count*4).fill(1), indices: new Uint32Array(indices), material: { baseColor:[1,.86,.2,1],doubleSided:true,alphaMode:'BLEND',alphaCutoff:.5,emissive:[0,0,0],unlit:true } };
  }
  private upload(gl: WebGL2RenderingContext, entry: RegisteredModel): GpuModel {
    const start=performance.now();
    const textures=entry.images.map(image => {
      const texture=gl.createTexture(); if (!texture) throw new Error('Cannot allocate model texture.');
      gl.bindTexture(gl.TEXTURE_2D,texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      return texture;
    });
    const result={ batches:entry.model.batches.map(batch=>this.uploadBatch(gl,batch)), textures,
      box:this.uploadBatch(gl,this.decoration(entry.model,false),gl.LINES),ring:this.uploadBatch(gl,this.decoration(entry.model,true),gl.LINES) };
    this.metrics.uploads++; this.metrics.uploadMs+=performance.now()-start;
    return result;
  }
  private rotation(entity: ModelEntity, offset: number, scale: number, ground: boolean): Vec3[] {
    let pitch=radians(entity.pitch??0),roll=radians(entity.roll??0);
    const heading=radians((entity.heading??0)+offset), c=Math.cos(heading), s=Math.sin(heading);
    if (ground && this.options.slope && this.map?.getTerrain()) {
      const merc=MercatorCoordinate.fromLngLat([entity.lng,entity.lat]),unit=merc.meterInMercatorCoordinateUnits(),probe=3;
      const sample=(east:number,north:number)=>this.map!.queryTerrainElevation(new MercatorCoordinate(merc.x+east*unit,merc.y-north*unit).toLngLat());
      const e1=sample(probe,0),e0=sample(-probe,0),n1=sample(0,probe),n0=sample(0,-probe);
      if(e1!==null&&e0!==null&&n1!==null&&n0!==null){const east=(e1-e0)/(probe*2),north=(n1-n0)/(probe*2);pitch+=Math.atan(east*s+north*c);roll+=Math.atan(east*c-north*s);}
    }
    const rotate=(x:number,y:number,z:number):Vec3=>{
      const xr=x*Math.cos(roll)-y*Math.sin(roll),yr=x*Math.sin(roll)+y*Math.cos(roll);
      const yp=yr*Math.cos(pitch)+z*Math.sin(pitch),zp=-yr*Math.sin(pitch)+z*Math.cos(pitch);
      return [(xr*c+zp*s)*scale,(-xr*s+zp*c)*scale,yp*scale];
    };
    return [rotate(1,0,0),rotate(0,1,0),rotate(0,0,1)];
  }
  render(gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    const map=this.map;if(!map||gl.isContextLost())return;
    const started=performance.now();this.projection=input;this.pollTimers();
    let activeQuery:WebGLQuery|null=null;
    try {
      let program=this.programs.get(input.shaderData.variantName);
      if(!program){program=this.compile(gl,input);this.programs.set(input.shaderData.variantName,program);}
      gl.useProgram(program.program);
      const uniform=(name:string)=>{if(!program!.uniforms.has(name))program!.uniforms.set(name,gl.getUniformLocation(program!.program,name));return program!.uniforms.get(name)??null;};
      const d=input.defaultProjectionData,reference=MercatorCoordinate.fromLngLat(map.getCenter()),copy=nearestWorldCopy(map,reference.x),globe=input.shaderData.define.includes('GLOBE');
      gl.uniformMatrix4fv(uniform('u_projection_matrix'),false,globe?new Float32Array(d.mainMatrix):shiftedProjection(d.mainMatrix,reference.x+copy,reference.y));
      gl.uniformMatrix4fv(uniform('u_flat'),false,shiftedProjection(d.fallbackMatrix,reference.x+copy,reference.y));
      gl.uniformMatrix4fv(uniform('u_projection_fallback_matrix'),false,new Float32Array(d.fallbackMatrix));
      gl.uniform4fv(uniform('u_projection_clipping_plane'),d.clippingPlane);gl.uniform1f(uniform('u_projection_transition'),1);
      gl.uniform4f(uniform('u_projection_tile_mercator_coords'),reference.x,reference.y,1,1);gl.uniform1f(uniform('u_blend'),d.projectionTransition);
      const camera=map._camera.transform.getCameraLngLat(),cameraHeight=map._camera.transform.getCameraAltitude(),cameraMerc=MercatorCoordinate.fromLngLat(camera),verticalScale=map.getTerrain()?.exaggeration??1;
      const grouped=new Map<string,{entry:RegisteredModel;solid:number[];fading:number[];decorations:number[]}>();
      const boxes:ProjectedModelBox[]=[];let pendingFade=false;
      const now=performance.now();
      for(const entity of this.entities){
        const entry=this.models.get(entity.modelId);
        if(!entry){this.visibility(entity.id,0);this.states.delete(entity.id);continue;}
        if(entity.heading===undefined){if(!this.reportedHeading.has(entity.id)){this.reportedHeading.add(entity.id);this.report(new Error(`Missing Heading for ${entity.id}; remains an icon.`));}this.visibility(entity.id,0);continue;}
        const merc=MercatorCoordinate.fromLngLat([entity.lng,entity.lat]),unit=merc.meterInMercatorCoordinateUnits();
        const dx=merc.x-cameraMerc.x;const distance=Math.hypot((dx-Math.round(dx))/unit,(merc.y-cameraMerc.y)/unit,entity.height*verticalScale-cameraHeight);
        let state=this.states.get(entity.id);if(!state){state={near:distance<this.options.thresholdMeters,opacity:0,time:now};this.states.set(entity.id,state);}
        const half=Math.max(0,this.options.deadZoneMeters)/2;
        if(state.near?distance>this.options.thresholdMeters+half:distance<this.options.thresholdMeters-half)state.near=!state.near;
        const desired=state.near?1:0;
        state.opacity=this.options.transition==='instant'?desired:Math.max(0,Math.min(1,state.opacity+(state.near?1:-1)*(now-state.time)/180));state.time=now;
        if(state.opacity!==desired)pendingFade=true;
        this.visibility(entity.id,state.opacity);
        if(state.opacity<=0)continue;
        const centerClip=clipEntityPosition(map,input,[entity.lng,entity.lat,entity.height*verticalScale],[reference.x,reference.y]);if(!centerClip)continue;
        const center=centerClip[3]!>0?entityScreenPoint(map,centerClip):null;
        const {min,max}=entry.model.bounds,meshCenter:Vec3=[(min[0]+max[0])/2,(min[1]+max[1])/2,(min[2]+max[2])/2];
        const radius=Math.max(max[0]-min[0],max[1]-min[1],max[2]-min[2])/2*entry.metersPerUnit;
        const east=new MercatorCoordinate(merc.x+radius*unit,merc.y).toLngLat(),north=new MercatorCoordinate(merc.x,merc.y-radius*unit).toLngLat();
        const edge=projectEntityPosition(map,input,[east.lng,east.lat,entity.height*verticalScale],[reference.x,reference.y]),edgeN=projectEntityPosition(map,input,[north.lng,north.lat,entity.height*verticalScale],[reference.x,reference.y]);
        const realPixels=2*Math.max(edge&&center?Math.hypot(edge.x-center.x,edge.y-center.y):0,edgeN&&center?Math.hypot(edgeN.x-center.x,edgeN.y-center.y):0);
        const scale=entry.metersPerUnit*(this.options.sizeMode==='enlarged'&&center&&realPixels>0?Math.max(1,this.options.targetPixels/realPixels):1);
        const ground=entity.grounded??/tank|boat/.test(entity.modelId),rot=this.rotation(entity,entry.headingOffset,scale,ground);
        const localCorners:Vec3[]=[];
        for(let i=0;i<8;i++){
          const p=[(i&1?max[0]:min[0])-meshCenter[0],(i&2?max[1]:min[1])-meshCenter[1],(i&4?max[2]:min[2])-meshCenter[2]];
          const axis=(index: number)=>rot[0]![index]!*p[0]!+rot[1]![index]!*p[1]!+rot[2]![index]!*p[2]!;
          localCorners.push([axis(0),axis(1),axis(2)]);
        }
        let height=entity.height*verticalScale;
        if(ground){
          height-=Math.min(...localCorners.map(point=>point[2]));
          if(map.getTerrain())for(const point of localCorners){const location=new MercatorCoordinate(merc.x+point[0]*unit,merc.y-point[1]*unit).toLngLat(),terrain=map.queryTerrainElevation(location);if(terrain!==null)height=Math.max(height,terrain-point[2]);}
          height+=.06;
        }
        const cornerClips=localCorners.map(point=>{
          const location=new MercatorCoordinate(merc.x+point[0]*unit,merc.y-point[1]*unit).toLngLat();
          return clipEntityPosition(map,input,[location.lng,location.lat,height+point[2]],[reference.x,reference.y]);
        });
        if(cornerClips.some(clip=>!clip))continue;
        const clips=cornerClips.filter((clip):clip is number[]=>clip!==null);
        const originalPoints=clips.map(clip=>clip[3]!>0?entityScreenPoint(map,clip):null);
        const crossesDepthPlane=clips.some(clip=>clip[3]!<=0||clip[2]!+clip[3]!<0||clip[3]!-clip[2]!<0);
        const clippedFaces=crossesDepthPlane
          ?faces.map(face=>clipEntityPolygon(face.map(index=>clips[index]!)).map(clip=>entityScreenPoint(map,clip))).filter(face=>face.length>=3)
          :faces.map(face=>face.map(index=>originalPoints[index]!));
        const visiblePoints=clippedFaces.flat();if(!visiblePoints.length)continue;
        const minX=Math.min(...visiblePoints.map(p=>p.x)),maxX=Math.max(...visiblePoints.map(p=>p.x)),minY=Math.min(...visiblePoints.map(p=>p.y)),maxY=Math.max(...visiblePoints.map(p=>p.y));
        if(maxX<0||maxY<0||minX>map.getCanvas().clientWidth||minY>map.getCanvas().clientHeight)continue;
        const projectedCenter=center??{x:(minX+maxX)/2,y:(minY+maxY)/2,depth:Math.min(...visiblePoints.map(point=>point.depth))};
        // Original corners remain useful to inspect ordinary boxes. Picking uses
        // clipped faces so a box crossing the camera plane keeps its visible part.
        const projected=originalPoints.map(point=>point??projectedCenter);
        boxes.push({entityId:entity.id,corners:projected,clippedFaces,center:projectedCenter,minX,maxX,minY,maxY,depth:Math.min(...visiblePoints.map(p=>p.depth)),scale,cameraDistance:distance,opacity:state.opacity,selected:!!entity.selected,hovered:!!entity.hovered});
        let group=grouped.get(entity.modelId);if(!group){group={entry,solid:[],fading:[],decorations:[]};grouped.set(entity.modelId,group);}
        const x=merc.x-reference.x,values=[...rot[0]!,...rot[1]!,...rot[2]!,x-Math.round(x),merc.y-reference.y,height,unit,...(this.options.tint?(entity.tint??[1,1,1]):[1,1,1]),state.opacity,this.options.treatment==='bright'?(entity.selected?.52:entity.hovered?.28:0):0];
        (state.opacity===1?group.solid:group.fading).push(...values);if(entity.selected||entity.hovered)group.decorations.push(...values);
      }
      this.projectedBoxes=boxes;this.metrics.cpuPassMs=performance.now()-started;this.metrics.drawCalls=0;this.metrics.instances=boxes.length;this.metrics.triangles=0;
      if(this.timerExtension&&this.timerQueries.length<4){activeQuery=gl.createQuery();if(activeQuery)gl.beginQuery(this.timerExtension.TIME_ELAPSED_EXT,activeQuery);}
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      const draw=(batch:GpuBatch,values:number[],entry:RegisteredModel,gpu:GpuModel,decoration=false,fading=false)=>{
        if(!values.length)return;const m=batch.material;
        gl.bindVertexArray(batch.vao);gl.bindBuffer(gl.ARRAY_BUFFER,batch.instances);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.DYNAMIC_DRAW);
        gl.uniform3f(uniform('u_mesh_center'),(entry.model.bounds.min[0]+entry.model.bounds.max[0])/2,(entry.model.bounds.min[1]+entry.model.bounds.max[1])/2,(entry.model.bounds.min[2]+entry.model.bounds.max[2])/2);
        gl.uniform4fv(uniform('u_base'),m.baseColor);gl.uniform3fv(uniform('u_emissive'),m.emissive);gl.uniform1i(uniform('u_unlit'),m.unlit?1:0);
        gl.uniform1i(uniform('u_alpha_mode'),m.alphaMode==='MASK'?1:m.alphaMode==='BLEND'?2:0);gl.uniform1f(uniform('u_cutoff'),m.alphaCutoff);
        gl.uniform2fv(uniform('u_uv_offset'),m.uvTransform?.offset??[0,0]);gl.uniform2fv(uniform('u_uv_scale'),m.uvTransform?.scale??[1,1]);gl.uniform1f(uniform('u_uv_rotation'),m.uvTransform?.rotation??0);
        gl.uniform1i(uniform('u_textured'),m.texture===undefined?0:1);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,m.texture===undefined?null:gpu.textures[m.texture]??null);gl.uniform1i(uniform('u_texture'),0);
        if(m.doubleSided||decoration)gl.disable(gl.CULL_FACE);else{gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.frontFace(gl.CCW);}
        gl.depthMask(m.alphaMode!=='BLEND'&&!decoration&&!fading);
        gl.drawElementsInstanced(batch.mode,batch.count,gl.UNSIGNED_INT,0,values.length/instanceStride);this.metrics.drawCalls++;
      };
      for(const transparent of [false,true])for(const [id,group] of grouped){
        let gpu=this.gpuModels.get(id);if(!gpu){gpu=this.upload(gl,group.entry);this.gpuModels.set(id,gpu);}
        for(const batch of gpu.batches){
          if(!transparent&&batch.material.alphaMode!=='BLEND')draw(batch,group.solid,group.entry,gpu);
          if(transparent){
            if(batch.material.alphaMode==='BLEND')draw(batch,group.solid,group.entry,gpu);
            draw(batch,group.fading,group.entry,gpu,false,true);
          }
        }
        if(!transparent)this.metrics.triangles+=group.entry.model.triangles*(group.solid.length+group.fading.length)/instanceStride;
      }
      if(this.options.treatment!=='bright')for(const [id,group]of grouped){const gpu=this.gpuModels.get(id)!;draw(this.options.treatment==='ring'?gpu.ring:gpu.box,group.decorations,group.entry,gpu,true);}
      gl.bindVertexArray(null);gl.depthMask(true);
      if(activeQuery){gl.endQuery(this.timerExtension!.TIME_ELAPSED_EXT);this.timerQueries.push({query:activeQuery,sequence:++this.querySequence});activeQuery=null;}
      this.metrics.renderSubmitMs=performance.now()-started;this.metrics.frames++;
      if(pendingFade)map.triggerRepaint();
    }catch(cause){if(activeQuery&&this.timerExtension){try{gl.endQuery(this.timerExtension.TIME_ELAPSED_EXT);gl.deleteQuery(activeQuery);}catch{}}gl.bindVertexArray(null);gl.depthMask(true);this.report(cause);}
  }
  pick(x:number,y:number,tolerance:number){
    const hits:{entityId:string;depth:number}[]=[];let terrainDepth:number|undefined;
    if(this.map&&this.projection){const location=this.map.unproject([x,y]),height=this.map.getTerrain()?this.map.queryTerrainElevation(location):0;if(height!==null)terrainDepth=projectEntityPosition(this.map,this.projection,[location.lng,location.lat,height])?.depth;}
    for(const box of this.projectedBoxes){
      if(box.opacity<.5||x<box.minX-tolerance||x>box.maxX+tolerance||y<box.minY-tolerance||y>box.maxY+tolerance)continue;
      let depth=Infinity;
      for(const polygon of box.clippedFaces)for(let vertex=1;vertex+1<polygon.length;vertex++){
        const a=polygon[0]!,b=polygon[vertex]!,c=polygon[vertex+1]!;
        const den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(den)<1e-8)continue;
        const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/den,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/den;
        if(u>=0&&v>=0&&u+v<=1)depth=Math.min(depth,u*a.depth+v*b.depth+(1-u-v)*c.depth);
      }
      if(Number.isFinite(depth)&&(terrainDepth===undefined||depth<=terrainDepth+1e-6))hits.push({entityId:box.entityId,depth});
    }
    return hits.sort((a,b)=>a.depth-b.depth);
  }
}
