import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FeatureStore } from '../src/features';
import type { MapFeature } from '../src/types';

for (const shared of [false, true]) {
  test(`${shared ? 'Shared' : 'Ordinary'} buffer snapshots retain graph aliases and isolate inputs and reads`, () => {
    const buffer = shared ? new SharedArrayBuffer(32) : new ArrayBuffer(32);
    const bytes = new Uint8Array(buffer, 8, 8);
    bytes.set([1, 2, 3, 4, 5, 6, 7, 8]);
    const properties = {
      buffer, bytes, repeated: bytes,
      words: new Uint16Array(buffer, 10, 2), data: new DataView(buffer, 12, 3),
      map: new Map<unknown, unknown>(), set: new Set<unknown>(),
      error: new Error('Property failure', { cause: { bytes } }),
      date: new Date('2026-10-15T00:00:00.000Z'), regexp: /snapshot/gi, amount: 12n,
    };
    properties.map.set(bytes, buffer);
    properties.map.set(properties, properties.data);
    properties.error.cause = { bytes, error: properties.error };
    properties.set.add(properties);
    properties.set.add(bytes);
    const store = new FeatureStore<typeof properties>();
    const input = { type: 'Feature', id: 'graph', geometry: { type: 'Point', coordinates: [6, 45] },
      properties, foreign: { bytes, properties } } satisfies MapFeature<typeof properties> & { foreign: unknown };
    store.upsert([input]);
    bytes[0] = 71;
    const snapshot = store.get('graph');
    assert.ok(snapshot);
    const output = snapshot.properties;
    assert.equal(output.bytes[0], 1);
    assert.equal(output.buffer instanceof SharedArrayBuffer, shared);
    assert.notEqual(output.buffer, buffer);
    assert.equal(output.bytes, output.repeated);
    assert.equal(output.bytes.buffer, output.buffer);
    assert.equal(output.words.buffer, output.buffer);
    assert.equal(output.data.buffer, output.buffer);
    assert.ok(output.words instanceof Uint16Array);
    assert.ok(output.data instanceof DataView);
    assert.deepEqual([output.bytes.byteOffset, output.bytes.length, output.words.byteOffset,
      output.words.length, output.data.byteOffset, output.data.byteLength], [8, 8, 10, 2, 12, 3]);
    assert.equal(output.map.get(output.bytes), output.buffer);
    assert.equal(output.map.get(output), output.data);
    assert.ok(output.set.has(output) && output.set.has(output.bytes));
    const cause = output.error.cause;
    assert.ok(cause && typeof cause === 'object' && 'bytes' in cause && 'error' in cause);
    assert.equal(cause.bytes, output.bytes);
    assert.equal(cause.error, output.error);
    const foreign: unknown = Reflect.get(snapshot, 'foreign');
    assert.ok(foreign && typeof foreign === 'object' && 'bytes' in foreign && 'properties' in foreign);
    assert.equal(foreign.bytes, output.bytes);
    assert.equal(foreign.properties, output);
    assert.equal(output.date.toISOString(), '2026-10-15T00:00:00.000Z');
    assert.equal(output.regexp.source, 'snapshot');
    assert.equal(output.regexp.flags, 'gi');
    assert.equal(output.amount, 12n);
    output.bytes[0] = 91;
    const all = store.all();
    assert.equal(all[0]?.properties.bytes[0], 1);
    all[0]!.properties.bytes[0] = 101;
    assert.equal(store.get('graph')?.properties.bytes[0], 1);
    assert.equal(bytes[0], 71);
    output.data.setUint8(0, 51);
    assert.equal(output.bytes[4], 51);
    assert.equal(store.get('graph')?.properties.bytes[4], 5);
  });
}

test('shared snapshot buffers retain supported growable capacity without sharing growth', () => {
  const buffer: unknown = Reflect.construct(SharedArrayBuffer, [16, { maxByteLength: 64 }]);
  assert.ok(buffer instanceof SharedArrayBuffer);
  const bytes = new Uint8Array(buffer, 4, 4);
  bytes[0] = 7;
  const store = new FeatureStore<{ buffer: SharedArrayBuffer; bytes: Uint8Array }>();
  store.upsert([{ type: 'Feature', id: 'growable', properties: { buffer, bytes },
    geometry: { type: 'Point', coordinates: [0, 0] } }]);
  const snapshot = store.get('growable');
  assert.ok(snapshot);
  assert.equal(Reflect.get(snapshot.properties.buffer, 'growable'), true);
  assert.equal(Reflect.get(snapshot.properties.buffer, 'maxByteLength'), 64);
  const grow: unknown = Reflect.get(snapshot.properties.buffer, 'grow');
  assert.ok(typeof grow === 'function');
  Reflect.apply(grow, snapshot.properties.buffer, [32]);
  assert.equal(buffer.byteLength, 16);
  assert.equal(snapshot.properties.buffer.byteLength, 32);
  assert.equal(snapshot.properties.bytes.buffer, snapshot.properties.buffer);
  assert.equal(store.get('growable')?.properties.buffer.byteLength, 16);
  assert.equal(store.get('growable')?.properties.bytes[0], 7);
});

test('shared snapshots preserve every native typed view constructor and offset', () => {
  const buffer = new SharedArrayBuffer(128);
  const views: ArrayBufferView[] = [
    new Int8Array(buffer, 8, 2), new Uint8Array(buffer, 8, 2), new Uint8ClampedArray(buffer, 8, 2),
    new Int16Array(buffer, 8, 2), new Uint16Array(buffer, 8, 2),
    new Int32Array(buffer, 8, 2), new Uint32Array(buffer, 8, 2),
    new Float32Array(buffer, 8, 2), new Float64Array(buffer, 8, 2),
    new BigInt64Array(buffer, 8, 2), new BigUint64Array(buffer, 8, 2),
    new DataView(buffer, 8, 2), new Uint8Array(buffer, 128, 0),
  ];
  const float16: unknown = Reflect.get(globalThis, 'Float16Array');
  if (typeof float16 === 'function') {
    const view: unknown = Reflect.construct(float16, [buffer, 8, 2]);
    assert.ok(ArrayBuffer.isView(view));
    views.push(view);
  }
  const store = new FeatureStore<{ buffer: SharedArrayBuffer; views: ArrayBufferView[] }>();
  store.upsert([{ type: 'Feature', id: 'views', properties: { buffer, views },
    geometry: { type: 'Point', coordinates: [0, 0] } }]);
  const output = store.get('views')?.properties;
  assert.ok(output);
  assert.equal(output.views.length, views.length);
  for (const [index, view] of output.views.entries()) {
    assert.equal(Object.getPrototypeOf(view), Object.getPrototypeOf(views[index]));
    assert.equal(view.buffer, output.buffer);
    assert.equal(view.byteOffset, views[index]!.byteOffset);
    assert.equal(view.byteLength, views[index]!.byteLength);
  }
  new Uint8Array(output.buffer)[8] = 53;
  assert.equal(new Uint8Array(buffer)[8], 0);
  assert.equal(new Uint8Array(store.get('views')!.properties.buffer)[8], 0);
});

test('ordinary resizable buffer snapshots keep native view tracking and isolate resizing', () => {
  const buffer: unknown = Reflect.construct(ArrayBuffer, [16, { maxByteLength: 64 }]);
  assert.ok(buffer instanceof ArrayBuffer);
  const bytes = new Uint8Array(buffer, 4);
  bytes[0] = 7;
  const store = new FeatureStore<{ buffer: ArrayBuffer; bytes: Uint8Array }>();
  store.upsert([{ type: 'Feature', id: 'resizable', properties: { buffer, bytes },
    geometry: { type: 'Point', coordinates: [0, 0] } }]);
  const output = store.get('resizable')?.properties;
  assert.ok(output);
  assert.equal(Reflect.get(output.buffer, 'resizable'), true);
  assert.equal(Reflect.get(output.buffer, 'maxByteLength'), 64);
  const resize: unknown = Reflect.get(output.buffer, 'resize');
  assert.ok(typeof resize === 'function');
  Reflect.apply(resize, output.buffer, [32]);
  assert.equal(output.bytes.length, 28);
  assert.equal(buffer.byteLength, 16);
  assert.equal(store.get('resizable')?.properties.buffer.byteLength, 16);
  assert.equal(store.get('resizable')?.properties.bytes[0], 7);
});
