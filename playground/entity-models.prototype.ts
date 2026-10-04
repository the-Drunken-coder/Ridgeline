// Throwaway comparison on the existing playground route. No appearance decision is approved.
import type { MapFeature, Viewport } from '@ridgeline/map';
import { FEATURE_SOURCE, sourceFeatureId } from '../src/maplibre-feature-publication';
import { parseGlb, decodeModelImages } from './entity-model-glb.prototype';
import type { ParsedModel, ModelBatch } from './entity-model-glb.prototype';
import { ModelLayer } from './entity-model-layer.prototype';
import type { Sample } from './samples';

const samples = [
  { id: 'drone', name: 'Drone', file: 'drone.glb', scale: 1, headingOffset: 0, airborne: 35,
    credit: '"Drone" by NateGazzard', url: 'https://poly.pizza/m/DNbUoMtG3H' },
  { id: 'tank', name: 'Tank', file: 'tank.glb', scale: 1, headingOffset: 90, airborne: 0,
    credit: '"Tank" by KolosStudios', url: 'https://poly.pizza/m/egcLMSGiuA' },
  { id: 'plane', name: 'Jet', file: 'plane.glb', scale: 1, headingOffset: 0, airborne: 60,
    credit: '"Jet" by jeremy', url: 'https://poly.pizza/m/6fyLMORhgGK' },
  { id: 'boat', name: 'Speedboat', file: 'boat.glb', scale: 1, headingOffset: 0, airborne: 0,
    credit: 'Watercraft Kit by Kenney, texture embedded', url: 'https://kenney.nl/assets/watercraft-kit' },
] as const;
type View = 'workload' | 'samples' | 'slope' | 'precision' | 'date-line' | 'world-copy' | 'transition';
const views: View[] = ['workload', 'samples', 'slope', 'precision', 'date-line', 'world-copy', 'transition'];
const affiliations: [number, number, number][] = [[.3,.7,1],[1,.35,.25],[.35,.85,.4],[1,.8,.3]];
const percentile = (values: readonly number[], fraction: number) => {
  const sorted = [...values].sort((a,b) => a-b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? null;
};
const summary = (values: readonly number[]) => ({ samples: values.length, median: percentile(values,.5), p95: percentile(values,.95), max: values.length ? Math.max(...values) : null });

/** Increase actual submitted triangles without changing the shape, materials, or draw count. */
function subdivide(model: ParsedModel): ParsedModel {
  const batches = model.batches.map(batch => {
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], colors: number[] = [];
    const attrs = [batch.positions,batch.normals,batch.uvs,batch.colors];
    const sizes = [3,3,2,4];
    const output = [positions,normals,uvs,colors];
    const add = (a: number, b = a) => {
      for (let attr = 0; attr < attrs.length; attr++) for (let c = 0; c < sizes[attr]!; c++)
        output[attr]!.push((attrs[attr]![a * sizes[attr]! + c]! + attrs[attr]![b * sizes[attr]! + c]!) / 2);
    };
    for (let i = 0; i < batch.indices.length; i += 3) {
      const a=batch.indices[i]!, b=batch.indices[i+1]!, c=batch.indices[i+2]!;
      for (const triangle of [[[a,a],[a,b],[c,a]],[[a,b],[b,b],[b,c]],[[c,a],[b,c],[c,c]],[[a,b],[b,c],[c,a]]])
        for (const [u,v] of triangle) add(u!,v!);
    }
    return { ...batch, positions:new Float32Array(positions), normals:new Float32Array(normals), uvs:new Float32Array(uvs), colors:new Float32Array(colors), indices:Uint32Array.from({length:positions.length/3},(_,i)=>i) } satisfies ModelBatch;
  });
  return { ...model, batches, triangles:model.triangles*4 };
}

export function mountEntityModelsPrototype(viewport: Viewport<Sample>, container: HTMLElement) {
  const map = viewport.map, lifetime = new AbortController();
  let destroyed=false, paused=new URLSearchParams(location.search).get('paused')==='1', tick=0, view: View='workload', hovered='';
  let motion: ReturnType<typeof setInterval> | undefined;
  let opacityFrame=0;
  let renderCount=0;
  const opacities=new Map<string,number>(), pendingOpacity=new Map<string,number>();
  function entityLayer() {
    const styled=map.getLayer('rl:entities');
    if (!styled || !('implementation' in styled)) return;
    const implementation=styled.implementation;
    // Works with both the development source and the packaged playground build.
    if (implementation && typeof implementation==='object' &&
        'setRepresentationOpacity' in implementation && typeof implementation.setRepresentationOpacity==='function' &&
        'setModelPicker' in implementation && typeof implementation.setModelPicker==='function') {
      const setOpacity=implementation.setRepresentationOpacity, setPicker=implementation.setModelPicker;
      return {
        setRepresentationOpacity:(id:string,opacity:number)=>setOpacity.call(implementation,id,opacity),
        setModelPicker:(picker?: (x:number,y:number,tolerance:number)=>{entityId:string;depth:number}[])=>setPicker.call(implementation,picker),
      };
    }
  }
  const loadTimings: {id:string;bytes:number;triangles:number;parseMs:number;decodeMs:number}[]=[];
  const errors: string[]=[];
  const options = { sizeMode:'enlarged' as 'enlarged'|'real', targetPixels:56, thresholdMeters:2000, deadZoneMeters:200,
    transition:'instant' as 'instant'|'fade', tint:false, treatment:'ring' as 'ring'|'box'|'bright', slope:false };
  const registry = new Map<string,{model:ParsedModel;images:ImageBitmap[];metersPerUnit:number;headingOffset:number}>();
  const originals = new Map<string,ParsedModel>();
  const originalBytes = new Map<string,ArrayBuffer>();
  const layer = new ModelLayer(cause => { errors.push(String(cause)); status.textContent=errors.at(-1) ?? ''; }, (id,opacity) => {
    if ((pendingOpacity.get(id) ?? opacities.get(id)) === opacity) return;
    pendingOpacity.set(id,opacity);
    if (!opacityFrame) opacityFrame=requestAnimationFrame(() => {
      opacityFrame=0;
      if (destroyed) return;
      const entities=entityLayer();
      for (const [id,value] of pendingOpacity) {
        opacities.set(id,value);
        if (map.getSource(FEATURE_SOURCE)) map.setFeatureState({source:FEATURE_SOURCE,id:sourceFeatureId(id)},{modelOpacity:value});
        entities?.setRepresentationOpacity(id,1-value);
      }
      pendingOpacity.clear();
      renderState();
    });
  });
  container.innerHTML=`<h2>Choose model behavior</h2><p>Throwaway prototype. Choices remain open.</p>
    <label class="setting">View<select data-control="view">${views.map(v=>`<option value="${v}">${({workload:'100 + 1,000',samples:'Four samples',slope:'Tank on slope',precision:'Zoom 19', 'date-line':'Date line','world-copy':'World copy',transition:'Globe transition'})[v]}</option>`).join('')}</select></label>
    <h2>Size and switching</h2>
    <label class="setting">Size<select data-control="sizeMode"><option value="enlarged">Enlarged, then real</option><option value="real">Real size only</option></select></label>
    <label class="setting">Fixed size px<input data-control="targetPixels" type="number" min="12" max="160" step="4" value="56"></label>
    <label class="setting">Switch distance m<input data-control="thresholdMeters" type="number" min="10" max="2000000" step="10" value="2000"></label>
    <label class="setting">Dead zone m<input data-control="deadZoneMeters" type="number" min="0" max="100000" step="50" value="200"></label>
    <label class="setting">Swap<select data-control="transition"><option value="instant">Instant</option><option value="fade">Brief fade</option></select></label>
    <h2>Appearance</h2>
    <label class="setting">Affiliation tint<input data-control="tint" type="checkbox"></label>
    <label class="setting">Selection / hover<select data-control="treatment"><option value="ring">Model ring</option><option value="box">Model box</option><option value="bright">Brighten model</option></select></label>
    <label class="setting">Ground vehicle<select data-control="slope"><option value="flat">Flat</option><option value="slope">Follow slope</option></select></label>
    <div class="action-row"><button data-action="pause">Pause motion</button><button data-action="top">Top down</button><button data-action="tilt">Tilted</button></div>
    <output data-state aria-live="polite"></output>
    <details><summary>Measurements and checks</summary>
      <label class="setting">Triangle load<select data-control="detail"><option value="1">Original</option><option value="4">4 times</option><option value="16">16 times</option></select></label>
      <div class="action-row"><button data-action="measure">Measure 10s</button><button data-action="context">Lose / restore GPU</button></div>
      <output data-measurement></output><p data-gpu></p>
    </details>
    <details class="model-prototype-attribution"><summary>Sample model credits</summary>
      ${samples.map(s=>`<p><a href="${s.url}" target="_blank" rel="noreferrer">${s.credit}</a>, ${s.id==='boat'?'<a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0</a>':'<a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>'}</p>`).join('')}
      <p>Boat is on land here to compare model loading and placement.</p>
    </details><p data-status role="status">Loading four GLBs…</p>`;
  const status=container.querySelector<HTMLElement>('[data-status]')!;
  const state=container.querySelector<HTMLOutputElement>('[data-state]')!;
  const measurement=container.querySelector<HTMLOutputElement>('[data-measurement]')!;
  const switcher=document.createElement('div'); switcher.className='model-prototype-switcher';
  switcher.innerHTML='<button aria-label="Previous model treatment">←</button><span></span><button aria-label="Next model treatment">→</button>';
  map.getContainer().append(switcher);

  function setOptions(next: Partial<typeof options>) {
    Object.assign(options,next); layer.setOptions(options); renderState();
    const url=new URL(location.href); url.searchParams.set('scenario','entity-models'); url.searchParams.set('variant',options.treatment);
    history.replaceState(null,'',url);
    for (const input of container.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-control]')) {
      const key=input.dataset.control;
      if (input instanceof HTMLInputElement && key==='tint') input.checked=options.tint;
      else if (key && key in options) input.value=key==='slope' ? options.slope?'slope':'flat' : String(options[key as keyof typeof options]);
    }
  }
  function renderState() {
    const showing=[...opacities.values()].filter(v=>v>.5).length;
    state.textContent=`${showing} models showing · ${view==='workload'?1000:0} icon-only entities\n${options.thresholdMeters} m switch · ${options.deadZoneMeters} m dead zone\n${options.sizeMode==='enlarged'?`${options.targetPixels} px minimum`:'Authored real size'} · ${options.transition} swap`;
    switcher.querySelector('span')!.textContent=({ring:'Model ring',box:'Model box',bright:'Brighten model'})[options.treatment];
  }
  function makeFeatures(): MapFeature<Sample>[] {
    const count=view==='workload'?1100:view==='samples'?4:1;
    const center: [number,number]=view==='date-line'?[179.99998,10]:view==='world-copy'?[6.8694,45.9255]:view==='slope'?[6.884,45.9155]:[6.8694,45.9255];
    return Array.from({length:count},(_,i) => {
      const model=i<100, sample=samples[i%samples.length]!;
      const phase=tick/40+i, movement=paused?0:1;
      let lng=center[0]+(model ? ((i%10)-4.5)*.00035:((i-100)%40-19.5)*.00045);
      let lat=center[1]+(model ? (Math.floor(i/10)-4.5)*.00025:(Math.floor((i-100)/40)-12)*.00032);
      if (view!=='workload') { lng=center[0]+(view==='samples'?(i-1.5)*.0008:0); lat=center[1]; }
      if (view==='workload') { lng+=Math.sin(phase)*.000045*movement; lat+=Math.cos(phase)*.000025*movement; }
      lng=((lng+180)%360+360)%360-180;
      const sampleForView=view==='slope'||view==='precision'||view==='date-line'||view==='world-copy'?samples[1]!:sample;
      const affiliation=i%4, color=['#489dde','#ca5645','#4c9260','#a98b35'][affiliation]!;
      return {type:'Feature',id:model?`model-${i}`:`icon-${i-100}`, geometry:{type:'Point',coordinates:[lng,lat]},
        properties:{name:model?`${sampleForView.name} ${String(i+1).padStart(2,'0')}`:`Icon ${i-99}`,kind:model?sampleForView.id:'Icon entity',icon:`prototype-${model?sampleForView.id:'drone'}`,color,
          label:model&&i<4?sampleForView.name:undefined},
        entity:{...(model&&sampleForView.airborne?{altitude:{meters:sampleForView.airborne,reference:'ground' as const}}:{}),
          attachments:model&&i===0&&view==='workload'?[{id:'ground-zone',type:'circle',radius:18,color:'#489dde',fillOpacity:.15}, {id:'volume',type:'sphere',radius:8,color:'#e1a33e',fillOpacity:.16}]:[]}};
    });
  }
  function syncModels() {
    if (destroyed) return;
    const selection=new Set(viewport.getSelection());
    layer.setEntities(viewport.getFeatures().filter(f=>f.id.startsWith('model-')).flatMap(f=>{
      if (f.geometry.type!=='Point') return [];
      const [lng,lat]=f.geometry.coordinates;
      if (lng===undefined||lat===undefined) return [];
      const entity=viewport.getEntityState(f.id);
      const ground=map.getTerrain()?map.queryTerrainElevation([lng,lat]):0;
      if (ground===null) return [];
      const rawGround=ground/(map.getTerrain()?.exaggeration??1);
      const airborne=f.entity?.altitude?.meters??0;
      const index=Number(f.id.slice(6)), tint=affiliations[index%4]!;
      return [{id:f.id,modelId:f.properties.kind,lng,lat,height:entity?.altitude??rawGround+airborne,heading:(index*37+tick*1.5)%360,
        pitch:f.properties.kind==='plane'?8:0,roll:f.properties.kind==='plane'?Math.sin(tick/30)*12:0,grounded:airborne===0,tint,selected:selection.has(f.id),hovered:f.id===hovered}];
    }));
  }
  function advance() {
    if (destroyed||paused||document.hidden) return;
    tick++; const started=performance.now(); viewport.upsert(makeFeatures()); updateTimes.push(performance.now()-started); syncModels();
  }
  function resetView() {
    const center:[number,number]=view==='date-line'?[180.00003,10]:view==='world-copy'?[366.8694,45.9255]:view==='slope'?[6.884,45.9155]:[6.8694,45.9255];
    viewport.setCamera({center,zoom:view==='precision'||view==='date-line'||view==='world-copy'?19:view==='slope'?17.5:view==='samples'?17:16,pitch:view==='slope'?35:60,bearing:view==='slope'?90:-20});
  }
  function setView(next: View) {
    view=next; tick=0; opacities.clear(); viewport.clear(); viewport.upsert(makeFeatures());
    viewport.setSelection([view==='workload'||view==='samples'?'model-1':'model-0']);
    container.querySelector<HTMLSelectElement>('[data-control="view"]')!.value=view;
    if (view==='transition') {
      viewport.configure({projection:'globe'}); options.thresholdMeters=200000;
      const projectionControl=document.querySelector<HTMLSelectElement>('#projection');
      if(projectionControl)projectionControl.value='globe';
    }
    else options.thresholdMeters=2000;
    setOptions({}); resetView(); syncModels();
  }
  function attach() {
    if (destroyed||!map.getLayer('rl:entities')) return;
    if (!map.getLayer(layer.id)) map.addLayer(layer,'rl:entities');
    const entities=entityLayer();
    if (entities) {
      entities.setModelPicker((x,y,tolerance)=>layer.pick(x,y,tolerance));
      for (const [id,opacity] of opacities) entities.setRepresentationOpacity(id,1-opacity);
    }
    for (const [layerId,paint] of [['rl:icons','icon-opacity'],['rl:points','circle-opacity'],['rl:points','circle-stroke-opacity']] as const) {
      if (map.getLayer(layerId)) map.setPaintProperty(layerId,paint,['case',['boolean',['feature-state','editing'],false],0,['-',1,['coalesce',['feature-state','modelOpacity'],0]]]);
    }
    if(map.getLayer('rl:icons')) map.setPaintProperty('rl:icons','icon-opacity-transition',{duration:0});
    for (const [id,opacity] of opacities) if (map.getSource(FEATURE_SOURCE)) map.setFeatureState({source:FEATURE_SOURCE,id:sourceFeatureId(id)},{modelOpacity:opacity});
  }

  const updateTimes:number[]=[], cpuTimes:number[]=[], modelTimes:number[]=[], gpuTimes:number[]=[];
  const onRender=()=>{
    renderCount++;
    cpuTimes.push(layer.metrics.renderSubmitMs);
    modelTimes.push(layer.metrics.cpuPassMs);
    for(const sample of layer.drainGpuTimes())gpuTimes.push(sample.gpuMs);
    if(cpuTimes.length>10000) {cpuTimes.splice(0,5000);modelTimes.splice(0,5000);gpuTimes.splice(0,5000);updateTimes.splice(0,5000);}
    if (renderCount%10===0)renderState();
  };
  map.on('render',onRender); map.on('style.load',attach);
  const offEntity=viewport.on('entitychange',event=>{if(event.ids.some(id=>id.startsWith('model-')))syncModels();});
  const offSelection=viewport.on('selectionchange',syncModels);
  const offHover=viewport.on('hover',event=>{hovered=event.features[0]?.id??'';syncModels();});
  function setPaused(next:boolean) {
    paused=next; container.querySelector<HTMLButtonElement>('[data-action="pause"]')!.textContent=paused?'Resume motion':'Pause motion';
  }
  async function measure(durationMs=10000) {
    const ui:number[]=[],started=performance.now(); let previous=started;
    const before={cpu:cpuTimes.length,model:modelTimes.length,gpu:gpuTimes.length,updates:updateTimes.length,renders:renderCount};
    measurement.textContent='Measuring camera motion and entity updates…';
    const bearing=map.getBearing();
    await new Promise<void>(resolve=>{
      function frame(now:number) {
        if(destroyed){resolve();return;}
        ui.push(now-previous);previous=now;
        map.jumpTo({bearing:bearing+(now-started)/1000*2});
        if(now-started<durationMs)requestAnimationFrame(frame);else resolve();
      }
      requestAnimationFrame(frame);
    });
    const result={date:new Date().toISOString(),durationMs:performance.now()-started,view,options:{...options},camera:viewport.map.getZoom(),
      projection:viewport.getConfiguration().projection,viewport:{width:map.getCanvas().clientWidth,height:map.getCanvas().clientHeight},devicePixelRatio,
      uiFrameMs:summary(ui),modelSubmissionMs:summary(cpuTimes.slice(before.cpu)),modelCpuMs:summary(modelTimes.slice(before.model)),modelGpuMs:summary(gpuTimes.slice(before.gpu)),
      upsertMs:summary(updateTimes.slice(before.updates)),mapRenders:renderCount-before.renders,metrics:{...layer.metrics},loads:loadTimings,gpu:gpuInfo(),errors:[...errors]};
    measurement.textContent=`UI frame p95 ${result.uiFrameMs.p95?.toFixed(1)} ms\nModel submission p95 ${result.modelSubmissionMs.p95?.toFixed(2)} ms\nModel CPU p95 ${result.modelCpuMs.p95?.toFixed(2)} ms\n${result.modelGpuMs.samples?`Model GPU p95 ${result.modelGpuMs.p95?.toFixed(2)} ms`:'GPU duration unavailable'}\n${result.mapRenders} map frames · ${result.metrics.instances} models drawn`;
    measurements.push(result); return result;
  }
  const measurements: { uiFrameMs:ReturnType<typeof summary>;modelCpuMs:ReturnType<typeof summary>;modelGpuMs:ReturnType<typeof summary>;[key:string]:unknown }[]=[];
  function gpuInfo() {
    const gl=map.getCanvas().getContext('webgl2'),debug=gl?.getExtension('WEBGL_debug_renderer_info');
    return {browser:navigator.userAgent,renderer:debug&&gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL),vendor:debug&&gl?.getParameter(debug.UNMASKED_VENDOR_WEBGL)};
  }
  function setDetail(detail:1|4|16) {
    for(const [id,entry] of registry) {let model=originals.get(id)!;for(let i=1;i<detail;i*=4)model=subdivide(model);entry.model=model;}
    layer.setModels(new Map(registry));syncModels();
  }
  function loseContext() {
    const gl=map.getCanvas().getContext('webgl2'),extension=gl?.getExtension('WEBGL_lose_context');
    if(!extension){status.textContent='Context loss extension unavailable.';return;}
    extension.loseContext();setTimeout(()=>{if(!destroyed)extension.restoreContext();},800);
  }
  const onRestored=()=>{attach();syncModels();};
  map.getCanvas().addEventListener('webglcontextrestored',onRestored,{signal:lifetime.signal});
  container.addEventListener('change',event=>{
    const input=event.target;if(!(input instanceof HTMLInputElement||input instanceof HTMLSelectElement))return;
    const key=input.dataset.control;
    if(key==='view'&&views.includes(input.value as View))setView(input.value as View);
    else if(key==='sizeMode'&&(input.value==='real'||input.value==='enlarged'))setOptions({sizeMode:input.value});
    else if(key==='transition'&&(input.value==='instant'||input.value==='fade'))setOptions({transition:input.value});
    else if(key==='treatment'&&(input.value==='ring'||input.value==='box'||input.value==='bright'))setOptions({treatment:input.value});
    else if(key==='slope')setOptions({slope:input.value==='slope'});
    else if(key==='tint'&&input instanceof HTMLInputElement)setOptions({tint:input.checked});
    else if((key==='targetPixels'||key==='thresholdMeters'||key==='deadZoneMeters')&&input instanceof HTMLInputElement&&input.checkValidity())setOptions({[key]:input.valueAsNumber});
    else if(key==='detail')setDetail(Number(input.value)===16?16:Number(input.value)===4?4:1);
  },{signal:lifetime.signal});
  container.addEventListener('click',event=>{
    const target=event.target;if(!(target instanceof HTMLButtonElement))return;
    switch(target.dataset.action){case'pause':setPaused(!paused);break;case'top':viewport.setCamera({pitch:0});break;case'tilt':viewport.setCamera({pitch:60});break;case'measure':void measure();break;case'context':loseContext();break;}
  },{signal:lifetime.signal});
  function cycle(direction:number){const choices=['ring','box','bright'] as const;setOptions({treatment:choices[(choices.indexOf(options.treatment)+direction+3)%3]!});syncModels();}
  switcher.querySelectorAll('button').forEach((button,i)=>button.addEventListener('click',()=>cycle(i?1:-1),{signal:lifetime.signal}));
  document.addEventListener('keydown',event=>{if(event.target instanceof HTMLInputElement||event.target instanceof HTMLSelectElement||event.target instanceof HTMLTextAreaElement)return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();cycle(event.key==='ArrowRight'?1:-1);}},{signal:lifetime.signal});

  // Locally generated category icons remain ordinary registered consumer icons.
  for(const sample of samples){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=48;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#fafbf7';ctx.strokeStyle='#284d65';ctx.lineWidth=2;
    ctx.beginPath();ctx.roundRect(2,2,44,44,3);ctx.fill();ctx.stroke();ctx.fillStyle='#284d65';ctx.font='bold 25px system-ui';ctx.textAlign='center';ctx.fillText(sample.id==='plane'?'✈':sample.id==='boat'?'B':sample.id==='tank'?'T':'D',24,33);
    viewport.registerIcon(`prototype-${sample.id}`,{image:ctx.getImageData(0,0,48,48),url:canvas.toDataURL(),pixelRatio:2});
  }
  const variant=new URLSearchParams(location.search).get('variant');if(variant==='ring'||variant==='box'||variant==='bright')options.treatment=variant;
  const requestedView=new URLSearchParams(location.search).get('modelView');
  layer.setOptions(options);attach();setView(views.includes(requestedView as View)?requestedView as View:'workload');setPaused(paused);
  motion=setInterval(advance,100);
  const ready=Promise.all(samples.map(async sample=>{
    const response=await fetch(`/entity-models/${sample.file}`);if(!response.ok)throw new Error(`${sample.id}: HTTP ${response.status}`);
    const bytes=await response.arrayBuffer(),started=performance.now();const model=parseGlb(bytes),parseMs=performance.now()-started;
    const decodeStart=performance.now(),images=await decodeModelImages(model),decodeMs=performance.now()-decodeStart;
    if(destroyed){images.forEach(image=>image.close());return;}
    originalBytes.set(sample.id,bytes);originals.set(sample.id,model);registry.set(sample.id,{model,images,metersPerUnit:sample.scale,headingOffset:sample.headingOffset});
    loadTimings.push({id:sample.id,bytes:bytes.byteLength,triangles:model.triangles,parseMs,decodeMs});
  })).then(()=>{if(destroyed)return;layer.setModels(registry);syncModels();status.textContent='Four models loaded. Select or hover a model to compare treatments.';container.querySelector<HTMLElement>('[data-gpu]')!.textContent=String(gpuInfo().renderer);}).catch(cause=>{errors.push(String(cause));status.textContent=`Model loading failed. Icons retained. ${String(cause)}`;});
  const api={viewport,layer,options,registry,originalBytes,loads:loadTimings,measurements,errors,ready,setOptions,setView,setPaused,setDetail,measure,loseContext,gpuInfo,
    get renderCount(){return renderCount;},get opacities(){return Object.fromEntries(opacities);},syncModels};
  Object.defineProperty(window,'__entityModelsPrototype',{value:api,configurable:true});
  return {resetView,destroy(){
    destroyed=true;clearInterval(motion);cancelAnimationFrame(opacityFrame);lifetime.abort();offEntity();offSelection();offHover();
    map.off('render',onRender);map.off('style.load',attach);
    const entities=entityLayer();if(entities){entities.setModelPicker(undefined);for(const id of opacities.keys())entities.setRepresentationOpacity(id,1);}
    if(map.getLayer(layer.id))map.removeLayer(layer.id);layer.dispose();registry.forEach(entry=>entry.images.forEach(image=>image.close()));switcher.remove();
    Reflect.deleteProperty(window,'__entityModelsPrototype');container.replaceChildren();
  }};
}
