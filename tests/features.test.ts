import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FeatureStore } from '../src/features';
import { RidgelineError, createReporter } from '../src/errors';
import { DEFAULT_ENTITY_MODELS, modelSettings } from '../src/model-settings';
import type { MapFeature } from '../src/types';

const point = (id: string, name = id): MapFeature => ({ type: 'Feature', id, properties: { name }, geometry: { type: 'Point', coordinates: [6, 45] } });

test('updates replace the complete feature and preserve stable identity', () => {
  const store = new FeatureStore();
  store.upsert([{ ...point('a'), properties: { name: 'Old', removed: true } }]);
  const replacement: MapFeature = { ...point('a', 'New'), geometry: { type: 'LineString', coordinates: [[6,45], [7,46]] } };
  store.upsert([replacement]);
  assert.deepEqual(store.all(), [replacement]);
});

test('a failed batch makes no partial changes', () => {
  const store = new FeatureStore(); store.upsert([point('a', 'Original')]);
  assert.throws(() => store.upsert([point('a', 'Changed'), point('')]), { code: 'INVALID_FEATURE' });
  assert.equal(store.get('a')?.properties.name, 'Original');
  assert.deepEqual(store.ids(), ['a']);
});

test('overlapping ground attachment boundaries reject the whole mixed feature batch', () => {
  const store = new FeatureStore();
  store.upsert([point('accepted', 'Original')]);
  const invalid: MapFeature = { ...point('overlap'), entity: { attachments: [{ id: 'boundary', type: 'polygon',
    vertices: [[0, 0], [4, 0], [2, 0], [4, 4], [0, 4]],
  }] } };
  const before = store.all();
  assert.throws(() => store.upsert([point('accepted', 'Changed'), point('new'), invalid]), {
    code: 'INVALID_FEATURE',
  });
  assert.deepEqual(store.all(), before);
});

test('ground attachment polygons reject nonadjacent contacts and retain ordinary corners', () => {
  const store = new FeatureStore();
  const polygon = (vertices: [number, number][]): MapFeature => ({ ...point('area'), entity: {
    attachments: [{ id: 'boundary', type: 'polygon', vertices }],
  } });
  for (const vertices of [
    [[0, 0], [4, 0], [4, 4], [2, 0], [0, 4]],
    [[0, 0], [4, 0], [4, 4], [0, 4], [0, 1], [3, 1], [3, 0], [1, 0], [1, 2], [0, 2]],
    [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0], [1, 1]],
    [[0, 0], [4, 0], [4, 4], [0, 4], [0, 4]],
    [[0, 0], [4, 0], [4, 4], [0, 4], [0, 2], [0, 5]],
  ] satisfies [number, number][][]) {
    assert.throws(() => store.upsert([polygon(vertices)]), { code: 'INVALID_FEATURE' });
    assert.deepEqual(store.all(), []);
  }
  for (const vertices of [
    [[0, 0], [4, 0], [4, 4], [0, 4]],
    [[0, 0], [2, 0], [4, 0], [4, 4], [2, 2], [0, 4]],
    [[0, 0], [0, 4], [2, 2], [4, 4], [4, 0]],
  ] satisfies [number, number][][]) {
    const feature = polygon(vertices);
    store.upsert([feature]);
    assert.deepEqual(store.get(feature.id), feature);
  }
});

test('data snapshots isolate callers and the last duplicate ID wins', () => {
  const store = new FeatureStore(); const input = point('a');
  store.upsert([input]); input.properties.name = 'Mutated';
  const output = store.get('a')!; output.properties.name = 'Mutated again';
  assert.equal(store.get('a')?.properties.name, 'a');
  store.upsert([point('a', 'First'), point('a', 'Last')]);
  assert.equal(store.get('a')?.properties.name, 'Last');
  assert.deepEqual(store.remove(['missing', 'a', 'a']), ['a']);
  assert.equal(store.all().length, 0);
});

test('features missing geometry after cloning reject the complete batch', () => {
  class ComputedFeature {
    readonly type = 'Feature';
    readonly id = 'computed';
    readonly properties = {};
    get geometry(): MapFeature['geometry'] { return { type: 'Point', coordinates: [6, 45] }; }
  }
  const store = new FeatureStore();
  store.upsert([point('accepted', 'Original')]);
  assert.throws(() => store.upsert([point('accepted', 'Changed'), point('new'), new ComputedFeature()]), {
    code: 'INVALID_FEATURE',
  });
  assert.deepEqual(store.all(), [point('accepted', 'Original')]);
});

test('own getters are read once and the retained geometry is what validation checks', () => {
  let reads = 0;
  const computed: MapFeature = {
    type: 'Feature', id: 'computed', properties: {},
    get geometry(): MapFeature['geometry'] { return { type: 'Point', coordinates: ++reads === 1 ? [6, 45] : [NaN, 91] }; },
  };
  const store = new FeatureStore();
  store.upsert([computed]);
  assert.deepEqual(store.get('computed')?.geometry, { type: 'Point', coordinates: [6, 45] });
  assert.equal(reads, 1);
  assert.throws(() => store.upsert([point('computed', 'Changed'), {
    ...point('invalid'), get geometry(): MapFeature['geometry'] { return { type: 'Point', coordinates: [NaN, 91] }; },
  }]), { code: 'INVALID_FEATURE' });
  assert.deepEqual(store.ids(), ['computed']);
  assert.deepEqual(store.get('computed')?.geometry, { type: 'Point', coordinates: [6, 45] });
});

test('the validated snapshot ID determines the batch key', () => {
  let reads = 0;
  const computed: MapFeature = { ...point('unused'), get id() { return `snapshot-${++reads}`; } };
  const store = new FeatureStore();
  const changed = store.upsert([computed]);
  assert.deepEqual(store.ids(), ['snapshot-1']);
  assert.equal(changed[0]?.id, 'snapshot-1');
  assert.deepEqual(store.get('snapshot-1'), point('snapshot-1', 'unused'));
  assert.equal(reads, 1);
});

test('additional validation checks the retained model settings before committing any feature', () => {
  const store = new FeatureStore();
  store.upsert([point('accepted', 'Original')]);
  let reads = 0;
  let checked: MapFeature | undefined;
  const validate = (candidate: MapFeature) => {
    checked = candidate;
    modelSettings(DEFAULT_ENTITY_MODELS, candidate.entity?.model);
  };
  const valid: MapFeature = { ...point('model'), entity: { model: {
    id: 'asset', get switchDistanceMeters() { return ++reads === 1 ? 1000 : 1; },
  } } };
  const changed = store.upsert([valid], validate);
  assert.equal(checked, changed[0]);
  assert.equal(store.get('model')?.entity?.model?.switchDistanceMeters, 1000);
  assert.equal(reads, 1);
  assert.throws(() => store.upsert([point('accepted', 'Changed'), {
    ...point('invalid-model'), entity: { model: { id: 'asset', switchDistanceMeters: 1 } },
  }], validate), /Model distance/);
  assert.equal(store.get('accepted')?.properties.name, 'Original');
  assert.deepEqual(store.ids(), ['accepted', 'model']);
});

test('rejects unclosed polygons, nonfinite coordinates, and 3D positions', () => {
  const store = new FeatureStore();
  for (const geometry of [
    { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1]]] },
    { type: 'Point', coordinates: [NaN, 0] },
    { type: 'Point', coordinates: [0, 0, 100] },
  ] satisfies MapFeature['geometry'][]) {
    assert.throws(() => store.upsert([{ ...point('a'), geometry }]), { code: 'INVALID_FEATURE' });
  }
});

test('diagnostics retain causes and deduplicate logs by operation and source', () => {
  const errors: RidgelineError[] = [];
  const report = createReporter(error => errors.push(error));
  const cause = new Error('404');
  const error = new RidgelineError('ELEVATION_UNAVAILABLE', 'Unavailable', { operation: 'elevation', recoverable: true, sourceId: 'terrain' }, cause);
  report(error); report(error);
  report(new RidgelineError(error.code, error.message, { ...error.context, sourceId: 'hillshade' }));
  assert.equal(errors.length, 2); assert.equal(error.cause, cause);
  assert.doesNotThrow(() => createReporter(() => { throw new Error('Broken logger'); })(error));
});
