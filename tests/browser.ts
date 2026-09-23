import { createViewport, attachInteractions, RidgelineError } from '@ridgeline/map';
import type { CameraAttachment, MapFeature, Viewport } from '@ridgeline/map';
import { GeoJSONSource, ErrorEvent as MapErrorEvent, setWorkerUrl } from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@ridgeline/map/style.css';

setWorkerUrl(workerUrl);
const container = document.querySelector<HTMLDivElement>('#map')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const style = (color = '#e9efea'): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': color } }] });
const point = (id: string, lng = 0): MapFeature => ({ type: 'Feature', id, properties: { name: id }, geometry: { type: 'Point', coordinates: [lng, 0] } });
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
let current: Viewport | undefined;
status.dataset.state = 'running';
async function until(predicate: () => boolean, description: string) {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > 8_000) throw new Error(`Timed out: ${description}`);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
}
async function run(name: string, test: () => Promise<void>) {
  const row = document.createElement('li'); row.textContent = name; results.append(row);
  try { await test(); row.className = 'pass'; row.textContent = `PASS: ${name}`; }
  catch (error) { row.className = 'fail'; row.textContent = `FAIL: ${name}: ${String(error)}`; throw error; }
}
async function suite() {
  await run('Destroy during initialization, repeat destroy, then remount', async () => {
    const abandoned = createViewport({ container, basemap: style() });
    abandoned.on('destroy', () => abandoned.destroy());
    attachInteractions(abandoned);
    abandoned.destroy(); abandoned.destroy();
    await abandoned.ready.then(() => { throw new Error('Expected canceled readiness'); }, error => check(error instanceof RidgelineError && error.code === 'DESTROYED', 'Structured cancellation'));
    check(!container.querySelector('canvas,.rl-ui'), 'Old canvas or overlay remains');
  });
  const viewport = createViewport({ container, basemap: style(), camera: { center: [0,0], zoom: 8 }, features: [point('initial')], style: feature => { if (feature.properties.broken) throw new Error('Broken style'); return { color: feature.properties.color === 'red' ? '#ff0000' : '#008855', icon: typeof feature.properties.icon === 'string' ? feature.properties.icon : undefined }; }, logger: () => {} });
  current = viewport;
  const hits = () => viewport.map.queryRenderedFeatures({ layers: ['rl:points'] });
  await run('Queued features render with stable string IDs and click events', async () => {
    viewport.upsert([point('queued')]);
    await viewport.ready;
    await until(() => hits().some(hit => hit.id === 'queued'), 'queued feature rendered');
    check(hits().some(hit => hit.id === 'initial'), 'Initial feature missing');
    let ids: string[] = [];
    const off = viewport.on('click', event => { ids = event.features.map(feature => feature.id); });
    container.querySelector('canvas')!.click();
    // A native click above uses its default coordinates. Verify the actual map hit path at center too.
    viewport.map.fire('click', { point: viewport.map.project([0,0]), lngLat: viewport.map.getCenter(), originalEvent: new MouseEvent('click') });
    check(ids.includes('queued') && ids.includes('initial'), 'Consumer click IDs missing'); off();
  });
  await run('Incremental updates replace data without moving the camera', async () => {
    const center = viewport.map.getCenter().toArray().join(',');
    viewport.setSelection(['queued']);
    viewport.upsert([{ ...point('queued', .03), properties: { name: 'Renamed', color: 'red' } }]);
    viewport.remove(['initial', 'unknown']);
    await until(() => hits().some(hit => hit.id === 'queued' && hit.properties._rl_color === '#ff0000') && !hits().some(hit => hit.id === 'initial'), 'incremental replace/remove');
    check(viewport.map.getCenter().toArray().join(',') === center, 'Camera moved');
    check(viewport.getFeature('queued')?.properties.name === 'Renamed', 'Name not replaced');
    check(viewport.map.getFeatureState({ source: 'rl:features', id: 'queued' }).selected, 'Selection state lost');
  });
  await run('Style replacement preserves data and selection', async () => {
    viewport.configure({ basemap: style('#ddeedd'), projection: 'globe' });
    viewport.upsert([point('during-style')]);
    await until(() => Boolean(viewport.map.getLayer('rl:points')) && hits().some(hit => hit.id === 'during-style'), 'style rehydration');
    check(viewport.getSelection()[0] === 'queued', 'Selected ID lost');
    check(viewport.map.getFeatureState({ source: 'rl:features', id: 'queued' }).selected, 'Selection display lost');
    const before = viewport.getConfiguration();
    viewport.configure({ basemap: undefined, terrain: undefined, hillshade: undefined });
    const after = viewport.getConfiguration();
    check(JSON.stringify(after) === JSON.stringify(before), 'Undefined settings changed configuration');
    check(Boolean(viewport.map.getLayer('rl:points')), 'Undefined basemap replaced the style');
  });
  await run('A broken style isolates one feature and retries only on request', async () => {
    const failures: RidgelineError[] = [];
    const off = viewport.on('diagnostic', error => { if (error.code === 'UPDATE_FAILED') failures.push(error); });
    viewport.upsert([point('broken'), point('remove-me')]);
    await until(() => hits().some(hit => hit.id === 'broken') && hits().some(hit => hit.id === 'remove-me'), 'recovery setup');
    viewport.upsert([{ ...point('broken'), properties: { broken: true } }, point('healthy')]);
    viewport.remove(['remove-me']);
    await until(() => hits().some(hit => hit.id === 'healthy') && !hits().some(hit => hit.id === 'remove-me'), 'healthy changes survive');
    check(failures.length === 1 && failures[0]?.context.featureId === 'broken', 'Failure must identify the feature');
    check(hits().some(hit => hit.id === 'broken'), 'Last rendered version should remain');
    viewport.upsert([point('healthy', .01)]);
    await until(() => hits().some(hit => hit.id === 'healthy' && hit.geometry.type === 'Point' && hit.geometry.coordinates[0]! > .005), 'unrelated update');
    check(failures.length === 1, 'Broken callback retried automatically');
    viewport.retryUpdates();
    await until(() => failures.length === 2, 'explicit retry');
    viewport.upsert([{ ...point('broken'), properties: { color: 'red' } }]);
    await until(() => hits().some(hit => hit.id === 'broken' && hit.properties._rl_color === '#ff0000'), 'corrected feature');
    viewport.remove(['broken', 'healthy']);
    await until(() => !hits().some(hit => ['broken', 'healthy'].includes(String(hit.id))), 'recovery cleanup');
    off();
  });
  await run('Renderer rejection preserves removals and never restores an older update', async () => {
    viewport.upsert([point('retry-remove'), point('retry-update')]);
    await until(() => hits().some(hit => hit.id === 'retry-remove') && hits().some(hit => hit.id === 'retry-update'), 'renderer setup');
    const source = viewport.map.getSource('rl:features');
    if (!(source instanceof GeoJSONSource)) throw new Error('Missing GeoJSON source');
    const update = source.updateData.bind(source);
    let rejectUpdate: ((reason: Error) => void) | undefined;
    let calls = 0;
    source.updateData = diff => {
      calls++;
      if (calls === 1) return new Promise<void>((_, reject) => { rejectUpdate = reject; });
      return update(diff);
    };
    viewport.remove(['retry-remove']);
    viewport.upsert([point('retry-update', .01)]);
    await until(() => Boolean(rejectUpdate), 'pending renderer submission');
    viewport.upsert([{ ...point('retry-update', .02), properties: { color: 'red' } }]);
    rejectUpdate!(new Error('Injected renderer rejection'));
    await until(() => hits().some(hit => hit.id === 'retry-update' && hit.properties._rl_color === '#ff0000'), 'newer replacement');
    check(calls === 2, 'Failed batch retried automatically');
    check(hits().some(hit => hit.id === 'retry-remove'), 'Injected failed removal unexpectedly applied');
    viewport.retryUpdates();
    await until(() => !hits().some(hit => hit.id === 'retry-remove'), 'removal retry');
    check(hits().some(hit => hit.id === 'retry-update' && hit.properties._rl_color === '#ff0000'), 'Retry restored stale data');
    source.updateData = update;
    viewport.remove(['retry-update']);
    await until(() => !hits().some(hit => hit.id === 'retry-update'), 'renderer cleanup');
  });
  await run('Source error events retain updates even when updateData resolves', async () => {
    const source = viewport.map.getSource('rl:features');
    if (!(source instanceof GeoJSONSource)) throw new Error('Missing GeoJSON source');
    const update = source.updateData.bind(source);
    let failures = 0;
    const off = viewport.on('diagnostic', error => { if (error.code === 'UPDATE_FAILED') failures++; });
    source.updateData = async () => { source.fire(new MapErrorEvent(new Error('Injected worker error'))); };
    viewport.upsert([point('worker-retry')]);
    await until(() => failures === 1, 'source failure diagnostic');
    source.updateData = update;
    viewport.retryUpdates();
    await until(() => hits().some(hit => hit.id === 'worker-retry'), 'worker error retry');
    viewport.remove(['worker-retry']);
    await until(() => !hits().some(hit => hit.id === 'worker-retry'), 'worker cleanup');
    off();
  });
  await run('A retired source cannot restore stale changes after a basemap switch', async () => {
    const source = viewport.map.getSource('rl:features');
    if (!(source instanceof GeoJSONSource)) throw new Error('Missing GeoJSON source');
    let rejectUpdate: ((reason: Error) => void) | undefined;
    source.updateData = () => new Promise<void>((_, reject) => { rejectUpdate = reject; });
    viewport.upsert([point('retired-update')]);
    await until(() => Boolean(rejectUpdate), 'old source submission');
    viewport.configure({ basemap: style('#ddeedd') });
    viewport.upsert([{ ...point('retired-update'), properties: { color: 'red' } }]);
    await until(() => Boolean(viewport.map.getLayer('rl:points')) && hits().some(hit => hit.id === 'retired-update' && hit.properties._rl_color === '#ff0000'), 'new source snapshot');
    rejectUpdate!(new Error('Retired source rejection'));
    viewport.remove(['retired-update']);
    viewport.retryUpdates();
    await until(() => !hits().some(hit => hit.id === 'retired-update'), 'retired source cleanup');
    viewport.retryUpdates();
    viewport.upsert([point('during-style')]);
    await until(() => hits().some(hit => hit.id === 'during-style'), 'new source still accepts updates');
    check(!hits().some(hit => hit.id === 'retired-update'), 'Old source resurrected removed data');
  });
  await run('A broken style does not block basemap restoration or later updates', async () => {
    const failures: RidgelineError[] = [];
    const off = viewport.on('diagnostic', error => { if (error.code === 'UPDATE_FAILED') failures.push(error); });
    viewport.upsert([point('rebuild-broken'), point('rebuild-healthy')]);
    await until(() => hits().some(hit => hit.id === 'rebuild-broken') && hits().some(hit => hit.id === 'rebuild-healthy'), 'rebuild setup');
    viewport.upsert([{ ...point('rebuild-broken'), properties: { name: 'Broken', broken: true } }]);
    await until(() => failures.length === 1, 'broken style diagnostic');
    viewport.configure({ basemap: style('#dce7dc') });
    await until(() => Boolean(viewport.map.getLayer('rl:points')) && hits().some(hit => hit.id === 'rebuild-healthy'), 'healthy feature after rebuild');
    check(!hits().some(hit => hit.id === 'rebuild-broken'), 'Broken feature rendered during rebuild');
    check(failures.length === 2 && failures[1]?.context.featureId === 'rebuild-broken', `Rebuild failure did not identify feature: ${failures.map(error => `${error.context.operation}/${error.context.featureId}: ${error.message}: ${error.cause}`).join('; ')}`);
    viewport.upsert([point('rebuild-later')]);
    await until(() => hits().some(hit => hit.id === 'rebuild-later'), 'update after partial rebuild');
    viewport.upsert([point('rebuild-broken')]);
    await until(() => hits().some(hit => hit.id === 'rebuild-broken'), 'corrected feature after rebuild');
    viewport.remove(['rebuild-broken', 'rebuild-healthy', 'rebuild-later']);
    await until(() => !hits().some(hit => String(hit.id).startsWith('rebuild-')), 'rebuild cleanup');
    off();
  });
  await run('Escape reaches consumers unless a picker is open', async () => {
    const ui = attachInteractions(viewport);
    let bubbled = 0;
    const onKeydown = () => { bubbled++; };
    document.addEventListener('keydown', onKeydown);
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check(bubbled === 1, 'Escape was intercepted without an overlay');
    viewport.map.fire('click', { point: viewport.map.project([0,0]), lngLat: viewport.map.getCenter(), originalEvent: new MouseEvent('click') });
    check(Boolean(container.querySelector('.rl-picker')), 'Picker did not open');
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check(!container.querySelector('.rl-picker') && bubbled === 1, 'Escape did not stay with the open picker');
    document.removeEventListener('keydown', onKeydown);
    ui.destroy();
  });
  await run('Picker candidates stay stable during movement; UI disposes once', async () => {
    let disposals = 0;
    const ui = attachInteractions(viewport, { renderFeature: feature => { const element = document.createElement('span'); element.textContent = viewport.getName(feature); return { element, dispose: () => { disposals++; } }; } });
    viewport.map.fire('click', { point: viewport.map.project([0,0]), lngLat: viewport.map.getCenter(), originalEvent: new MouseEvent('click') });
    const ids = [...container.querySelectorAll<HTMLElement>('[data-feature-id]')].map(button => button.dataset.featureId);
    check(ids.length === 2, 'Expected two picker candidates');
    viewport.upsert([point('queued', 1)]);
    check(ids.join(',') === [...container.querySelectorAll<HTMLElement>('[data-feature-id]')].map(button => button.dataset.featureId).join(','), 'Picker reordered');
    check(disposals === 1, 'Replaced custom content was not disposed');
    ui.destroy(); ui.destroy(); check(disposals === 3, 'Custom UI disposal count');
    check(!container.querySelector('.rl-ui'), 'Overlay remains');
  });
  await run('Picker refreshes names, icons and availability without replacing buttons or focus', async () => {
    viewport.upsert([point('queued')]);
    await until(() => hits().some(hit => hit.id === 'queued'), 'picker setup');
    const ui = attachInteractions(viewport);
    viewport.map.fire('click', { point: viewport.map.project([0,0]), lngLat: viewport.map.getCenter(), originalEvent: new MouseEvent('click') });
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[data-feature-id]')];
    const choice = buttons[0]!;
    const id = choice.dataset.featureId!;
    const original = viewport.getFeature(id)!;
    choice.focus();
    const label = choice.querySelector('.rl-feature-content');
    viewport.upsert([{ ...original, geometry: { type: 'Point', coordinates: [.01, 0] } }]);
    check(choice.querySelector('.rl-feature-content') === label, 'Position update rebuilt default content');
    const iconUrl = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>';
    viewport.registerIcon('picker-icon', { image: new ImageData(2, 2), url: iconUrl });
    const renamed = { ...original, properties: { name: 'Updated candidate', icon: 'picker-icon' } };
    viewport.upsert([renamed]);
    check(choice.textContent === 'Updated candidate' && choice.getAttribute('aria-label') === 'Select Updated candidate', 'Stale picker name');
    check(choice.querySelector('img')?.getAttribute('src') === iconUrl, 'Stale picker icon');
    check(document.activeElement === choice, 'Keyboard focus lost');
    check(buttons.every((button, index) => container.querySelectorAll('[data-feature-id]')[index] === button), 'Buttons replaced or reordered');
    viewport.remove([id]);
    check(choice.disabled && choice.textContent === 'Unavailable', 'Removed candidate still available');
    check(document.activeElement === buttons[1], 'Removing the focused candidate lost keyboard access');
    viewport.upsert([renamed]);
    check(!choice.disabled && choice.textContent === 'Updated candidate', 'Reintroduced candidate stayed disabled');
    choice.focus();
    choice.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    check(document.activeElement === buttons[1], 'Keyboard navigation broke after refresh');
    ui.destroy();
  });
  await run('A broken style falls back to names without interrupting the picker', async () => {
    viewport.upsert([point('picker-broken'), point('picker-healthy')]);
    await until(() => hits().some(hit => hit.id === 'picker-broken') && hits().some(hit => hit.id === 'picker-healthy'), 'picker failure setup');
    viewport.upsert([{ ...point('picker-broken'), properties: { name: 'Broken candidate', broken: true } }]);
    const ui = attachInteractions(viewport);
    viewport.map.fire('click', { point: viewport.map.project([0,0]), lngLat: viewport.map.getCenter(), originalEvent: new MouseEvent('click') });
    check(Boolean(container.querySelector('.rl-picker-hub button.rl-picker-close')), 'Picker stopped before drawing Close');
    const broken = container.querySelector<HTMLButtonElement>('[data-feature-id="picker-broken"]');
    const healthy = container.querySelector<HTMLButtonElement>('[data-feature-id="picker-healthy"]');
    check(broken?.textContent === 'Broken candidate' && Boolean(healthy), 'Picker did not show the name fallback');
    viewport.upsert([
      { ...point('picker-broken'), properties: { name: 'Broken renamed', broken: true } },
      { ...point('picker-healthy'), properties: { name: 'Healthy renamed' } },
    ]);
    check(broken?.textContent === 'Broken renamed' && healthy?.textContent === 'Healthy renamed', 'Broken style blocked another candidate refresh');
    ui.destroy();
    viewport.upsert([point('picker-broken')]);
    viewport.remove(['picker-broken', 'picker-healthy']);
  });
  await run('Hillshade options update live and survive toggles and basemap replacement', async () => {
    viewport.configure({ hillshade: true, elevation: { tiles: [], encoding: 'terrarium', tileSize: 256 }, hillshadeOptions: { method: 'igor', direction: 270, altitude: 30, anchor: 'map', intensity: .6, shadowColor: '#123456', highlightColor: '#eeeeee', accentColor: '#345678' } });
    const expected = viewport.map.getLayer('rl:hillshade')?.serialize().paint;
    check(viewport.map.getPaintProperty('rl:hillshade', 'hillshade-method') === 'igor', 'Hillshade method not applied');
    check(viewport.map.getPaintProperty('rl:hillshade', 'hillshade-illumination-direction') === 270, 'Hillshade direction not applied');
    check(viewport.map.getPaintProperty('rl:hillshade', 'hillshade-illumination-altitude') === 30, 'Hillshade altitude not applied');
    check(viewport.map.getPaintProperty('rl:hillshade', 'hillshade-illumination-anchor') === 'map', 'Hillshade anchor not applied');
    check(viewport.map.getPaintProperty('rl:hillshade', 'hillshade-shadow-color') === '#123456', 'Hillshade shadow color not applied');
    check(viewport.map.getPaintProperty('rl:hillshade', 'hillshade-highlight-color') === '#eeeeee', 'Hillshade highlight color not applied');
    check(viewport.map.getPaintProperty('rl:hillshade', 'hillshade-accent-color') === '#345678', 'Hillshade accent color not applied');
    viewport.configure({ hillshadeOptions: { intensity: .2 } });
    check(viewport.map.getPaintProperty('rl:hillshade', 'hillshade-exaggeration') === .2, 'Live intensity did not change');
    check(viewport.getConfiguration().hillshadeOptions.direction === 270, 'Partial settings discarded direction');
    viewport.configure({ hillshadeOptions: { intensity: .6 }, hillshade: false });
    check(!viewport.map.getLayer('rl:hillshade'), 'Hillshade toggle did not disable layer');
    viewport.configure({ hillshade: true, basemap: style('#eeeeee') });
    await until(() => Boolean(viewport.map.getLayer('rl:hillshade')), 'hillshade style restoration');
    check(JSON.stringify(viewport.map.getLayer('rl:hillshade')?.serialize().paint) === JSON.stringify(expected), 'Hillshade settings lost after style change');
    const before = viewport.getConfiguration();
    try { viewport.configure({ hillshadeOptions: { intensity: 2 }, terrain: true }); throw new Error('Invalid intensity accepted'); }
    catch (error) { check(error instanceof RidgelineError && error.code === 'INVALID_CONFIGURATION', 'Expected invalid configuration'); }
    check(JSON.stringify(viewport.getConfiguration()) === JSON.stringify(before), 'Invalid settings partially applied');
    try { viewport.configure({ hillshadeOptions: { shadowColor: 'not-a-color' } }); throw new Error('Invalid color accepted'); }
    catch (error) { check(error instanceof RidgelineError && error.code === 'INVALID_CONFIGURATION', 'Expected invalid color diagnostic'); }
    check(JSON.stringify(viewport.getConfiguration()) === JSON.stringify(before), 'Invalid color changed configuration');
    viewport.configure({ hillshade: false });
  });
  await run('Completed viewport releases DOM and rejects further mutation', async () => {
    viewport.destroy(); viewport.destroy();
    check(!container.querySelector('canvas,.rl-ui'), 'DOM remains');
    try { viewport.upsert([point('late')]); throw new Error('Mutation unexpectedly succeeded'); }
    catch (error) { check(error instanceof RidgelineError && error.code === 'DESTROYED', 'Expected DESTROYED'); }
  });
  await run('Airborne placement, attachment lifecycle, fallbacks, and globe shaders work through the package', async () => {
    let missing=false;
    const errors: RidgelineError[]=[];
    const air=createViewport({container,basemap:style(),camera:{center:[0,0],zoom:14,pitch:55},elevationSampler:{sample:()=>missing?null:100},logger:()=>{},onError:error=>errors.push(error)});
    current=air;
    await air.ready;
    const aircraft:MapFeature={...point('aircraft'),entity:{altitude:{meters:300,reference:'ground'},attachments:[{id:'camera',type:'camera',bearing:0,elevation:-45,fovX:60,fovY:40,range:1000},{id:'zone',type:'sphere',radius:100}]}};
    air.upsert([aircraft]);
    await until(()=>air.getEntityState('aircraft')?.coverage==='ready','airborne terrain ready');
    check(air.getEntityState('aircraft')?.altitude===400,'AGL conversion lost ground height');
    check((air.getEntityState('aircraft')?.footprintTriangles??0)>0,'Ground footprint absent');
    const triangles=air.getEntityState('aircraft')!.footprintTriangles;
    await new Promise<void>(resolve=>air.map.once('idle',()=>resolve()));
    const ui = attachInteractions(air, {picker:false});
    let selectedAttachment = '';
    air.on('selectionrequest', event => { selectedAttachment = event.attachments[0]?.attachmentId ?? ''; });
    // A nadir ground zone is selectable through the same public event path as a feature.
    air.upsert([{...aircraft, entity:{...aircraft.entity, attachments:[{id:'ground-zone',type:'polygon',vertices:[[-200,-200],[200,-200],[200,200],[-200,200]]}]}}]);
    await until(()=>air.getEntityState('aircraft')?.footprintTriangles===0,'zone replacement');
    await new Promise<void>(resolve=>air.map.once('idle',()=>resolve()));
    air.map.fire('click',{point:air.map.project([0.001,0]),lngLat:air.map.getCenter(),originalEvent:new MouseEvent('click')});
    check(selectedAttachment==='ground-zone','Attachment identity lost in selection request');
    ui.destroy();
    air.upsert([aircraft]);
    await until(()=>air.getEntityState('aircraft')?.footprintTriangles===triangles,'camera restored');
    air.configure({exaggeration:2,projection:'globe'});
    await until(()=>air.getEntityState('aircraft')?.footprintTriangles===triangles&&Boolean(air.map.getLayer('rl:entities')),'globe entity layer');
    await new Promise<void>(resolve=>air.map.once('idle',()=>resolve()));
    check(!errors.some(e=>e.context.operation==='entities'&&e.code==='UPDATE_FAILED'),errors.map(e=>`${e.message}: ${e.cause}`).join('\n'));
    air.configure({basemap:style('#ffffff')});
    await until(()=>Boolean(air.map.getLayer('rl:entities')),'entity layer restored after style replacement');
    await new Promise<void>(resolve=>air.map.once('idle',()=>resolve()));
    check(air.getEntityState('aircraft')?.footprintTriangles===triangles,'Style replacement changed coverage');
    air.upsert([{...aircraft,entity:{...aircraft.entity,altitude:{meters:450,reference:'sea-level'}}}]);
    await until(()=>air.getEntityState('aircraft')?.altitude===450,'MSL placement');
    missing=true;air.retryUpdates();
    await until(()=>air.getEntityState('aircraft')?.placement==='elevation-unavailable','missing terrain fallback');
    missing=false;air.upsert([{...aircraft,entity:{groundIfNoAltitude:false}}]);
    await until(()=>air.getEntityState('aircraft')?.placement==='withheld','missing altitude disabled');
    air.upsert([{...aircraft,entity:{altitude:{meters:0,reference:'sea-level'}}}]);
    await until(()=>air.getEntityState('aircraft')?.placement==='below-terrain','zero is an explicit below-terrain altitude');
    air.remove(['aircraft']);check(!air.getEntityState('aircraft'),'Removed entity state remains');
    air.destroy();
  });
  await run('Raw DEM placement and coverage remain physical with terrain off and exaggerated', async () => {
    const dem=document.createElement('canvas'); dem.width=dem.height=256;
    const context=dem.getContext('2d')!; context.fillStyle='rgb(1,0,0)'; context.fillRect(0,0,256,256);
    const air=createViewport({container,basemap:style(),elevation:{tiles:[dem.toDataURL()],encoding:'custom',redFactor:100,greenFactor:0,blueFactor:0,baseShift:0,maxzoom:0},camera:{center:[0,0],zoom:14,pitch:50},logger:()=>{}});
    current=air; await air.ready;
    air.upsert([{...point('raw'),entity:{altitude:{meters:300,reference:'ground'},attachments:[{id:'camera',type:'camera',bearing:0,elevation:-45,fovX:50,fovY:30,range:1000},{id:'cylinder',type:'cylinder',radius:50,height:80}]}}]);
    await until(()=>air.getEntityState('raw')?.coverage==='ready','raw DEM decoding');
    check(air.getEntityState('raw')?.altitude===400,'Raw custom DEM did not decode to 100 metres');
    const triangles=air.getEntityState('raw')!.footprintTriangles;
    for(const exaggeration of [0.5,1,2]) {
      const before=air.getEntityState('raw')!.computedAt;
      air.configure({terrain:true,exaggeration});
      await until(()=>air.getEntityState('raw')!.computedAt>before,'terrain display recomputation');
      check(air.getEntityState('raw')?.footprintTriangles===triangles,'Terrain display changed physical coverage');
      check(air.getEntityState('raw')?.altitude===400,'Exaggeration changed physical altitude');
    }
    air.configure({terrain:false});
    air.remove(['raw']);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    let remaining=0; air.on('click',event=>{remaining=event.features.length;});
    air.map.fire('click',{point:air.map.project([0,0]),lngLat:air.map.getCenter(),originalEvent:new MouseEvent('click')});
    check(remaining===0,'Removed attachments still pickable');
    air.destroy();
  });
  await run('Visible footprint stays filled when displayed terrain differs slightly from sampled terrain', async () => {
    const dem=document.createElement('canvas'); dem.width=dem.height=256;
    const context=dem.getContext('2d')!; context.fillStyle='rgb(105,0,0)'; context.fillRect(0,0,256,256);
    const air=createViewport({container,basemap:style('#000000'),terrain:true,elevation:{tiles:[dem.toDataURL()],encoding:'custom',redFactor:1,greenFactor:0,blueFactor:0,baseShift:0,maxzoom:0},elevationSampler:{sample:()=>100},camera:{center:[0,0],zoom:17,pitch:0},entityVisibility:{volumes:false,footprints:true,zones:false,groundLines:false},logger:()=>{}});
    current=air; await air.ready;
    air.upsert([{...point('visible'),entity:{altitude:{meters:300,reference:'ground'},attachments:[{id:'camera',type:'camera',color:'#00ff00',bearing:0,elevation:-90,fovX:60,fovY:60,range:1000}]}}]);
    await until(()=>air.getEntityState('visible')?.coverage==='ready' && Math.abs((air.map.queryTerrainElevation([0,0])??0)-105)<0.1,'synthetic terrain and coverage');
    await new Promise<void>(resolve=>air.map.once('idle',()=>resolve()));
    const pixels=await new Promise<number[]>(resolve=>{
      air.map.once('render',()=>{
        const canvas=air.map.getCanvas(), gl=canvas.getContext('webgl2')!, greens:number[]=[];
        for(const lng of [-0.0006,0.0006]) for(const lat of [-0.0006,0.0006]) {
          const p=air.map.project([lng,lat]), pixel=new Uint8Array(4), scale=canvas.width/canvas.clientWidth;
          gl.readPixels(Math.round(p.x*scale),canvas.height-1-Math.round(p.y*scale),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
          greens.push(pixel[1]!);
        }
        resolve(greens);
      });
      air.map.triggerRepaint();
    });
    check(pixels.every(green=>green>50),`Visible ground has unpainted gaps: green pixels ${pixels.join(',')}`);
    air.destroy();
  });
  await run('Camera color, fill strength, and wireframe independently control visible and pickable geometry', async () => {
    const air = createViewport({ container, basemap: style('#000000'),
      elevationSampler: { sample: () => 0 }, camera: { center: [0, 0], zoom: 16, pitch: 0 },
      entityVisibility: { volumes: true, footprints: false, zones: false, groundLines: false }, logger: () => {} });
    current = air; await air.ready;
    const camera: CameraAttachment = { id: 'camera', type: 'camera', bearing: 0, elevation: 90,
      fovX: 60, fovY: 60, range: 200, volumeColor: '#ff0000', wireframe: false };
    async function update(changes: Partial<CameraAttachment>) {
      Object.assign(camera, changes);
      const previous = air.getEntityState('styled')?.computedAt;
      air.upsert([{ ...point('styled'), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [camera] } }]);
      await until(() => air.getEntityState('styled')?.computedAt !== previous, 'camera style update');
      return new Promise<{ pixels: Uint8Array; width: number; height: number; scale: number }>(resolve => {
        air.map.once('render', () => {
          const canvas = air.map.getCanvas(), gl = canvas.getContext('webgl2')!;
          const pixels = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          resolve({ pixels, width: canvas.width, height: canvas.height, scale: canvas.width / canvas.clientWidth });
        });
        air.map.triggerRepaint();
      });
    }
    const faint = await update({ volumeOpacity: 0.1 });
    const solid = await update({ volumeOpacity: 1 });
    const redPixels = (frame: typeof solid) => {
      const indices: number[] = [];
      for (let i = 0; i < frame.pixels.length; i += 4)
        if (frame.pixels[i]! > 20 && frame.pixels[i + 1]! < 5 && frame.pixels[i + 2]! < 5) indices.push(i);
      return indices;
    };
    const solidPixels = redPixels(solid);
    check(solidPixels.length > 500, 'Custom red volume was not rendered');
    const interior = solidPixels[Math.floor(solidPixels.length / 3)]!;
    check(solid.pixels[interior]! > faint.pixels[interior]! + 100, 'Fill strength did not change the rendered opacity');
    const blue = await update({ volumeColor: '#0000ff' });
    check(blue.pixels[interior]! < 5 && blue.pixels[interior + 2]! > 200, 'Volume color did not update');
    let hit = false;
    air.on('click', event => { hit = event.attachments.some(a => a.attachmentId === 'camera'); });
    function pick(frame: typeof solid, index: number) {
      const p = { x: (index / 4 % frame.width) / frame.scale, y: (frame.height - 1 - Math.floor(index / 4 / frame.width)) / frame.scale };
      air.map.fire('click', { point: p, lngLat: air.map.unproject([p.x, p.y]), originalEvent: new MouseEvent('click') });
      return hit;
    }
    check(pick(solid, interior), 'Filled volume cannot be selected');
    const hidden = await update({ volumeColor: '#ff0000', volumeOpacity: 0 });
    check(redPixels(hidden).length === 0 && !pick(hidden, interior), 'Invisible volume remains drawn or pickable');
    const wire = await update({ wireframe: true });
    const edges = redPixels(wire);
    check(edges.length > 50 && edges.length < solidPixels.length / 3, 'Wireframe-only view still has filled faces or no edges');
    check(pick(wire, edges[Math.floor(edges.length / 3)]!), 'Wireframe-only volume cannot be selected');
    air.destroy();
  });
  status.dataset.state = 'passed';
  status.textContent = `${results.children.length} checks passed. Package imported through its published exports.`;
}
void suite().catch(error => { status.dataset.state = 'failed'; status.textContent = `Failed: ${String(error)}`; current?.destroy(); });
