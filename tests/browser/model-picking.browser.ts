import { attachInteractions, createViewport } from '@ridgeline/map';
import type { Interaction, MapFeature, Viewport } from '@ridgeline/map';
import { MercatorCoordinate } from 'maplibre-gl';
import { solidGlb } from './model-fixtures';
import { axisModelGlb, planarTerrain } from './model-placement-fixtures';
import { captureMapPixels, pixelToCss, waitForVisible } from './browser-observation';

import type { BrowserCaseContext as Context, BrowserCaseModule } from './context';
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function pointer(action: 'move' | 'click', x: number, y: number) {
  check(window.drawingPointer, 'Real pointer bridge unavailable'); await window.drawingPointer(action, x, y);
}
function entity(id = 'model'): MapFeature {
  return { type: 'Feature', id, properties: { name: id }, geometry: { type: 'Point', coordinates: [0, 0] },
    entity: { heading: 0, altitude: { meters: 30, reference: 'ground' }, model: { id: 'asset', minimumSizePixels: 120 } } };
}
function create(context: Context, features = [entity()], sample: () => number | null = () => 0) {
  const viewport = context.own(createViewport({ container: context.container, features, elevationSampler: { sample },
    basemap: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }] },
    camera: { center: [0, 0], zoom: 17, pitch: 0, bearing: 0 },
    entityModels: { switchDistanceMeters: 1e7, deadZoneMeters: 0, minimumSizePixels: 120 },
    style: feature => ({ radius: 6, color: '#0000ff', icon: feature.id === 'ordinary' ? 'ordinary-icon' : 'entity-icon' }), logger: () => {} }));

  const bytes = new Uint8ClampedArray(12 * 12 * 4);
  for (let i = 0; i < bytes.length; i += 4) { bytes[i + 2] = 255; bytes[i + 3] = 255; }
  viewport.registerIcon('entity-icon', { image: new ImageData(bytes, 12, 12) });
  const yellow = bytes.slice();
  for (let i=0;i<yellow.length;i+=4) { yellow[i]=255; yellow[i+1]=255; yellow[i+2]=0; }
  viewport.registerIcon('ordinary-icon', { image: new ImageData(yellow,12,12) });
  return viewport;
}
async function ready(context: Context, viewport: Viewport) {
  await viewport.ready; await viewport.registerModel('asset', { bytes: axisModelGlb() });
  await context.until(() => viewport.getEntityState('model')?.representation === 'model', 'drawn model');
}
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function frame(viewport: Viewport) {
  await new Promise<void>(resolve => { viewport.map.once('render', () => resolve()); viewport.map.triggerRepaint(); });
  await Promise.resolve();
}
async function colors(viewport: Viewport, timeout = 8000) {
  const image = await captureMapPixels(viewport, timeout), pixels = image.bytes;
  let colored = 0; const magenta = { count: 0, x: 0, y: 0 };
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3]! <= 16) continue;
    if (Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) - Math.min(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > 100) colored++;
    if (pixels[i]! > pixels[i + 1]! + 80 && pixels[i + 2]! > pixels[i + 1]! + 80) {
      const point = pixelToCss(image, { x: i / 4 % image.width, y: Math.floor(i / 4 / image.width) });
      magenta.count++; magenta.x += point.x; magenta.y += point.y;
    }
  }
  if (magenta.count) { magenta.x /= magenta.count; magenta.y /= magenta.count; }
  const index = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4;
  return { colored, center: [...pixels.slice(index, index + 3)], magenta };
}
async function key(value: string) { check(window.browserKey, 'Real keyboard bridge unavailable'); await window.browserKey(value); }

export const modelPickingCases = {
  "Model pixel observation aligns visible picking across canvas ratios and rejects absent models": async (context) => {
    check(devicePixelRatio === 2, 'This fixture must exercise browser DPR 2 independently of the map ratio');
    const located = entity(); located.geometry = { type: 'Point', coordinates: [.0002, .00015] };
    located.entity!.attachments = [{ id: 'zone', type: 'polygon', vertices: [[-50,-50],[50,-50],[50,50],[-50,50]] }];
    const viewport = create(context, [located]), clicks: Interaction<Record<string, unknown>>[] = [];
    viewport.on('click', value => { clicks.push(value); });
    try {
      await viewport.ready;
      for (const ratio of [1, 2]) {
        viewport.map.setPixelRatio(ratio);
        await viewport.registerModel('asset', { bytes: axisModelGlb() });
        await context.until(() => viewport.getEntityState('model')?.representation === 'model', 'published model');
        const visible = await waitForVisible(remaining => colors(viewport, remaining), result => result.magenta.count > 100,
          { timeout: 8000, description: `model body at map ratio ${ratio}` });
        const canvas = viewport.map.getCanvas();
        check(Math.abs(canvas.width / canvas.clientWidth - ratio) < .01 && Math.abs(canvas.height / canvas.clientHeight - ratio) < .01,
          'Map drawing-buffer ratio did not match its configured value');
        await pointer('click', visible.magenta.x, visible.magenta.y);
        check(clicks.at(-1)?.features[0]?.id === 'model', `Visible pixels did not pick the model at ratio ${ratio}`);
        viewport.unregisterModel('asset');
        viewport.map.setPaintProperty('background', 'background-color', '#ff00ff');
        viewport.map.setPaintProperty('background', 'background-opacity', 0);
        const absent = await colors(viewport);
        check(absent.colored > 100, 'The unrelated blue attachment must remain visible in the negative fixture');
        check(absent.magenta.count === 0, 'Transparent background or unrelated attachment pixels counted as a model');
      }
    } finally { viewport.destroy(); }
  },
  "Model picking uses drawn boxes and returns original entity and attachment hits": async (context) => {
    const viewport = create(context), clicks: Interaction<Record<string, unknown>>[] = [];
    viewport.on('click', value => { clicks.push(value); });
    try {
      await ready(context, viewport);
      const canvas = viewport.map.getCanvas(), x = canvas.clientWidth / 2, y = canvas.clientHeight / 2;
      await pointer('click', x + 25, y + 25);
      check(clicks.at(-1)?.features[0]?.id === 'model', 'Empty box region did not return the original model entity');
      check(clicks.at(-1)?.attachments.length === 0, 'Model picking invented an attachment');
      check(viewport.getSelection().length === 0, 'Click changed consumer-owned selection');
      await pointer('click', x + 90, y + 90);
      check(clicks.at(-1)?.features.length === 0, 'Point beyond the projected box and tolerance was picked');
      const attached = entity(); attached.entity!.attachments = [{ id: 'zone', type: 'polygon', vertices: [[-100,-100],[100,-100],[100,100],[-100,100]] }];
      viewport.upsert([attached]); await frame(viewport); await pause(100);
      await pointer('click', x + 25, y + 25);
      check(clicks.at(-1)?.features.length === 1 && clicks.at(-1)?.attachments.some(hit => hit.entityId === 'model' && hit.attachmentId === 'zone'), 'Actual attachment identity was lost or duplicated model entity');
      const count = clicks.length, release = viewport.acquireInteraction('test-tool');
      await pointer('click', x + 25, y + 25); check(clicks.length === count, 'Interaction lease leaked model click'); release();
    } finally { viewport.destroy(); }
  },
  "Model picking clips terrain near-plane and displayed world copies": async (context) => {
    const viewport = create(context), clicks: Interaction<Record<string, unknown>>[] = [];
    viewport.on('click', value => { clicks.push(value); });
    try {
      await ready(context, viewport);
      const canvas = viewport.map.getCanvas(), x = canvas.clientWidth / 2, y = canvas.clientHeight / 2;
      for (const [projection, longitude, latitude, zoom] of [['flat', 179.99999, 46, 18], ['flat', -179.99999, 46, 18], ['globe', 179.99999, 46, 11]] as const) {
        const moved = entity(); moved.geometry = { type: 'Point', coordinates: [longitude, latitude] };
        viewport.upsert([moved]); viewport.configure({ projection }); viewport.setCamera({ center: [longitude + (projection === 'flat' ? 720 : 0), latitude], zoom });
        await frame(viewport); await pause(150); await frame(viewport);
        check((await colors(viewport)).colored > 0, `${projection} ${longitude} model did not actually draw`);
        await pointer('click', x + 25, y + 25);
        check(clicks.at(-1)?.features[0]?.id === 'model', `${projection} ${longitude} displayed world copy was not picked`);
      }
      viewport.configure({ projection: 'flat' }); viewport.setCamera({ center: [0,0], zoom:17 });
      await viewport.registerModel('crossing', {bytes:solidGlb(),metersPerUnit:64,appearance:{mode:'color',color:'#ff00ff'}});
      const cameraHeight=viewport.map._camera.transform.getCameraAltitude(), longitude=90*360/(2*Math.PI*6371008.8), crossing=entity();
      crossing.geometry={type:'Point',coordinates:[longitude,0]}; crossing.entity!.altitude={meters:cameraHeight-25,reference:'ground'};
      crossing.entity!.model={id:'crossing',minimumSizePixels:0};
      let matrix:Float64Array|undefined;
      viewport.map.addLayer({id:'picking-near-plane-reference',type:'custom',render(_gl,input){matrix=Float64Array.from(input.defaultProjectionData.mainMatrix);}});
      viewport.upsert([crossing]); const nearPixels=await colors(viewport); check(matrix,'Near-plane reference absent');
      const anchor=MercatorCoordinate.fromLngLat([longitude,0],cameraHeight-25), units=anchor.meterInMercatorCoordinateUnits(), distances:number[]=[];
      for(const dx of [-64,64]) for(const dy of [-64,64]) for(const dz of [-32,32]) {
        const point=[anchor.x+dx*units,anchor.y+dy*units,anchor.z+dz*units,1];
        distances.push(point.reduce((sum,value,index)=>sum+value*(matrix![index*4+2]!+matrix![index*4+3]!),0));
      }
      check(Math.min(...distances)<0 && Math.max(...distances)>0,'Model bounds did not actually cross the native near plane');
      check(nearPixels.magenta.count>100,'Near-plane crossing model lost its visible exterior');
      await pointer('click',nearPixels.magenta.x,nearPixels.magenta.y);
      check(clicks.at(-1)?.features[0]?.id==='model','Visible clipped model exterior was not picked');
      viewport.map.removeLayer('picking-near-plane-reference');
      const behind = entity(); behind.entity!.altitude = { meters: viewport.map._camera.transform.getCameraAltitude() + 100, reference: 'ground' };
      viewport.upsert([behind]); await frame(viewport);
      await pointer('click', x + 25, y + 25); check(clicks.at(-1)?.features.length === 0, 'Behind-near-plane box was picked');
      const terrain = planarTerrain(0,0), hidden = entity(); hidden.geometry = { type: 'Point', coordinates: terrain.location };
      viewport.upsert([hidden]); viewport.setCamera({ center: terrain.location, zoom:17 });
      await frame(viewport); await pointer('click', x + 25, y + 25); check(clicks.at(-1)?.features[0]?.id === 'model', 'Terrain baseline box absent');
      viewport.configure({ elevation: terrain.elevation, terrain: true });
      await context.until(() => Math.abs((viewport.map.queryTerrainElevation(terrain.location) ?? 0) - 100) < 1, 'known foreground terrain');
      check((await colors(viewport)).colored === 0, 'Native foreground terrain did not visually occlude the model');
      await pointer('click', x + 25, y + 25);
      check(clicks.at(-1)?.features.length === 0, 'Box behind known native terrain was picked');
    } finally { viewport.destroy(); }
  },
  "Model overlap picker preserves choices focus and consumer selection": async (context) => {
    const far = entity('far'), near = entity('near'); near.entity!.altitude = { meters:80, reference:'ground' };
    const ordinary: MapFeature = { type:'Feature', id:'ordinary', properties:{name:'Ordinary icon'}, geometry:{type:'Point',coordinates:[0,0]} };
    const viewport = create(context, [far,near,ordinary]), clicks: Interaction<Record<string, unknown>>[] = [], requests:string[][] = [];
    viewport.on('click', value => { clicks.push(value); }); viewport.on('selectionrequest', value => { requests.push(value.ids); });
    const ui = attachInteractions(viewport);
    try {
      await viewport.ready; await viewport.registerModel('asset',{bytes:axisModelGlb()});
      await context.until(() => viewport.getEntityState('near')?.representation === 'model' && viewport.map.isSourceLoaded('rl:features'), 'overlap models');
      await frame(viewport);
      const top = (await colors(viewport)).center; check(top[0]!>220 && top[1]!>220 && top[2]!<30,'Native ordinary icon is not visibly above overlapping models');
      const canvas = viewport.map.getCanvas(), x = canvas.clientWidth/2, y = canvas.clientHeight/2;
      await pointer('click',x,y);
      check(clicks.at(-1)?.features.map(item=>item.id).join(',') === 'ordinary,near,far', 'Overlap order differs from visible layer/depth order');
      const choices = [...context.container.querySelectorAll<HTMLButtonElement>('[data-feature-id]')];
      check(choices.length === 3, 'Original entities did not open radial choices');
      check(choices.every(choice => choice.querySelector('canvas') && choice.textContent?.includes(viewport.getName(viewport.getFeature(choice.dataset.featureId!)!))), 'Model choice lost its registered icon or display name');
      const ids = choices.map(button=>button.dataset.featureId).join(',');
      viewport.configure({entityModels:{switchDistanceMeters:1,deadZoneMeters:0,minimumSizePixels:120}}); await frame(viewport);
      check([...context.container.querySelectorAll<HTMLButtonElement>('[data-feature-id]')].map(button=>button.dataset.featureId).join(',') === ids, 'Representation switch reordered open picker');
      choices[1]!.focus(); viewport.remove(['near']);
      check(choices[1]!.disabled && document.activeElement === choices[2], 'Removed choice did not preserve slot and transfer focus');
      viewport.upsert([near]); check(!choices[1]!.disabled, 'Reintroduced ID did not restore its choice');
      choices[0]!.focus(); await key('ArrowRight'); check(document.activeElement === choices[1], 'Arrow did not focus restored choice');
      await key('Enter'); check(requests.at(-1)?.[0] === 'near' && viewport.getSelection().length === 0, 'Enter did not retain consumer-owned selection');
      viewport.setSelection(requests.at(-1)!); check(viewport.getSelection()[0] === 'near', 'Consumer could not apply selection');
      await pointer('click',x,y); check(context.container.querySelector('.rl-picker'), 'Second radial picker did not open');
      await key('Escape'); check(!context.container.querySelector('.rl-picker'), 'Escape did not dismiss radial picker');
      ui.destroy(); let disposeArmed = false, disposedViewport = false;
      const cancelling = attachInteractions(viewport, { hover:false, renderFeature(feature) {
        const element=document.createElement('span'); element.textContent=feature.id;
        return { element, dispose() { if(disposeArmed) { disposeArmed=false; disposedViewport=true; viewport.destroy(); } } };
      } });
      await pointer('click',x,y); const first=context.container.querySelector<HTMLButtonElement>('[data-feature-id]');
      check(first, 'Disposal cancellation picker absent'); first.focus(); disposeArmed=true;
      const requestedBefore=requests.length; await key('Enter');
      check(disposedViewport && requests.length===requestedBefore && !context.container.querySelector('.rl-ui'), 'Destroyed picker emitted a stale selection or remounted content'); cancelling.destroy();
    } finally { ui.destroy(); viewport.destroy(); }
  },
  "Model hover follows a stationary pointer and cancels stale callbacks": async (context) => {
    let ground: number | null = 0;
    const viewport = create(context, [entity()], () => ground), hovers:string[] = [];
    viewport.on('hover', value => { hovers.push(value.features[0]?.id ?? ''); });
    const ui = attachInteractions(viewport);
    try {
      await viewport.ready;
      const canvas = viewport.map.getCanvas(), x = canvas.clientWidth/2+25, y = canvas.clientHeight/2+25;
      await pointer('move',x,y); await viewport.registerModel('asset',{bytes:axisModelGlb()});
      await context.until(() => hovers.at(-1) === 'model' && Boolean(context.container.querySelector('.rl-tooltip')), 'stationary model readiness hover');
      viewport.unregisterModel('asset');
      await context.until(() => hovers.at(-1) === '' && !context.container.querySelector('.rl-tooltip'), 'stationary unregister clearing');
      await viewport.registerModel('asset',{bytes:axisModelGlb()}); await context.until(() => hovers.at(-1) === 'model', 'stationary model recovery');
      const moved = entity(); moved.geometry={type:'Point',coordinates:[.001,0]}; viewport.upsert([moved]);
      await context.until(() => hovers.at(-1) === '', 'stationary entity motion');
      viewport.upsert([entity()]); await context.until(() => hovers.at(-1) === 'model', 'entity return');
      let movingExit = false; const off = viewport.on('hover',value => { if(!value.features.length && viewport.map.isMoving()) movingExit=true; });
      await frame(viewport); viewport.setCamera({center:[.001,0]},{duration:1500}); await context.until(()=>movingExit,'hover exit during camera animation'); off();
      await context.until(()=>!viewport.map.isMoving(),'camera settled'); viewport.setCamera({center:[0,0]});
      await context.until(()=>hovers.at(-1)==='model','camera return hover');
      ground=null; viewport.configure({elevation:{...viewport.getConfiguration().elevation}});
      await context.until(()=>hovers.at(-1)==='' && viewport.getEntityState('model')?.representation!=='model','unknown terrain clears model hover');
      ground=0; viewport.retryUpdates(); await context.until(()=>hovers.at(-1)==='model','known terrain hover recovery');
      viewport.configure({entityModels:{switchDistanceMeters:1,deadZoneMeters:0,minimumSizePixels:120}});
      await context.until(()=>hovers.at(-1)==='','stationary representation exit');
      viewport.configure({entityModels:{switchDistanceMeters:1e7,deadZoneMeters:0,minimumSizePixels:120}});
      await context.until(()=>hovers.at(-1)==='model','stationary representation return');
      await new Promise<void>(resolve => { viewport.map.once('idle', () => resolve()); viewport.map.triggerRepaint(); });
      let renders=0; const before=hovers.length, count=()=>{renders++;}; viewport.map.on('render',count); await pause(5000); viewport.map.off('render',count);
      check(renders===0 && hovers.length===before, `Settled hover stayed active: ${renders} renders, ${hovers.length-before} events`);
      ui.destroy(); viewport.remove(['model']); await context.until(()=>hovers.at(-1)==='','hover removal');
      const cancelled:string[]=[]; const cancel=viewport.on('hover',value=>{if(value.features[0])viewport.remove([value.features[0].id]);});
      const observe=viewport.on('hover',value=>{if(value.features[0])cancelled.push(value.features[0].id);});
      const replacementUI=attachInteractions(viewport); viewport.upsert([entity()]); await pause(200); await frame(viewport);
      check(cancelled.length===0 && !context.container.querySelector('.rl-tooltip'), 'Cancelled hover reached a later listener or remounted UI');
      cancel(); observe(); replacementUI.destroy();
      let replacementCallbacks = 0; const replacedNames:string[]=[];
      const replace=viewport.on('hover', value=>{ if(value.features[0]) { replacementCallbacks++; viewport.upsert([{...entity(),properties:{name:'Newest'}}]); } });
      const replacementObserver=viewport.on('hover',value=>{if(value.features[0])replacedNames.push(String(value.features[0].properties.name));});
      const latestUI=attachInteractions(viewport); viewport.upsert([entity()]);
      await context.until(()=>context.container.querySelector('.rl-tooltip')?.textContent==='Newest','replacement hover shows latest content');
      check(replacementCallbacks===1 && replacedNames.join(',')==='Newest','Replacement repeated its initiating callback or emitted stale follow-up hover'); replace(); replacementObserver(); latestUI.destroy();
    } finally { ui.destroy(); viewport.destroy(); }
  },
} satisfies BrowserCaseModule;
