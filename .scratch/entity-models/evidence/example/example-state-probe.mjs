import { preview } from '/tmp/ridgeline-model-example/node_modules/vite/dist/node/index.js';
import { chromium } from '/tmp/ridgeline-model-example/node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';
const history=process.argv[2]??'default', root='/tmp/ridgeline-model-example';
const prefix=`/tmp/ridgeline-model-context/example-state-${history}`;
const start=Date.now(),requests=[],snapshots=[],errors=[],events=[];
const server=await preview({root:root+'/playground',configFile:root+'/vite.playground.config.ts',preview:{host:'127.0.0.1',port:5176,strictPort:true},logLevel:'error'});
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const browserVersion=browser.version();
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const lookup=new Map();
 page.on('pageerror',e=>errors.push({time:Date.now()-start,message:e.message}));
 page.on('console',e=>{if(e.type()==='error'||e.type()==='warning')errors.push({time:Date.now()-start,message:e.text()})});
 page.on('request',request=>{const value={url:request.url(),start:Date.now()-start};requests.push(value);lookup.set(request,value)});
 page.on('requestfinished',request=>{const value=lookup.get(request);if(value)value.end=Date.now()-start});
 page.on('requestfailed',request=>{const value=lookup.get(request);if(value){value.end=Date.now()-start;value.failure=request.failure()}});
 await page.route('https://tiles.openfreemap.org/styles/*',route=>route.fulfill({json:{version:8,glyphs:'https://example.test/fonts/{fontstack}/{range}.pbf',sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e9efea'}}]}}));
 await page.route('https://example.test/fonts/**',route=>route.fulfill({path:root+'/tests/fixtures/noto-sans/0-255.pbf'}));
 await page.route('https://tiles.mapterhorn.com/tilejson.json',route=>route.fulfill({json:{tilejson:'3.0.0',tiles:['https://tiles.mapterhorn.com/flat/{z}/{x}/{y}.png'],minzoom:0,maxzoom:12,encoding:'terrarium'}}));
 await page.route('https://tiles.mapterhorn.com/flat/**',route=>route.fulfill({path:root+'/tests/fixtures/flat-terrain.png',contentType:'image/png'}));
 let release,requested=false;const delayed=new Promise(resolve=>release=resolve);
 if(history==='cancel')await page.route('**/entity-models/drone.glb',async route=>{requested=true;await delayed;await route.fulfill({path:root+'/playground/public/entity-models/drone.glb'})});
 await page.goto('http://127.0.0.1:5176/'+(history==='default'?'':'?scenario=models'));
 await page.waitForFunction(()=>document.querySelector('#map-status').textContent==='Ready');
 await page.evaluate(()=>{window.exampleEvents=[];window.exampleRenderCount=0;window.exampleIdleCount=0;const v=window.exampleViewport;v.map.on('render',()=>{window.exampleRenderCount++;window.exampleLastRender=performance.now()});v.map.on('idle',()=>window.exampleIdleCount++);v.on('entitychange',value=>window.exampleEvents.push({time:performance.now(),ids:value.ids}));});
 if(history==='default')await page.getByLabel('Test scenario').selectOption('models');
 if(history==='cancel') {while(!requested)await page.waitForTimeout(100);await page.getByLabel('Test scenario').selectOption('empty');release();await page.getByLabel('Test scenario').selectOption('models');}
 const waitStart=Date.now();
 while(Date.now()-waitStart<90000) {
  const value=await page.evaluate(()=>{const v=window.exampleViewport,m=v.map,c=v.getConfiguration();return{at:performance.now(),status:document.querySelector('[aria-label="Model example status"]')?.textContent,featureCount:document.querySelector('#feature-count').textContent,diagnostics:document.querySelector('#diagnostics').textContent,diagnosticsHidden:document.querySelector('#diagnostics').hidden,camera:{center:m.getCenter(),zoom:m.getZoom(),pitch:m.getPitch(),bearing:m.getBearing(),targetElevation:m.getCameraTargetElevation()},configuration:{terrain:c.terrain,hillshade:c.hillshade,elevation:c.elevation,exaggeration:c.exaggeration,entityVisibility:c.entityVisibility,entityModels:c.entityModels},tilesLoaded:m.areTilesLoaded(),styleLoaded:m.isStyleLoaded(),moving:m.isMoving(),renderCount:window.exampleRenderCount,idleCount:window.exampleIdleCount,lastRender:window.exampleLastRender,features:v.getFeatures().map(f=>({id:f.id,entity:f.entity,state:v.getEntityState(f.id),nativeGround:f.geometry.type==='Point'?m.queryTerrainElevation(f.geometry.coordinates):null})),events:window.exampleEvents.splice(0)}});
  snapshots.push({...value,elapsed:Date.now()-start});
  await writeFile(prefix+'.json',JSON.stringify({history,browserVersion,source:'a2ef7d3 plus temporary public viewport exposure in example-diagnostic-main.ts',requests,snapshots,errors},null,2));
  console.log(JSON.stringify({elapsed:Date.now()-start,status:value.status,featureCount:value.featureCount,camera:value.camera,tilesLoaded:value.tilesLoaded,styleLoaded:value.styleLoaded,renderCount:value.renderCount,idleCount:value.idleCount,states:value.features.map(f=>({id:f.id,state:f.state,nativeGround:f.nativeGround}))}));
  if(value.status==='8 models · 0 icons')break;
  await page.waitForTimeout(5000);
 }
} finally {await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
