// Execute visible playground workflows. Software WebGL results are smoke evidence only.
import { chromium } from 'playwright';
import { writeFile,mkdir } from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const out=new URL('./',import.meta.url).pathname;
const group=process.argv[2]??'appearance';
await mkdir(`${out}screenshots`,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
process.on('uncaughtException',async error=>{console.error(error);await browser.close();process.exit(1);});
const context=await browser.newContext({viewport:{width:1100,height:760},recordVideo:{dir:`${out}raw-recordings`,size:{width:1100,height:760}}});
const page=await context.newPage();
page.setDefaultTimeout(90000);
const observations={date:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),group,environment:'Software WebGL only',steps:[],errors:[],networkFailures:[]};
page.on('pageerror',e=>{observations.errors.push(String(e));console.log('pageerror',String(e));});
page.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')observations.networkFailures.push({url:r.url(),error:r.failure()?.errorText});});
const evaluate=(fn,arg)=>page.evaluate(fn,arg);
const state=()=>evaluate(()=>{const p=window.__entityModelsPrototype;return {gpu:p.gpuInfo(),metrics:p.layer.getMetrics(),loads:p.loads,errors:p.errors,opacities:p.opacities,boxes:p.layer.projectedBoxes,features:p.viewport.getFeatures().length,selection:p.viewport.getSelection(),camera:{center:p.viewport.map.getCenter(),zoom:p.viewport.map.getZoom(),pitch:p.viewport.map.getPitch()},options:{...p.options},drawOrder:p.viewport.map.style?._order,layers:p.viewport.map.getStyle().layers.map(l=>({id:l.id,type:l.type})),sourceLoaded:p.viewport.map.isSourceLoaded('rl:terrain')};});
async function save(name,extra={}) {
  await page.waitForTimeout(800);
  const observation=await state();
  await page.screenshot({path:`${out}screenshots/${name}.png`,timeout:90000});
  observations.steps.push({name,capturedAt:new Date().toISOString(),...extra,...observation});
  await writeFile(`${out}software-${group}.json`,JSON.stringify(observations,null,2));
  console.log(name,JSON.stringify({models:observation.metrics.instances,triangles:observation.metrics.triangles,drawCalls:observation.metrics.drawCalls,errors:observation.errors}));
}
const initialView=group==='slope'?'slope':group==='workload'?'workload':group==='globe'||group==='controls'?'transition':group==='precision18'?'precision':'samples';
await page.goto(process.env.PROTOTYPE_URL??`http://127.0.0.1:5176/?scenario=entity-models&modelView=${initialView}&paused=1`,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>!!window.__entityModelsPrototype);
await evaluate(()=>window.__entityModelsPrototype.ready);
console.log('packaged prototype loaded');
await page.waitForFunction(expected=>window.__entityModelsPrototype.layer.metrics.instances>=expected,initialView==='samples'?3:1);
const before=await state();
await page.selectOption('#basemap','positron');
await page.waitForFunction(expected=>!!window.__entityModelsPrototype.viewport.map.getLayer('rl:entity-models-prototype')&&window.__entityModelsPrototype.layer.metrics.instances>=expected,initialView==='samples'?3:1);
const after=await state();
observations.steps.push({name:'basemap-change',beforeUploads:before.metrics.uploads,afterUploads:after.metrics.uploads,selection:after.selection});
if(group==='appearance') {
await save('size-enlarged');
await page.selectOption('[data-control="sizeMode"]','real');await save('size-real');
await page.selectOption('[data-control="sizeMode"]','enlarged');
await page.check('[data-control="tint"]');await save('tint-on');
await page.uncheck('[data-control="tint"]');await save('tint-off');
for(const treatment of ['ring','box','bright']) {
  await page.selectOption('[data-control="treatment"]',treatment);
  const box=await evaluate(()=>window.__entityModelsPrototype.layer.projectedBoxes.find(b=>b.entityId==='model-0'));
  if(box)await page.mouse.move(300+(box.minX+box.maxX)/2,52+(box.minY+box.maxY)/2);
  await save(`treatment-${treatment}`);
}
await page.mouse.move(50,50);
// A model-box hit enters the existing viewport click/selection workflow.
const tank=await evaluate(()=>window.__entityModelsPrototype.layer.projectedBoxes.find(b=>b.entityId==='model-1'));
if(tank){await page.mouse.click(300+(tank.minX+tank.maxX)/2,52+(tank.minY+tank.maxY)/2);await save('box-picking');}
}
if(group==='slope') {
await page.selectOption('[data-control="view"]','slope');
await page.waitForFunction(()=>window.__entityModelsPrototype.layer.metrics.instances===1);
await page.selectOption('[data-control="slope"]','flat');await save('slope-flat');
await page.selectOption('[data-control="slope"]','slope');await save('slope-following');
await page.selectOption('[data-control="sizeMode"]','real');await save('slope-real');
}
if(group==='precision') {
await evaluate(()=>{const p=window.__entityModelsPrototype;p.registry.get('tank').metersPerUnit=.1;p.setOptions({sizeMode:'real'});});
await page.selectOption('[data-control="view"]','precision');
await evaluate(()=>window.__entityModelsPrototype.viewport.setCamera({zoom:18}));await save('precision-zoom18');
await evaluate(()=>window.__entityModelsPrototype.viewport.setCamera({zoom:19}));
await save('precision-zoom19');
await evaluate(()=>window.__entityModelsPrototype.viewport.setCamera({zoom:20}));await save('precision-zoom20');
await page.selectOption('[data-control="view"]','date-line');await save('date-line');
await page.selectOption('[data-control="view"]','world-copy');await save('world-copy');
const sweep=[];
for(const [lng,zoom] of [[6.86939,18],[6.8694,18.5],[6.86941,19],[6.8694,19.5],[6.86939,20]]) {
  const beforeFrame=await evaluate(()=>window.__entityModelsPrototype.layer.metrics.frames);
  await evaluate(([lng,zoom])=>window.__entityModelsPrototype.viewport.setCamera({center:[lng+360,45.9255],zoom}),[lng,zoom]);
  await page.waitForFunction(before=>window.__entityModelsPrototype.layer.metrics.frames>before,beforeFrame);
  sweep.push({lng,zoom,box:await evaluate(()=>window.__entityModelsPrototype.layer.projectedBoxes[0])});
}
observations.steps.push({name:'meter-scale-world-copy-camera-sweep',metersPerUnit:.1,sweep});
}
if(group==='precision18') {
await evaluate(()=>{const p=window.__entityModelsPrototype;p.registry.get('tank').metersPerUnit=.1;p.setOptions({sizeMode:'real'});p.viewport.setCamera({zoom:18});});
await page.waitForFunction(()=>window.__entityModelsPrototype.layer.metrics.instances===1);
await save('precision-zoom18');
}
if(group==='switching') {
await page.selectOption('[data-control="view"]','samples');
await page.selectOption('[data-control="sizeMode"]','enlarged');
await page.selectOption('[data-control="transition"]','instant');
await page.fill('[data-control="thresholdMeters"]','10');await page.locator('[data-control="thresholdMeters"]').blur();await save('instant-icons');
await page.fill('[data-control="thresholdMeters"]','2000');await page.locator('[data-control="thresholdMeters"]').blur();await save('instant-models');
await page.selectOption('[data-control="transition"]','fade');
await page.fill('[data-control="thresholdMeters"]','10');await page.locator('[data-control="thresholdMeters"]').blur();await save('fade-icons');
await page.fill('[data-control="thresholdMeters"]','2000');await page.locator('[data-control="thresholdMeters"]').blur();await save('fade-models');
const rendersBefore=await evaluate(()=>window.__entityModelsPrototype.renderCount);
await page.waitForTimeout(5000);
const rendersAfter=await evaluate(()=>window.__entityModelsPrototype.renderCount);
observations.steps.push({name:'idle-5-seconds',rendersBefore,rendersAfter});
}
if(group==='lifecycle') {
await evaluate(()=>window.__entityModelsPrototype.loseContext());
await page.waitForFunction(()=>window.__entityModelsPrototype.layer.metrics.contextRestores>=1&&window.__entityModelsPrototype.layer.metrics.instances>=3);
await save('context-restored');
}
if(group==='workload') {
await page.selectOption('[data-control="view"]','workload');
await page.waitForFunction(()=>window.__entityModelsPrototype.viewport.getFeatures().length===1100);
await save('workload-paused');
await page.click('[data-action="pause"]');
await page.waitForTimeout(2500);await save('workload-moving');
await evaluate(()=>window.__entityModelsPrototype.setPaused(true));
// Smoke frame observations have no authority to set a hardware triangle guideline.
const softwareMeasurement=await evaluate(()=>{window.__entityModelsPrototype.setPaused(false);return window.__entityModelsPrototype.measure(3000);});
observations.steps.push({name:'software-frame-smoke',measurement:softwareMeasurement});
}
if(group==='globe') {
await page.selectOption('[data-control="view"]','transition');
await evaluate(()=>window.__entityModelsPrototype.viewport.setCamera({zoom:11,pitch:45}));await save('globe-zoom11');
await evaluate(()=>window.__entityModelsPrototype.viewport.setCamera({zoom:11.5}));await save('globe-zoom11-5');
await evaluate(()=>window.__entityModelsPrototype.viewport.setCamera({zoom:12}));await save('globe-zoom12');
await evaluate(()=>{const p=window.__entityModelsPrototype;p.setOptions({thresholdMeters:30000000});p.viewport.setCamera({center:[-173.1306,-45.9255],zoom:1,pitch:0});});
await page.waitForFunction(()=>window.__entityModelsPrototype.layer.metrics.instances===0);
await save('globe-behind-planet');
}
if(group==='controls') {
await page.waitForFunction(()=>document.querySelector('#projection').value==='globe');
observations.steps.push({name:'globe-control-matches-view',value:await page.inputValue('#projection')});
await page.selectOption('#projection','flat');
await page.waitForFunction(()=>window.__entityModelsPrototype.viewport.getConfiguration().projection==='flat'&&window.__entityModelsPrototype.layer.metrics.instances===1);
await save('globe-control-to-flat');
}
if(group==='extras') {
  // Real input must change selection from the previous entity.
  await page.waitForFunction(()=>window.__entityModelsPrototype.layer.projectedBoxes.some(b=>b.entityId==='model-0'));
  const drone=await evaluate(()=>window.__entityModelsPrototype.layer.projectedBoxes.find(b=>b.entityId==='model-0'));
  await page.mouse.click(300+(drone.minX+drone.maxX)/2,52+(drone.minY+drone.maxY)/2);
  await page.waitForFunction(()=>window.__entityModelsPrototype.viewport.getSelection()[0]==='model-0');
  await save('model-click-selected-drone');
  await page.fill('[data-control="targetPixels"]','40');await page.locator('[data-control="targetPixels"]').blur();
  await save('size-enlarged-40px');
  await page.click('[data-action="top"]');await save('top-down-enlarged');
  await page.selectOption('[data-control="sizeMode"]','real');await save('top-down-real');
  await page.selectOption('[data-control="sizeMode"]','enlarged');
  const distance=await evaluate(()=>window.__entityModelsPrototype.layer.projectedBoxes.find(b=>b.entityId==='model-1').cameraDistance);
  const changes=[];
  for(const [name,threshold,expected] of [['inside-near-band',distance-50,1],['exit-beyond-band',distance-150,0],['inside-far-band',distance-50,0],['enter-beyond-band',distance+150,1]]) {
    await evaluate(t=>window.__entityModelsPrototype.setOptions({thresholdMeters:t,deadZoneMeters:200,transition:'instant'}),threshold);
    await page.waitForFunction(wanted=>window.__entityModelsPrototype.opacities['model-1']===wanted,expected);
    changes.push({name,threshold,expected,applied:await evaluate(()=>window.__entityModelsPrototype.opacities['model-1'])});
  }
  observations.steps.push({name:'dead-zone-top-down',distance,changes});
  await evaluate(()=>window.__entityModelsPrototype.setOptions({thresholdMeters:2000}));
  await page.click('[data-action="tilt"]');
  await evaluate(()=>{const p=window.__entityModelsPrototype;const entry=p.registry.get('plane');entry.model={...entry.model,batches:entry.model.batches.map(b=>({...b,material:{...b.material,alphaMode:'BLEND',baseColor:[...b.material.baseColor.slice(0,3),.35]}}))};p.layer.setModels(new Map(p.registry));});
  await save('material-translucent-fixture');
  await evaluate(()=>{const p=window.__entityModelsPrototype;const entry=p.registry.get('drone');entry.model={...entry.model,batches:entry.model.batches.map(b=>({...b,material:{...b.material,alphaMode:'MASK',alphaCutoff:.5,baseColor:[...b.material.baseColor.slice(0,3),.25]}}))};p.layer.setModels(new Map(p.registry));});
  await save('material-cutout-fixture');
  // Restore original assets before measuring only the drone's cold upload submission.
  const frameBeforeReset=await evaluate(()=>window.__entityModelsPrototype.layer.metrics.frames);
  await evaluate(()=>window.__entityModelsPrototype.setDetail(1));
  await page.waitForFunction(frame=>window.__entityModelsPrototype.layer.metrics.frames>frame,frameBeforeReset);
  const uploadBefore=await evaluate(()=>window.__entityModelsPrototype.layer.metrics.uploadMs);
  await evaluate(()=>{const p=window.__entityModelsPrototype;p.layer.setModels(new Map([['drone',p.registry.get('drone')]]));});
  await page.waitForFunction(()=>window.__entityModelsPrototype.layer.metrics.instances===1);
  const uploadAfter=await evaluate(()=>window.__entityModelsPrototype.layer.metrics.uploadMs);
  observations.steps.push({name:'largest-sample-upload-submission',model:'drone',uploadCpuMs:uploadAfter-uploadBefore});
  await save('largest-sample-loaded');
}
await writeFile(`${out}software-${group}.json`,JSON.stringify(observations,null,2));
const video=page.video();await context.close();observations.video=await video.path();
await writeFile(`${out}software-${group}.json`,JSON.stringify(observations,null,2));await browser.close();
console.log('capture complete',observations.video);
