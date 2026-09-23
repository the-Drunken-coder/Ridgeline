import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FeatureStore } from '../src/features';
import { RidgelineError, createReporter } from '../src/errors';
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
