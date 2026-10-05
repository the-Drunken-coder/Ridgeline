import { createViewport } from '@ridgeline/map';
import type { MapFeature, Viewport } from '@ridgeline/map';
import type { GeoJSONSource } from 'maplibre-gl';
import { observeModels } from './observer';
const container = document.querySelector<HTMLDivElement>('#map')!;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean, description: string) {
  const end = performance.now() + 15_000;
  while (!predicate()) { if (performance.now() > end) throw new Error(`Timed out: ${description}`); await pause(20); }
}
async function frame(viewport: Viewport) {
  await new Promise<void>(resolve => { viewport.map.once('render', () => resolve()); viewport.map.triggerRepaint(); });
}
/** Actual tarball parser/decoder/GPU, reentrant updates, and held native worker publication. */
export async function verify() {
  const observer = observeModels();
  const features: MapFeature[] = [-.00015,.00015].map((longitude,index) => ({ type:'Feature',id:`model-${index}`,properties:{},
    geometry:{type:'Point',coordinates:[longitude,0]},entity:{heading:0,model:{id:'drone',minimumSizePixels:40}} }));
  const probe: MapFeature = { type:'Feature',id:'native-probe',properties:{},geometry:{type:'Point',coordinates:[0,.0005]},entity:{} };
  const viewport = createViewport({container,features:[...features,probe],projection:'flat',camera:{center:[0,0],zoom:17,pitch:35},
    basemap:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'white'}}]},
    style:()=>({icon:'probe',radius:0}), elevationSampler:{sample:()=>0},entityModels:{switchDistanceMeters:1e8,deadZoneMeters:0,minimumSizePixels:40},logger:()=>{}});
  try {
    await viewport.ready;
    viewport.registerIcon('probe',{image:new ImageData(new Uint8ClampedArray(8*8*4).fill(255),8,8)});
    const bytes = await fetch('/assets/drone.glb').then(response => response.arrayBuffer());
    await viewport.registerModel('drone',{bytes});
    await until(()=>features.every(feature=>viewport.getEntityState(feature.id)?.representation==='model') && viewport.map.loaded(),'disabled model and native frame');
    await frame(viewport); observer.drain(); const disabledEntries=observer.records.length;
    viewport.map.getCanvas().dataset.ridgelineMeasure='true';
    await viewport.registerModel('drone',{bytes}); viewport.upsert(features);
    await frame(viewport); await frame(viewport);
    const source=viewport.map.getSource<GeoJSONSource>('rl:features')!, update=source.updateData.bind(source);
    const marker=()=>viewport.map.queryRenderedFeatures(undefined,{layers:['rl:icons']}).find(value=>value.properties._rl_feature_id==='native-probe')?.properties._rl_marker;
    const nativeBefore: unknown=marker();
    let release:(()=>void)|undefined;
    source.updateData=diff=>new Promise<void>((resolve,reject)=>{release=()=>{update(diff).then(resolve,reject);};});
    viewport.upsert([{...probe,geometry:{type:'Point',coordinates:[.00025,.0005]}}]);
    await until(()=>Boolean(release),'held native source publication'); await frame(viewport);
    const nativeHeld: unknown=marker();
    const nativeHeldVisible=!viewport.map.getFeatureState({source:'rl:features',id:'rl:native-probe'}).model;
    source.updateData=update; release!();
    await until(()=>viewport.map.loaded() && marker()!==nativeBefore,'native rendered pose changes'); await frame(viewport);
    const nativeAfter: unknown=marker();
    let replaced=false;
    const off=viewport.on('datachange',()=>{if(!replaced){replaced=true;viewport.upsert([{...features[0]!,entity:{...features[0]!.entity,heading:90}}]);}});
    const reentrantStart=performance.now(); viewport.upsert(features); off();
    await frame(viewport); await frame(viewport); observer.drain();
    return {disabledEntries,retainedEntries:performance.getEntriesByType('measure').filter(entry=>entry.name.startsWith('ridgeline:model:')).length,
      nativeBefore,nativeHeld,nativeHeldVisible,nativeAfter,reentrantStart,records:observer.records};
  } finally { viewport.destroy(); observer.destroy(); }
}
