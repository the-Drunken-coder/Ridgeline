import { createViewport, attachInteractions, RidgelineError } from '@ridgeline/map';
import type { MapFeature, Viewport } from '@ridgeline/map';
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
  await run('Completed viewport releases DOM and rejects further mutation', async () => {
    viewport.destroy(); viewport.destroy();
    check(!container.querySelector('canvas,.rl-ui'), 'DOM remains');
    try { viewport.upsert([point('late')]); throw new Error('Mutation unexpectedly succeeded'); }
    catch (error) { check(error instanceof RidgelineError && error.code === 'DESTROYED', 'Expected DESTROYED'); }
  });
  status.dataset.state = 'passed';
  status.textContent = `${results.children.length} checks passed. Package imported through its published exports.`;
}
void suite().catch(error => { status.dataset.state = 'failed'; status.textContent = `Failed: ${String(error)}`; current?.destroy(); });
