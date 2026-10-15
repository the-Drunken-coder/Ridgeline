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

test('shared WebAssembly.Memory snapshots isolate hidden input and read storage', () => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
  const bytes = new Uint8Array(memory.buffer);
  bytes[0] = 7;
  bytes[bytes.length - 1] = 13;
  const store = new FeatureStore<{ memory: WebAssembly.Memory }>();
  store.upsert([{ type: 'Feature', id: 'memory', properties: { memory },
    geometry: { type: 'Point', coordinates: [0, 0] } }]);
  bytes[0] = 9;
  const snapshot = store.get('memory');
  assert.ok(snapshot);
  assert.ok(snapshot.properties.memory instanceof WebAssembly.Memory);
  assert.ok(snapshot.properties.memory.buffer instanceof SharedArrayBuffer);
  const output = new Uint8Array(snapshot.properties.memory.buffer);
  assert.deepEqual([output[0], output[output.length - 1]], [7, 13]);
  output[0] = 11;
  const listed = store.all();
  assert.equal(new Uint8Array(listed[0]!.properties.memory.buffer)[0], 7);
  new Uint8Array(listed[0]!.properties.memory.buffer)[0] = 17;
  assert.equal(new Uint8Array(store.get('memory')!.properties.memory.buffer)[0], 7);
  assert.equal(bytes[0], 9);
});

for (const ownerFirst of [false, true]) {
  test(`shared WebAssembly.Memory snapshots retain aliases with owner ${ownerFirst ? 'first' : 'last'}`, () => {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
    const buffer = memory.buffer;
    const bytes = new Uint8Array(buffer, 8, 4);
    bytes.set([1, 2, 3, 4]);
    const properties = {
      ...(ownerFirst ? { memory, buffer, bytes } : { bytes, buffer, memory }),
      repeated: memory, repeatedBytes: bytes, data: new DataView(buffer, 9, 2),
      map: new Map<unknown, unknown>(), set: new Set<unknown>(),
      error: new Error('Memory cause'),
    };
    properties.map.set(memory, bytes);
    properties.map.set(properties, memory);
    properties.set.add(memory);
    properties.set.add(properties);
    properties.error.cause = { memory, error: properties.error };
    const store = new FeatureStore<typeof properties>();
    store.upsert([{ type: 'Feature', id: 'aliases', properties,
      geometry: { type: 'Point', coordinates: [0, 0] } }]);
    bytes[0] = 7;
    const output = store.get('aliases')!.properties;
    assert.ok(output.memory instanceof WebAssembly.Memory);
    assert.notEqual(output.memory, memory);
    assert.equal(output.memory, output.repeated);
    assert.ok(output.memory.buffer === output.buffer, 'Memory and exposed buffer must alias');
    assert.equal(output.bytes, output.repeatedBytes);
    assert.ok(output.bytes.buffer === output.buffer, 'View and exposed buffer must alias');
    assert.ok(output.data.buffer === output.buffer, 'DataView and exposed buffer must alias');
    assert.deepEqual([output.bytes.byteOffset, output.bytes.length, output.data.byteOffset,
      output.data.byteLength], [8, 4, 9, 2]);
    assert.equal(output.map.get(output.memory), output.bytes);
    assert.equal(output.map.get(output), output.memory);
    assert.ok(output.set.has(output.memory) && output.set.has(output));
    const cause = output.error.cause;
    assert.ok(cause && typeof cause === 'object' && 'memory' in cause && 'error' in cause);
    assert.equal(cause.memory, output.memory);
    assert.equal(cause.error, output.error);
    assert.deepEqual([...output.bytes], [1, 2, 3, 4]);
    new Uint8Array(output.memory.buffer)[8] = 23;
    output.data.setUint8(0, 29);
    assert.deepEqual([...output.bytes], [23, 29, 3, 4]);
    assert.deepEqual([...store.get('aliases')!.properties.bytes], [1, 2, 3, 4]);
    assert.deepEqual([...bytes], [7, 2, 3, 4]);
  });
}

test('shared WebAssembly.Memory owners nested in Map Set and Error are isolated', () => {
  const memories = Array.from({ length: 3 }, () => new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true }));
  for (const memory of memories) new Uint8Array(memory.buffer)[0] = 7;
  const properties = { map: new Map([[memories[0]!, 'key']]),
    set: new Set([memories[1]!]), error: new Error('Hidden memory', { cause: memories[2]! }) };
  const store = new FeatureStore<typeof properties>();
  store.upsert([{ type: 'Feature', id: 'nested', properties,
    geometry: { type: 'Point', coordinates: [0, 0] } }]);
  for (const memory of memories) new Uint8Array(memory.buffer)[0] = 9;
  const output = store.get('nested')!.properties;
  for (const memory of [output.map.keys().next().value, ...output.set, output.error.cause]) {
    assert.ok(memory instanceof WebAssembly.Memory);
    assert.equal(new Uint8Array(memory.buffer)[0], 7);
    new Uint8Array(memory.buffer)[0] = 11;
  }
  assert.deepEqual(memories.map(memory => new Uint8Array(memory.buffer)[0]), [9, 9, 9]);
  const reread = store.get('nested')!.properties;
  assert.equal(new Uint8Array(reread.map.keys().next().value!.buffer)[0], 7);
  assert.equal(new Uint8Array([...reread.set][0]!.buffer)[0], 7);
  assert.ok(reread.error.cause instanceof WebAssembly.Memory);
  assert.equal(new Uint8Array(reread.error.cause.buffer)[0], 7);
});

test('shared WebAssembly.Memory snapshots fix growth at the current page extent', () => {
  for (const pages of [0, 2]) {
    const memory = new WebAssembly.Memory({ initial: 0, maximum: 3, shared: true });
    memory.grow(pages);
    const bytes = new Uint8Array(memory.buffer);
    if (pages) bytes[bytes.length - 1] = 37;
    const store = new FeatureStore<{ memory: WebAssembly.Memory }>();
    store.upsert([{ type: 'Feature', id: 'extent', properties: { memory },
      geometry: { type: 'Point', coordinates: [0, 0] } }]);
    const output = store.get('extent')!.properties.memory;
    assert.equal(output.buffer.byteLength, pages * 65536);
    assert.equal(output.grow(0), pages);
    assert.throws(() => output.grow(1), RangeError);
    assert.equal(memory.grow(1), pages);
    new Uint8Array(memory.buffer)[pages * 65536] = 41;
    const reread = store.get('extent')!.properties.memory;
    assert.equal(reread.buffer.byteLength, pages * 65536);
    if (pages) assert.equal(new Uint8Array(reread.buffer)[pages * 65536 - 1], 37);
    assert.equal(output.buffer.byteLength, pages * 65536);
  }
});
