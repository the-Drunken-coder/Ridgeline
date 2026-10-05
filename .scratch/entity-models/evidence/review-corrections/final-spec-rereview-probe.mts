import assert from 'node:assert/strict';
import { EntityScene, DEFAULT_ENTITY_VISIBILITY } from '/tmp/ridgeline-model-spec-review/src/entities.ts';
import { ModelRegistry } from '/tmp/ridgeline-model-spec-review/src/models.ts';
import { ModelRenderer } from '/tmp/ridgeline-model-spec-review/src/model-renderer.ts';
import { DEFAULT_ENTITY_MODELS } from '/tmp/ridgeline-model-spec-review/src/model-settings.ts';
import { solidGlb } from '/tmp/ridgeline-model-spec-review/tests/model-fixtures.ts';
const revision = '31221198ab629d6030d8c0ba2aab93aac2811acc';
const frames = new Map(); let nextFrame = 0;
globalThis.OffscreenCanvas = class { getContext() { return { fillStyle: '', fillRect() {}, getImageData() { return { data: new Uint8ClampedArray([33,110,92,255]) }; } }; } };
globalThis.requestAnimationFrame = callback => { const id = ++nextFrame; frames.set(id,callback); return id; };
globalThis.cancelAnimationFrame = id => { frames.delete(id); };
ModelRenderer.prototype.initialize = function () { return {}; };
ModelRenderer.prototype.upload = async function () { let disposed = false; return { batches: [], get disposed(){return disposed;}, dispose(){disposed=true;} }; };
const report = [];
function entity(id='body',lng=0,color='red',altitude=100) { return {type:'Feature',id,properties:{color},geometry:{type:'Point',coordinates:[lng,0]},entity:{model:{id:'box'},heading:0,...(altitude === undefined?{}:{altitude:{meters:altitude,reference:'sea-level'}})}}; }
async function fixture(changed=()=>{}) {
  let scene,center=0,configuration={basemap:{version:8,sources:{},layers:[]},projection:'flat',terrain:false,hillshade:false,hillshadeOptions:{},exaggeration:1,elevation:{tiles:[]},entityVisibility:DEFAULT_ENTITY_VISIBILITY,entityModels:{...DEFAULT_ENTITY_MODELS,minimumSizePixels:0}};
  const listeners = new Map(), diagnostics = [], prepared = []; let submitted = [], drawCalls=0,repaints=0,deletes=0;
  const map = {getPixelRatio:()=>1,getCenter:()=>({lng:center,lat:0}),getCanvas:()=>({clientWidth:1000,clientHeight:1000}),getLayer:()=>undefined,getSource:()=>undefined,
    on(type,fn){const set=listeners.get(type)??new Set();set.add(fn);listeners.set(type,set);},off(type,fn){listeners.get(type)?.delete(fn);},triggerRepaint(){repaints++;},
    _camera:{transform:{getCameraLngLat:()=>[center,0],getCameraAltitude:()=>100,clone(){return this;}}}};
  const gl={isContextLost:()=>false,createBuffer:()=>({}),deleteBuffer(){deletes++;}};
  ModelRenderer.prototype.prepareFrame = function(_input,_projection,draws){submitted=draws.flatMap(draw=>draw.instances);prepared.push(structuredClone(submitted));return {draw(){drawCalls++;}};};
  const registry=new ModelRegistry({changed:id=>scene.modelsChanged(id),diagnostic:error=>diagnostics.push(error)});
  scene=new EntityScene({map,models:registry,configuration:()=>configuration,sampler:{sample:()=>0},style:feature=>({modelAppearance:{mode:'color',color:feature.properties.color}}),diagnostic:error=>diagnostics.push(error),changed:ids=>changed(scene,ids)});
  const input=()=>{const matrix=[100000,0,0,0,0,100000,0,0,0,0,1000,0,-100000*((center+180)/360),-50000,0,1];return {shaderData:{define:'',variantName:'flat'},defaultProjectionData:{mainMatrix:matrix,fallbackMatrix:matrix,clippingPlane:[0,0,1,1],projectionTransition:0}};};
  const frame=()=>{scene.modelLayer.prerender(gl,input());scene.modelLayer.render(gl,input());for(const fn of [...(listeners.get('render')??[])])fn();return structuredClone(submitted);};
  scene.modelLayer.onAdd(map,gl);frame();await registry.register('box',{bytes:solidGlb()});
  return {scene,registry,prepared,diagnostics,frame,gl,map,center(lng){center=lng;},configure(settings){configuration={...configuration,entityModels:settings};scene.configure();},work(){return {drawCalls,repaints,scheduled:frames.size,deletes};},destroy(){scene.destroy();registry.destroy();}};
}
// Valid directly accepted control compared with a reentrant replacement.
const current=entity('body',.002,'blue',80);current.entity.heading=73;current.entity.pitch=24;current.entity.roll=-16;
const direct=await fixture();direct.scene.set([current]);const valid=direct.frame();assert.equal(valid.length,1);direct.destroy();
let armed=false,replaced=false;
const reentrant=await fixture(scene=>{if(armed&&!replaced){replaced=true;scene.set([current]);}});
armed=true;reentrant.scene.set([entity()]);const replacement=reentrant.frame();assert.equal(replaced,true);assert.deepEqual(replacement,valid);assert.equal(reentrant.prepared.length,2);assert.equal(reentrant.scene.getState('body').altitude,80);reentrant.destroy();
report.push({history:'callback replacement vs directly accepted control',outcome:'same current placement/orientation/appearance',preparedInstances:replacement.length});
// The below-terrain replacement must submit no body in its first completed frame.
armed=false;replaced=false;const below=await fixture(scene=>{if(armed&&!replaced){replaced=true;scene.set([entity('body',.002,'blue',-10)]);}});
armed=true;below.scene.set([entity()]);assert.deepEqual(below.frame(),[]);assert.equal(below.scene.getState('body').placement,'below-terrain');assert.notEqual(below.scene.getState('body').representation,'model');below.destroy();
report.push({history:'callback replacement below terrain',outcome:'zero model submission in first completed frame'});
// Removal and destruction invalidate preparation and stale point/model work.
armed=false;replaced=false;const removed=await fixture(scene=>{if(armed&&!replaced){replaced=true;scene.set([],['body']);}});
armed=true;removed.scene.set([entity()]);assert.deepEqual(removed.frame(),[]);assert.equal(removed.scene.getState('body'),undefined);removed.destroy();
report.push({history:'callback removal',outcome:'zero model submission; no entity state'});
armed=false;replaced=false;const disposed=await fixture(scene=>{if(armed&&!replaced){replaced=true;scene.destroy();}});
disposed.scene.layer.onAdd(disposed.map,disposed.gl);armed=true;disposed.scene.set([entity()]);disposed.frame();const work=disposed.work();disposed.scene.layer.render(disposed.gl,{});disposed.scene.modelLayer.render(disposed.gl,{});assert.deepEqual(disposed.work(),work);assert.equal(disposed.scene.getState('body'),undefined);assert.equal(work.deletes,1);disposed.destroy();
report.push({history:'callback destruction then stale layer render',outcome:'no additional upload/draw/repaint; entity buffer disposed',work});
// Culling keeps logical representation and hysteresis while excluding outside boxes.
const cull=await fixture();cull.scene.set([entity('inside',0,'red',undefined),entity('outside',.01,'blue',undefined)]);const initial=cull.frame();assert.equal(initial.length,1);assert.equal(initial[0].appearance.color,'red');assert.equal(cull.scene.getState('outside').representation,'model');
cull.configure({switchDistanceMeters:5000,deadZoneMeters:9800,minimumSizePixels:0});cull.center(.02);assert.equal(cull.frame().length,0);assert.equal(cull.scene.getState('outside').representation,'model');cull.center(.01);const returned=cull.frame();assert.equal(returned.length,1);assert.equal(returned[0].appearance.color,'blue');assert.equal(cull.scene.getState('outside').representation,'model');
report.push({history:'off-screen culling, empty view, and dead-zone re-entry',outcome:'submissions1→0→1; representation remainsmodel'});cull.destroy();
// Enlargement may expose a box with an outside physical anchor.
const edge=await fixture();const body=entity('edge',.003672,'blue',undefined);body.entity.model.minimumSizePixels=40;edge.scene.set([body]);assert.equal(edge.frame().length,1);report.push({history:'enlarged edge whose physical anchor is off-screen',outcome:'partly visible body is submitted'});edge.destroy();
console.log(JSON.stringify({revision,sourceTree:'8e6c0efa6f852371658ab9cb49846ea7f872a703',scope:'real scene/model-layer CPU preparation/publication; GPU upload/draw and controlled map/sampler stubbed; no native-browser pixel/remount claim',histories:report,remainingScheduledFrames:frames.size},null,2));
assert.equal(frames.size,0);
