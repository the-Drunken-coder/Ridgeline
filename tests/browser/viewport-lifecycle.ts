import { createViewport, attachInteractions, RidgelineError } from '@ridgeline/map';
import type { CameraAttachment, MapFeature, Viewport } from '@ridgeline/map';
import type { ImageSource } from 'maplibre-gl';
import { style, point, check, pointer, browserKey, untilPixel } from './helpers';
import { withBaseViewport } from './base-viewport';
import type { BrowserCaseModule } from './context';


export const viewportLifecycleCases = {
  "Preparation failures preserve construction and update publication and release the viewport": async caseContext => {
    const { own, container, until } = caseContext;
    for (const immediate of [true, false]) {
      const errors: RidgelineError[] = [];
      const feature = (id: string, lng: number): MapFeature => ({ ...point(id, lng), entity: {
        altitude: { meters: 100, reference: 'sea-level' }, attachments: [{ id: 'body', type: 'sphere', radius: 20 }],
      } });
      const air = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 },
        features: [feature('initial-preparation', 0)], logger: () => {}, onError: error => errors.push(error),
        elevationSampler: { sample: () => null, prepare: () => {
          if (immediate) throw new Error('Immediate preparation failure');
          return Promise.reject(new Error('Rejected preparation failure'));
        } } }));

      try {
        await air.ready;
        await until(() => errors.some(error => error.code === 'ELEVATION_UNAVAILABLE'), 'construction preparation diagnostic');
        check(air.getFeature('initial-preparation') !== undefined, 'Construction lost accepted data');
        const changes: string[] = [];
        air.on('datachange', event => changes.push(...event.ids));
        errors.length = 0;
        air.upsert([feature('updated-preparation', .01), point('healthy-preparation', -.01)]);
        await until(() => errors.some(error => error.code === 'ELEVATION_UNAVAILABLE') &&
          air.map.queryRenderedFeatures({ layers: ['rl:points'] }).some(hit => hit.properties._rl_feature_id === 'healthy-preparation'),
        'update diagnostic and healthy publication');
        check(changes.includes('updated-preparation') && changes.includes('healthy-preparation'), 'Preparation failure interrupted datachange');
        check(air.getFeature('updated-preparation') !== undefined && air.getEntityState('updated-preparation')?.coverage === 'unavailable', 'Accepted entity update was abandoned');
        check(errors.some(error => error.context.operation === 'entities' && error.cause instanceof Error), 'Preparation diagnostic lost context or cause');
      } finally { air.destroy(); }
      check(!container.querySelector('canvas'), 'Preparation failure leaked a canvas after destroy');
    }
  },
  "Removing an entity from preparation leaves accepted data and rendered output absent": async caseContext => {
    const { own, container, until } = caseContext;
    let removeDuringPreparation = false;
    const air = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, logger: () => {},
      elevationSampler: { sample: () => null, prepare: async () => {
        if (removeDuringPreparation) { removeDuringPreparation = false; air.remove(['removed-in-preparation']); }
      } } }));

    try {
      await air.ready;
      removeDuringPreparation = true;
      air.upsert([{ ...point('removed-in-preparation'), entity: { altitude: { meters: 100, reference: 'sea-level' },
        attachments: [{ id: 'zone', type: 'circle', radius: 100 }] } }, point('healthy-after-removal', .01)]);
      await until(() => !air.getFeature('removed-in-preparation') &&
        air.map.queryRenderedFeatures({ layers: ['rl:points'] }).some(hit => hit.properties._rl_feature_id === 'healthy-after-removal'),
      'reentrant removal and healthy publication');
      await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
      check(!air.getEntityState('removed-in-preparation'), 'Removed entity retained computation state');
      check(!air.map.querySourceFeatures('rl:features').some(hit => hit.properties._rl_feature_id === 'removed-in-preparation'), 'Removed feature reached the source');
      check(!air.map.queryRenderedFeatures().some(hit => hit.properties._rl_feature_id === 'removed-in-preparation' || hit.properties.entityId === 'removed-in-preparation'), 'Removed entity left rendered geometry');
    } finally { air.destroy(); }
  },
  "Removing an entity during elevation sampling clears its displayed camera": async caseContext => {
    const { own, container, until } = caseContext;
    let armed = false, removed = false;
    const air = own(createViewport({ container, basemap: style(), camera: { center: [0, .0008], zoom: 16 }, logger: () => {},
      elevationSampler: { sample: () => {
        if (armed && !removed) { removed = true; air.remove(['sampled-camera']); }
        return 0;
      } } }));

    try {
      await air.ready;
      const feature: MapFeature = { ...point('sampled-camera'), entity: {
        altitude: { meters: 100, reference: 'ground' }, attachments: [
          { id: 'view', type: 'camera', range: 300, bearing: 0, elevation: -45, fovX: 60, fovY: 40,
            color: '#e02020', fillOpacity: 1, outline: false, volumeOpacity: 0 },
        ],
      } };
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'initial sampled camera');
      await untilPixel(air, [0, .0008], true, 'initial camera fill');
      armed = true;
      air.upsert([{ ...feature, properties: { revision: 2 } }]);
      await until(() => removed && !air.getFeature(feature.id) && !air.getEntityState(feature.id), 'removal from sampling');
      await untilPixel(air, [0, .0008], false, 'removed camera fill stays absent');
      await until(() => !air.map.querySourceFeatures('rl:entity-ground').some(hit => hit.properties.entityId === feature.id), 'removed camera source output');
      check(!air.map.queryRenderedFeatures().some(hit => hit.properties.entityId === feature.id), 'Sampling removal restored camera geometry');
    } finally { air.destroy(); }
  },
  "Destroying from a restoration diagnostic stops callbacks and resource creation": async caseContext => {
    const { own, container, until } = caseContext;
    let restoring = false, destroyed = false, callbacksAfterDestroy = 0, resourcesAfterDestroy = 0;
    const air = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 12 }, features: [point('broken-restore'), point('later-restore')],
      logger: () => {}, style: feature => {
        if (destroyed) callbacksAfterDestroy++;
        if (restoring && feature.id === 'broken-restore') throw new Error('Restoration style failure');
        return {};
      }, onError: error => {
        if (restoring && error.code === 'UPDATE_FAILED' && !destroyed) { destroyed = true; air.destroy(); }
      } }));

    try {
      await air.ready;
      await until(() => air.map.queryRenderedFeatures({ layers: ['rl:points'] }).length > 0, 'initial restoration features');
      const addSource = air.map.addSource.bind(air.map), addLayer = air.map.addLayer.bind(air.map);
      air.map.addSource = (...args) => { if (destroyed) resourcesAfterDestroy++; return addSource(...args); };
      air.map.addLayer = (...args) => { if (destroyed) resourcesAfterDestroy++; return addLayer(...args); };
      restoring = true;
      air.configure({ basemap: style('#ffffff') });
      await until(() => destroyed, 'destruction from restoration error callback');
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      check(callbacksAfterDestroy === 0, 'Restoration called styling after destruction');
      check(resourcesAfterDestroy === 0, 'Restoration created sources or layers after destruction');
      check(!container.querySelector('canvas'), 'Restoration destruction left a canvas');
    } finally { air.destroy(); }
  },
  "Unrelated terrain failure preserves the displayed mask of a pending replacement": async caseContext => {
    const { own, container, until } = caseContext;
    let pending = false, finish: (() => void) | undefined;
    const air = own(createViewport({ container, basemap: style(), camera: { center: [.02, 0], zoom: 16 }, logger: () => {},
      elevationSampler: {
        sample: (lng, lat) => !pending || (Math.abs(lat) < 1e-8 && (Math.abs(lng) < 1e-8 || Math.abs(lng - .04) < 1e-8)) ? 0 : null,
        prepare: positions => {
          if (!pending) return Promise.resolve();
          if (Math.abs(positions[0]![0]) < .01) return Promise.reject(new Error('Unrelated region failed'));
          return new Promise<void>(resolve => { finish = () => { pending = false; resolve(); }; });
        },
      } }));

    const camera: CameraAttachment = { id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0,
      elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: 0, wireframe: false };
    const sensor = (id: string, lng: number): MapFeature => ({ ...point(id, lng), entity: {
      altitude: { meters: 100, reference: 'sea-level' }, attachments: [camera],
    } });
    try {
      await air.ready;
      air.upsert([sensor('retained-region', .02)]);
      await until(() => air.getEntityState('retained-region')?.coverage === 'ready', 'completed retained camera');
      const mask = air.map.getStyle().layers.find(layer => layer.id.startsWith('rl:camera-mask:'));
      check(mask, 'Initial camera mask absent');
      const image = mask && air.map.getSource<ImageSource>(mask.id)?.image;
      let picked = '';
      air.on('click', event => { picked = event.attachments[0]?.entityId ?? ''; });
      await pointer('click', air.map.project([.02, .0008]));
      check(picked === 'retained-region', 'Initial camera was not selectable at the retained test point');
      pending = true;
      air.upsert([sensor('retained-region', .04), sensor('failed-region', 0)]);
      await until(() => air.getEntityState('failed-region')?.coverage === 'unavailable' &&
        air.getEntityState('retained-region')?.coverage === 'loading' && Boolean(finish), 'regional failure with retained replacement');
      check(mask && air.map.getLayer(mask.id) && air.map.getSource<ImageSource>(mask.id)?.image === image, 'Unrelated failure replaced or removed the displayed mask');
      picked = '';
      await pointer('click', air.map.project([.02, .0008]));
      check(picked === 'retained-region', 'Retained camera stopped being selectable');
      finish!();
      await until(() => air.getEntityState('retained-region')?.coverage === 'ready', 'replacement completes after unrelated failure');
    } finally { finish?.(); air.destroy(); }
  },
  "Destroy during initialization, repeat destroy, then remount": async caseContext => {
    const { own, container } = caseContext;
    const abandoned = own(createViewport({ container, basemap: style() }));
    abandoned.on('destroy', () => abandoned.destroy());
    attachInteractions(abandoned);
    abandoned.destroy(); abandoned.destroy();
    await abandoned.ready.then(() => { throw new Error('Expected canceled readiness'); }, error => check(error instanceof RidgelineError && error.code === 'DESTROYED', 'Structured cancellation'));
    check(!container.querySelector('canvas,.rl-ui'), 'Old canvas or overlay remains');
    await withBaseViewport(caseContext, async ({ viewport }) => {
      const canvas = viewport.map.getCanvas();
      const ui = attachInteractions(viewport);
      const off = viewport.on('selectionrequest', event => viewport.setSelection(event.ids));
      try {
        abandoned.destroy();
        await pointer('click', viewport.map.project([0, 0]));
        check(Boolean(container.querySelector('.rl-picker')), 'Replacement did not open its picker');
        const choice = container.querySelector<HTMLButtonElement>('[data-feature-id="queued"]');
        if (!choice) throw new Error('Replacement queued choice is absent');
        choice.focus();
        await browserKey('Enter');
        check(viewport.getSelection()[0] === 'queued', 'Replacement did not accept a real picker choice');
        check(container.querySelectorAll('canvas').length === 1 && container.querySelector('canvas') === canvas,
          'Old destruction removed or duplicated the replacement canvas');
        check(container.querySelectorAll('.rl-ui').length === 1, 'Old destruction left obsolete interaction UI');
      } finally { off(); ui.destroy(); }
    });
  },
  "Late terrain preparation cannot affect a replacement viewport": async caseContext => {
    const { own, container, until } = caseContext;
    let finishPreparation: (() => void) | undefined;
    let preparationSignal: AbortSignal | undefined;
    let available = false;
    let destroyed = false;
    let lateErrors = 0;
    const abandoned = own(createViewport({ container, basemap: style(), logger: () => {},
      onError: () => { if (destroyed) lateErrors++; },
      elevationSampler: {
        sample: () => available ? 12 : null,
        // Some consumer loaders cannot stop their underlying work after cancellation.
        prepare: (_positions, signal) => {
          preparationSignal = signal;
          return new Promise<void>(resolve => { finishPreparation = resolve; });
        },
      },
    }));

    let replacement: Viewport | undefined;
    try {
      await abandoned.ready;
      abandoned.upsert([{ ...point('shared-id'), entity: { altitude: { meters: 100, reference: 'ground' } } }]);
      await until(() => Boolean(finishPreparation), 'old viewport terrain preparation starts');
      abandoned.destroy();
      destroyed = true;
      check(preparationSignal?.aborted, 'Destroy did not cancel terrain preparation');
      check(!container.querySelector('canvas,.rl-ui'), 'Old viewport retained DOM');

      replacement = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 8 },
        features: [{ ...point('shared-id'), properties: { name: 'Replacement' } }],
      }));

      const mounted = replacement;
      await mounted.ready;
      const ui = attachInteractions(mounted);
      const off = mounted.on('selectionrequest', event => mounted.setSelection(event.ids));
      try {
        available = true;
        finishPreparation?.();
        await until(() => mounted.map.queryRenderedFeatures({ layers: ['rl:points'] })
          .some(hit => hit.properties._rl_feature_id === 'shared-id'), 'replacement renders after old terrain completes');
        await pointer('click', mounted.map.project([0, 0]));
        check(mounted.getSelection()[0] === 'shared-id', 'Replacement stopped accepting real clicks');
        check(mounted.getFeature('shared-id')?.properties.name === 'Replacement', 'Old preparation replaced current data');
        check(!mounted.getFeature('shared-id')?.entity, 'Old airborne entity leaked into replacement');
        check(container.querySelectorAll('canvas').length === 1, 'Old preparation recreated a canvas');
        check(lateErrors === 0, 'Destroyed viewport emitted a late diagnostic');
      } finally { off(); ui.destroy(); }
    } finally {
      finishPreparation?.(); abandoned.destroy(); replacement?.destroy();
    }
  },
} satisfies BrowserCaseModule;
