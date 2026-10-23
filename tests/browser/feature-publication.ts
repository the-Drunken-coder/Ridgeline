import { createViewport, RidgelineError } from '@ridgeline/map';
import type { MapFeature, Viewport } from '@ridgeline/map';
import { GeoJSONSource, ErrorEvent as MapErrorEvent } from 'maplibre-gl';
import { style, point, check, pointer } from './helpers';
import { withBaseViewport } from './base-viewport';
import type { BrowserCaseModule } from './context';


export const featurePublicationCases = {
  "Queued features render with stable string IDs and click events": caseContext => withBaseViewport(caseContext, async ({ viewport, hits }) => {
    const { until } = caseContext;
    check(!viewport.map.getLayer('rl:camera-gpu'), 'Ground-only viewport allocated the camera renderer');
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'queued'), 'queued feature rendered');
    check(hits().some(hit => hit.properties._rl_feature_id === 'initial'), 'Initial feature missing');
    let ids: string[] = [];
    const off = viewport.on('click', event => { ids = event.features.map(feature => feature.id); });
    await pointer('click', viewport.map.project([0,0]));
    check(ids.includes('queued') && ids.includes('initial'), 'Consumer click IDs missing'); off();
  }),
  "Reserved feature IDs remain selectable without inherited state": caseContext => withBaseViewport(caseContext, async ({ viewport, hits }) => {
    const { until } = caseContext;
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
  }),
  "Incremental updates replace data without moving the camera": caseContext => withBaseViewport(caseContext, async ({ viewport, hits, featureState }) => {
    const { until } = caseContext;
    const center = viewport.map.getCenter().toArray().join(',');
    viewport.setSelection(['queued']);
    viewport.upsert([{ ...point('queued', .03), properties: { name: 'Renamed', color: 'red' } }]);
    viewport.remove(['initial', 'unknown']);
    await until(() => hits().some(hit => hit.properties._rl_feature_id === 'queued' && hit.properties._rl_color === '#ff0000') && !hits().some(hit => hit.properties._rl_feature_id === 'initial'), 'incremental replace/remove');
    check(viewport.map.getCenter().toArray().join(',') === center, 'Camera moved');
    check(viewport.getFeature('queued')?.properties.name === 'Renamed', 'Name not replaced');
    check(featureState('queued').selected, 'Selection state lost');
  }),
  "A mutating style callback cannot change accepted or rendered feature data": async caseContext => {
    const { own, until } = caseContext;
    const mount = document.createElement('div');
    mount.style.cssText = 'width:320px;height:240px;position:absolute;left:0;top:0';
    document.body.append(mount);
    const feature = { ...point('snapshot'), properties: { name: 'Original' } };
    const map = own(createViewport({ container: mount, basemap: style(), camera: { center: [0, 0], zoom: 12 },
      features: [feature], style: value => {
        value.properties.name = 'Mutated';
        if (value.geometry.type === 'Point') value.geometry.coordinates[0] = .1;
        return { color: '#008855' };
      }, logger: () => {} }));
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
  },
  "Removing and reinserting an airborne ID does not restore its selection": async caseContext => {
    const { own, container, until } = caseContext;
    const air = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, elevationSampler: { sample: () => 0 }, logger: () => {} }));
    await air.ready;
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
      const sourceFeature = () => air.map.querySourceFeatures('rl:features').find(hit => hit.properties._rl_feature_id === feature.id);
      await until(() => sourceFeature()?.id !== undefined, 'reinserted source feature');
      const state = air.map.getFeatureState({ source: 'rl:features', id: sourceFeature()!.id! });
      check(state.selected !== true, 'Reinserted feature retained renderer selection state');
    } finally { air.destroy(); }
  },
  "Mutating object basemaps does not change accepted configuration or style": async caseContext => {
    const { own, container, until } = caseContext;
    const first = style('#112233');
    const map = own(createViewport({ container, basemap: first, logger: () => {} }));

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
  },
  "Style replacement preserves data and selection": caseContext => withBaseViewport(caseContext, async ({ viewport, hits, featureState }) => {
    const { until } = caseContext;
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
  }),
  "A broken style isolates one feature and retries only on request": caseContext => withBaseViewport(caseContext, async ({ viewport, hits }) => {
    const { until } = caseContext;
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
  }),
  "Renderer rejection preserves removals and never restores an older update": caseContext => withBaseViewport(caseContext, async ({ viewport, hits }) => {
    const { until } = caseContext;
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
  }),
  "Source error events retain updates even when updateData resolves": caseContext => withBaseViewport(caseContext, async ({ viewport, hits }) => {
    const { until } = caseContext;
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
  }),
  "An initial GeoJSON worker-load rejection recovers with the latest accepted features": async caseContext => {
    const { own, until } = caseContext;
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
      map = own(createViewport({ container: mount, basemap: style(), camera: { center: [0, 0], zoom: 9 },
        features: [point('worker-latest'), point('worker-removed')], logger: () => {} }));
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
  },
  "A retired source cannot restore stale changes after a basemap switch": caseContext => withBaseViewport(caseContext, async ({ viewport, hits }) => {
    const { until } = caseContext;
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
  }),
  "A broken style does not block basemap restoration or later updates": caseContext => withBaseViewport(caseContext, async ({ viewport, hits }) => {
    const { until } = caseContext;
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
  }),
} satisfies BrowserCaseModule;
