import assert from 'node:assert/strict';
import test from 'node:test';
import { featureStyle } from '../src/feature-style';
import { NativeDisplayBook } from '../src/native-presentation';
import type { NativeRecord } from '../src/native-presentation';
import type { MapFeature, Properties } from '../src/types';

test('staged variants survive newer staging and retire only on their own commit or full replacement', () => {
  const book = new NativeDisplayBook<Properties>();
  const record = (id: string, revision: number): NativeRecord<Properties> => ({
    feature: { type: 'Feature', id, properties: { revision }, geometry: { type: 'Point', coordinates: [0, 0] } },
    style: featureStyle({ dashArray: [revision, 1], labelStyle: { font: [`Revision ${revision}`] } }),
  });
  const a10 = record('a', 10), b20 = record('b', 20);
  const a11 = record('a', 11), a12 = record('a', 12), b21 = record('b', 21), b22 = record('b', 22);
  book.replace([a10, b20]);
  for (const staged of [a11, a12, b21, b22, a11]) book.stage(staged);
  assert.equal([...book.styles()].length, 6);
  assert.deepEqual(new Set(book.styles()), new Set([a10.style, b20.style, a11.style, a12.style, b21.style, b22.style]));
  assert.equal(book.get('a'), a10);
  assert.equal(book.get('b'), b20);

  book.commit('a', a12);
  assert.equal(book.get('a'), a12);
  assert.deepEqual(new Set(book.styles()), new Set([a12.style, b20.style, b21.style, b22.style]));
  book.commit('b', null);
  assert.equal(book.get('b'), undefined);
  assert.deepEqual([...book.styles()], [a12.style]);

  for (const staged of [a11, a12, b21, b22]) book.stage(staged);
  const replacement = record('a', 30);
  book.replace([replacement]);
  assert.equal(book.get('a'), replacement);
  assert.equal(book.get('b'), undefined);
  assert.deepEqual([...book.styles()], [replacement.style]);
});

test('marker withdrawal retains displayed data and style until source confirmation or reintroduction', () => {
  const book = new NativeDisplayBook<Properties>();
  const feature: MapFeature = { type: 'Feature', id: 'entity', properties: { name: 'Retained' }, geometry: { type: 'Point', coordinates: [0, 0] } };
  const record = { feature, style: featureStyle({ color: '#ff0000' }), markerKey: 'installed' };
  book.replace([record]);
  const staged = { ...record, style: featureStyle({ color: '#0000ff' }), markerKey: 'staged' };
  book.stage(staged);
  book.withdrawMarker(feature.id);
  book.withdrawMarker(feature.id);
  assert.equal(book.get(feature.id)?.markerKey, undefined);
  assert.equal(book.get(feature.id)?.feature, feature);
  assert.equal(book.get(feature.id)?.style, record.style);
  assert.deepEqual([...book.styles()], [record.style, staged.style]);
  book.commit(feature.id, staged);
  assert.equal(book.get(feature.id), staged);
  assert.equal(book.get(feature.id)?.markerKey, 'staged');
  assert.deepEqual([...book.styles()], [staged.style]);
  book.withdrawMarker(feature.id);
  book.commit(feature.id, null);
  assert.equal(book.get(feature.id), undefined);
  assert.deepEqual([...book.styles()], []);
});

test('arrow membership follows installed records through replacement, removal and restoration', () => {
  const book = new NativeDisplayBook<Properties>();
  const feature: MapFeature = { type: 'Feature', id: 'a', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0]] },
    drawing: { version: 1, shape: { kind: 'arrow', vertices: [[0, 0], [1, 0]] },
      style: { color: '#ff0000', fillColor: '#ff0000', lineWidth: 3, fillOpacity: 0, dashed: false, label: '' } } };
  const arrow: NativeRecord<Properties> = { feature, style: featureStyle({ color: '#ff0000' }) };
  const line: NativeRecord<Properties> = { feature: { ...feature, drawing: undefined }, style: featureStyle({ color: '#0000ff' }) };
  const second: NativeRecord<Properties> = { ...arrow, feature: { ...feature, id: 'b' } };
  book.stage(arrow);
  assert.deepEqual(book.arrows(), []);
  book.commit('a', arrow);
  assert.deepEqual(book.arrows(), [feature]);
  book.stage(line);
  assert.deepEqual(book.arrows(), [feature]);
  book.commit('a', line);
  assert.deepEqual(book.arrows(), []);
  book.commit('b', second);
  book.commit('a', arrow);
  assert.deepEqual(book.arrows(), [second.feature, feature]);
  book.commit('b', { ...second, feature: { ...second.feature, drawing: undefined } });
  book.commit('b', second);
  assert.deepEqual(book.arrows(), [feature, second.feature]);
  book.replace([arrow]);
  assert.deepEqual(book.arrows(), [feature]);
  book.commit('a', null);
  assert.deepEqual(book.arrows(), []);
  book.stage(line);
  book.replace([]);
  assert.deepEqual([...book.styles()], []);
});
