import { createViewport, RidgelineError } from '@ridgeline/map';
import type { MapFeature, Viewport } from '@ridgeline/map';
import { GeoJSONSource } from 'maplibre-gl';
import { style, point, check } from './helpers';
import type { BrowserCaseModule } from './context';


export const publicationReentryCases = {
  "Reliability entity nonsimple attachment polygons reject mixed batches before accepted or rendered changes": async caseContext => {
    const { own, container, until } = caseContext;
    const air = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 16 },
      elevationSampler: { sample: () => 0 }, logger: () => {} }));
    await air.ready;
    const original: MapFeature = { ...point('accepted'), properties: { name: 'Original' } };
    const valid: MapFeature = { ...point('valid-area', .002), entity: { attachments: [{ id: 'area', type: 'polygon',
      vertices: [[0, 0], [100, 0], [100, 100], [0, 100]], color: '#ff0000',
    }] } };
    try {
      air.upsert([original, valid]);
      await until(() => air.map.queryRenderedFeatures(air.map.project([0, 0]), { layers: ['rl:points'] })
        .some(hit => hit.properties._rl_feature_id === original.id), 'accepted point before invalid batch');
      await until(() => air.map.queryRenderedFeatures(air.map.project([.0024, .0004]), { layers: ['rl:entity-ground-fill'] })
        .some(hit => hit.properties.entityId === valid.id), 'valid attachment before invalid batch');
      const before = air.getFeatures();
      for (const vertices of [
        [[0, 0], [200, 0], [100, 0], [200, 200], [0, 200]],
        [[0, 0], [200, 0], [200, 200], [100, 0], [0, 200]],
      ] satisfies [number, number][][]) {
        const invalid: MapFeature = { ...point('invalid-area'), entity: { attachments: [{ id: 'area', type: 'polygon', vertices }] } };
        let rejected = false;
        try { air.upsert([{ ...original, properties: { name: 'Changed' }, geometry: { type: 'Point', coordinates: [.001, 0] } }, point('new'), invalid]); }
        catch (error) { check(error instanceof RidgelineError && error.code === 'INVALID_FEATURE', 'Wrong polygon validation error'); rejected = true; }
        check(rejected, 'Nonsimple attachment boundary was accepted');
        check(JSON.stringify(air.getFeatures()) === JSON.stringify(before), 'Invalid mixed batch mutated accepted data');
      }
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const rendered = air.map.queryRenderedFeatures(undefined, { layers: ['rl:points'] });
      check(air.map.queryRenderedFeatures(air.map.project([0, 0]), { layers: ['rl:points'] })
        .some(hit => hit.properties._rl_feature_id === original.id), 'Invalid batch moved rendered accepted point');
      check(!rendered.some(hit => hit.properties._rl_feature_id === 'new'), 'Invalid batch rendered a new feature');
      const adjacent: MapFeature = { ...valid, entity: { attachments: [{ id: 'area', type: 'polygon',
        vertices: [[0, 0], [50, 0], [100, 0], [100, 100], [0, 100]], color: '#ff0000',
      }] } };
      air.upsert([adjacent]);
      check(air.getFeature(valid.id)?.entity?.attachments?.[0]?.type === 'polygon', 'Valid adjacent corners were rejected');
    } finally { air.destroy(); }
  },
  "Reliability publication retires styling when callbacks replace the basemap": async caseContext => {
    const { own, container, until } = caseContext;
    for (const initial of [true, false]) {
      let replace = initial;
      let map: Viewport | undefined;
      const diagnostics: RidgelineError[] = [];
      map = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 },
        features: [point('scene-current')], logger: () => {}, onError: error => diagnostics.push(error),
        style: () => {
          if (replace && map) {
            replace = false;
            map.configure({ basemap: style('#ccddee') });
            map.upsert([point('scene-current', .03)]);
            map.setSelection(['scene-current']);
          }
          return { color: '#ff0000' };
        },
      }));

      try {
        await map.ready;
        if (!initial) { replace = true; map.configure({ basemap: style('#eedddd') }); }
        const active = map;
        await until(() => Boolean(active.map.getLayer('rl:points')) && active.map.queryRenderedFeatures({ layers: ['rl:points'] })
          .some(hit => hit.properties._rl_feature_id === 'scene-current' && hit.geometry.type === 'Point' && hit.geometry.coordinates[0]! > .02),
          `${initial ? 'initial' : 'later'} replacement renders current geometry`);
        check(active.getSelection()[0] === 'scene-current', 'Basemap replacement lost current selection');
        check(active.map.getFeatureState({ source: 'rl:features', id: 'rl:scene-current' }).selected === true, 'Replacement lost selection display');
        check(!diagnostics.some(error => error.code === 'STYLE_FAILED'), 'Obsolete restoration reported a style failure');
      } finally { map.destroy(); }
    }
  },
  "Reliability publication keeps updates made during icon registration": async caseContext => {
    const { own, container, until } = caseContext;
    let replace = false;
    const map = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 },
      features: [point('icon-current')], logger: () => {}, style: () => {
        if (replace) { replace = false; map.upsert([point('icon-current', .03)]); }
        return { icon: 'callback-icon' };
      },
    }));

    try {
      await map.ready;
      replace = true;
      map.registerIcon('callback-icon', { image: new ImageData(1, 1) });
      await until(() => map.map.queryRenderedFeatures({ layers: ['rl:points'] }).some(hit =>
        hit.properties._rl_feature_id === 'icon-current' && hit.geometry.type === 'Point' && hit.geometry.coordinates[0]! > .02), 'icon refresh renders the accepted callback update');
      const feature = map.getFeature('icon-current');
      check(feature?.geometry.type === 'Point' && feature.geometry.coordinates[0] === .03, 'Icon callback update was not accepted');
    } finally { map.destroy(); }
  },
  "Reliability publication keeps removals and scene changes made by later icon callbacks": async caseContext => {
    const { own, container } = caseContext;
    for (const action of ['remove', 'scene', 'destroy']) {
      let armed = false, afterDestroy = 0;
      const map = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 9 },
        features: [point('icon-earlier'), point('icon-trigger', -.03), point('icon-later', .06)], logger: () => {},
        style: feature => {
          if (armed && feature.id === 'icon-trigger') {
            armed = false;
            if (action === 'remove') map.remove(['icon-earlier']);
            else if (action === 'scene') { map.configure({ basemap: style('#ccddee') }); map.upsert([point('icon-earlier', .03)]); }
            else map.destroy();
          } else if (action === 'destroy' && !map.getFeature('icon-trigger') && feature.id === 'icon-later') afterDestroy++;
          return { icon: 'callback-icon' };
        },
      }));

      try {
        await map.ready;
        armed = true;
        map.registerIcon('callback-icon', { image: new ImageData(1, 1) });
        if (action === 'destroy') { check(afterDestroy === 0, 'Styling continued after viewport destruction'); continue; }
        await map.map.once('idle');
        const hits = map.map.queryRenderedFeatures({ layers: ['rl:points'] });
        if (action === 'remove') {
          check(!map.getFeature('icon-earlier') && !hits.some(hit => hit.properties._rl_feature_id === 'icon-earlier'), 'A later icon callback restored a removed feature');
        } else {
          check(hits.some(hit => hit.properties._rl_feature_id === 'icon-earlier' && hit.geometry.type === 'Point' && hit.geometry.coordinates[0]! > .02), 'Icon refresh overwrote the replacement scene');
        }
      } finally { map.destroy(); }
    }
  },
  "Reliability publication runs a requested reset after a held update settles": async caseContext => {
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
      const source = active.map.getSource('rl:features');
      if (!(source instanceof GeoJSONSource)) throw new Error('Missing feature source');
      let settle: (() => void) | undefined;
      source.updateData = () => new Promise<void>(resolve => { settle = resolve; });
      active.upsert([{ ...point('worker-latest', .03), properties: { name: 'Latest' } }]);
      active.remove(['worker-removed']);
      await until(() => Boolean(settle), 'held publication began');
      active.retryUpdates();
      settle!();
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
} satisfies BrowserCaseModule;
