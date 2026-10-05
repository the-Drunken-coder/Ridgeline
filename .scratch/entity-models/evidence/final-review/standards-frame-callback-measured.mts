import assert from 'node:assert/strict';
import { EntityScene, DEFAULT_ENTITY_VISIBILITY } from '/home/ubuntu/.t3/worktrees/Ridgeline/t3code-7c4f2af4/src/entities.ts';
import { ModelRegistry } from '/home/ubuntu/.t3/worktrees/Ridgeline/t3code-7c4f2af4/src/models.ts';
import { DEFAULT_ENTITY_MODELS } from '/home/ubuntu/.t3/worktrees/Ridgeline/t3code-7c4f2af4/src/model-settings.ts';
import { solidGlb } from '/home/ubuntu/.t3/worktrees/Ridgeline/t3code-7c4f2af4/tests/model-fixtures.ts';
import { PerformanceObserver } from 'node:perf_hooks';
import { ModelMeasurement } from '/home/ubuntu/.t3/worktrees/Ridgeline/t3code-7c4f2af4/src/model-measurement.ts';
const measures = []; const observer = new PerformanceObserver(list => measures.push(...list.getEntries().map(entry => ({ name: entry.name, detail: entry.detail })))); observer.observe({type: 'measure'});
const measurement = new ModelMeasurement({dataset:{ridgelineMeasure:'true'}});
const raf = new Map(); let serial = 0;
globalThis.requestAnimationFrame = callback => { raf.set(++serial, callback); return serial; };
globalThis.cancelAnimationFrame = id => { raf.delete(id); };
globalThis.OffscreenCanvas = class { getContext() { return { fillStyle: '', fillRect() {}, getImageData() { return { data: new Uint8ClampedArray([33,110,92,255]) }; } }; } };
const events = new Map();
const map = { getPixelRatio: () => 1, getLayer: () => undefined, getSource: () => undefined, getCenter: () => ({lng:0,lat:0}),
 getCanvas: () => ({clientWidth:1000,clientHeight:800}), triggerRepaint() {},
 on(name, callback) { events.set(name,callback); }, off(name) { events.delete(name); },
 _camera: {transform:{getCameraLngLat:()=>({lng:0,lat:0}),getCameraAltitude:()=>500,clone:()=>({})}} };
const input = { shaderData:{variantName:'test',vertexShaderPrelude:'',define:''}, defaultProjectionData:{mainMatrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],fallbackMatrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],clippingPlane:[0,0,0,1],projectionTransition:0} };
const uploads=[];
const gl = new Proxy({NO_ERROR:0,isContextLost:()=>false,getError:()=>0,createProgram:()=>({}),createShader:()=>({}),getShaderParameter:()=>true,getProgramParameter:()=>true,
 bufferData(_target,data) { uploads.push(Array.from(data)); } }, {get(target,key) { return key in target ? target[key] : /^[A-Z_]+$/.test(String(key)) ? 1 : ()=>{}; }});
let scene, replace=false;
const registry=new ModelRegistry({changed:id=>scene.modelsChanged(id),diagnostic:error=>{throw error;}});
const configuration={basemap:{version:8,sources:{},layers:[]},projection:'flat',terrain:false,hillshade:false,hillshadeOptions:{},exaggeration:1,elevation:{tiles:[]},entityModels:{...DEFAULT_ENTITY_MODELS,minimumSizePixels:0,switchDistanceMeters:1e8},entityVisibility:DEFAULT_ENTITY_VISIBILITY};
const feature=meters=>({type:'Feature',id:'aircraft',properties:{},geometry:{type:'Point',coordinates:[0,0]},entity:{heading:0,model:{id:'asset',minimumSizePixels:0},altitude:{meters,reference:'sea-level'}}});
scene=new EntityScene({measurement,map,configuration:()=>configuration,models:registry,sampler:{sample:()=>0},style:()=>({}),diagnostic:error=>{throw error;},nativeAvailable:()=>true,commitVisibility:()=>true,commitPresentation:()=>true,representationChanged:()=>{},changed:()=>{if(replace){replace=false;measurement.accepted(1);scene.set([feature(300)]);}}});
registry.renderer({upload:model=>({batches:[{vao:{},instances:{},count:3,material:model.batches[0].material}],disposed:false,dispose(){}})});
await registry.register('asset',{bytes:solidGlb()});
scene.modelLayer.onAdd(map,gl);
measurement.accepted(1); scene.set([feature(100)]); replace=true;
scene.modelLayer.prerender(gl,input); scene.modelLayer.render(gl,input); events.get('render')?.();
await new Promise(resolve => setImmediate(resolve));
const firstFrames = measures.filter(record=>record.name === 'ridgeline:model:frame');
const first={frameFacts:firstFrames,acceptedAltitude:300,state:scene.getState('aircraft'),instanceAltitude:uploads.at(-1)?.[11],pendingFrames:raf.size};
scene.modelLayer.prerender(gl,input);scene.modelLayer.render(gl,input);events.get('render')?.();
const second={state:scene.getState('aircraft'),instanceAltitude:uploads.at(-1)?.[11]};
console.log(JSON.stringify({first,second},null,2));
assert.equal(first.instanceAltitude,100);
assert.equal(second.instanceAltitude,300);
scene.destroy();registry.destroy();observer.disconnect();measurement.destroy();
