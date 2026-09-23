import { createViewport, attachInteractions, RidgelineError } from '@ridgeline/map';
import type { MapFeature, Viewport } from '@ridgeline/map';
import { setWorkerUrl } from 'maplibre-gl';
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
  const viewport = createViewport({ container, basemap: style(), camera: { center: [0,0], zoom: 8 }, features: [point('initial')], style: feature => ({ color: feature.properties.color === 'red' ? '#ff0000' : '#008855' }) });
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
    ui.destroy(); ui.destroy(); check(disposals === 2, 'Custom UI disposal count');
    check(!container.querySelector('.rl-ui'), 'Overlay remains');
  });
  await run('Completed viewport releases DOM and rejects further mutation', async () => {
    viewport.destroy(); viewport.destroy();
    check(!container.querySelector('canvas,.rl-ui'), 'DOM remains');
    try { viewport.upsert([point('late')]); throw new Error('Mutation unexpectedly succeeded'); }
    catch (error) { check(error instanceof RidgelineError && error.code === 'DESTROYED', 'Expected DESTROYED'); }
  });
  status.textContent = '7 checks passed. Package imported through its published exports.';
}
void suite().catch(error => { status.textContent = `Failed: ${String(error)}`; current?.destroy(); });
