import { attachInteractions, createViewport } from '@ridgeline/map';
import type { Interaction, MapFeature, Viewport } from '@ridgeline/map';
import { axisModelGlb, planarTerrain } from './model-placement-fixtures';

type Context = { container: HTMLDivElement; setCurrent(viewport: Viewport): void;
  until(predicate: () => boolean, description: string, timeout?: number): Promise<void> };
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function pointer(action: 'move' | 'click', x: number, y: number) {
  check(window.drawingPointer, 'Real pointer bridge unavailable'); await window.drawingPointer(action, x, y);
}
function entity(id = 'model'): MapFeature {
  return { type: 'Feature', id, properties: { name: id }, geometry: { type: 'Point', coordinates: [0, 0] },
    entity: { heading: 0, altitude: { meters: 30, reference: 'ground' }, model: { id: 'asset', minimumSizePixels: 120 } } };
}
function create(context: Context, features = [entity()]) {
  const viewport = createViewport({ container: context.container, features, elevationSampler: { sample: () => 0 },
    basemap: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }] },
    camera: { center: [0, 0], zoom: 17, pitch: 0, bearing: 0 },
    entityModels: { switchDistanceMeters: 1e7, deadZoneMeters: 0, minimumSizePixels: 120 },
    style: () => ({ radius: 6, color: '#0000ff' }), logger: () => {} });
  context.setCurrent(viewport); return viewport;
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
async function key(value: string) { check(window.browserKey, 'Real keyboard bridge unavailable'); await window.browserKey(value); }
export const modelPickingCases: readonly { name: string; run(context: Context): Promise<void> }[] = [
  { name: 'Model picking uses drawn boxes and returns original entity and attachment hits', async run(context) {
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
  } },
  { name: 'Model picking clips terrain near-plane and displayed world copies', async run(context) {
    const viewport = create(context), clicks: Interaction<Record<string, unknown>>[] = [];
    viewport.on('click', value => { clicks.push(value); });
    try {
      await ready(context, viewport);
      const canvas = viewport.map.getCanvas(), x = canvas.clientWidth / 2, y = canvas.clientHeight / 2;
      for (const [projection, longitude, latitude, zoom] of [['flat', 179.99999, 46, 18], ['flat', -179.99999, 46, 18], ['globe', 179.99999, 46, 11]] as const) {
        const moved = entity(); moved.geometry = { type: 'Point', coordinates: [longitude, latitude] };
        viewport.upsert([moved]); viewport.configure({ projection }); viewport.setCamera({ center: [longitude + (projection === 'flat' ? 720 : 0), latitude], zoom });
        await frame(viewport); await pause(150); await frame(viewport);
        await pointer('click', x + 25, y + 25);
        check(clicks.at(-1)?.features[0]?.id === 'model', `${projection} ${longitude} displayed world copy was not picked`);
      }
      viewport.configure({ projection: 'flat' }); viewport.setCamera({ center: [0,0], zoom:17 });
      const behind = entity(); behind.entity!.altitude = { meters: viewport.map._camera.transform.getCameraAltitude() + 100, reference: 'ground' };
      viewport.upsert([behind]); await frame(viewport);
      await pointer('click', x + 25, y + 25); check(clicks.at(-1)?.features.length === 0, 'Behind-near-plane box was picked');
      const terrain = planarTerrain(0,0), hidden = entity(); hidden.geometry = { type: 'Point', coordinates: terrain.location };
      viewport.upsert([hidden]); viewport.setCamera({ center: terrain.location, zoom:17 });
      await frame(viewport); await pointer('click', x + 25, y + 25); check(clicks.at(-1)?.features[0]?.id === 'model', 'Terrain baseline box absent');
      viewport.configure({ elevation: terrain.elevation, terrain: true });
      await context.until(() => Math.abs((viewport.map.queryTerrainElevation(terrain.location) ?? 0) - 100) < 1, 'known foreground terrain');
      await frame(viewport); await pointer('click', x + 25, y + 25);
      check(clicks.at(-1)?.features.length === 0, 'Box behind known native terrain was picked');
    } finally { viewport.destroy(); }
  } },
  { name: 'Model overlap picker preserves choices focus and consumer selection', async run(context) {
    const far = entity('far'), near = entity('near'); near.entity!.altitude = { meters:80, reference:'ground' };
    const ordinary: MapFeature = { type:'Feature', id:'ordinary', properties:{name:'Ordinary icon'}, geometry:{type:'Point',coordinates:[0,0]} };
    const viewport = create(context, [far,near,ordinary]), clicks: Interaction<Record<string, unknown>>[] = [], requests:string[][] = [];
    viewport.on('click', value => { clicks.push(value); }); viewport.on('selectionrequest', value => { requests.push(value.ids); });
    const ui = attachInteractions(viewport);
    try {
      await viewport.ready; await viewport.registerModel('asset',{bytes:axisModelGlb()});
      await context.until(() => viewport.getEntityState('near')?.representation === 'model' && viewport.map.isSourceLoaded('rl:features'), 'overlap models');
      await frame(viewport);
      const canvas = viewport.map.getCanvas(), x = canvas.clientWidth/2, y = canvas.clientHeight/2;
      await pointer('click',x,y);
      check(clicks.at(-1)?.features.map(item=>item.id).join(',') === 'ordinary,near,far', 'Overlap order differs from visible layer/depth order');
      const choices = [...context.container.querySelectorAll<HTMLButtonElement>('[data-feature-id]')];
      check(choices.length === 3, 'Original entities did not open radial choices');
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
    } finally { ui.destroy(); viewport.destroy(); }
  } },
  { name: 'Model hover follows a stationary pointer and cancels stale callbacks', async run(context) {
    const viewport = create(context), hovers:string[] = [];
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
      viewport.setCamera({center:[.001,0]},{duration:600}); await context.until(()=>movingExit,'hover exit during camera animation'); off();
      await context.until(()=>!viewport.map.isMoving(),'camera settled'); viewport.setCamera({center:[0,0]});
      await context.until(()=>hovers.at(-1)==='model','camera return hover');
      viewport.configure({entityModels:{switchDistanceMeters:1,deadZoneMeters:0,minimumSizePixels:120}});
      await context.until(()=>hovers.at(-1)==='','stationary representation exit');
      viewport.configure({entityModels:{switchDistanceMeters:1e7,deadZoneMeters:0,minimumSizePixels:120}});
      await context.until(()=>hovers.at(-1)==='model','stationary representation return');
      await pause(500); let renders=0; const before=hovers.length, count=()=>{renders++;}; viewport.map.on('render',count); await pause(5000); viewport.map.off('render',count);
      check(renders===0 && hovers.length===before, `Settled hover stayed active: ${renders} renders, ${hovers.length-before} events`);
      ui.destroy(); viewport.remove(['model']); await context.until(()=>hovers.at(-1)==='','hover removal');
      const cancelled:string[]=[]; const cancel=viewport.on('hover',value=>{if(value.features[0])viewport.remove([value.features[0].id]);});
      const observe=viewport.on('hover',value=>{if(value.features[0])cancelled.push(value.features[0].id);});
      const replacementUI=attachInteractions(viewport); viewport.upsert([entity()]); await pause(200); await frame(viewport);
      check(cancelled.length===0 && !context.container.querySelector('.rl-tooltip'), 'Cancelled hover reached a later listener or remounted UI');
      cancel(); observe(); replacementUI.destroy();
    } finally { ui.destroy(); viewport.destroy(); }
  } },
];
