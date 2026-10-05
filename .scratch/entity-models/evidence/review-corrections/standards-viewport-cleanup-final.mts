import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as native from '/home/ubuntu/.t3/worktrees/Ridgeline/t3code-7c4f2af4/node_modules/maplibre-gl/dist/maplibre-gl.mjs';
const maps=[];
class ClassList { values=new Set(); add(...values){for(const value of values)this.values.add(value);} remove(...values){for(const value of values)this.values.delete(value);} contains(value){return this.values.has(value);} }
class NativeMap {
  listeners=new globalThis.Map(); removed=0; renderNesting=0; duringRender;
  constructor(options) {
    maps.push(this); this._container=options.container; this._container.classList.add('maplibregl-map');
    this._canvas={dataset:{},addEventListener(){},removeEventListener(){}};
    const canvas=this._canvas;
    this._container.canvases.add(canvas);
    this._canvasContainer={remove:()=>this._container.canvases.delete(canvas)};
    this._controlContainer={remove(){}};
    this.style={tileManagers:{}};
  }
  _render(time) { this.renderNesting++;try { const action=this.duringRender;this.duringRender=undefined;action?.();assert.ok(this.style,'Native style destroyed before render returned');return this;}finally{this.renderNesting--;}}
  _cleanupContainer=native.Map.prototype._cleanupContainer;
  remove(){assert.equal(this.renderNesting,0,'Native removal must wait for outer render');this.removed++;this._cleanupContainer();this.style=undefined;}
  getCanvas(){return this._canvas;}
  getSource(){return undefined;} getLayer(){return undefined;} hasImage(){return false;} getPixelRatio(){return 1;}
  on(type,listener){const set=this.listeners.get(type)??new Set();set.add(listener);this.listeners.set(type,set);return this;}
  off(type,listener){this.listeners.get(type)?.delete(listener);return this;}
}
globalThis.__standardsNativeMap=NativeMap;
globalThis.ResizeObserver=class{observe(){}disconnect(){}};
globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
registerHooks({resolve(specifier,context,nextResolve){if(specifier==='maplibre-gl')return{url:'file:///tmp/ridgeline-model-context/standards-viewport-maplibre-stub.mjs',shortCircuit:true};return nextResolve(specifier,context);}});
const {createViewport}=await import('/tmp/ridgeline-model-standards-review/src/viewport.ts');
const results=[];
for(const history of ['ordinary-destroy-event-remount','render-destroy-event-remount','render-remount-after-return','nested-render-remount-after-return','nested-render-event-remount']) {
  const container={classList:new ClassList(),canvases:new Set(),removeEventListener(){}};
  const options={container,basemap:{version:8,sources:{},layers:[]},logger:()=>{}};
  const old=createViewport(options);let replacement;let emptyInListener;
  const mount=()=>{emptyInListener=container.canvases.size===0;replacement=createViewport(options);};
  if(history.endsWith('event-remount'))old.on('destroy',mount);
  const action=()=>{old.destroy();old.destroy();if(history.endsWith('after-return'))mount();};
  if(history==='ordinary-destroy-event-remount')action();
  else {old.map.duringRender=history.startsWith('nested')?()=>{old.map.duringRender=action;old.map._render(1);assert.equal(old.map.removed,0);}:action;old.map._render(0);}
  assert.ok(replacement);assert.equal(container.canvases.size,1);assert.equal(old.map.removed,1);
  const retainedClass=container.classList.contains('maplibregl-map');
  assert.equal(emptyInListener,true,'Owned DOM must retire before remount');
  results.push({history,emptyInListener,retainedClass,replacementCanvases:container.canvases.size,oldNativeRemovals:old.map.removed});
  replacement.destroy();assert.equal(container.canvases.size,0);
}
console.log(JSON.stringify({revision:'cf09290e615dfc4809b09519fdfb0825c4642ba9',scope:'real public viewport with native Map constructor/render/remove doubles, exact installed MapLibre6.11 _cleanupContainer; no GPU/browser claim',results},null,2));
assert.equal(results[0].retainedClass,true);assert.equal(results[1].retainedClass,true);
assert.equal(results[2].retainedClass,true);assert.equal(results[3].retainedClass,true);assert.equal(results[4].retainedClass,true);
