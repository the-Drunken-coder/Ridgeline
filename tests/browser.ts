import { checkGpuVote } from './gpu-vote';
import { browserCases } from './browser-cases';
import { createViewport, attachInteractions, attachDrawing, attachDrawingControls, shapeGeometry, RidgelineError } from '@ridgeline/map';
import type { CameraAttachment, MapFeature, Viewport } from '@ridgeline/map';
import { GeoJSONSource, ErrorEvent as MapErrorEvent, setWorkerUrl } from 'maplibre-gl';
import type { ImageSource, StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@ridgeline/map/style.css';

declare global {
  interface Window {
    drawingPointer?: (action: 'move' | 'click', x: number, y: number) => Promise<void>;
    browserKey?: (key: string) => Promise<void>;
    browserDrag?: (fromX: number, fromY: number, toX: number, toY: number) => Promise<void>;
    browserClick?: (selector: string) => Promise<void>;
    cleanupBrowserCase?: () => void;
    browserMouse?: (action: 'down' | 'move' | 'up' | 'click', x: number, y: number) => Promise<void>;
    browserFill?: (selector: string, value: string) => Promise<void>;
  }
}

setWorkerUrl(workerUrl);
const container = document.querySelector<HTMLDivElement>('#map')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const style = (color = '#e9efea'): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': color } }] });
const point = (id: string, lng = 0): MapFeature => ({ type: 'Feature', id, properties: { name: id }, geometry: { type: 'Point', coordinates: [lng, 0] } });
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
let current: Viewport | undefined;
const selectedCase = new URLSearchParams(location.search).get('case');
let ran = false;
const registeredCases: string[] = [];
status.dataset.state = 'running';
async function until(predicate: () => boolean, description: string, timeout = 8_000) {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeout) throw new Error(`Timed out: ${description}`);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
}
async function run(name: string, test: () => Promise<void>) {
  registeredCases.push(name);
  if (name !== selectedCase) return;
  ran = true;
  const row = document.createElement('li'); row.textContent = name; results.append(row);
  try { await test(); row.className = 'pass'; row.textContent = `PASS: ${name}`; }
  catch (error) { row.className = 'fail'; row.textContent = `FAIL: ${name}: ${error instanceof Error ? error.stack : String(error)}`; throw error; }
}
async function pointer(action: 'move' | 'click', point: { x: number; y: number }) {
  const drawingPointer = window.drawingPointer;
  if (!drawingPointer) throw new Error('Playwright pointer bridge is unavailable.');
  await drawingPointer(action, point.x, point.y);
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}
async function browserKey(key: string) {
  if (!window.browserKey) throw new Error('Playwright keyboard bridge is unavailable.');
  await window.browserKey(key);
}
async function browserClick(selector: string) {
  if (!window.browserClick) throw new Error('Playwright click bridge is unavailable.');
  await window.browserClick(selector);
}
async function browserDrag(fromX: number, fromY: number, toX: number, toY: number) {
  if (!window.browserDrag) throw new Error('Playwright drag bridge is unavailable.');
  await window.browserDrag(fromX, fromY, toX, toY);
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
  viewport.upsert([point('queued')]);
  await viewport.ready;
  await until(() => hits().some(hit => hit.properties._rl_feature_id === 'queued'), 'base feature rendered');
  const featureState = (id: string) => {
    const sourceFeature = viewport.map.querySourceFeatures('rl:features').find(hit => hit.properties._rl_feature_id === id);
    return sourceFeature?.id === undefined ? {} : viewport.map.getFeatureState({ source: 'rl:features', id: sourceFeature.id });
  };
  await run('Queued features render with stable string IDs and click events', async () => {
    check(!viewport.map.getLayer('rl:camera-gpu'), 'Ground-only viewport allocated the camera renderer');
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'queued'), 'queued feature rendered');
    check(hits().some(hit => hit.properties._rl_feature_id === 'initial'), 'Initial feature missing');
    let ids: string[] = [];
    const off = viewport.on('click', event => { ids = event.features.map(feature => feature.id); });
    await pointer('click', viewport.map.project([0,0]));
    check(ids.includes('queued') && ids.includes('initial'), 'Consumer click IDs missing'); off();
  });
  await run('Reserved feature IDs remain selectable without inherited state', async () => {
    const id = '__proto__';
    viewport.upsert([point(id, .08)]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === id), 'reserved ID rendered');
    viewport.setSelection([id]);
    viewport.preview(id);
    check(viewport.getSelection()[0] === id, 'Reserved ID was rejected by selection');
    let clicked = '';
    const off = viewport.on('click', event => { clicked = event.features[0]?.id ?? ''; });
    await pointer('click', viewport.map.project([.08, 0]));
    check(clicked === id, `Reserved ID click returned ${clicked}`);
    const unrelated: Record<string, unknown> = {};
    check(unrelated.selected === undefined && unrelated.hover === undefined, 'Feature state polluted unrelated objects');
    off(); viewport.preview(null); viewport.remove([id]);
  });
  await run('Incremental updates replace data without moving the camera', async () => {
    const center = viewport.map.getCenter().toArray().join(',');
    viewport.setSelection(['queued']);
    viewport.upsert([{ ...point('queued', .03), properties: { name: 'Renamed', color: 'red' } }]);
    viewport.remove(['initial', 'unknown']);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'queued' && hit.properties._rl_color === '#ff0000') && !hits().some(hit => hit.properties._rl_feature_id === 'initial'), 'incremental replace/remove');
    check(viewport.map.getCenter().toArray().join(',') === center, 'Camera moved');
    check(viewport.getFeature('queued')?.properties.name === 'Renamed', 'Name not replaced');
    check(featureState('queued').selected, 'Selection state lost');
  });
  await run('A mutating style callback cannot change accepted or rendered feature data', async () => {
    const mount = document.createElement('div');
    mount.style.cssText = 'width:320px;height:240px;position:absolute;left:0;top:0';
    document.body.append(mount);
    const feature = { ...point('snapshot'), properties: { name: 'Original' } };
    const map = createViewport({ container: mount, basemap: style(), camera: { center: [0, 0], zoom: 12 },
      features: [feature], style: value => {
        value.properties.name = 'Mutated';
        if (value.geometry.type === 'Point') value.geometry.coordinates[0] = .1;
        return { color: '#008855' };
      }, logger: () => {} });
    try {
      await map.ready;
      await until(() => map.map.queryRenderedFeatures(map.map.project([0, 0]), { layers: ['rl:points'] })
        .some(hit => hit.properties._rl_feature_id === 'snapshot'), 'snapshot rendered at accepted position');
      const accepted = map.getFeature('snapshot');
      check(accepted?.properties.name === 'Original', 'Style callback mutated accepted properties');
      check(accepted?.geometry.type === 'Point' && accepted.geometry.coordinates[0] === 0,
        'Style callback mutated accepted coordinates');
      check(!map.map.queryRenderedFeatures(map.map.project([.1, 0]), { layers: ['rl:points'] })
        .some(hit => hit.properties._rl_feature_id === 'snapshot'), 'Style callback moved rendered geometry');
    } finally { map.destroy(); mount.remove(); }
  });
  await run('Removing and reinserting an airborne ID does not restore its selection', async () => {
    const air = createViewport({ container, basemap: style(), elevationSampler: { sample: () => 0 }, logger: () => {} });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('selected-air'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'zone', type: 'circle', radius: 100 }] } };
    try {
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'selected airborne entity');
      air.setSelection([feature.id]);
      check(air.getSelection()[0] === feature.id, 'Airborne entity was not selected');
      air.remove([feature.id]);
      check(air.getSelection().length === 0, 'Removal kept the ID selected');
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'reinserted airborne entity');
      check(air.getSelection().length === 0, 'Reinserted airborne entity regained selection');
      const sourceFeature = air.map.querySourceFeatures('rl:features').find(hit => hit.properties._rl_feature_id === feature.id);
      if (sourceFeature?.id !== undefined) {
        const state = air.map.getFeatureState({ source: 'rl:features', id: sourceFeature.id });
        check(state.selected !== true, 'Reinserted feature retained renderer selection state');
      }
    } finally { air.destroy(); }
  });
  await run('Mutating object basemaps does not change accepted configuration or style', async () => {
    const first = style('#112233');
    const map = createViewport({ container, basemap: first, logger: () => {} });
    current = map;
    try {
      await map.ready;
      first.layers[0] = { id: 'background', type: 'background', paint: { 'background-color': '#ff0000' } };
      check(map.map.getPaintProperty('background', 'background-color') === '#112233', 'Creation input changed the displayed style');
      const acceptedFirst = map.getConfiguration().basemap;
      check(typeof acceptedFirst !== 'string' && acceptedFirst.layers[0]?.type === 'background' &&
        acceptedFirst.layers[0].paint?.['background-color'] === '#112233', 'Creation input changed accepted basemap');
      const second = style('#445566');
      map.configure({ basemap: second });
      await until(() => map.map.isStyleLoaded() === true &&
        map.map.getPaintProperty('background', 'background-color') === '#445566', 'configured basemap loaded');
      second.layers[0] = { id: 'background', type: 'background', paint: { 'background-color': '#00ff00' } };
      const acceptedSecond = map.getConfiguration().basemap;
      check(typeof acceptedSecond !== 'string' && acceptedSecond.layers[0]?.type === 'background' &&
        acceptedSecond.layers[0].paint?.['background-color'] === '#445566', 'Configure input changed accepted basemap');
      check(map.map.getPaintProperty('background', 'background-color') === '#445566', 'Configure input changed displayed style');
    } finally { map.destroy(); }
  });
  await run('Style replacement preserves data and selection', async () => {
    viewport.setSelection(['queued']);
    viewport.configure({ basemap: style('#ddeedd'), projection: 'globe' });
    viewport.upsert([point('during-style')]);
    await until(() => Boolean(viewport.map.getLayer('rl:points')) && hits().some(hit => hit.properties._rl_feature_id === 'during-style'), 'style rehydration');
    check(viewport.getSelection()[0] === 'queued', 'Selected ID lost');
    check(featureState('queued').selected, 'Selection display lost');
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
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'broken') && hits().some(hit => hit.properties._rl_feature_id === 'remove-me'), 'recovery setup');
    viewport.upsert([{ ...point('broken'), properties: { broken: true } }, point('healthy')]);
    viewport.remove(['remove-me']);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'healthy') && !hits().some(hit => hit.properties._rl_feature_id === 'remove-me'), 'healthy changes survive');
    check(failures.length === 1 && failures[0]?.context.featureId === 'broken', 'Failure must identify the feature');
    check(hits().some(hit => hit.properties._rl_feature_id === 'broken'), 'Last rendered version should remain');
    viewport.upsert([point('healthy', .01)]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'healthy' && hit.geometry.type === 'Point' && hit.geometry.coordinates[0]! > .005), 'unrelated update');
    check(failures.length === 1, 'Broken callback retried automatically');
    viewport.retryUpdates();
    await until(() => failures.length === 2, 'explicit retry');
    viewport.upsert([{ ...point('broken'), properties: { color: 'red' } }]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'broken' && hit.properties._rl_color === '#ff0000'), 'corrected feature');
    viewport.remove(['broken', 'healthy']);
    await until(() => !hits().some(hit => ['broken', 'healthy'].includes(String(hit.properties._rl_feature_id))), 'recovery cleanup');
    off();
  });
  await run('Renderer rejection preserves removals and never restores an older update', async () => {
    viewport.upsert([point('retry-remove'), point('retry-update')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'retry-remove') && hits().some(hit => hit.properties._rl_feature_id === 'retry-update'), 'renderer setup');
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
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'retry-update' && hit.properties._rl_color === '#ff0000'), 'newer replacement');
    check(calls === 2, 'Failed batch retried automatically');
    check(hits().some(hit => hit.properties._rl_feature_id === 'retry-remove'), 'Injected failed removal unexpectedly applied');
    viewport.retryUpdates();
    await until(() => !hits().some(hit => hit.properties._rl_feature_id === 'retry-remove'), 'removal retry');
    check(hits().some(hit => hit.properties._rl_feature_id === 'retry-update' && hit.properties._rl_color === '#ff0000'), 'Retry restored stale data');
    source.updateData = update;
    viewport.remove(['retry-update']);
    await until(() => !hits().some(hit => hit.properties._rl_feature_id === 'retry-update'), 'renderer cleanup');
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
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'worker-retry'), 'worker error retry');
    viewport.remove(['worker-retry']);
    await until(() => !hits().some(hit => hit.properties._rl_feature_id === 'worker-retry'), 'worker cleanup');
    off();
  });
  await run('An initial GeoJSON worker-load rejection recovers with the latest accepted features', async () => {
    const mount = document.createElement('div');
    mount.style.cssText = 'width:320px;height:240px;position:absolute;left:0;top:0';
    document.body.append(mount);
    const onAdd = GeoJSONSource.prototype.onAdd;
    let rejected = false, workerLoads = 0;
    GeoJSONSource.prototype.onAdd = function(map) {
      if (this.id === 'rl:features') {
        this.actorPromise = this.actorPromise.then(actor => new Proxy(actor, {
          get(target, property, receiver) {
            if (property !== 'sendAsync') return Reflect.get(target, property, receiver);
            const send = target.sendAsync.bind(target);
            return new Proxy(send, { apply(fn, receiver, args) {
              const message: unknown = args[0];
              if (message && typeof message === 'object' && 'type' in message && message.type === 'LD') {
                workerLoads++;
                if (!rejected) {
                  rejected = true;
                  return Promise.reject(new Error('Injected GeoJSON worker load rejection'));
                }
              }
              return Reflect.apply(fn, receiver, args);
            } });
          },
        }));
      }
      onAdd.call(this, map);
    };
    let map: Viewport | undefined;
    try {
      map = createViewport({ container: mount, basemap: style(), camera: { center: [0, 0], zoom: 9 },
        features: [point('worker-latest'), point('worker-removed')], logger: () => {} });
      const active = map;
      const diagnostics: RidgelineError[] = [];
      active.on('diagnostic', error => diagnostics.push(error));
      await active.ready;
      await until(() => rejected && diagnostics.some(error => error.code === 'UPDATE_FAILED' && error.context.sourceId === 'rl:features'),
        'initial GeoJSON worker rejection reported');
      const rendered = () => active.map.queryRenderedFeatures({ layers: ['rl:points'] });
      check(!rendered().some(hit => hit.properties._rl_feature_id === 'worker-latest'), 'Failed initial load appeared before retry');
      active.upsert([{ ...point('worker-latest', .03), properties: { name: 'Latest' } }]);
      active.remove(['worker-removed']);
      active.retryUpdates();
      await until(() => rendered().some(hit => hit.properties._rl_feature_id === 'worker-latest' &&
        hit.geometry.type === 'Point' && hit.geometry.coordinates[0]! > .02) &&
        !rendered().some(hit => hit.properties._rl_feature_id === 'worker-removed'), 'worker recovery with latest snapshot');
      check(workerLoads >= 2, 'Retry did not reach the GeoJSON worker');
    } finally {
      map?.destroy();
      GeoJSONSource.prototype.onAdd = onAdd;
      mount.remove();
    }
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
    await until(() => Boolean(viewport.map.getLayer('rl:points')) && hits().some(hit => hit.properties._rl_feature_id === 'retired-update' && hit.properties._rl_color === '#ff0000'), 'new source snapshot');
    rejectUpdate!(new Error('Retired source rejection'));
    viewport.remove(['retired-update']);
    viewport.retryUpdates();
    await until(() => !hits().some(hit => hit.properties._rl_feature_id === 'retired-update'), 'retired source cleanup');
    viewport.retryUpdates();
    viewport.upsert([point('during-style')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'during-style'), 'new source still accepts updates');
    check(!hits().some(hit => hit.properties._rl_feature_id === 'retired-update'), 'Old source resurrected removed data');
  });
  await run('A broken style does not block basemap restoration or later updates', async () => {
    const failures: RidgelineError[] = [];
    const off = viewport.on('diagnostic', error => { if (error.code === 'UPDATE_FAILED') failures.push(error); });
    viewport.upsert([point('rebuild-broken'), point('rebuild-healthy')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'rebuild-broken') && hits().some(hit => hit.properties._rl_feature_id === 'rebuild-healthy'), 'rebuild setup');
    viewport.upsert([{ ...point('rebuild-broken'), properties: { name: 'Broken', broken: true } }]);
    await until(() => failures.length === 1, 'broken style diagnostic');
    viewport.configure({ basemap: style('#dce7dc') });
    await until(() => Boolean(viewport.map.getLayer('rl:points')) && hits().some(hit => hit.properties._rl_feature_id === 'rebuild-healthy'), 'healthy feature after rebuild');
    check(!hits().some(hit => hit.properties._rl_feature_id === 'rebuild-broken'), 'Broken feature rendered during rebuild');
    check(failures.length === 2 && failures[1]?.context.featureId === 'rebuild-broken', `Rebuild failure did not identify feature: ${failures.map(error => `${error.context.operation}/${error.context.featureId}: ${error.message}: ${error.cause}`).join('; ')}`);
    viewport.upsert([point('rebuild-later')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'rebuild-later'), 'update after partial rebuild');
    viewport.upsert([point('rebuild-broken')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'rebuild-broken'), 'corrected feature after rebuild');
    viewport.remove(['rebuild-broken', 'rebuild-healthy', 'rebuild-later']);
    await until(() => !hits().some(hit => String(hit.properties._rl_feature_id).startsWith('rebuild-')), 'rebuild cleanup');
    off();
  });
  await run('Escape reaches consumers unless a picker is open', async () => {
    const ui = attachInteractions(viewport);
    let bubbled = 0;
    const onKeydown = () => { bubbled++; };
    document.addEventListener('keydown', onKeydown);
    viewport.map.getCanvas().focus();
    await browserKey('Escape');
    check(bubbled === 1, 'Escape was intercepted without an overlay');
    await pointer('click', viewport.map.project([0,0]));
    check(Boolean(container.querySelector('.rl-picker')), 'Picker did not open');
    await browserKey('Escape');
    check(!container.querySelector('.rl-picker') && bubbled === 1, 'Escape did not stay with the open picker');
    document.removeEventListener('keydown', onKeydown);
    ui.destroy();
  });
  await run('Keyboard picker activation selects the chosen overlapping feature', async () => {
    const ui = attachInteractions(viewport);
    let requested = '';
    const off = viewport.on('selectionrequest', event => {
      requested = event.ids[0] ?? '';
      viewport.setSelection(requested ? [requested] : []);
    });
    await pointer('click', viewport.map.project([0,0]));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[data-feature-id]')];
    check(buttons.length >= 2, 'Overlapping features did not open a picker');
    const target = buttons[1]!.dataset.featureId!;
    buttons[0]!.focus();
    await browserKey('ArrowRight');
    check(document.activeElement === buttons[1], 'Arrow key did not move picker focus');
    await browserKey('Enter');
    check(requested === target && viewport.getSelection()[0] === target, 'Enter did not request and apply the focused choice');
    check(!container.querySelector('.rl-picker'), 'Picker remained open after selection');
    off(); ui.destroy();
  });
  await run('Picker candidates stay stable during movement; UI disposes once', async () => {
    let renders = 0, disposals = 0;
    const live = new Set<number>();
    const ui = attachInteractions(viewport, { renderFeature: feature => { const element = document.createElement('span'); element.textContent = viewport.getName(feature); const id = ++renders; live.add(id); return { element, dispose: () => { check(live.delete(id), 'Custom content disposed twice'); disposals++; } }; } });
    await pointer('click', viewport.map.project([0,0]));
    const ids = [...container.querySelectorAll<HTMLElement>('[data-feature-id]')].map(button => button.dataset.featureId);
    check(ids.length === 2, 'Expected two picker candidates');
    viewport.upsert([{ ...point('queued', .001), properties: { name: 'Moved candidate' } }]);
    check(ids.join(',') === [...container.querySelectorAll<HTMLElement>('[data-feature-id]')].map(button => button.dataset.featureId).join(','), 'Picker reordered');
    check(disposals > 0, 'Changed custom content was not disposed');
    ui.destroy(); ui.destroy(); check(live.size === 0 && disposals === renders, 'Custom UI content leaked or disposed twice');
    check(!container.querySelector('.rl-ui'), 'Overlay remains');
  });
  await run('Picker refreshes names, icons and availability without replacing buttons or focus', async () => {
    viewport.upsert([point('queued')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'queued'), 'picker setup');
    const ui = attachInteractions(viewport);
    await pointer('click', viewport.map.project([0,0]));
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
    await browserKey('ArrowRight');
    check(document.activeElement === buttons[1], 'Keyboard navigation broke after refresh');
    ui.destroy();
  });
  await run('Replacing a registered icon updates the map and an open picker', async () => {
    const mount = document.createElement('div');
    mount.style.cssText = 'width:320px;height:240px;position:absolute;left:0;top:0';
    document.body.append(mount);
    const iconMap = createViewport({
      container: mount, basemap: style(), camera: { center: [0, 0], zoom: 12 },
      features: [point('icon-target'), point('icon-other')],
      style: feature => ({ icon: feature.id === 'icon-target' ? 'swap' : undefined }),
      logger: () => {},
    });
    const pixels = (red: boolean) => {
      const image = new ImageData(24, 24);
      for (let i = 0; i < image.data.length; i += 4) {
        image.data[i] = red ? 255 : 0;
        image.data[i + 1] = red ? 0 : 255;
        image.data[i + 3] = 255;
      }
      return image;
    };
    const color = new Uint8Array(4);
    try {
      await iconMap.ready;
      const canvas = iconMap.map.getCanvas();
      const gl = canvas.getContext('webgl2');
      check(Boolean(gl), 'Icon map has no WebGL2 context');
      iconMap.map.on('render', () => {
        const point = iconMap.map.project([0, 0]);
        const scale = canvas.width / canvas.clientWidth;
        gl!.readPixels(Math.round(point.x * scale), canvas.height - 1 - Math.round(point.y * scale), 1, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, color);
      });
      iconMap.registerIcon('swap', { image: pixels(true), url: 'data:image/svg+xml,red' });
      await until(() => color[0]! > 200 && color[1]! < 50, 'first icon rendered red');
      const ui = attachInteractions(iconMap);
      if (!window.browserMouse) throw new Error('Playwright mouse bridge required');
      const iconBox = iconMap.map.getCanvas().getBoundingClientRect();
      const iconPoint = iconMap.map.project([0, 0]);
      await window.browserMouse('click', iconBox.left + iconPoint.x, iconBox.top + iconPoint.y);
      const choice = mount.querySelector<HTMLButtonElement>('[data-feature-id="icon-target"]')!;
      check(choice.querySelector('img')?.getAttribute('src') === 'data:image/svg+xml,red', 'Picker lacked the first icon');
      iconMap.registerIcon('swap', { image: pixels(false), url: 'data:image/svg+xml,green' });
      await until(() => color[1]! > 200 && color[0]! < 50, 'replacement icon rendered green');
      check(choice.querySelector('img')?.getAttribute('src') === 'data:image/svg+xml,green', 'Open picker kept the old icon');
      ui.destroy();
    } finally {
      iconMap.destroy();
      mount.remove();
    }
  });
  await run('Icon registration isolates an unrelated failing style callback', async () => {
    const failures: RidgelineError[] = [];
    const off = viewport.on('diagnostic', error => { if (error.context.featureId === 'icon-broken') failures.push(error); });
    viewport.upsert([
      { ...point('icon-healthy'), properties: { name: 'Healthy icon', icon: 'isolated-icon' } },
      { ...point('icon-broken'), properties: { name: 'Broken icon', broken: true } },
    ]);
    const image = new ImageData(16, 16);
    for (let i = 0; i < image.data.length; i += 4) { image.data[i] = 255; image.data[i + 3] = 255; }
    viewport.registerIcon('isolated-icon', { image });
    await until(() => viewport.map.queryRenderedFeatures({ layers: ['rl:icons'] })
      .some(hit => hit.properties._rl_feature_id === 'icon-healthy'), 'healthy icon published');
    check(failures.length > 0, 'Broken style callback did not report its feature ID');
    viewport.upsert([point('icon-broken')]);
    viewport.retryUpdates();
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'icon-broken'), 'recovered broken icon feature');
    viewport.remove(['icon-healthy', 'icon-broken']); off();
  });
  await run('A broken style falls back to names without interrupting the picker', async () => {
    viewport.upsert([point('picker-broken'), point('picker-healthy')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'picker-broken') && hits().some(hit => hit.properties._rl_feature_id === 'picker-healthy'), 'picker failure setup');
    viewport.upsert([{ ...point('picker-broken'), properties: { name: 'Broken candidate', broken: true } }]);
    const ui = attachInteractions(viewport);
    await pointer('click', viewport.map.project([0,0]));
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
  await run('Hover content follows the current feature and survives unrelated removal', async () => {
    viewport.upsert([point('hover-current', .08), point('hover-unrelated', -.08)]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'hover-current'), 'hover feature rendered');
    const ui = attachInteractions(viewport);
    await pointer('move', viewport.map.project([.08, 0]));
    await until(() => container.querySelector('.rl-tooltip')?.textContent === 'hover-current', 'hover tooltip');
    viewport.upsert([{ ...point('hover-current', .08), properties: { name: 'Current name' } }]);
    check(container.querySelector('.rl-tooltip')?.textContent === 'Current name', 'Hover tooltip kept stale content');
    viewport.remove(['hover-unrelated']);
    check(container.querySelector('.rl-tooltip')?.textContent === 'Current name', 'Unrelated removal hid the hovered feature');
    ui.destroy();
    viewport.remove(['hover-current']);
  });
  await run('A failed custom picker choice keeps the other choice and keyboard selection usable', async () => {
    viewport.upsert([point('custom-broken'), point('custom-healthy')]);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'custom-broken') && hits().some(hit => hit.properties._rl_feature_id === 'custom-healthy'), 'custom picker setup');
    const failures: RidgelineError[] = [];
    const offDiagnostic = viewport.on('diagnostic', error => { if (error.context.operation === 'renderFeature') failures.push(error); });
    let selection: string[] = [];
    const offSelection = viewport.on('selectionrequest', event => { selection = event.ids; });
    const ui = attachInteractions(viewport, {
      renderFeature(feature) {
        if (feature.properties.broken) throw new Error('Custom choice failed');
        const label = document.createElement('span');
        label.textContent = viewport.getName(feature);
        return label;
      },
    });
    await pointer('click', viewport.map.project([0, 0]));
    const broken = container.querySelector<HTMLButtonElement>('[data-feature-id="custom-broken"]')!;
    const healthy = container.querySelector<HTMLButtonElement>('[data-feature-id="custom-healthy"]')!;
    broken.focus();
    viewport.upsert([
      { ...point('custom-broken'), properties: { name: 'Broken current', broken: true } },
      { ...point('custom-healthy'), properties: { name: 'Healthy current' } },
    ]);
    check(broken.textContent === 'Broken current' && healthy.textContent === 'Healthy current', 'One custom renderer blocked choice refresh');
    check(document.activeElement === broken && !broken.disabled, 'Failed choice lost focus or became unavailable');
    check(failures.length === 1 && failures[0]?.context.featureId === 'custom-broken', 'Custom renderer failure was not reported');
    if (!window.browserKey) throw new Error('Playwright keyboard bridge required');
    await window.browserKey('Enter');
    check(selection[0] === 'custom-broken', 'Failed choice could not be selected with the keyboard');
    offSelection(); offDiagnostic(); ui.destroy();
    viewport.remove(['custom-broken', 'custom-healthy']);
  });
  await run('Point above a ground area wins the click and picker-free selection', async () => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;left:0;top:0;z-index:9999';
    const mount = document.createElement('div');
    mount.style.cssText = 'width:320px;height:240px';
    overlay.append(mount);
    document.body.append(overlay);
    const air = createViewport({ container: mount, basemap: style(), camera: { center: [0, 0], zoom: 16 },
      elevationSampler: { sample: () => 0 }, logger: () => {} });
    let ui: ReturnType<typeof attachInteractions> | undefined;
    try {
      await air.ready;
      air.upsert([
        { ...point('ground-area', -.002), entity: { attachments: [{ id: 'zone', type: 'circle', radius: 500 }] } },
        point('top-point'),
      ]);
      await until(() => {
        const hits = air.map.queryRenderedFeatures(air.map.project([0, 0]), { layers: ['rl:points', 'rl:entity-ground-fill'] });
        return air.getEntityState('ground-area')?.coverage === 'ready' &&
          hits.some(hit => hit.properties._rl_feature_id === 'top-point') &&
          hits.some(hit => hit.properties.entityId === 'ground-area');
      },
      'overlapping ground area and point');
      const rendered = air.map.queryRenderedFeatures(air.map.project([0, 0]), { layers: ['rl:points', 'rl:entity-ground-fill'] });
      check(rendered[0]?.properties._rl_feature_id === 'top-point',
        `Test setup did not render the point above the ground area: ${rendered.slice(0, 4).map(hit => `${hit.layer.id}/${hit.properties._rl_feature_id ?? hit.properties.entityId}`).join(',')}`);
      let clicked: string[] = [];
      let requested: string[] = [];
      let clickEvents = 0;
      air.on('click', event => { clickEvents++; clicked = event.features.map(feature => feature.id); });
      air.on('selectionrequest', event => { requested = event.ids; });
      ui = attachInteractions(air, { picker: false });
      const pointAt = air.map.project([0, 0]);
      const rect = air.map.getCanvas().getBoundingClientRect();
      if (!window.browserClick) throw new Error('Playwright click bridge required');
      if (!window.browserMouse) throw new Error('Playwright mouse bridge required');
      await window.browserMouse('click', rect.left + pointAt.x, rect.top + pointAt.y);
      check(clicked[0] === 'top-point' && clicked.includes('ground-area'),
        `Click order differed from rendering: ${clicked}; events=${clickEvents}`);
      check(requested[0] === 'top-point', `Picker-free selection chose ${requested[0]}`);
    } finally {
      ui?.destroy(); air.destroy(); overlay.remove();
    }
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
  if (selectedCase) viewport.destroy();
  await run('Airborne placement, attachment lifecycle, fallbacks, and globe shaders work through the package', async () => {
    let missing=false;
    const errors: RidgelineError[]=[];
    const air=createViewport({container,basemap:style(),camera:{center:[0,0],zoom:14,pitch:55},elevationSampler:{sample:()=>missing?null:100},logger:()=>{},onError:error=>errors.push(error)});
    current=air;
    await air.ready;
    const aircraft:MapFeature={...point('aircraft'),entity:{altitude:{meters:300,reference:'ground'},attachments:[{id:'camera',type:'camera',bearing:0,elevation:-45,fovX:60,fovY:40,range:1000,volumeOpacity:.28,wireframe:true,wireframeWidth:5},{id:'zone',type:'sphere',radius:100}]}};
    air.upsert([aircraft]);
    await until(()=>air.getEntityState('aircraft')?.coverage==='ready','airborne terrain ready');
    check(air.getEntityState('aircraft')?.altitude===400,'AGL conversion lost ground height');
    check((air.getEntityState('aircraft')?.footprintTriangles??0)>0,'Ground footprint absent');
    check(!air.map.getLayer('rl:camera-gpu'), 'Plain camera overlay allocated the GPU visibility renderer');
    const triangles=air.getEntityState('aircraft')!.footprintTriangles;
    await new Promise<void>(resolve=>air.map.once('idle',()=>resolve()));
    const ui = attachInteractions(air, {picker:false});
    let selectedAttachment = '';
    air.on('selectionrequest', event => { selectedAttachment = event.attachments[0]?.attachmentId ?? ''; });
    // A nadir ground zone is selectable through the same public event path as a feature.
    air.upsert([{...aircraft, entity:{...aircraft.entity, attachments:[{id:'ground-zone',type:'polygon',vertices:[[-200,-200],[200,-200],[200,200],[-200,200]]}]}}]);
    await until(()=>air.getEntityState('aircraft')?.footprintTriangles===0,'zone replacement');
    await new Promise<void>(resolve=>air.map.once('idle',()=>resolve()));
    await pointer('click', air.map.project([0.001,0]));
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
  await run('Wireframe-only camera interiors do not intercept clicks', async () => {
    const air = createViewport({ container, basemap: style(), elevationSampler: { sample: () => 0 },
      camera: { center: [0,0], zoom: 17, pitch: 0 }, logger: () => {} });
    current = air; await air.ready;
    const camera: CameraAttachment = { id: 'camera', type: 'camera', bearing: 0, elevation: -90,
      fovX: 60, fovY: 60, range: 1000, fillOpacity: 0, outline: false, wireframe: true, volumeOpacity: .2 };
    const feature: MapFeature = { ...point('wireframe'), entity: { altitude: { meters: 300, reference: 'ground' }, attachments: [camera] } };
    let attachment = '';
    air.on('click', event => { attachment = event.attachments[0]?.attachmentId ?? ''; });
    const click = () => pointer('click', air.map.project([.0006,.0004]));
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'camera volume');
    await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
    await click(); check(attachment === camera.id, 'Visible camera face was not selectable');
    const before = air.getEntityState(feature.id)!.computedAt;
    air.upsert([{ ...feature, entity: { ...feature.entity!, attachments: [{ ...camera, volumeOpacity: 0 }] } }]);
    await until(() => air.getEntityState(feature.id)!.computedAt > before, 'wireframe-only update');
    await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
    await click(); check(attachment === '', 'Invisible camera face intercepted a click');
    air.destroy();
  });
  await run('A real click selects a visible camera face clipped by the view', async () => {
    const air = createViewport({ container, basemap: style('#000000'), elevationSampler: { sample: () => 0 },
      camera: { center: [0, .001], zoom: 18, pitch: 45 }, logger: () => {} });
    current = air; await air.ready;
    const camera: CameraAttachment = { id: 'clipped-camera', type: 'camera', bearing: 0, elevation: -45,
      fovX: 60, fovY: 40, range: 1000, color: '#00ff00', volumeOpacity: 1, fillOpacity: 0, outline: false };
    const feature: MapFeature = { ...point('clipped-aircraft'), entity: { altitude: { meters: 300, reference: 'ground' }, attachments: [camera] } };
    try {
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'clipped camera volume');
      await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
      const layer = air.map.getLayer('rl:entities') as unknown as { implementation: {
        draws: { entityId: string; attachmentId?: string; mode: string; vertices: [number, number, number][] }[];
        project(point: [number, number, number]): { x: number; y: number } | null;
        clippedTriangle(points: [number, number, number][]): { x: number; y: number }[];
      } };
      const geometry = layer.implementation;
      const face = geometry.draws.find(draw => draw.entityId === feature.id && draw.attachmentId === camera.id && draw.mode === 'triangles');
      check(face, 'Camera face was not rendered');
      const canvas = air.map.getCanvas();
      const inside = (x: number, y: number, polygon: { x: number; y: number }[]) => {
        let contained = false;
        for (let a = 0, b = polygon.length - 1; a < polygon.length; b = a++) {
          const first = polygon[a]!, last = polygon[b]!;
          if ((first.y > y) !== (last.y > y) && x < (last.x - first.x) * (y - first.y) / (last.y - first.y) + first.x)
            contained = !contained;
        }
        return contained;
      };
      const candidates: { x: number; y: number }[] = [];
      for (let i = 0; i < face!.vertices.length; i += 3) {
        const triangle = face!.vertices.slice(i, i + 3);
        const projected = triangle.map(vertex => geometry.project(vertex));
        if (projected.every(Boolean) || projected.every(point => !point)) continue;
        const clipped = geometry.clippedTriangle(triangle);
        if (clipped.length < 3) continue;
        for (let y = 24; y < canvas.clientHeight - 24; y += 24)
          for (let x = 24; x < canvas.clientWidth - 24; x += 24)
            if (inside(x, y, clipped)) candidates.push({ x, y });
      }
      check(candidates.length > 0, 'No partially clipped camera face intersects the visible canvas');
      const visible = await new Promise<{ x: number; y: number } | undefined>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Timed out reading the clipped camera face')), 5_000);
        air.map.once('render', () => {
          window.clearTimeout(timeout);
          const gl = canvas.getContext('webgl2')!;
          const scale = canvas.width / canvas.clientWidth;
          const pixels = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          for (const candidate of candidates) {
            const x = Math.round(candidate.x * scale), y = canvas.height - 1 - Math.round(candidate.y * scale);
            const index = (y * canvas.width + x) * 4;
            if (pixels[index + 1]! > 100 && pixels[index]! < 80 && pixels[index + 2]! < 80) {
              resolve(candidate); return;
            }
          }
          resolve(undefined);
        });
        air.map.triggerRepaint();
      });
      check(visible, 'Clipped camera face was not visibly rendered');
      const ui = attachInteractions(air, { picker: false });
      let clicked = '';
      let selected = '';
      const offClick = air.on('click', event => { clicked = event.attachments.find(hit => hit.entityId === feature.id)?.attachmentId ?? ''; });
      const offSelection = air.on('selectionrequest', event => { selected = event.attachments.find(hit => hit.entityId === feature.id)?.attachmentId ?? ''; });
      try {
        await pointer('click', visible!);
        check(clicked === camera.id, `Native click missed the visible clipped face: ${clicked}`);
        check(selected === camera.id, `Selection request lost the clipped face identity: ${selected}`);

      } finally { offClick(); offSelection(); ui.destroy(); }
    } finally { air.destroy(); }
  });
  await run('Incomplete custom camera terrain settles without polling and retries explicitly', async () => {
    let samples = 0, available = false;
    const air = createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample: (lng, lat) => { samples++; return available || (lng === 0 && lat === 0) ? 0 : null; },
    } });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('missing-patch'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } };
    air.upsert([feature]);
    await until(() => samples > 66000, 'incomplete patch sampled');
    const initialSamples = samples;
    await new Promise(resolve => setTimeout(resolve, 700));
    check(samples === initialSamples, `Unknown terrain kept polling: ${samples - initialSamples} extra samples`);
    check(air.getEntityState(feature.id)?.coverage === 'unavailable', 'Unknown custom terrain stayed loading');
    available = true; air.retryUpdates();
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'explicit terrain retry');
    available = false; air.retryUpdates();
    await until(() => air.getEntityState(feature.id)?.coverage === 'unavailable', 'retry discards stale terrain');
    check(!air.map.getLayer('rl:camera-gpu'), 'Unknown terrain retained its previous mask');
    air.destroy();
  });
  await run('Custom terrain preparation settles missing data and refreshes the cached patch', async () => {
    let available = false, finish = () => {}, extent = 0;
    const air = createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample: (lng, lat) => available || (lng === 0 && lat === 0) ? 0 : null,
      prepare: positions => new Promise<void>(resolve => {
        finish = resolve;
        extent = Math.max(...positions.map(([lng, lat]) => Math.max(Math.abs(lng), Math.abs(lat)) * 111195));
      }),
    } });
    current = air; await air.ready;
    air.upsert([{ ...point('prepared-patch'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } }]);
    await until(() => air.getEntityState('prepared-patch')?.coverage === 'loading', 'pending terrain preparation');
    check(extent > 389, 'Preparation omitted the terrain patch movement margin');
    finish();
    await until(() => air.getEntityState('prepared-patch')?.coverage === 'unavailable', 'settled incomplete preparation');
    air.retryUpdates();
    await until(() => air.getEntityState('prepared-patch')?.coverage === 'loading', 'retry prepares terrain');
    available = true; finish();
    await until(() => air.getEntityState('prepared-patch')?.coverage === 'ready', 'completed terrain preparation');
    air.destroy();
  });
  await run('Mixed terrain cameras retain shared preparation for non-camera attachments', async () => {
    let available = false;
    const preparationExtents: number[] = [];
    const air = createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample: () => available ? 0 : null,
      prepare: async positions => {
        preparationExtents.push(Math.max(...positions.map(([lng, lat]) => Math.max(Math.abs(lng), Math.abs(lat)) * 111195)));
        available = true;
      },
    } });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('mixed-prepared'), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [
      { id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 10 },
      { id: 'zone', type: 'circle', radius: 100 },
    ] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'mixed terrain preparation');
    check(preparationExtents.some(extent => extent > 90), `Shared preparation omitted the non-camera terrain extent: ${preparationExtents}`);
    air.destroy();
  });
  await run('A ready camera does not hide unavailable ground attachment terrain', async () => {
    const known = (lng: number, lat: number) => Math.abs(lng) < .00055 && Math.abs(lat) < .00055;
    const air = createViewport({ container, basemap: style(), elevationSampler: { sample: (lng, lat) => known(lng, lat) ? 0 : null }, logger: () => {} });
    current = air; await air.ready;
    const camera: CameraAttachment = { id: 'near-camera', type: 'camera', terrainVisibility: true,
      bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 10 };
    const near: MapFeature = { ...point('near-only'), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [camera] } };
    const mixed: MapFeature = { ...point('near-plus-zone'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [camera, { id: 'wide-zone', type: 'circle', radius: 300 }] } };
    air.upsert([near, mixed]);
    await until(() => air.getEntityState(near.id)?.coverage === 'ready', 'near camera ready');
    await until(() => air.getEntityState(mixed.id)?.coverage === 'unavailable', 'wide ground area unavailable');
    check(air.getEntityState(mixed.id)?.coverage === 'unavailable', 'Ready camera hid unknown ground terrain');
    air.destroy();
  });
  await run('One failed terrain region does not settle another pending camera', async () => {
    let secondReady = false;
    let finishSecond: (() => void) | undefined;
    const air = createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample(lng, lat) {
        if (Math.abs(lat) < 1e-8 && (Math.abs(lng) < 1e-8 || Math.abs(lng - .02) < 1e-8)) return 0;
        return secondReady && Math.abs(lng - .02) < .01 ? 0 : null;
      },
      prepare(positions) {
        if (Math.abs(positions[0]![0]) < .01) return Promise.reject(new Error('First region failed'));
        return new Promise<void>(resolve => { finishSecond = () => { secondReady = true; resolve(); }; });
      },
    } });
    current = air; await air.ready;
    const camera: CameraAttachment = { id: 'camera', type: 'camera', terrainVisibility: true,
      bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 };
    const first: MapFeature = { ...point('failed-region'), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [camera] } };
    const second: MapFeature = { ...point('pending-region', .02), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [camera] } };
    try {
      air.upsert([first, second]);
      await until(() => air.getEntityState(first.id)?.coverage === 'unavailable' &&
        air.getEntityState(second.id)?.coverage === 'loading' && Boolean(finishSecond), 'independent terrain statuses');
      finishSecond!();
      await until(() => air.getEntityState(second.id)?.coverage === 'ready', 'second camera after unrelated failure');
      check(air.getEntityState(first.id)?.coverage === 'unavailable', 'Unrelated success changed failed region');
    } finally { finishSecond?.(); air.destroy(); }
  });
  await run('A failed airborne style update retains its last complete display', async () => {
    const errors: RidgelineError[] = [];
    const air = createViewport({ container, basemap: style(), camera: { center: [.005, 0], zoom: 15 },
      elevationSampler: { sample: () => 0 }, logger: () => {}, onError: error => errors.push(error),
      style: feature => { if (feature.properties.fail) throw new Error('Airborne style failed'); return { color: '#1166aa' }; } });
    current = air; await air.ready;
    const original: MapFeature = { ...point('retained-air'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'zone', type: 'circle', radius: 100 }, { id: 'ball', type: 'sphere', radius: 30 }] } };
    const moved: MapFeature = { ...original, geometry: { type: 'Point', coordinates: [.01, 0] } };
    const zoneAt = (lng: number) => air.map.queryRenderedFeatures(air.map.project([lng, 0]), { layers: ['rl:entity-ground-fill'] })
      .some(hit => hit.properties.entityId === original.id && hit.properties.attachmentId === 'zone');
    try {
      air.upsert([original]);
      await until(() => zoneAt(0), 'initial airborne ground attachment');
      air.upsert([{ ...moved, properties: { fail: true } }]);
      await until(() => errors.some(error => error.context.featureId === original.id && error.code === 'UPDATE_FAILED'), 'airborne style failure');
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      check(zoneAt(0) && !zoneAt(.01), 'Failed style update moved or erased retained ground attachment');
      const accepted = air.getFeature(original.id);
      check(accepted?.geometry.type === 'Point' && accepted.geometry.coordinates[0] === .01,
        'Accepted data did not advance after style failure');
      air.upsert([moved]);
      await until(() => zoneAt(.01) && !zoneAt(0), 'corrected airborne update');
    } finally { air.destroy(); }
  });
  await run('Airborne shader creation recovers through retryUpdates', async () => {
    const errors: RidgelineError[] = [];
    const air = createViewport({ container, basemap: style('#ffffff'), camera: { center: [0, 0], zoom: 17, pitch: 45 },
      elevationSampler: { sample: () => 0 }, logger: () => {}, onError: error => errors.push(error) });
    current = air; await air.ready;
    await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const createProgram = gl.createProgram.bind(gl);
    let failOnce = true;
    Object.defineProperty(gl, 'createProgram', { configurable: true, value: () => {
      if (failOnce) { failOnce = false; return null; }
      return createProgram();
    } });
    const feature: MapFeature = { ...point('shader-retry'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'ball', type: 'sphere', radius: 100, color: '#ff0000' }] } };
    const redPixels = () => new Promise<number>(resolve => {
      air.map.once('render', () => {
        const canvas = air.map.getCanvas(), context = canvas.getContext('webgl2')!;
        const values = new Uint8Array(300 * 300 * 4);
        context.readPixels(Math.floor(canvas.width / 2) - 150, Math.floor(canvas.height / 2) - 150,
          300, 300, context.RGBA, context.UNSIGNED_BYTE, values);
        let count = 0;
        for (let i = 0; i < values.length; i += 4)
          if (values[i]! > values[i + 1]! + 20 && values[i]! > values[i + 2]! + 20) count++;
        resolve(count);
      });
      air.map.triggerRepaint();
    });
    try {
      air.upsert([feature]);
      await until(() => errors.some(error => error.code === 'UPDATE_FAILED' && error.context.operation === 'entities'), 'airborne shader failure');
      Object.defineProperty(gl, 'createProgram', { configurable: true, value: createProgram });
      check(await redPixels() === 0, 'Failed shader still drew airborne geometry');
      air.retryUpdates();
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'entity retry state');
      check(await redPixels() > 0, 'Retry did not restore airborne geometry');
    } finally { Object.defineProperty(gl, 'createProgram', { configurable: true, value: createProgram }); air.destroy(); }
  });
  await run('Custom elevation preparation also covers entities with only plain cameras', async () => {
    let prepared = false, prepareCalls = 0;
    const air = createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample: () => prepared ? 0 : null,
      prepare: async () => { prepareCalls++; prepared = true; },
    } });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('plain-prepared'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: false, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'plain camera preparation');
    check(prepareCalls === 1, `Plain camera skipped shared elevation preparation: ${prepareCalls}`);
    check(air.getEntityState(feature.id)?.placement === 'airborne', 'Prepared plain camera remained elevation-unavailable');
    check((air.getEntityState(feature.id)?.footprintTriangles ?? 0) > 0, 'Prepared plain camera has no footprint');
    check(!air.map.getLayer('rl:camera-gpu'), 'Plain camera allocated the GPU visibility renderer');
    air.destroy();
  });
  await run('A moved airborne camera prepares a missing center while retaining historical coverage', async () => {
    const movedLng = .00005;
    let centerAvailable = true;
    let prepareCalls = 0;
    let preparedPositions: readonly [number, number][] = [];
    let finishPreparation: (() => void) | undefined;
    const air = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 16 }, logger: () => {}, elevationSampler: {
      sample: (lng, lat) => {
        if (Math.abs(lng) < 1e-8 && Math.abs(lat) < 1e-8) return 12;
        if (Math.abs(lng - movedLng) < 1e-8 && Math.abs(lat) < 1e-8) return centerAvailable ? 12 : null;
        return 0;
      },
      prepare: (requested, signal) => {
        prepareCalls++;
        preparedPositions = requested.map(([lng, lat]) => [lng, lat] as [number, number]);
        return new Promise<void>((resolve, reject) => {
          const abort = () => {
            signal.removeEventListener('abort', abort);
            reject(new DOMException('aborted', 'AbortError'));
          };
          if (signal.aborted) { abort(); return; }
          signal.addEventListener('abort', abort, { once: true });
          finishPreparation = () => {
            signal.removeEventListener('abort', abort);
            resolve();
          };
        });
      },
    } });
    current = air; await air.ready;
    const camera: CameraAttachment = { id: 'camera', type: 'camera', terrainVisibility: true,
      bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: 0, wireframe: false };
    const feature: MapFeature = { ...point('moving-airborne'), entity: {
      altitude: { meters: 100, reference: 'ground' }, attachments: [camera],
    } };
    air.upsert([feature]);
    await until(() => {
      const state = air.getEntityState(feature.id);
      return state?.ground === 12 && state.altitude === 112 && state.placement === 'airborne' && state.coverage === 'ready';
    }, 'initial airborne camera');
    let picked = '';
    const off = air.on('click', event => { picked = event.attachments.find(hit => hit.entityId === feature.id)?.attachmentId ?? ''; });
    const pickAt = async (lng: number, lat: number) => {
      const screen = air.map.project([lng, lat]);
      picked = '';
      await pointer('click', screen);
      return picked;
    };
    try {
      check(await pickAt(0, .0008) === camera.id, 'Initial airborne camera coverage was not pickable');
      centerAvailable = false;
      air.upsert([{ ...feature, geometry: { type: 'Point', coordinates: [movedLng, 0] } }]);
      await until(() => prepareCalls === 1 && air.getEntityState(feature.id)?.placement === 'elevation-unavailable', 'center preparation and placement after movement');
      const pending = air.getEntityState(feature.id);
      check(pending?.placement === 'elevation-unavailable' && pending.coverage === 'loading', `Missing center did not remain loading during preparation: ${JSON.stringify(pending)}; calls=${prepareCalls}`);
      check(preparedPositions.some(([lng, lat]) => Math.abs(lng - movedLng) < 1e-8 && Math.abs(lat) < 1e-8), 'Preparation omitted the moved center');
      check(await pickAt(0, .0008) === camera.id, 'Historical camera coverage disappeared during center preparation');
      centerAvailable = true;
      finishPreparation?.();
      finishPreparation = undefined;
      await until(() => {
        const state = air.getEntityState(feature.id);
        return state?.ground === 12 && state.altitude === 112 && state.placement === 'airborne' && state.coverage === 'ready';
      }, 'recovered airborne camera');
    } finally {
      finishPreparation?.();
      off();
      air.destroy();
    }
  });
  await run('No-altitude terrain cameras use prepared ground placement without GPU coverage', async () => {
    let prepared = false;
    let positions: readonly [number, number][] = [];
    const air = createViewport({ container, basemap: style(), logger: () => {}, elevationSampler: {
      sample: () => prepared ? 12 : null,
      prepare: async requested => { positions = requested; prepared = true; },
    } });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('prepared-ground'), entity: { attachments: [{ id: 'camera', type: 'camera',
      terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.ground === 12 && air.getEntityState(feature.id)?.coverage === 'ready', 'prepared ground placement');
    const state = air.getEntityState(feature.id)!;
    check(state.placement === 'ground', `No-altitude entity placement was ${state.placement}`);
    check(positions.some(([lng, lat]) => Math.abs(lng) < 1e-9 && Math.abs(lat) < 1e-9), 'Preparation omitted the entity center');
    check(!air.map.getLayer('rl:camera-gpu'), 'Ground-placed terrain camera allocated GPU coverage');
    air.destroy();
  });
  await run('Stateful elevation samplers retain their prepare method receiver', async () => {
    class StatefulSampler {
      #centerReady = false;
      #patchReady = false;
      sample(lng: number, lat: number) {
        if (lng === 0 && lat === 0) return this.#centerReady ? 0 : null;
        return this.#patchReady ? 0 : null;
      }
      async prepare(positions: readonly [number, number][]) {
        this.#centerReady = true;
        if (positions.some(([lng, lat]) => lng !== 0 || lat !== 0)) this.#patchReady = true;
      }
    }
    const errors: RidgelineError[] = [];
    const air = createViewport({ container, basemap: style(), logger: () => {},
      elevationSampler: new StatefulSampler(), onError: error => errors.push(error) });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('stateful-sampler'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.placement === 'airborne' && air.getEntityState(feature.id)?.coverage === 'ready', 'stateful sampler camera coverage');
    check(!errors.some(error => error.code === 'ELEVATION_UNAVAILABLE'), 'Stateful sampler preparation failed');
    air.destroy();
  });
  await run('Hidden terrain cameras still prepare placement elevation after movement', async () => {
    class HiddenSampler {
      #prepared = new Set<string>();
      calls = 0;
      sample(lng: number, lat: number) { return this.#prepared.has(`${lng},${lat}`) ? 0 : null; }
      async prepare(positions: readonly [number, number][]) {
        this.calls++;
        for (const [lng, lat] of positions) this.#prepared.add(`${lng},${lat}`);
      }
    }
    const sampler = new HiddenSampler();
    const air = createViewport({ container, basemap: style(), logger: () => {},
      entityVisibility: { footprints: false, zones: false, groundLines: false }, elevationSampler: sampler });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('hidden-placement'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.placement === 'airborne', 'hidden initial placement');
    check(sampler.calls >= 1, 'Hidden terrain camera did not prepare entity elevation');
    check(air.getEntityState(feature.id)?.coverage === 'ready', 'Hidden placement remained unavailable');
    const before = air.getEntityState(feature.id)!.computedAt;
    air.upsert([{ ...feature, geometry: { type: 'Point', coordinates: [.01, 0] } }]);
    await until(() => {
      const state = air.getEntityState(feature.id);
      return state?.computedAt !== undefined && state.computedAt > before && state.placement === 'airborne';
    }, 'hidden moved placement');
    check(sampler.calls >= 2, 'Hidden movement did not prepare the new entity position');
    check(!air.map.getLayer('rl:camera-gpu'), 'Hidden camera allocated GPU coverage');
    air.destroy();
  });
  await run('Hiding coverage replaces aborted camera preparation for entity placement', async () => {
    class PendingSampler {
      #ready = false;
      calls = 0;
      finish?: () => void;
      sample() { return this.#ready ? 0 : null; }
      prepare(_positions: readonly [number, number][], signal: AbortSignal) {
        this.calls++;
        return new Promise<void>((resolve, reject) => {
          const abort = () => {
            signal.removeEventListener('abort', abort);
            reject(new DOMException('aborted', 'AbortError'));
          };
          if (signal.aborted) { abort(); return; }
          signal.addEventListener('abort', abort, { once: true });
          this.finish = () => {
            signal.removeEventListener('abort', abort);
            this.#ready = true;
            resolve();
          };
        });
      }
    }
    const sampler = new PendingSampler();
    const errors: RidgelineError[] = [];
    const air = createViewport({ container, basemap: style(), logger: () => {}, onError: error => errors.push(error), elevationSampler: sampler });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('hide-pending'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } };
    air.upsert([feature]);
    await until(() => sampler.calls === 1 && air.getEntityState(feature.id)?.coverage === 'loading', 'initial camera preparation');
    air.configure({ entityVisibility: { footprints: false, zones: false, groundLines: false } });
    await until(() => sampler.calls >= 2, 'placement preparation after hiding coverage');
    sampler.finish?.();
    await until(() => air.getEntityState(feature.id)?.placement === 'airborne', 'placement recovery after hiding coverage');
    check(air.getEntityState(feature.id)?.coverage === 'ready', 'Hidden placement remained loading');
    check(!errors.some(error => error.code === 'ELEVATION_UNAVAILABLE'), 'Aborted camera preparation reported a diagnostic');
    air.destroy();
  });
  await run('Hidden unavailable placement waits for explicit retry after display configuration changes', async () => {
    let ready = false, recover = false, preparations = 0;
    const air = createViewport({ container, basemap: style(), logger: () => {},
      entityVisibility: { footprints: false, zones: false, groundLines: false },
      elevationSampler: { sample: () => ready ? 0 : null, prepare: async () => { preparations++; ready = recover; } } });
    current = air; await air.ready;
    air.upsert([{ ...point('hidden-unavailable'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } }]);
    await until(() => air.getEntityState('hidden-unavailable')?.coverage === 'unavailable', 'settled hidden placement');
    const before = air.getEntityState('hidden-unavailable')!.computedAt;
    const attempts = preparations;
    air.configure({ projection: 'globe', entityVisibility: { footprints: false, zones: false, groundLines: false } });
    await until(() => air.getEntityState('hidden-unavailable')!.computedAt > before, 'hidden display reconfiguration');
    check(preparations === attempts, 'Display configuration retried settled unavailable elevation');
    recover = true;
    air.retryUpdates();
    await until(() => air.getEntityState('hidden-unavailable')?.placement === 'airborne', 'explicit hidden placement retry');
    check(preparations > attempts, 'Explicit retry did not prepare placement elevation');
    air.destroy();
  });
  await run('Raw DEM placement and coverage remain physical with terrain off and exaggerated', async () => {
    const errors: RidgelineError[] = [];
    const dem=document.createElement('canvas'); dem.width=dem.height=256;
    const context=dem.getContext('2d')!; context.fillStyle='rgb(1,0,0)'; context.fillRect(0,0,256,256);
    const air=createViewport({container,basemap:style(),elevation:{tiles:[dem.toDataURL()],encoding:'custom',redFactor:100,greenFactor:0,blueFactor:0,baseShift:0,maxzoom:0},camera:{center:[0,0],zoom:14,pitch:50},onError:error=>errors.push(error),logger:()=>{}});
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
    air.configure({ projection: 'globe' });
    await until(() => air.getEntityState('raw')?.coverage === 'ready', 'globe camera overlay');
    check((air.getEntityState('raw')?.footprintTriangles ?? 0) > 0, 'Globe lost camera coverage');
    air.configure({ projection: 'flat', terrain: false });
    await until(() => air.getEntityState('raw')?.coverage === 'ready', 'Overlay restored after globe');
    air.remove(['raw']);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    let remaining=0; air.on('click',event=>{remaining=event.features.length;});
    await pointer('click', air.map.project([0,0]));
    check(remaining===0,'Removed attachments still pickable');
    check(!errors.some(error=>error.code==='UPDATE_FAILED'), 'Entity overlay reported an update failure: '+errors.map(error=>error.message).join(', '));
    air.destroy();
  });
  await run('Custom DEM shifts agree with the installed renderer on both sides of zero', async () => {
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!; context.fillStyle = 'rgb(1,0,0)'; context.fillRect(0, 0, 256, 256);
    for (const [shift, expected] of [[40, 60], [-40, 140]] as const) {
      const air = createViewport({ container, basemap: style(), terrain: true,
        elevation: { tiles: [dem.toDataURL()], encoding: 'custom', redFactor: 100, greenFactor: 0,
          blueFactor: 0, baseShift: shift, maxzoom: 0 }, camera: { center: [0, 0], zoom: 12 }, logger: () => {} });
      current = air;
      try {
        await air.ready;
        air.upsert([{ ...point(`shift-${shift}`), entity: {} }]);
        await until(() => Math.abs((air.getEntityState(`shift-${shift}`)?.ground ?? NaN) - expected) < .1 &&
          Math.abs((air.map.queryTerrainElevation([0, 0]) ?? NaN) - expected) < .1, `custom shift ${shift} renderer agreement`);
        check(Math.abs(air.getEntityState(`shift-${shift}`)!.ground! - expected) < .1, `Raw custom shift ${shift} disagreed`);
      } finally { air.destroy(); }
    }
  });
  await run('TileJSON Terrarium metadata decodes flat ground in raw and displayed terrain', async () => {
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!; context.fillStyle = 'rgb(128,0,0)'; context.fillRect(0, 0, 256, 256);
    const tilejson = { tilejson: '3.0.0', tiles: [dem.toDataURL()], minzoom: 0, maxzoom: 0,
      encoding: 'terrarium', scheme: 'tms' };
    const url = `data:application/json,${encodeURIComponent(JSON.stringify(tilejson))}`;
    const air = createViewport({ container, basemap: style(), terrain: true,
      elevation: { url }, camera: { center: [0, 0], zoom: 12 }, logger: () => {} });
    current = air;
    try {
      await air.ready;
      air.upsert([{ ...point('tilejson-flat'), entity: {} }]);
      await until(() => air.getEntityState('tilejson-flat')?.ground === 0 &&
        Math.abs(air.map.queryTerrainElevation([0, 0]) ?? NaN) < .1, 'TileJSON flat terrain agreement');
      check(air.getEntityState('tilejson-flat')?.ground === 0, 'TileJSON Terrarium raw height was not zero');
    } finally { air.destroy(); }
  });
  await run('A 50 km camera at latitude 46 settles with bounded raw terrain loading', async () => {
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!; context.fillStyle = 'rgb(0,0,0)'; context.fillRect(0, 0, 256, 256);
    const air = createViewport({ container, basemap: style(),
      elevation: { tiles: [dem.toDataURL()], encoding: 'custom', redFactor: 0, greenFactor: 0,
        blueFactor: 0, baseShift: 0, minzoom: 0, maxzoom: 12 },
      camera: { center: [0, 46], zoom: 9 }, logger: () => {} });
    current = air;
    const feature: MapFeature = { ...point('wide-range'), geometry: { type: 'Point', coordinates: [0, 46] },
      entity: { altitude: { meters: 1000, reference: 'ground' }, attachments: [{ id: 'camera', type: 'camera',
        terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 50_000 }] } };
    try {
      await air.ready;
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', '50 km terrain convergence', 20_000);
      check(air.getEntityState(feature.id)?.coverage === 'ready', 'Wide camera never reached ready');
    } finally { air.destroy(); }
  });
  await run('Visible footprint stays filled when displayed terrain differs slightly from sampled terrain', async () => {
    const dem=document.createElement('canvas'); dem.width=dem.height=256;
    const context=dem.getContext('2d')!; context.fillStyle='rgb(105,0,0)'; context.fillRect(0,0,256,256);
    const air=createViewport({container,basemap:style('#000000'),terrain:true,elevation:{tiles:[dem.toDataURL()],encoding:'custom',redFactor:1,greenFactor:0,blueFactor:0,baseShift:0,maxzoom:0},elevationSampler:{sample:()=>100},camera:{center:[0,0],zoom:17,pitch:0},entityVisibility:{footprints:true,zones:false,groundLines:false},logger:()=>{}});
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
  await run('Camera overlay remains filled across a hill without testing occlusion', async () => {
    const meters = Math.PI / 180 * 6371008.8;
    const hill = (_lng: number, lat: number) => 20 * Math.exp(-(((lat * meters - 300) / 40) ** 2));
    const air = createViewport({ container, basemap: style('#000000'),
      elevationSampler: { sample: hill }, camera: { center: [0, 310 / meters], zoom: 17, pitch: 0 },
      entityVisibility: { footprints: true, zones: false, groundLines: false }, logger: () => {} });
    current = air; await air.ready;
    air.upsert([{ ...point('hill-shadow'), entity: { altitude: { meters: 100, reference: 'sea-level' },
      attachments: [{ id: 'camera', type: 'camera', color: '#00ff00', bearing: 0, elevation: -15, fovX: 60, fovY: 40, range: 2000 }] } }]);
    await until(() => air.getEntityState('hill-shadow')?.coverage === 'ready', 'hill coverage');
    await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
    const pixels = await new Promise<number[]>(resolve => {
      air.map.once('render', () => {
        const canvas = air.map.getCanvas(), gl = canvas.getContext('webgl2')!, greens: number[] = [];
        for (const north of [250, 355]) {
          const p = air.map.project([0, north / meters]), pixel = new Uint8Array(4), scale = canvas.width / canvas.clientWidth;
          gl.readPixels(Math.round(p.x * scale), canvas.height - 1 - Math.round(p.y * scale), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          greens.push(pixel[1]!);
        }
        resolve(greens);
      });
      air.map.triggerRepaint();
    });
    check(pixels[0]! > 50, `Visible approach lost coverage: ${pixels}`);
    check(pixels[1]! > 50, `Overlay incorrectly removed the far slope: ${pixels}`);
    air.destroy();
  });
  await run('Drawing creates accepted features, owns clicks, edits with keyboard and survives style reload', async () => {
    const draw = createViewport({ container, basemap: style(), camera: { center:[0,0], zoom:12 }, logger:()=>{} });
    current = draw;
    await draw.ready;
    let clicks=0, accepts=0;
    draw.on('click',()=>{clicks++;});
    const editor=attachDrawing(draw,{
      createFeature:()=>({id:'drawn',properties:{name:'Drawn'}}),
      submit:()=>{accepts++;return {accepted:true};},
    });
    const tools=document.createElement('div'),inspector=document.createElement('div');container.after(tools,inspector);
    const controls=attachDrawingControls(draw,editor,{tools,inspector});
    await until(()=>Boolean(draw.map.getSource('rl:draft')),'draft source attached');
    await browserClick('[data-field="action:Polygon"]');
    check(inspector.contains(document.activeElement), 'Starting a tool lost keyboard focus');
    for(const p of [[0,0],[.02,0],[.02,.02],[0,.02]] as [number,number][]){
      await pointer('click', draw.map.project(p));
    }
    check(clicks===0,'Drawing clicks escaped to consumer selection');
    check(container.querySelectorAll('.rl-drawing-handle').length>=4,'Vertex handles missing');
    check(!draw.getFeature('drawn'),'Unaccepted draft entered store');
    check(inspector.textContent?.includes('Area'),'Measurements missing');
    const undo = inspector.querySelector<HTMLButtonElement>('[data-field="action:Undo"]')!;
    undo.focus(); await browserKey('Control+z');
    const undone=editor.getState().draft?.shape;
    check(undone?.kind==='polygon'&&undone.vertices.length===3,'Nested controls applied Undo more than once');
    check(document.activeElement?.getAttribute('data-field')==='action:Undo','Undo lost keyboard focus');
    const redo = inspector.querySelector<HTMLButtonElement>('[data-field="action:Redo"]')!;
    redo.focus(); await browserKey('Control+Shift+z');
    const redone=editor.getState().draft?.shape;
    check(redone?.kind==='polygon'&&redone.vertices.length===4,'Nested controls applied Redo more than once');
    check(inspector.contains(document.activeElement),'Disabled redo lost keyboard focus');
    editor.setStyle({fillOpacity:0.29});
    check(inspector.querySelector<HTMLInputElement>('[data-field="Opacity (%)"]')?.value==='29','Opacity displayed floating-point noise');
    await browserClick('[data-field="action:Finish"]');
    await until(() => accepts === 1, 'drawing accepted through Finish control');
    check(accepts===1&&draw.getFeature('drawn')?.geometry.type==='Polygon','Accepted polygon not stored');
    editor.edit('drawn');
    const original=JSON.stringify(editor.getState().draft?.shape);
    const handle=container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]')!;
    handle.focus();await browserKey('ArrowRight');
    check(JSON.stringify(editor.getState().draft?.shape)!==original,'Keyboard did not move a vertex');
    editor.undo();check(JSON.stringify(editor.getState().draft?.shape)===original,'Draft undo failed');
    draw.configure({basemap:style('#dddddd'),projection:'globe'});
    await until(()=>Boolean(draw.map.getLayer('rl:draft-fill')),'draft restored after style replacement');
    check(Boolean(editor.getState().draft),'Style replacement discarded the draft');
    await until(() => draw.map.querySourceFeatures('rl:features').some(hit => hit.properties._rl_feature_id === 'drawn'), 'edited source restored');
    const editedSource = draw.map.querySourceFeatures('rl:features').find(hit => hit.properties._rl_feature_id === 'drawn');
    await until(() => editedSource?.id !== undefined && Boolean(draw.map.getFeatureState({source:'rl:features',id:editedSource.id}).editing), 'editing state restored');
    check(editedSource?.id !== undefined && draw.map.getFeatureState({source:'rl:features',id:editedSource.id}).editing,'Original feature not hidden during edit');
    editor.cancel();check(editedSource?.id !== undefined && !draw.map.getFeatureState({source:'rl:features',id:editedSource.id}).editing,'Cancel left original hidden');
    controls.destroy();editor.destroy();check(!container.querySelector('.rl-drawing-handle'),'Handle leaked on destroy');
    check(!draw.map.getSource('rl:draft'),'Draft source leaked on destroy');
    draw.destroy();tools.remove();inspector.remove();
  });
  await run('Inspector label editing preserves Tab and the first real Finish click', async () => {
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, logger: () => {} });
    current = draw; await draw.ready;
    let accepts = 0;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'inspector-finish', properties: {} }), submit: () => { accepts++; return { accepted: true }; } });
    const tools = document.createElement('div'), inspector = document.createElement('div');
    inspector.id = 'case25-inspector'; container.append(tools, inspector);
    const controls = attachDrawingControls(draw, editor, { tools, inspector });
    try {
      editor.start('line'); editor.addPoint([0, 0]); editor.addPoint([.01, 0]);
      if (!window.browserFill || !window.browserKey || !window.browserClick) throw new Error('Playwright input bridge required');
      await window.browserFill('#case25-inspector [data-field="Label"]', 'First label');
      await window.browserKey('Tab');
      check(document.activeElement?.getAttribute('data-field') === 'Stroke', 'Tab skipped the next inspector field');
      await window.browserFill('#case25-inspector [data-field="Label"]', 'Final label');
      await window.browserClick('#case25-inspector [data-field="action:Finish"]');
      await until(() => Boolean(draw.getFeature('inspector-finish')), 'first Finish click accepted');
      check(accepts === 1 && draw.getFeature('inspector-finish')?.drawing?.style.label === 'Final label', 'Finish lost the label or submitted twice');
    } finally {
      controls.destroy(); editor.destroy(); draw.destroy(); tools.remove(); inspector.remove();
    }
  });
  await run('Inspector rectangle fields retain consecutive native edits and undo history', async () => {
    const shape = { kind: 'rectangle' as const, center: [0, 0] as [number, number], width: 100, height: 80, bearing: 0 };
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 15 },
      features: [{ type: 'Feature', id: 'rectangle-fields', properties: {}, geometry: shapeGeometry(shape), drawing: { version: 1, shape, style: { color: '#008855', fillColor: '#008855', lineWidth: 2, fillOpacity: .2, dashed: false, label: '' } } }], logger: () => {} });
    current = draw; await draw.ready;
    let accepts = 0;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'unused', properties: {} }), submit: () => { accepts++; return { accepted: true }; } });
    const tools = document.createElement('div'), inspector = document.createElement('div');
    inspector.id = 'rectangle-inspector'; container.append(tools, inspector);
    const controls = attachDrawingControls(draw, editor, { tools, inspector });
    const dimensions = (width: number, height: number, bearing: number) => {
      const current = editor.getState().draft?.shape;
      check(current?.kind === 'rectangle' && current.width === width && current.height === height && current.bearing === bearing,
        `Expected rectangle ${width}/${height}/${bearing}, received ${JSON.stringify(current)}`);
    };
    try {
      editor.edit('rectangle-fields');
      if (!window.browserFill) throw new Error('Playwright fill bridge required');
      await window.browserFill('#rectangle-inspector [data-field="Width (m)"]', '240');
      await browserKey('Tab');
      check(document.activeElement?.getAttribute('data-field') === 'Height (m)', 'Width Tab missed Height');
      await window.browserFill('#rectangle-inspector [data-field="Height (m)"]', '160');
      await browserKey('Tab');
      check(document.activeElement?.getAttribute('data-field') === 'Bearing (°)', 'Height Tab missed Bearing');
      await window.browserFill('#rectangle-inspector [data-field="Bearing (°)"]', '35');
      await browserKey('Tab');
      dimensions(240, 160, 35);
      await browserClick('#rectangle-inspector [data-field="action:Undo"]'); dimensions(240, 160, 0);
      await browserClick('#rectangle-inspector [data-field="action:Undo"]'); dimensions(240, 80, 0);
      await browserClick('#rectangle-inspector [data-field="action:Undo"]'); dimensions(100, 80, 0);
      for (let i = 0; i < 3; i++) await browserClick('#rectangle-inspector [data-field="action:Redo"]');
      dimensions(240, 160, 35);
      await browserClick('#rectangle-inspector [data-field="action:Finish"]');
      await until(() => accepts === 1 && editor.getState().phase === 'idle', 'rectangle accepted once');
      const accepted = draw.getFeature('rectangle-fields')?.drawing?.shape;
      check(accepted?.kind === 'rectangle' && accepted.width === 240 && accepted.height === 160 && accepted.bearing === 35,
        'Finish lost consecutive rectangle changes');
    } finally { controls.destroy(); editor.destroy(); draw.destroy(); tools.remove(); inspector.remove(); }
  });
  await run('Deleting the focused final vertex keeps keyboard undo reachable', async () => {
    const line: MapFeature = { type: 'Feature', id: 'focus-line', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 }, features: [line], logger: () => {} });
    current = draw; await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'new-focus', properties: {} }), submit: () => ({ accepted: true }) });
    try {
      editor.edit('focus-line');
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]')!;
      handle.focus();
      if (!window.browserKey) throw new Error('Playwright keyboard bridge required');
      await window.browserKey('Delete');
      const shape = editor.getState().draft?.shape;
      check(shape?.kind === 'line' && shape.vertices.length === 1, 'Delete did not remove the last vertex');
      const focus = document.activeElement;
      check(focus instanceof HTMLElement && focus.isConnected &&
        (focus.getAttribute('aria-label') === 'Vertex 1' || focus.getAttribute('aria-label') === 'Move drawing' || focus === draw.map.getCanvas()),
      'Deleting the focused handle lost editor focus');
      await window.browserKey('Control+z');
      const restored = editor.getState().draft?.shape;
      check(restored?.kind === 'line' && restored.vertices.length === 2, 'Keyboard undo could not restore the deleted vertex');
    } finally { editor.destroy(); draw.destroy(); }
  });
  await run('Undo during a real vertex drag leaves later edits individually undoable', async () => {
    const line: MapFeature = { type: 'Feature', id: 'gesture-line', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] } };
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 13 }, features: [line], logger: () => {} });
    current = draw; await draw.ready;
    const editor = attachDrawing(draw, { createFeature: () => ({ id: 'new-gesture', properties: {} }), submit: () => ({ accepted: true }) });
    try {
      editor.edit('gesture-line');
      await until(() => draw.map.loaded(), 'gesture map ready');
      const handle = container.querySelector<HTMLButtonElement>('[aria-label="Vertex 2"]')!;
      const rect = handle.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      if (!window.browserMouse || !window.browserKey) throw new Error('Playwright input bridge required');
      await window.browserMouse('down', x, y);
      await window.browserMouse('move', x + 40, y);
      await until(() => {
        const shape = editor.getState().draft?.shape;
        return shape?.kind === 'line' && shape.vertices[1]?.[0] !== .01;
      }, 'vertex moved during drag');
      await window.browserKey('Control+z');
      await window.browserMouse('up', x + 40, y);
      const afterUndo = editor.getState().draft?.shape;
      check(afterUndo?.kind === 'line' && Math.abs((afterUndo.vertices[1]?.[0] ?? 0) - .01) < 1e-10, 'Undo during drag left the moved vertex');
      editor.insertVertex(0, [.005, 0]);
      editor.moveVertex(1, [.006, 0]);
      editor.undo();
      const afterMoveUndo = editor.getState().draft?.shape;
      check(afterMoveUndo?.kind === 'line' && afterMoveUndo.vertices.length === 3 && afterMoveUndo.vertices[1]?.[0] === .005,
        'Undo skipped the later vertex move');
      editor.undo();
      const afterInsertUndo = editor.getState().draft?.shape;
      check(afterInsertUndo?.kind === 'line' && afterInsertUndo.vertices.length === 2, 'Undo skipped the later insertion');
    } finally { editor.destroy(); draw.destroy(); }
  });
  await run('Ordinary edits preserve dynamic styles, delete-only controls, and hover recovery', async () => {
    const line: MapFeature = {type:'Feature',id:'line',geometry:{type:'LineString',coordinates:[[-.01,0],[.01,0]]},properties:{closed:false}};
    const draw=createViewport({container,basemap:style(),camera:{center:[0,0],zoom:12},features:[line,point('hover',.02)],
      style:feature=>({color:feature.properties.closed?'#cc2222':'#008855',dashed:true,lineWidth:2}),logger:()=>{}});
    current=draw;await draw.ready;
    await until(()=>draw.map.queryRenderedFeatures({layers:['rl:points']}).length>0,'hover target rendered');
    let hovers=0; draw.on('hover',()=>hovers++);
    const hover=()=>pointer('move',draw.map.project([.02,0]));
    await hover();const previous=hovers,release=draw.acquireInteraction('test');
    await pointer('move',draw.map.project([0,0]));await hover();release();
    check(hovers===previous,'Interaction owner leaked hover events');
    await pointer('move',draw.map.project([0,0]));await hover();
    check(hovers>previous,'Hover did not resume after releasing interaction ownership');
    const orangePixels=()=>new Promise<number>(resolve=>{
      draw.map.once('render',()=>{
        const canvas=draw.map.getCanvas(),gl=canvas.getContext('webgl2')!,scale=canvas.width/canvas.clientWidth,p=draw.map.project([0,0]);
        const pixels=new Uint8Array(100*24*4);
        gl.readPixels(Math.round(p.x*scale)-50,canvas.height-Math.round(p.y*scale)-12,100,24,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        let count=0;for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]!-219)<3&&Math.abs(pixels[i+1]!-106)<3&&Math.abs(pixels[i+2]!-32)<3)count++;
        resolve(count);
      });draw.map.triggerRepaint();
    });
    draw.preview('line');const hovered=await orangePixels();
    draw.setSelection(['line']);const selected=await orangePixels();
    check(hovered>0&&selected>hovered,'Dashed line did not show hover color and selection width');
    let deleteOnly=false;
    const editor=attachDrawing(draw,{createFeature:()=>({id:'new',properties:{}}),styleFields:[],canEdit:(_f,op)=>!deleteOnly||op==='delete',submit:()=>({accepted:true})});
    const tools=document.createElement('div'),inspector=document.createElement('div');container.after(tools,inspector);
    const controls=attachDrawingControls(draw,editor,{tools,inspector});
    editor.edit('line');editor.moveVertex(1,[.015,0]);check(await editor.finish(),'Ordinary edit failed');
    check(!draw.getFeature('line')?.drawing,'Geometry-only edit added fixed appearance');
    draw.upsert([{...draw.getFeature('line')!,properties:{closed:true}}]);
    check(draw.getStyle(draw.getFeature('line')!).color==='#cc2222','Consumer style stopped following properties');
    deleteOnly=true;editor.edit('line');
    const button=inspector.querySelector<HTMLButtonElement>('[data-field="action:Delete drawing"]')!;
    check(!button.disabled,'Delete-only permission disabled the Delete control');await browserClick('[data-field="action:Delete drawing"]');
    await until(()=>!draw.getFeature('line'),'delete-only action applied');
    controls.destroy();editor.destroy();draw.destroy();tools.remove();inspector.remove();
  });
  await run('Drawing snapping visits only nearby rendered candidates', async () => {
    const draw=createViewport({container,basemap:style(),camera:{center:[0,0],zoom:12},features:[point('near',0),point('far',0.04)],logger:()=>{}});
    current=draw;await draw.ready;
    await until(()=>draw.map.queryRenderedFeatures({layers:['rl:points']}).length>=2,'snap targets rendered');
    const visited:string[]=[];
    const editor=attachDrawing(draw,{createFeature:()=>({id:'snapped',properties:{}}),submit:()=>({accepted:true}),canSnap:feature=>{visited.push(feature.id);return true;}});
    editor.start('line');
    const origin=draw.map.project([0,0]);
    const cursor={x:origin.x+4,y:origin.y};
    await pointer('click',cursor);
    const shape=editor.getState().draft?.shape;
    check(shape?.kind==='line'&&shape.vertices[0]?.[0]===0&&shape.vertices[0]?.[1]===0,'Nearby vertex did not snap');
    check(visited.length>0&&visited.every(id=>id==='near'),'Snapping inspected features outside its pointer radius');
    editor.destroy();draw.destroy();
  });
  await run('Real pointer drawing previews stay ephemeral and match circle and rotated rectangle placement', async () => {
    const draw=createViewport({container,basemap:style(),camera:{center:[0,0],zoom:12},logger:()=>{}});
    current=draw;await draw.ready;
    let nextId=0;
    const editor=attachDrawing(draw,{createFeature:()=>({id:`pointer-${nextId++}`,properties:{}}),submit:()=>({accepted:true})});
    const visibleDraft=()=>draw.map.queryRenderedFeatures({layers:['rl:draft-fill']}).map(feature=>feature.geometry);
    const previewDistance=(target:{x:number;y:number})=>Math.min(...visibleDraft().flatMap(geometry=>
      geometry.type==='Polygon'?(geometry.coordinates[0]??[]).map(([lng,lat])=>{
        if(lng===undefined||lat===undefined)return Infinity;
        const edge=draw.map.project([lng,lat]);
        return Math.hypot(edge.x-target.x,edge.y-target.y);
      }):[]));
    const center=draw.map.project([0,0]);
    editor.start('circle');
    await pointer('click',center);
    const circleBefore=editor.getState(),circleDraft=JSON.stringify(circleBefore.draft),circleUndo=circleBefore.canUndo;
    const circleEdge={x:center.x+70,y:center.y};
    await pointer('move',circleEdge);
    await until(()=>previewDistance(circleEdge)<1.5,'visible circle preview reaches pointer');
    const circlePreview=editor.getMeasurements();
    check(circlePreview.length>0&&circlePreview.area!>0,'Circle preview did not follow the pointer');
    const circleDuring=editor.getState();
    check(JSON.stringify(circleDuring.draft)===circleDraft,'Circle preview mutated the draft');
    check(circleDuring.canUndo===circleUndo,'Circle preview added an undo entry');
    await pointer('click',circleEdge);
    const circleCommitted=editor.getMeasurements();
    check(Math.abs(circlePreview.length-circleCommitted.length)<.001,'Circle preview did not match the committed placement');
    check(Math.abs(circlePreview.area!-circleCommitted.area!)<.001,'Circle preview area did not match placement');
    const circleShape=editor.getState().draft!.shape;
    editor.undo();
    const circleUndone=editor.getState().draft;
    check(circleUndone?.placing===true&&circleUndone.placed===1,'Undo did not restore the first circle placement');
    check(circleUndone?.shape.kind==='circle'&&circleUndone.shape.radius===0,'Undo retained the second circle placement');
    editor.redo();
    check(await editor.finish(),'Circle change was not accepted');
    check(JSON.stringify(draw.getFeature('pointer-0')?.geometry)===JSON.stringify(shapeGeometry(circleShape)),'Accepted circle differs from placed geometry');

    editor.start('rectangle');
    await pointer('click',center);
    const rectangleCenter=editor.getState().draft!.shape;
    if(rectangleCenter.kind!=='rectangle')throw new Error('Rectangle draft was not created');
    editor.setShape({...rectangleCenter,width:0,height:0,bearing:45});
    const rectangleBefore=editor.getState(),rectangleDraft=JSON.stringify(rectangleBefore.draft),rectangleUndo=rectangleBefore.canUndo;
    const rectanglePoint={x:center.x+86,y:center.y-42};
    await pointer('move',rectanglePoint);
    await until(()=>previewDistance(rectanglePoint)<1.5,'visible rectangle preview reaches pointer');
    const rectanglePreview=editor.getMeasurements();
    check(rectanglePreview.length>0&&rectanglePreview.area!>0,'Rectangle preview did not follow the pointer');
    const rectangleDuring=editor.getState();
    check(JSON.stringify(rectangleDuring.draft)===rectangleDraft,'Rectangle preview mutated the draft');
    check(rectangleDuring.canUndo===rectangleUndo,'Rectangle preview added an undo entry');
    await pointer('click',rectanglePoint);
    const rectangleCommitted=editor.getMeasurements();
    check(Math.abs(rectanglePreview.length-rectangleCommitted.length)<.001,'Rotated rectangle preview did not match the committed placement');
    check(Math.abs(rectanglePreview.area!-rectangleCommitted.area!)<.001,'Rotated rectangle preview area did not match placement');
    const rectangleAfter=editor.getState().draft!;
    if(rectangleAfter.shape.kind!=='rectangle'||rectangleAfter.placing)throw new Error('Rectangle second placement did not finish placement');
    const rectangleShape=rectangleAfter.shape;
    const geometry=shapeGeometry(rectangleShape);
    if(geometry.type!=='Polygon')throw new Error('Rectangle geometry was not a polygon');
    const cornerDistance=Math.min(...geometry.coordinates[0]!.slice(0,-1).map(([lng,lat])=>{
      if(lng===undefined||lat===undefined)return Infinity;
      const corner=draw.map.project([lng,lat]);
      return Math.hypot(corner.x-rectanglePoint.x,corner.y-rectanglePoint.y);
    }));
    // Browser mouse events round CSS coordinates, so compare within one screen pixel.
    check(cornerDistance<1,`Committed rectangle missed the clicked corner by ${cornerDistance} pixels`);
    editor.undo();
    const rectangleUndone=editor.getState().draft;
    check(JSON.stringify(rectangleUndone)===rectangleDraft,'Undo did not restore the first rotated rectangle placement');
    editor.redo();
    check(await editor.finish(),'Rectangle change was not accepted');
    check(JSON.stringify(draw.getFeature('pointer-1')?.geometry)===JSON.stringify(geometry),'Accepted rectangle differs from placed geometry');
    editor.destroy();draw.destroy();
  });
  await run('Accepted shape definitions survive consumer storage and viewport recreation', async () => {
    const first = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, logger: () => {} });
    current = first; await first.ready;
    let next = 0;
    const editor = attachDrawing(first, {
      createFeature: () => ({ id: `stored-${next++}`, properties: { name: 'Stored drawing' } }),
      submit: () => ({ accepted: true }),
    });
    editor.start('circle'); editor.addPoint([0, 0]); editor.addPoint([.005, 0]);
    check(await editor.finish(), 'Circle acceptance failed');
    editor.start('rectangle'); editor.addPoint([0, 0]);
    const rectangle = editor.getState().draft?.shape;
    if (rectangle?.kind !== 'rectangle') throw new Error('Rectangle shape missing');
    editor.setShape({ ...rectangle, width: 600, height: 350, bearing: 35 });
    check(await editor.finish(), 'Rectangle acceptance failed');
    editor.start('arrow'); editor.addPoint([0, 0]); editor.addPoint([.005, .005]);
    check(await editor.finish(), 'Arrow acceptance failed');
    const before = ['stored-0', 'stored-1', 'stored-2'].map(id => first.getFeature(id));
    check(before.every(feature => feature?.drawing), 'Accepted feature lost its shape definition');
    const originalShapes = before.map(feature => feature?.drawing?.shape);
    const stored = JSON.stringify(before);
    editor.destroy(); first.destroy();

    const restored = JSON.parse(stored) as MapFeature[];
    const second = createViewport({ container, basemap: style('#f4f4f4'), camera: { center: [0, 0], zoom: 12 }, features: restored, logger: () => {} });
    current = second; await second.ready;
    const reloaded = attachDrawing(second, {
      createFeature: () => ({ id: 'unused', properties: {} }),
      submit: () => ({ accepted: true }),
    });
    reloaded.edit('stored-0');
    const circle = reloaded.getState().draft?.shape;
    if (circle?.kind !== 'circle' || Math.abs(circle.radius - 556) > 1) throw new Error('Circle radius was not restored');
    check(JSON.stringify(circle) === JSON.stringify(originalShapes[0]), 'Circle definition changed during storage');
    reloaded.setShape({ ...circle, radius: circle.radius + 100 });
    check(await reloaded.finish(), 'Reloaded circle could not be edited');
    const editedCircle = second.getFeature('stored-0')?.drawing?.shape;
    check(editedCircle?.kind === 'circle' && Math.abs(editedCircle.radius - circle.radius - 100) < .001, 'Circle lost shape-specific editing');
    reloaded.edit('stored-1');
    const restoredRectangle = reloaded.getState().draft?.shape;
    if (restoredRectangle?.kind !== 'rectangle' || restoredRectangle.bearing !== 35 || restoredRectangle.width !== 600) throw new Error('Rectangle dimensions were not restored');
    reloaded.setShape({ ...restoredRectangle, width: 700 });
    check(await reloaded.finish(), 'Reloaded rectangle could not be edited');
    const editedRectangle = second.getFeature('stored-1')?.drawing?.shape;
    check(editedRectangle?.kind === 'rectangle' && editedRectangle.width === 700, 'Rectangle width edit was not saved');
    reloaded.edit('stored-2');
    const arrow = reloaded.getState().draft?.shape;
    if (arrow?.kind !== 'arrow' || JSON.stringify(arrow.vertices) !== JSON.stringify([[0, 0], [.005, .005]])) throw new Error('Arrow direction was not restored');
    check(JSON.stringify(arrow) === JSON.stringify(originalShapes[2]), 'Arrow definition changed during storage');
    reloaded.setShape({ ...arrow, vertices: [[0, 0], [.01, .005]] });
    check(await reloaded.finish(), 'Reloaded arrow could not be edited');
    const editedArrow = second.getFeature('stored-2')?.drawing?.shape;
    check(editedArrow?.kind === 'arrow' && editedArrow.vertices[1]?.[0] === .01, 'Arrow lost shape-specific editing');
    reloaded.destroy(); second.destroy();
  });
  await run('Rejected drawing remains editable and cancellation preserves accepted data', async () => {
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, logger: () => {} });
    current = draw; await draw.ready;
    let accept = false;
    const editor = attachDrawing(draw, {
      createFeature: () => ({ id: 'rejected', properties: { name: 'Rejected draft' } }),
      submit: () => accept ? { accepted: true } : { accepted: false, reason: 'Try another location' },
    });
    const tools = document.createElement('div'), inspector = document.createElement('div');
    container.after(tools, inspector);
    const controls = attachDrawingControls(draw, editor, { tools, inspector });
    await browserClick('[data-field="action:Circle"]');
    await pointer('click', draw.map.project([0, 0]));
    await pointer('click', draw.map.project([.005, 0]));
    await browserClick('[data-field="action:Finish"]');
    await until(() => editor.getState().phase === 'rejected', 'rejection feedback');
    check(!draw.getFeature('rejected') && editor.getState().draft?.shape.kind === 'circle', 'Rejection lost draft or saved it');
    const rejectedShape = editor.getState().draft?.shape;
    if (rejectedShape?.kind !== 'circle') throw new Error('Rejected circle shape missing');
    const radiusInput = inspector.querySelector<HTMLInputElement>('[data-field="Radius (m)"]');
    if (!radiusInput || radiusInput.disabled) throw new Error('Rejected circle lost its editable radius field');
    await browserClick('[data-field="Radius (m)"]');
    await browserKey('Control+A');
    for (const digit of '700') await browserKey(digit);
    await browserKey('Tab');
    const revisedShape = editor.getState().draft?.shape;
    if (revisedShape?.kind !== 'circle' || revisedShape.radius !== 700) throw new Error('Editing the rejected draft did not change its radius');
    accept = true;
    await browserClick('[data-field="action:Finish"]');
    await until(() => Boolean(draw.getFeature('rejected')), 'accepted retry');
    const acceptedShape = draw.getFeature('rejected')?.drawing?.shape;
    check(acceptedShape?.kind === 'circle' && Math.abs(acceptedShape.radius - revisedShape.radius) < .001, 'Accepted retry lost the draft edit');
    const accepted = JSON.stringify(draw.getFeature('rejected'));
    editor.edit('rejected');
    const shape = editor.getState().draft?.shape;
    if (shape?.kind !== 'circle') throw new Error('Accepted circle could not be edited');
    editor.setShape({ ...shape, radius: shape.radius + 200 });
    await browserClick('[data-field="action:Cancel"]');
    check(JSON.stringify(draw.getFeature('rejected')) === accepted, 'Cancel changed accepted feature');
    controls.destroy(); editor.destroy(); draw.destroy(); tools.remove(); inspector.remove();
  });
  await run('Vertex dragging moves the draft and restores unchanged snap targets', async () => {
    const line:MapFeature={type:'Feature',id:'line',properties:{},geometry:{type:'LineString',coordinates:[[0,0],[.01,0]]}};
    const draw=createViewport({container,basemap:style(),camera:{center:[0,0],zoom:13},features:[line,point('anchor',0)],logger:()=>{}});
    current=draw;await draw.ready;
    await until(()=>draw.map.queryRenderedFeatures({layers:['rl:points']}).length>0,'snap anchor rendered');
    const editor=attachDrawing(draw,{createFeature:()=>({id:'new',properties:{}}),submit:()=>({accepted:true})});editor.edit('line');
    await until(()=>draw.map.loaded(),'handle map ready');
    const handle=container.querySelector<HTMLButtonElement>('[aria-label="Vertex 1"]')!;
    const rect=handle.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    await browserDrag(x,y,x+7,y);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    const shape=editor.getState().draft?.shape,end=handle.getBoundingClientRect();
    check(shape?.kind==='line'&&shape.vertices[0]?.[0]===0&&shape.vertices[0]?.[1]===0,'Dragged vertex did not snap back to its anchor');
    check(Math.abs(end.x+end.width/2-x)<0.5&&Math.abs(end.y+end.height/2-y)<0.5,'Handle stayed displaced from its unchanged snap target');
    await browserDrag(x,y,x+30,y+35);
    const moved=editor.getState().draft?.shape,movedRect=handle.getBoundingClientRect();
    check(moved?.kind==='line'&&Math.abs(moved.vertices[0]![0])>.0001&&Math.abs(moved.vertices[0]![1])>.0001,'Dragging did not move the vertex in the draft');
    check(Math.abs(movedRect.x+movedRect.width/2-x-30)<1&&Math.abs(movedRect.y+movedRect.height/2-y-35)<1,'Handle did not follow the moved vertex');
    editor.destroy();draw.destroy();
  });
  await run('Whole-shape dragging follows the pointer without snapping to its own vertices', async () => {
    const shape={kind:'polygon' as const,vertices:[[-.0026,-.0026],[.0026,-.0026],[.0026,.0026],[-.0026,.0026]] as [number,number][]};
    const feature:MapFeature={type:'Feature',id:'moving',geometry:shapeGeometry(shape),properties:{}};
    const draw=createViewport({container,basemap:style(),camera:{center:[0,0],zoom:12},features:[feature],logger:()=>{}});
    current=draw;await draw.ready;
    const editor=attachDrawing(draw,{createFeature:()=>({id:'new',properties:{}}),submit:()=>({accepted:true})});
    editor.edit('moving');
    await until(()=>draw.map.loaded(),'drag map ready');
    const handle=container.querySelector<HTMLButtonElement>('[aria-label="Move drawing"]')!;
    const rect=handle.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    const origin=draw.map.project([0,0]);
    await browserDrag(x,y,x+30,y+30);
    const draft=editor.getState().draft?.shape;
    if(draft?.kind!=='polygon')throw new Error('Missing polygon draft');
    const center=draw.map.project([draft.vertices.reduce((sum,p)=>sum+p[0],0)/draft.vertices.length,draft.vertices.reduce((sum,p)=>sum+p[1],0)/draft.vertices.length]);
    check(Math.abs(center.x-origin.x-30)<0.5&&Math.abs(center.y-origin.y-30)<0.5,'Whole drawing jumped to its own moving vertex');
    editor.destroy();draw.destroy();
  });
  await run('Arrowheads follow accepted geometry updates and disappear on deletion', async () => {
    const arrowShape = { kind:'arrow' as const, vertices:[[-.01,0],[.01,0]] as [number,number][] };
    const arrow:MapFeature = { type:'Feature', id:'arrow', geometry:shapeGeometry(arrowShape), properties:{}, drawing:{version:1,shape:arrowShape,style:{color:'#ff0000',fillColor:'#ff0000',lineWidth:3,fillOpacity:0,dashed:false,label:''}} };
    const draw=createViewport({container,basemap:style(),features:[arrow],camera:{center:[0,0],zoom:12},logger:()=>{}});current=draw;await draw.ready;
    const heads=()=>draw.map.queryRenderedFeatures({layers:['rl:arrowheads']});
    await until(()=>heads().some(f=>f.properties._rl_feature_id==='arrow'),'initial arrowhead rendered');
    arrow.drawing!.shape={kind:'arrow',vertices:[[0,-.01],[0,.01]]};arrow.geometry=shapeGeometry(arrow.drawing!.shape);draw.upsert([arrow]);
    await until(()=>heads().some(f=>Math.abs(Number(f.properties.bearing))<1),'arrowhead follows direction');
    draw.remove(['arrow']);await until(()=>heads().length===0,'arrowhead removed');draw.destroy();
  });
  await run('A failed arrow update retains its shaft and head while healthy work advances', async () => {
    const oldShape = { kind: 'arrow' as const, vertices: [[-.01, 0], [.01, 0]] as [number, number][] };
    const newShape = { kind: 'arrow' as const, vertices: [[-.01, .02], [.01, .02]] as [number, number][] };
    const arrow: MapFeature = { type: 'Feature', id: 'coherent-arrow', properties: {}, geometry: shapeGeometry(oldShape),
      drawing: { version: 1, shape: oldShape, style: { color: '#ff0000', fillColor: '#ff0000', lineWidth: 3,
        fillOpacity: 0, dashed: false, label: '' } } };
    const errors: RidgelineError[] = [];
    const draw = createViewport({ container, basemap: style(), camera: { center: [0, .01], zoom: 12 },
      features: [arrow, point('arrow-neighbor')], style: feature => {
        if (feature.properties.fail) throw new Error('Arrow styling failed');
        return { color: '#008855' };
      }, logger: () => {}, onError: error => errors.push(error) });
    current = draw; await draw.ready;
    const visible = (layer: string, lng: number, lat: number) => draw.map.queryRenderedFeatures(draw.map.project([lng, lat]), { layers: [layer] })
      .some(hit => hit.properties._rl_feature_id === arrow.id);
    try {
      await until(() => visible('rl:line', 0, 0) && visible('rl:arrowheads', .01, 0), 'original arrow shaft and head');
      draw.upsert([
        { ...arrow, geometry: shapeGeometry(newShape), drawing: { ...arrow.drawing!, shape: newShape }, properties: { fail: true } },
        point('arrow-neighbor', .04),
      ]);
      await until(() => errors.some(error => error.context.featureId === arrow.id) &&
        draw.map.queryRenderedFeatures(draw.map.project([.04, 0]), { layers: ['rl:points'] })
          .some(hit => hit.properties._rl_feature_id === 'arrow-neighbor'), 'healthy feature advanced after arrow failure');
      check(visible('rl:line', 0, 0) && visible('rl:arrowheads', .01, 0), 'Failed arrow lost its previous complete shape');
      check(!visible('rl:line', 0, .02) && !visible('rl:arrowheads', .01, .02), 'Failed arrow published a split new shape');
      draw.upsert([{ ...arrow, geometry: shapeGeometry(newShape), drawing: { ...arrow.drawing!, shape: newShape } }]);
      await until(() => visible('rl:line', 0, .02) && visible('rl:arrowheads', .01, .02), 'corrected arrow published');
    } finally { draw.destroy(); }
  });
  await run('Terrain visibility colors the approach green and the hill shadow red', async () => {
    const meters = Math.PI / 180 * 6371008.8;
    const hill = (_lng: number, lat: number) => 150 * Math.exp(-(((lat * meters - 300) / 40) ** 2));
    const air = createViewport({ container, basemap: style('#000000'),
      elevationSampler: { sample: hill }, camera: { center: [0, 480 / meters], zoom: 15, pitch: 0 },
      entityVisibility: { footprints: true, zones: false, groundLines: false }, logger: () => {} });
    current = air; await air.ready;
    air.upsert([{ ...point('hill-shadow'), entity: { altitude: { meters: 100, reference: 'sea-level' },
      attachments: [{ id: 'camera', type: 'camera', color: '#00ff00', terrainVisibility: true, blockedColor: '#ff0000', fillOpacity: .6, blockedOpacity: .6, bearing: 0, elevation: -15, fovX: 60, fovY: 40, range: 2000 }] } }]);
    await until(() => air.getEntityState('hill-shadow')?.coverage === 'ready', 'hill coverage');
    await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
    const pixels = await new Promise<number[]>(resolve => {
      air.map.once('render', () => {
        const canvas = air.map.getCanvas(), gl = canvas.getContext('webgl2')!, greens: number[] = [];
        for (const north of [210, 750]) {
          const p = air.map.project([0, north / meters]), pixel = new Uint8Array(4), scale = canvas.width / canvas.clientWidth;
          gl.readPixels(Math.round(p.x * scale), canvas.height - 1 - Math.round(p.y * scale), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          greens.push(north === 210 ? pixel[1]! : pixel[0]!);
        }
        resolve(greens);
      });
      air.map.triggerRepaint();
    });
    check(pixels[0]! > 50, `Visible approach lost coverage: ${pixels}`);
    check(pixels[1]! > 50, `Blocked far slope was not red: ${pixels}`);
    const maskLayer=air.map.getStyle().layers.find(layer=>layer.id.startsWith('rl:camera-mask:'));
    check(!!maskLayer,'Missing GPU coverage layer');
    const mask=air.map.getSource<ImageSource>(maskLayer!.id)!.image;
    check(mask instanceof ImageData,'Expected completed GPU mask pixels');
    if(mask instanceof ImageData) {
      let mixed=0;
      for(let i=0;i<mask.data.length;i+=4) if(mask.data[i+3]!>0 && mask.data[i]!>0 && mask.data[i+1]!>0) mixed++;
      check(mixed<mask.width*mask.height*.03,`Contour transition is too broad: ${mixed} mixed pixels`);
    }
    check(air.map.getPaintProperty(maskLayer!.id,'raster-resampling')==='linear','Measured contours use square-pixel magnification');

    air.destroy();
  });
  await run('Camera volume covers rising terrain inside its true FOV', async () => {
    const meters = Math.PI / 180 * 6371008.8;
    const hill = (_lng: number, lat: number) => 100 * Math.exp(-(((lat * meters - 120) / 60) ** 2));
    const air = createViewport({container, basemap: style('#000000'), elevationSampler: {sample: hill},
      camera: {center: [0,80/meters], zoom:18, pitch:0}, logger:()=>{}});
    current=air; await air.ready;
    air.upsert([{...point('near-hill'),entity:{altitude:{meters:100,reference:'sea-level'},attachments:[{
      id:'camera',type:'camera',terrainVisibility:true,color:'#00ff00',fillOpacity:.6,blockedColor:'#ff0000',blockedOpacity:.6,
      bearing:0,elevation:-15,fovX:60,fovY:40,range:1000,
    }]}}]);
    await until(()=>air.getEntityState('near-hill')?.coverage==='ready','near hillside coverage');
    await new Promise<void>(resolve=>air.map.once('idle',()=>resolve()));
    const pixel=await new Promise<Uint8Array>(resolve=>{
      air.map.once('render',()=>{
        const canvas=air.map.getCanvas(),gl=canvas.getContext('webgl2')!,p=air.map.project([0,80/meters]);
        const scale=canvas.width/canvas.clientWidth,value=new Uint8Array(4);
        gl.readPixels(Math.round(p.x*scale),canvas.height-1-Math.round(p.y*scale),1,1,gl.RGBA,gl.UNSIGNED_BYTE,value);
        resolve(value);
      });air.map.triggerRepaint();
    });
    check(pixel[1]!>100&&pixel[0]!<25,`Finite camera volume excluded visible hillside: ${pixel}`);
    air.destroy();
  });
  await run('Raster tile arrivals recover camera coverage despite unrelated missing terrain', async () => {
    const dem=document.createElement('canvas');dem.width=dem.height=256;
    const context=dem.getContext('2d')!;context.fillStyle='#000000';context.fillRect(0,0,256,256);
    const air=createViewport({container,basemap:style(),elevation:{tiles:[dem.toDataURL()],encoding:'custom',redFactor:0,greenFactor:0,blueFactor:0,baseShift:0,maxzoom:12},logger:()=>{}});
    current=air;await air.ready;
    air.upsert([{...point('outside'),geometry:{type:'Point',coordinates:[0,86]},entity:{}}]);
    await until(()=>air.getEntityState('outside')?.coverage==='unavailable','out-of-range terrain');
    air.remove(['outside']);
    const location:MapFeature={...point('warm'),geometry:{type:'Point',coordinates:[.07,.044]},entity:{}};
    air.upsert([location]);await until(()=>air.getEntityState('warm')?.ground===0,'camera center tile');
    air.upsert([{...location,id:'border-camera',entity:{altitude:{meters:100,reference:'ground'},attachments:[{
      id:'camera',type:'camera',terrainVisibility:true,bearing:0,elevation:-45,fovX:60,fovY:40,range:2000,
    }]}}]);
    await until(()=>air.getEntityState('border-camera')?.coverage==='ready','neighboring terrain patch recovers without retry');
    air.destroy();
  });
  await run('A displayed camera failure removes only its coverage and retry uses current inputs', async () => {
    const errors: RidgelineError[] = [];
    const air = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 16 }, elevationSampler: { sample: () => 0 },
      logger: () => {}, onError: error => errors.push(error) });
    current = air; await air.ready;
    air.upsert([{ ...point('ground-survivor'), entity: { attachments: [{ id: 'zone', type: 'circle', radius: 50 }] } }]);
    await until(() => air.getEntityState('ground-survivor')?.coverage === 'ready', 'unrelated ground coverage');
    const failingCamera: CameraAttachment = { id: 'camera', type: 'camera', terrainVisibility: true,
      color: '#00ff00', bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: .1, wireframe: true };
    const feature: MapFeature = { ...point('failing-camera'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [failingCamera] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'initial camera coverage');
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const clientWaitSync = gl.clientWaitSync.bind(gl);
    let fail = false;
    gl.clientWaitSync = (sync, flags, timeout) => fail ? gl.WAIT_FAILED : clientWaitSync(sync, flags, timeout);
    const cameraMask = () => air.map.getStyle().layers.find(layer => layer.id.startsWith('rl:camera-mask:'));
    let pickedAttachment = '';
    air.on('click', event => { pickedAttachment = event.attachments.find(hit => hit.entityId === feature.id)?.attachmentId ?? ''; });
    const pickCoverage = async () => {
      const point = air.map.project([.0006, .0004]);
      pickedAttachment = '';
      await pointer('click', point);
      return pickedAttachment;
    };
    try {
      const initialMask = cameraMask();
      check(Boolean(initialMask), 'Initial camera mask missing');
      check(await pickCoverage() === 'camera', 'Initial camera coverage was not pickable');
      air.upsert([{ ...feature, entity: { ...feature.entity!, attachments: [{ ...failingCamera, bearing: 15 }] } }]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'loading', 'camera replacement pending');
      fail = true;
      await until(() => errors.some(error => error.code === 'UPDATE_FAILED'), 'displayed camera failure diagnostic');
      await until(() => air.getEntityState(feature.id)?.coverage === 'unavailable', 'failed camera coverage');
      check(!cameraMask(), 'Failed camera mask remained visible');
      check(await pickCoverage() === '', 'Failed camera coverage remained pickable');
      check(air.getEntityState('ground-survivor')?.coverage === 'ready', 'Camera failure removed unrelated ground coverage');
      fail = false;
      air.upsert([{ ...feature, entity: { ...feature.entity!, attachments: [{ ...failingCamera, bearing: 30, color: '#0000ff' }] } }]);
      air.retryUpdates();
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'current camera retry');
      const mask = cameraMask();
      const source = mask && air.map.getSource<ImageSource>(mask.id)?.image;
      check(source instanceof ImageData && source.data.some((value, index) => index % 4 === 2 && value > 100), 'Retry restored stale camera appearance instead of current inputs');
      check(air.getEntityState('ground-survivor')?.coverage === 'ready', 'Current camera retry disturbed unrelated ground coverage');
      check(await pickCoverage() === 'camera', 'Current camera coverage was not pickable after retry');
    } finally {
      gl.clientWaitSync = clientWaitSync;
      air.destroy();
    }
  });
  await run('Failed GPU target allocation releases its resources and retries', async () => {
    const errors: RidgelineError[] = [];
    const air = createViewport({ container, basemap: style(), elevationSampler: { sample: () => 0 },
      logger: () => {}, onError: error => errors.push(error) });
    current = air; await air.ready;
    air.upsert([{...point('plain-zone'),entity:{attachments:[{id:'zone',type:'circle',radius:50}]}}]);
    await until(()=>air.getEntityState('plain-zone')?.coverage==='ready','plain zone ready');
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const createFramebuffer = gl.createFramebuffer.bind(gl), deleteFramebuffer = gl.deleteFramebuffer.bind(gl);
    const createTexture = gl.createTexture.bind(gl), deleteTexture = gl.deleteTexture.bind(gl);
    const checkFramebufferStatus = gl.checkFramebufferStatus.bind(gl);
    const frames = new Set<WebGLFramebuffer>(), textures = new Set<WebGLTexture>();
    gl.createFramebuffer = () => { const value = createFramebuffer(); if (value) frames.add(value); return value; };
    gl.createTexture = () => { const value = createTexture(); if (value) textures.add(value); return value; };
    gl.deleteFramebuffer = value => { if (value) frames.delete(value); deleteFramebuffer(value); };
    gl.deleteTexture = value => { if (value) textures.delete(value); deleteTexture(value); };
    gl.checkFramebufferStatus = () => gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
    try {
      air.upsert([{ ...point('gpu-failure'), entity: { altitude: { meters: 100, reference: 'ground' },
        attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } }]);
      await until(() => air.getEntityState('gpu-failure')?.coverage === 'unavailable', 'GPU allocation failure');
      check(air.getEntityState('plain-zone')?.coverage==='ready','GPU failure changed unrelated ground coverage');
      check(errors.some(error => error.code === 'UPDATE_FAILED'), 'GPU failure did not report a diagnostic');
      check(frames.size === 0 && textures.size === 0, `Failed GPU allocation leaked ${frames.size} framebuffers and ${textures.size} textures`);
      gl.checkFramebufferStatus = checkFramebufferStatus;
      air.retryUpdates();
      await until(() => air.getEntityState('gpu-failure')?.coverage === 'ready', 'GPU allocation recovery');
    } finally {
      gl.checkFramebufferStatus = checkFramebufferStatus;
      air.destroy();
      gl.createFramebuffer = createFramebuffer; gl.deleteFramebuffer = deleteFramebuffer;
      gl.createTexture = createTexture; gl.deleteTexture = deleteTexture;
    }
  });
  await run('A null GPU synchronization result reports failure and recovers on retry', async () => {
    const errors: RidgelineError[] = [];
    const air = createViewport({ container, basemap: style(), elevationSampler: { sample: () => 0 },
      logger: () => {}, onError: error => errors.push(error) });
    current = air; await air.ready;
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const fenceSync = gl.fenceSync.bind(gl);
    let failOnce = true;
    gl.fenceSync = (condition, flags) => {
      if (failOnce) { failOnce = false; return null; }
      return fenceSync(condition, flags);
    };
    const feature: MapFeature = { ...point('null-fence'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45,
        fovX: 60, fovY: 40, range: 300 }] } };
    try {
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'unavailable', 'null GPU sync failure');
      check(errors.some(error => error.code === 'UPDATE_FAILED'), 'Null GPU sync did not report a diagnostic');
      check(!air.map.getStyle().layers.some(layer => layer.id.startsWith('rl:camera-mask:')), 'Failed sync published camera coverage');
      gl.fenceSync = fenceSync;
      air.retryUpdates();
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'GPU sync retry');
      check(air.map.getStyle().layers.some(layer => layer.id.startsWith('rl:camera-mask:')), 'Retry did not publish camera coverage');
    } finally { gl.fenceSync = fenceSync; air.destroy(); }
  });
  await run('Coverage readiness follows every camera, pose changes, and ground placement', async () => {
    const air = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 16 }, elevationSampler: { sample: () => 0 }, logger: () => {} });
    current = air; await air.ready;
    air.upsert([{...point('ground'),entity:{attachments:[{id:'zone',type:'circle',radius:50}]}}]);
    await until(()=>air.getEntityState('ground')?.coverage==='ready','ground geometry ready');
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const clientWaitSync = gl.clientWaitSync.bind(gl);
    const texImage2D = gl.texImage2D;
    const source=air.map.getSource<GeoJSONSource>('rl:entity-ground')!,setData=source.setData.bind(source);
    let sensorTargets=0,groundUploads=0;
    gl.texImage2D=new Proxy(texImage2D,{apply(target,context:WebGL2RenderingContext,args:unknown[]){
      if(args[3]===2048&&args[4]===2048)sensorTargets++;
      return Reflect.apply(target,context,args);
    }});
    source.setData=(...args)=>{groundUploads++;return setData(...args);};
    let first: WebGLSync | undefined;
    let releaseSecond = false;
    let heldWaits = 0;
    let completionBudget: number | undefined;
    gl.clientWaitSync = (sync, flags, timeout) => {
      first ??= sync;
      if (sync !== first && (!releaseSecond || completionBudget === 0)) {
        heldWaits++;
        return gl.TIMEOUT_EXPIRED;
      }
      const status = clientWaitSync(sync, flags, timeout);
      if (sync !== first && status !== gl.TIMEOUT_EXPIRED && completionBudget !== undefined) completionBudget--;
      return status;
    };
    const camera: CameraAttachment = { id: 'first', type: 'camera', terrainVisibility: true,
      bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: .1, wireframe: true };
    const published = () => air.map.getStyle().layers.filter(layer => layer.id.startsWith('rl:camera-mask:'))
      .filter(layer => air.map.getSource<ImageSource>(layer.id)?.image instanceof ImageData).length;
    const feature: MapFeature = { ...point('two-cameras'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [camera, { ...camera, id: 'second', bearing: 90 }] } };
    const masks = () => air.map.getStyle().layers
      .filter(layer => layer.id.startsWith('rl:camera-mask:'))
      .map(layer => air.map.getSource<ImageSource>(layer.id)?.image)
      .filter((image): image is ImageData => image instanceof ImageData);
    const maskSignature = () => masks().map(image => {
      let sum = 0;
      for (let index = 0; index < image.data.length; index += 4) sum = (sum + image.data[index]! * 3 + image.data[index + 1]! * 5 + image.data[index + 2]! * 7 + image.data[index + 3]!) % 0x1_0000_0000;
      return sum;
    });
    let pickedAttachments: string[] = [];
    air.on('click', event => { pickedAttachments = event.attachments.filter(hit => hit.entityId === feature.id).map(hit => hit.attachmentId); });
    const pickAt = async (lng: number, lat: number) => {
      const point = air.map.project([lng, lat]);
      pickedAttachments = [];
      await pointer('click', point);
      return pickedAttachments;
    };
    try {
      air.upsert([feature]);
      await until(() => published() === 1, 'first camera publishes while second is pending');
      check(air.getEntityState('two-cameras')?.coverage === 'loading', 'Entity became ready before its second camera published');
      check((await pickAt(0, .0008)).includes('first'), 'First camera result was not pickable');
      check(!(await pickAt(.0008, 0)).includes('second'), 'Second camera result published before its fence completed');
      releaseSecond = true;
      await until(() => air.getEntityState('two-cameras')?.coverage === 'ready', 'both camera masks published');
      check(published() === 2, 'Ready entity is missing camera coverage');
      check(sensorTargets===2,`Two cameras allocated ${sensorTargets} sensor targets instead of sharing one pair`);
      check(groundUploads===1,`GPU publication resubmitted unchanged ground geometry ${groundUploads} times`);
      releaseSecond = false;
      const oldSignature = maskSignature();
      check(oldSignature.length === 2, 'Initial camera images missing');
      heldWaits = 0;
      let before = air.getEntityState(feature.id)!.computedAt;
      air.upsert([{ ...feature, geometry: { type: 'Point', coordinates: [.0001,0] } }]);
      await until(() => air.getEntityState(feature.id)!.computedAt > before, 'camera replacement before equivalent configuration');
      await until(() => heldWaits > 0, 'camera replacement fence held');
      air.configure({ projection: 'flat', terrain: false, exaggeration: 1 });
      check(air.getEntityState(feature.id)?.coverage === 'loading', 'Equivalent configuration lost the pending camera state');
      check(JSON.stringify(maskSignature()) === JSON.stringify(oldSignature), 'Equivalent configuration dropped completed camera coverage');
      releaseSecond = true;
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'equivalent configuration republishes camera coverage');
      releaseSecond = false;
      const movedSignature = maskSignature();
      before = air.getEntityState(feature.id)!.computedAt;
      for (const lng of [.0002, .0003]) {
        air.upsert([{ ...feature, geometry: { type: 'Point', coordinates: [lng,0] } }]);
        await until(() => air.getEntityState(feature.id)!.computedAt > before, 'moved camera submitted');
        before = air.getEntityState(feature.id)!.computedAt;
        check(air.getEntityState(feature.id)?.coverage === 'loading', 'Old camera pose was reported ready for new input');
        check(JSON.stringify(maskSignature()) === JSON.stringify(movedSignature), 'Previous camera result disappeared while replacement was pending');
      }
      completionBudget = 1;
      releaseSecond = true;
      await until(() => {
        const current = maskSignature();
        return current.length === 2 && current[0] !== movedSignature[0];
      }, 'intermediate camera result published');
      check(air.getEntityState(feature.id)?.coverage === 'loading', 'Intermediate camera result marked the newest request ready');
      completionBudget = undefined;
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'moved camera masks published');
      check((await pickAt(.0003, .0008)).includes('first'), 'Final camera result was not pickable at the current position');
      before = air.getEntityState(feature.id)!.computedAt;
      air.upsert([{ ...feature, entity: { ...feature.entity!, altitude: { meters: 0, reference: 'ground' } } }]);
      await until(() => air.getEntityState(feature.id)!.computedAt > before, 'ground-level camera computed');
      check(air.getEntityState(feature.id)?.coverage === 'ready', 'Known ground-level camera stayed loading');
      check(!air.map.getLayer('rl:camera-gpu'), 'Ground-level camera retained GPU geometry');
    } finally { gl.clientWaitSync = clientWaitSync; gl.texImage2D=texImage2D;source.setData=setData;air.destroy(); }
  });
  await run('Rejected camera frames do not replace the displayed picking mask', async () => {
    const air = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 16 }, elevationSampler: { sample: () => 0 }, logger: () => {} });
    current = air; await air.ready;
    const camera: CameraAttachment = { id: 'camera', type: 'camera', terrainVisibility: true,
      color: '#00ff00', bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: 0, wireframe: false };
    const feature: MapFeature = { ...point('rejected-camera'), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [camera] } };
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const clientWaitSync = gl.clientWaitSync.bind(gl);
    let first: WebGLSync | undefined;
    let release = false;
    let completions = 0;
    let heldWaits = 0;
    gl.clientWaitSync = (sync, flags, timeout) => {
      first ??= sync;
      if (sync !== first && (!release || completions === 0)) {
        heldWaits++;
        return gl.TIMEOUT_EXPIRED;
      }
      const status = clientWaitSync(sync, flags, timeout);
      if (sync !== first && status !== gl.TIMEOUT_EXPIRED && completions > 0) completions--;
      return status;
    };
    let picked = '';
    air.on('click', event => { picked = event.attachments.find(hit => hit.entityId === feature.id)?.attachmentId ?? ''; });
    const pickAt = async (lng: number, lat: number) => {
      const point = air.map.project([lng, lat]);
      picked = '';
      await pointer('click', point);
      return picked;
    };
    try {
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'initial camera coverage');
      check(await pickAt(0, .0008) === camera.id, 'Initial camera coverage was not pickable');
      release = false;
      const moved = { ...feature, geometry: { type: 'Point' as const, coordinates: [.003, 0] as [number, number] },
        entity: { ...feature.entity!, attachments: [{ ...camera, bearing: 180 }] } };
      let before = air.getEntityState(feature.id)!.computedAt;
      air.upsert([moved]);
      await until(() => air.getEntityState(feature.id)!.computedAt > before, 'moved camera submission');
      await until(() => heldWaits > 0, 'moved camera fence held');
      const changed = { ...moved, entity: { ...moved.entity!, attachments: [{ ...camera, color: '#0000ff', bearing: 180, volumeOpacity: 0, wireframe: false }] } };
      before = air.getEntityState(feature.id)!.computedAt;
      air.upsert([changed]);
      await until(() => air.getEntityState(feature.id)!.computedAt > before, 'appearance replacement');
      const previousHolds = heldWaits;
      release = true;
      completions = 1;
      await until(() => heldWaits > previousHolds, 'replacement frame held after rejected result');
      check(await pickAt(0, .0008) === camera.id, 'Rejected readback replaced the displayed picking mask');
      check(await pickAt(0, -.0008) === '', 'Rejected readback created a south-side picking hit');
      gl.clientWaitSync = clientWaitSync;
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'replacement camera coverage');
    } finally {
      gl.clientWaitSync = clientWaitSync;
      air.destroy();
    }
  });
  await run('Retained camera masks survive a style rebuild during terrain retry', async () => {
    let available = true;
    let finish: (() => void) | undefined;
    const air = createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 16 }, elevationSampler: {
      sample: () => available ? 0 : null,
      prepare: async () => new Promise<void>(resolve => { finish = resolve; }),
    }, logger: () => {} });
    current = air; await air.ready;
    const camera: CameraAttachment = { id: 'camera', type: 'camera', terrainVisibility: true,
      bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: 0, wireframe: false };
    const feature: MapFeature = { ...point('retained-camera'), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [camera] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'initial retained camera');
    let picked = '';
    const off = air.on('click', event => { picked = event.attachments.find(hit => hit.entityId === feature.id)?.attachmentId ?? ''; });
    const pickAt = async (lng: number, lat: number) => {
      const point = air.map.project([lng, lat]);
      picked = '';
      await pointer('click', point);
      return picked;
    };
    try {
      check(await pickAt(0, .0008) === camera.id, 'Initial retained camera was not pickable');
      available = false;
      air.retryUpdates();
      await until(() => Boolean(finish) && air.getEntityState(feature.id)?.coverage === 'loading', 'pending retained retry');
      air.configure({ basemap: style('#ffffff') });
      await until(() => Boolean(air.map.getLayer('rl:camera-gpu')), 'camera layer after style rebuild');
      check(await pickAt(0, .0008) === camera.id, 'Style rebuild dropped retained camera picking');
      available = true;
      finish!(); finish = undefined;
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'retained camera retry');
    } finally {
      finish?.();
      off();
      air.destroy();
    }
  });
  await run('GPU visibility preserves flat-ground coverage at long range and caches terrain during movement', async () => {
    const meters = Math.PI / 180 * 6371008.8;
    let samples = 0;
    const air = createViewport({ container, basemap: style('#000000'),
      elevationSampler: { sample: () => { samples++; return 0; }, prepare: async () => {} },
      camera: { center: [0, 4000 / meters], zoom: 16, pitch: 0 }, logger: () => {} });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('gpu-flat'), entity: { altitude: { meters: 2000, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, color: '#00ff00', blockedColor: '#ff0000',
        fillOpacity: .6, blockedOpacity: .6, wireframe:true, volumeOpacity:.1, bearing: 0, elevation: -10, fovX: 60, fovY: 40, range: 6001 }] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'GPU flat coverage');
    await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
    const pixels = await new Promise<number[][]>(resolve => {
      air.map.once('render', () => {
        const canvas=air.map.getCanvas(), gl=canvas.getContext('webgl2')!, values:number[][]=[];
        for (const east of [-200,200]) {
          const p=air.map.project([east/meters,4000/meters]), pixel=new Uint8Array(4), scale=canvas.width/canvas.clientWidth;
          gl.readPixels(Math.round(p.x*scale),canvas.height-1-Math.round(p.y*scale),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
          values.push([...pixel]);
        }
        resolve(values);
      }); air.map.triggerRepaint();
    });
    check(pixels.every(p => p[1]! > 100 && p[0]! < 25), 'Flat terrain falsely blocked: '+JSON.stringify(pixels));
    // Count actual sensor-depth submissions while changing appearance on a stationary camera.
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const drawElements = gl.drawElements;
    let sensorPasses = 0;
    gl.drawElements = function(...args: Parameters<WebGL2RenderingContext['drawElements']>) {
      const viewport = this.getParameter(this.VIEWPORT) as Int32Array;
      if (viewport[2] === 2048 && this.getParameter(this.FRAMEBUFFER_BINDING)) sensorPasses++;
      return drawElements.apply(this, args);
    };
    try {
      const camera = feature.entity!.attachments![0] as CameraAttachment;
      const maskId = air.map.getStyle().layers.find(layer => layer.id.startsWith('rl:camera-mask:'))!.id;
      for (const opacity of [.2, .8, .4]) {
        air.upsert([{...feature, entity: {...feature.entity!, attachments: [{...camera, color: '#0000ff', fillOpacity: opacity}]}}]);
        await until(() => {
          const image = air.map.getSource<ImageSource>(maskId)?.image;
          return image instanceof ImageData && image.data.some((value, i) => i % 4 === 2 && value === 255 && Math.abs(image.data[i+1]! - opacity*255) < 2);
        }, 'cached visibility restyled');
      }
      check(sensorPasses === 0, `Appearance edits reran ${sensorPasses} sensor depth passes`);
      air.upsert([feature]);
      await until(() => {
        const image = air.map.getSource<ImageSource>(maskId)?.image;
        return image instanceof ImageData && image.data.some((value, i) => i % 4 === 1 && value === 255);
      }, 'original appearance restored');
      check(sensorPasses === 0, 'Restoring appearance reran visibility');
      air.upsert([{...feature, entity: {...feature.entity!, attachments: [{...camera, bearing: 15}]}}]);
      await until(() => sensorPasses > 0, 'changed camera aim recomputed depth');
    } finally { gl.drawElements = drawElements; }
    const assertSynchronized=()=>{
      const gpu=air.map.getLayer('rl:camera-gpu') as unknown as {implementation:{cameras:Map<string,{published?:{origin:number[]}}>}};
      const geometry=air.map.getLayer('rl:entities') as unknown as {implementation:{draws:{attachmentId?:string;vertices:number[][]}[]}};
      const published=gpu.implementation.cameras.values().next().value?.published;
      const corner=geometry.implementation.draws.find(draw=>draw.attachmentId==='camera')?.vertices[0];
      check(!!published&&!!corner,'Published camera geometry missing');
      check(JSON.stringify(published!.origin)===JSON.stringify(corner),'Wireframe and mask use different poses');
    };
    const initialSamples=samples;
    for(let i=0;i<24;i++) {
      air.upsert([{...feature,geometry:{type:'Point',coordinates:[i*.000001,0]}}]);
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      assertSynchronized();
    }
    assertSynchronized();
    check(samples-initialSamples<=30,'Movement rebuilt terrain: '+(samples-initialSamples)+' samples');
    air.remove([feature.id]);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    check(!air.map.getStyle().layers.some(layer=>layer.id.startsWith('rl:camera-mask:')), 'Removed GPU mask remains');
    check(!air.map.getLayer('rl:camera-gpu'), 'Last camera removal retained GPU resources');
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'GPU camera recreated after removal');
    await new Promise<void>(resolve => {
      air.map.once('style.load', () => resolve());
      air.configure({ basemap: style('#101010') });
    });
    await until(() => {
      const mask = air.map.getStyle().layers.find(layer => layer.id.startsWith('rl:camera-mask:'));
      const image = mask && air.map.getSource<ImageSource>(mask.id)?.image;
      return image instanceof ImageData && image.data.some((value, i) => i % 4 === 3 && value > 0);
    }, 'GPU mask republished after style replacement');
    air.configure({ entityVisibility: { footprints: false, zones: false, groundLines: false } });
    await until(() => !air.map.getLayer('rl:camera-gpu'), 'Hidden cameras release GPU resources');
    air.configure({ entityVisibility: { footprints: true, zones: false, groundLines: false } });
    await until(() => Boolean(air.map.getLayer('rl:camera-gpu')) && air.getEntityState(feature.id)?.coverage === 'ready', 'Visible camera restores GPU resources');
    air.destroy();
  });
  await run('GPU grid stays clear across a sloped plane during movement', async () => {
    const meters = Math.PI / 180 * 6371008.8;
    let samples = 0;
    const air = createViewport({ container, basemap: style('#000000'),
      elevationSampler: { sample: (_lng, lat) => { samples++; return lat * meters * .4; } },
      camera: { center: [0, 4000 / meters], zoom: 16, pitch: 0 }, logger: () => {} });
    current = air; await air.ready;
    const feature: MapFeature = { ...point('gpu-flat'), entity: { altitude: { meters: 2000, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, color: '#00ff00', blockedColor: '#ff0000',
        fillOpacity: .6, blockedOpacity: .6, bearing: 0, elevation: -10, fovX: 60, fovY: 40, range: 6001 }] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'GPU flat coverage');
    await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
    const pixels = await new Promise<number[][]>(resolve => {
      air.map.once('render', () => {
        const canvas=air.map.getCanvas(), gl=canvas.getContext('webgl2')!, values:number[][]=[];
        for (const east of [-200,200]) {
          const p=air.map.project([east/meters,4000/meters]), pixel=new Uint8Array(4), scale=canvas.width/canvas.clientWidth;
          gl.readPixels(Math.round(p.x*scale),canvas.height-1-Math.round(p.y*scale),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
          values.push([...pixel]);
        }
        resolve(values);
      }); air.map.triggerRepaint();
    });
    check(pixels.every(p => p[1]! > 100 && p[0]! < 25), 'Flat terrain falsely blocked: '+JSON.stringify(pixels));
    const maskId=air.map.getStyle().layers.find(layer=>layer.id.startsWith('rl:camera-mask:'))!.id;
    const assertClear=()=> {
      const image=air.map.getSource<ImageSource>(maskId)!.image;
      check(image instanceof ImageData,'GPU mask missing');
      if(image instanceof ImageData){
        let red=0,filled=0;
        for(let i=0;i<image.data.length;i+=4)if(image.data[i+3]!>0){filled++;if(image.data[i]!>25)red++;}
        check(filled>100,'Slope mask unexpectedly empty');
        check(red===0,`Unobstructed slope has ${red}/${filled} false blocked pixels`);
      }
    };
    assertClear();
    const initialSamples=samples;
    for(let i=0;i<24;i++) {
      air.upsert([{...feature,geometry:{type:'Point',coordinates:[i*.000001,0]}}]);
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      assertClear();
    }
    check(samples-initialSamples<=30,'Movement rebuilt terrain: '+(samples-initialSamples)+' samples');
    air.remove([feature.id]);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    check(!air.map.getStyle().layers.some(layer=>layer.id.startsWith('rl:camera-mask:')), 'Removed GPU mask remains');
    air.destroy();
  });
  await run('GPU voting and depth-refined contours respond to subpixel boundaries', async () => { checkGpuVote(); });
  if (registeredCases.length !== browserCases.length || registeredCases.some((name, index) => name !== browserCases[index])) {
    throw new Error('Browser case manifest differs from registered checks.');
  }
  if (!selectedCase) {
    status.dataset.state = 'ready';
    status.textContent = 'Consumer fixture ready. Run cases with pnpm test:browser.';
    return;
  }
  if (!ran) throw new Error(`Unknown browser case: ${selectedCase}`);
  status.dataset.state = 'passed';
  status.textContent = `${selectedCase} passed through the installed package.`;
}
window.cleanupBrowserCase = () => current?.destroy();
void suite().catch(error => { status.dataset.state = 'failed'; status.textContent = `Failed: ${error instanceof Error ? error.stack : String(error)}`; });
