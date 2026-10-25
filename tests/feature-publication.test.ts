import assert from 'node:assert/strict';
import test from 'node:test';
import { createFeaturePublication } from '../src/feature-publication';
import type { FeatureChanges, FeaturePublicationSource } from '../src/feature-publication';
import { FeatureStore } from '../src/features';
import { NativeDisplayBook } from '../src/native-presentation';
import type { NativeRecord } from '../src/native-presentation';
import { dashExpression, featureStyle, fontExpression, styleProperties } from '../src/feature-style';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import type { RidgelineError } from '../src/errors';
import type { MapFeature, Properties } from '../src/types';

const point = (id: string, revision = 0): MapFeature => ({ type: 'Feature', id, properties: { revision }, geometry: { type: 'Point', coordinates: [0, 0] } });
type ErrorListener = Parameters<FeaturePublicationSource['on']>[1];

/** A source whose worker completions and error events are controlled by the test. */
class ControlledSource implements FeaturePublicationSource {
  readonly features = new Map<string, MapFeature>();
  readonly listeners = new Set<ErrorListener>();
  readonly calls: { changes: FeatureChanges; resolve: () => void; reject: (cause: Error) => void; reset?: boolean }[] = [];
  constructor(features: MapFeature[]) { for (const feature of features) this.features.set(feature.id, feature); }
  updateData(changes: FeatureChanges) {
    return new Promise<void>((resolve, reject) => { this.calls.push({ changes, resolve, reject }); });
  }
  setData(data: { features: MapFeature[] }) {
    return new Promise<void>((resolve, reject) => {
      this.calls.push({ changes: { add: data.features, remove: [] }, resolve, reject, reset: true });
    });
  }
  on(_type: 'error', listener: ErrorListener) { this.listeners.add(listener); }
  off(_type: 'error', listener: ErrorListener) { this.listeners.delete(listener); }
  error() { for (const listener of this.listeners) listener({ error: new Error('Worker failed') }); }
  apply(changes: FeatureChanges) {
    for (const feature of changes.add) this.features.set(feature.id, feature);
    for (const id of changes.remove) this.features.delete(id);
  }
  getCall(index: number) {
    const call = this.calls[index];
    assert.ok(call, `Expected source submission at index ${index}`);
    return call;
  }
  succeed(index: number) {
    const call = this.getCall(index);
    if (call.reset) this.features.clear();
    this.apply(call.changes);
    call.resolve();
  }
}

function prepared(feature: MapFeature): { source: MapFeature; record: NativeRecord<Properties> } {
  return { source: feature, record: { feature, style: featureStyle({}) } };
}

function styled(feature: MapFeature): ReturnType<typeof prepared> {
  const revision = feature.properties.revision;
  assert.ok(typeof revision === 'number');
  const style = featureStyle({ dashArray: [revision + 1, 1], labelStyle: { font: [`Revision ${revision}`] } });
  return { source: { ...feature, properties: { ...feature.properties, ...styleProperties(style) } },
    record: { feature, style, markerKey: `marker-${revision}` } };
}

function fixture(render = prepared, onDiagnostic?: (error: RidgelineError) => void) {
  const store = new FeatureStore<Properties>();
  const diagnostics: RidgelineError[] = [];
  const published: string[] = [];
  const book = new NativeDisplayBook<Properties>();
  const preparedRecords: NativeRecord<Properties>[] = [];
  const publishedRecords: (NativeRecord<Properties> | null)[] = [];
  const restoredRecords: NativeRecord<Properties>[][] = [];
  const frames = new Map<number, () => void>();
  let frameId = 0;
  let source: ControlledSource | undefined;
  let initialFailure: ((cause: unknown) => void) | undefined;
  const publication = createFeaturePublication({
    store, diagnostic: error => { diagnostics.push(error); onDiagnostic?.(error); },
    render: feature => {
      const result = render(feature);
      preparedRecords.push(result.record); book.stage(result.record);
      return result;
    },
    target: {
      current: () => source,
      create: features => { source = new ControlledSource(features); },
      watchInitial: failed => { initialFailure = failed; return () => { if (initialFailure === failed) initialFailure = undefined; }; },
    },
    published: (id, record) => { published.push(id); publishedRecords.push(record); book.commit(id, record); },
    restored: records => { restoredRecords.push(records); book.replace(records); },
    frames: {
      request(callback) { const id = ++frameId; frames.set(id, callback); return id; },
      cancel(id) { frames.delete(id); },
    },
  });
  return {
    publication, store, diagnostics, published, frames, book, preparedRecords, publishedRecords, restoredRecords,
    source() { assert.ok(source); return source; },
    upsert(...features: MapFeature[]) { publication.update(store.upsert(features)); },
    remove(...ids: string[]) { publication.update([], store.remove(ids)); },
    frame() { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(); },
    replaceStyle() { publication.retire(); source = undefined; },
    failInitial() { initialFailure?.(new Error('Initial load failed')); },
  };
}

test('retry replaces a failed initial source with the latest accepted snapshot', async () => {
  const f = fixture();
  f.upsert(point('a'), point('removed'));
  f.publication.restore();
  f.failInitial();
  f.upsert(point('a', 2));
  f.remove('removed');
  f.frame();
  f.source().succeed(0);
  await Promise.resolve();
  f.publication.retry();
  f.frame();
  assert.deepEqual(f.source().getCall(1).changes.add, [point('a', 2)]);
  f.source().succeed(1);
  await Promise.resolve();
  assert.deepEqual([...f.source().features.values()], [point('a', 2)]);
  assert.equal(f.diagnostics.length, 1);
});

test('coalesces each frame and waits for the current submission before sending newer changes', async () => {
  const f = fixture();
  f.upsert(point('initial'));
  assert.equal(f.frames.size, 0);
  f.publication.restore();
  assert.ok(f.source().features.has('initial'));
  f.upsert(point('a', 1));
  f.upsert(point('a', 2), point('b'));
  f.remove('b');
  assert.equal(f.frames.size, 1);
  f.frame();
  assert.deepEqual(f.source().calls[0]?.changes, { add: [point('a', 2)], remove: ['b'] });
  f.upsert(point('a', 3));
  f.upsert(point('a', 4));
  f.frame();
  assert.equal(f.source().calls.length, 1);
  f.source().succeed(0);
  await Promise.resolve();
  assert.equal(f.frames.size, 1);
  f.frame();
  f.source().succeed(1);
  await Promise.resolve();
  assert.deepEqual(f.source().features.get('a'), point('a', 4));
  assert.deepEqual(f.published, ['a', 'b', 'a']);
  assert.equal(f.frames.size, 0);
});

test('a partially failed batch keeps removals for retry without overwriting newer updates or removals', async () => {
  const f = fixture();
  f.upsert(point('a'), point('b'), point('c'));
  f.publication.restore();
  f.upsert(point('a', 1), point('c', 1));
  f.remove('b');
  f.frame();
  // A worker may have applied some replacements before reporting failure.
  f.source().apply({ add: [point('a', 1)], remove: [] });
  f.upsert(point('a', 2));
  f.remove('c');
  f.source().getCall(0).reject(new Error('Partial failure'));
  await Promise.resolve();
  f.frame();
  f.source().succeed(1);
  await Promise.resolve();
  assert.deepEqual(f.source().features.get('a'), point('a', 2));
  assert.equal(f.source().features.has('c'), false);
  assert.equal(f.source().features.has('b'), true);
  assert.equal(f.frames.size, 0);
  f.publication.retry();
  f.frame();
  assert.deepEqual(f.source().calls[2]?.changes, { add: [], remove: ['b'] });
  f.source().succeed(2);
  await Promise.resolve();
  assert.deepEqual([...f.source().features.values()], [point('a', 2)]);
  assert.equal(f.diagnostics.length, 1);
});

test('source errors retain failed IDs even when the worker promise resolves', async () => {
  const f = fixture();
  f.publication.restore();
  f.upsert(point('a'));
  f.frame();
  f.source().error();
  f.source().error();
  f.source().getCall(0).resolve();
  await Promise.resolve();
  assert.equal(f.diagnostics.length, 1);
  assert.deepEqual(f.published, []);
  assert.equal(f.frames.size, 0);
  assert.equal(f.source().listeners.size, 0);
  f.publication.retry();
  f.frame();
  f.source().succeed(1);
  await Promise.resolve();
  assert.deepEqual(f.published, ['a']);
  assert.ok(f.source().features.has('a'));
});

test('one broken feature keeps its last display while healthy changes proceed and retry reads current data', async () => {
  let broken = true;
  const f = fixture(feature => {
    if (broken && feature.properties.revision === 1) throw new Error('Broken style');
    return prepared(feature);
  });
  f.upsert(point('a'), point('removed'));
  f.publication.restore();
  f.upsert(point('a', 1), point('healthy'));
  f.remove('removed');
  f.frame();
  f.source().succeed(0);
  await Promise.resolve();
  assert.deepEqual(f.source().features.get('a'), point('a'));
  assert.equal(f.source().features.has('removed'), false);
  assert.equal(f.diagnostics[0]?.context.featureId, 'a');
  f.upsert(point('healthy', 2));
  f.frame();
  f.source().succeed(1);
  await Promise.resolve();
  assert.equal(f.diagnostics.length, 1);
  assert.equal(f.frames.size, 0);
  broken = false;
  // The publisher must consult its authoritative store instead of retaining a failed snapshot.
  f.store.upsert([point('a', 3)]);
  f.publication.retry();
  f.frame();
  f.source().succeed(2);
  await Promise.resolve();
  assert.deepEqual(f.source().features.get('a'), point('a', 3));
});

test('basemap restoration uses current data and an old rejection cannot disturb a new submission', async () => {
  const f = fixture();
  f.publication.restore();
  const retired = f.source();
  f.upsert(point('a', 1));
  f.frame();
  f.replaceStyle();
  f.upsert(point('a', 2), point('removed'));
  f.remove('removed');
  f.publication.restore();
  assert.deepEqual([...f.source().features.values()], [point('a', 2)]);
  f.upsert(point('a', 3));
  f.frame();
  f.upsert(point('a', 4));
  retired.error();
  retired.getCall(0).reject(new Error('Retired source failed'));
  await Promise.resolve();
  assert.equal(f.diagnostics.length, 0);
  assert.equal(retired.listeners.size, 0);
  assert.equal(f.frames.size, 0);
  f.source().succeed(0);
  await Promise.resolve();
  f.frame();
  f.source().succeed(1);
  await Promise.resolve();
  f.publication.retry();
  f.frame();
  assert.equal(f.source().calls.length, 2);
  assert.deepEqual([...f.source().features.values()], [point('a', 4)]);
});

test('restoration with a retained source preserves queued updates and removals', async () => {
  const f = fixture();
  f.upsert(point('a', 1), point('removed'));
  f.publication.restore();
  const source = f.source();
  f.upsert(point('a', 2));
  f.remove('removed');
  f.publication.restore();
  assert.equal(f.source(), source);
  f.frame();
  source.succeed(0);
  await Promise.resolve();
  assert.deepEqual([...source.features.values()], [point('a', 2)]);
});

test('restoration with a retained source preserves failures without retrying them', async () => {
  const f = fixture();
  f.upsert(point('a'), point('removed'));
  f.publication.restore();
  f.upsert(point('a', 1));
  f.remove('removed');
  f.frame();
  f.source().getCall(0).reject(new Error('Failed submission'));
  await Promise.resolve();
  f.publication.restore();
  assert.equal(f.frames.size, 0);
  f.publication.retry();
  f.frame();
  f.source().succeed(1);
  await Promise.resolve();
  assert.deepEqual([...f.source().features.values()], [point('a', 1)]);
});

test('restoration with a retained source keeps an in-flight submission ahead of newer work', async () => {
  const f = fixture();
  f.publication.restore();
  f.upsert(point('a', 1));
  f.frame();
  f.upsert(point('a', 2));
  f.publication.retire();
  f.publication.restore();
  f.frame();
  assert.equal(f.source().calls.length, 1);
  f.source().getCall(0).reject(new Error('Earlier submission failed'));
  await Promise.resolve();
  f.frame();
  f.source().succeed(1);
  await Promise.resolve();
  assert.equal(f.diagnostics.length, 1);
  assert.deepEqual([...f.source().features.values()], [point('a', 2)]);
});

test('a failure while retired remains retryable when the same source is restored', async () => {
  const f = fixture();
  f.upsert(point('a'), point('removed'));
  f.publication.restore();
  f.upsert(point('a', 1));
  f.remove('removed');
  f.frame();
  f.publication.retire();
  f.source().getCall(0).reject(new Error('Failure during retirement'));
  await Promise.resolve();
  f.publication.restore();
  assert.equal(f.frames.size, 0);
  f.publication.retry();
  f.frame();
  f.source().succeed(1);
  await Promise.resolve();
  assert.deepEqual([...f.source().features.values()], [point('a', 1)]);
});

test('restoration isolates preparation failures and keeps those IDs available for explicit retry', async () => {
  let broken = true;
  const f = fixture(feature => {
    if (broken && feature.id === 'broken') throw new Error('Broken style');
    return prepared(feature);
  });
  f.upsert(point('broken'), point('healthy'));
  f.publication.restore();
  assert.deepEqual([...f.source().features.keys()], ['healthy']);
  assert.equal(f.diagnostics[0]?.context.featureId, 'broken');
  assert.equal(f.frames.size, 0);
  broken = false;
  f.publication.retry();
  f.frame();
  f.source().succeed(0);
  await Promise.resolve();
  assert.ok(f.source().features.has('broken'));
});

test('destroy cancels scheduled publication and makes outstanding worker results inert', async () => {
  const f = fixture();
  f.publication.restore();
  f.upsert(point('a'));
  f.frame();
  f.upsert(point('queued'));
  f.publication.destroy();
  f.publication.destroy();
  f.source().error();
  f.source().getCall(0).reject(new Error('Late failure'));
  await Promise.resolve();
  f.publication.retry();
  f.publication.restore();
  f.upsert(point('after-destroy'));
  f.frame();
  assert.equal(f.source().calls.length, 1);
  assert.equal(f.diagnostics.length, 0);
  assert.deepEqual(f.published, []);
  assert.equal(f.source().listeners.size, 0);
  const scheduled = fixture();
  scheduled.publication.restore();
  scheduled.upsert(point('a'));
  scheduled.publication.destroy();
  assert.equal(scheduled.frames.size, 0);
  scheduled.frame();
  assert.equal(scheduled.source().calls.length, 0);
});

test('reentrant removal during preparation does not publish the removed feature', async () => {
  let f: ReturnType<typeof fixture>;
  f = fixture(feature => {
    if (feature.id === 'removed') f.remove('removed');
    return prepared(feature);
  });
  f.publication.restore();
  f.upsert(point('removed'), point('healthy'));
  f.frame();
  assert.deepEqual(f.source().getCall(0).changes, { add: [point('healthy')], remove: [] });
  f.source().succeed(0);
  await Promise.resolve();
  f.frame();
  f.source().succeed(1);
  await Promise.resolve();
  assert.deepEqual([...f.source().features.keys()], ['healthy']);
});

test('restoration stops when a preparation diagnostic destroys the publisher', () => {
  let f: ReturnType<typeof fixture>;
  let renders = 0;
  f = fixture(feature => {
    renders++;
    if (feature.id === 'broken') throw new Error('Broken style');
    return prepared(feature);
  }, () => f.publication.destroy());
  f.upsert(point('broken'), point('later'));
  f.publication.restore();
  assert.equal(renders, 1);
  assert.equal(f.frames.size, 0);
});

test('source creation stops restoration when an error observer destroys publication', () => {
  const store = new FeatureStore<Properties>();
  store.upsert([point('a')]);
  let restored = 0;
  let watched = 0;
  let publication: ReturnType<typeof createFeaturePublication<Properties, NativeRecord<Properties>>>;
  publication = createFeaturePublication({
    store, render: prepared, diagnostic: () => {}, published: () => {},
    restored: () => { restored++; },
    frames: { request: () => 1, cancel: () => {} },
    target: {
      current: () => undefined,
      create: () => publication.destroy(),
      watchInitial: () => { watched++; return () => {}; },
    },
  });
  publication.restore();
  assert.equal(restored, 0);
  assert.equal(watched, 0);
});


test('retry requested during a held update resets current accepted data after settlement', async () => {
  const f = fixture();
  f.upsert(point('a'), point('removed'));
  f.publication.restore();
  f.failInitial();
  f.upsert(point('a', 2));
  f.remove('removed');
  f.frame();
  f.publication.retry();
  assert.equal(f.source().calls.length, 1);
  f.source().succeed(0);
  await Promise.resolve();
  f.frame();
  assert.equal(f.source().getCall(1).reset, true);
  f.source().succeed(1);
  await Promise.resolve();
  assert.deepEqual([...f.source().features.values()], [point('a', 2)]);
  f.frame();
  assert.equal(f.source().calls.length, 2);
  assert.equal(f.frames.size, 0);
});


test('a replacement restoration keeps its scene when an obsolete render callback returns', () => {
  let replace = true;
  let f: ReturnType<typeof fixture>;
  f = fixture(feature => {
    if (replace) {
      replace = false;
      f.replaceStyle();
      f.store.upsert([point('a', 2)]);
      f.publication.restore();
    }
    return prepared(feature);
  });
  f.upsert(point('a', 1));
  f.publication.restore();
  assert.deepEqual([...f.source().features.values()], [point('a', 2)]);
  assert.equal(f.diagnostics.length, 0);
});

test('a deferred reset cannot publish after source replacement or destruction', async () => {
  for (const destroy of [false, true]) {
    const f = fixture();
    f.upsert(point('a'));
    f.publication.restore();
    const old = f.source();
    f.failInitial();
    f.upsert(point('a', 1));
    f.frame();
    f.publication.retry();
    if (destroy) f.publication.destroy();
    else { f.replaceStyle(); f.store.upsert([point('a', 2)]); f.publication.restore(); }
    old.succeed(0);
    await Promise.resolve();
    f.frame();
    assert.equal(old.calls.length, 1);
    assert.equal(f.frames.size, 0);
    assert.deepEqual(f.published, []);
    if (!destroy) assert.deepEqual([...f.source().features.values()], [point('a', 2)]);
  }
});

test('publication commits the exact prepared record even when newer accepted data is waiting', async () => {
  const f = fixture(styled);
  f.upsert(point('a', 10));
  f.publication.restore();
  const initial = f.preparedRecords[0];
  assert.ok(initial);
  assert.equal(f.restoredRecords[0]?.[0], initial);
  assert.equal(f.book.get('a'), initial);
  f.upsert(point('a', 11));
  f.frame();
  const submitted = f.preparedRecords[1];
  assert.ok(submitted);
  f.upsert(point('a', 12));
  f.source().succeed(0);
  await Promise.resolve();
  assert.equal(f.publishedRecords[0], submitted);
  assert.equal(f.book.get('a'), submitted);
  assert.equal(submitted.feature.properties.revision, 11);
  assert.deepEqual(submitted.style.dashArray, [12, 1]);
  assert.equal(submitted.markerKey, 'marker-11');
  f.frame();
  f.source().succeed(1);
  await Promise.resolve();
  assert.equal(f.publishedRecords[1], f.preparedRecords[2]);
  assert.equal(f.book.get('a')?.feature.properties.revision, 12);
  f.remove('a');
  f.frame();
  f.source().succeed(2);
  await Promise.resolve();
  assert.equal(f.publishedRecords[2], null);
  assert.equal(f.book.get('a'), undefined);
});

test('full reset restores and commits the same newly prepared records synchronously at settlement', async () => {
  const f = fixture(styled);
  f.upsert(point('a', 10));
  f.publication.restore();
  f.failInitial();
  f.store.upsert([point('a', 11), point('b', 20)]);
  f.publication.retry();
  f.frame();
  const records = f.preparedRecords.slice(1);
  assert.equal(f.source().getCall(0).reset, true);
  assert.equal(f.book.get('a'), f.preparedRecords[0]);
  f.source().succeed(0);
  await Promise.resolve();
  const restored = f.restoredRecords[1];
  assert.ok(restored);
  assert.equal(restored.length, 2);
  for (const [index, record] of records.entries()) {
    assert.equal(restored[index], record);
    assert.equal(f.publishedRecords[index], record);
    assert.equal(f.book.get(record.feature.id), record);
  }
});

function assertLiterals(book: NativeDisplayBook<Properties>, source: MapFeature, dash: number[], font: string[]) {
  const styles = [...book.styles()];
  const dashes = createExpression(dashExpression(styles), 'line-dasharray');
  const fonts = createExpression(fontExpression(styles), 'text-font', { type: 'array', value: 'string', 'property-type': 'data-driven', transition: false });
  assert.equal(dashes.result, 'success'); assert.equal(fonts.result, 'success');
  if (dashes.result !== 'success' || fonts.result !== 'success') throw new Error('Style literals did not compile.');
  assert.deepEqual({
    dash: dashes.value.evaluate({ zoom: 1 }, { type: 2, properties: source.properties }),
    font: fonts.value.evaluate({ zoom: 1 }, { type: 1, properties: source.properties }),
  }, { dash, font });
}

for (const failure of ['rejection', 'source error']) {
  test(`repeated ${failure} retains distinct style literals without retaining every prepared style`, async () => {
    const f = fixture(feature => {
      const style = featureStyle({ dashArray: [7, 3], label: `Revision ${feature.properties.revision}`,
        labelStyle: { font: ['Stream'] } });
      return { source: { ...feature, properties: { ...feature.properties, ...styleProperties(style) } }, record: { feature, style } };
    });
    f.upsert(point('a'));
    f.publication.restore();
    const installed = f.book.get('a');
    assert.ok(installed);
    for (let revision = 1; revision <= 1000; revision++) {
      f.upsert(point('a', revision));
      f.frame();
      const call = f.source().getCall(revision - 1);
      if (failure === 'source error') { f.source().error(); call.resolve(); }
      else call.reject(new Error('Worker unavailable'));
      await Promise.resolve();
      assert.equal(f.frames.size, 0);
    }
    assert.equal(f.diagnostics.length, 1000);
    assert.equal(f.book.get('a'), installed);
    assert.ok([...f.book.styles()].length <= 3, 'Retain the installed style and distinct font/dash literals only');
    const submitted = f.source().getCall(999).changes.add[0];
    assert.ok(submitted);
    assertLiterals(f.book, submitted, [7, 3], ['Stream']);
    f.publication.retry();
    f.frame();
    f.source().succeed(1000);
    await Promise.resolve();
    assert.equal(f.book.get('a')?.feature.properties.revision, 1000);
    assert.equal([...f.book.styles()].length, 1);
  });
}

for (const failure of ['rejection', 'partial failure', 'source error']) {
  test(`installed and staged dash/font literals survive successive ${failure} until their own commit or full replacement`, async () => {
    const f = fixture(styled);
    f.upsert(point('a', 10), point('b', 20));
    f.publication.restore();
    const installedA = f.source().features.get('a'), installedB = f.source().features.get('b');
    assert.ok(installedA); assert.ok(installedB);
    f.upsert(point('a', 11), point('b', 21));
    f.frame();
    const call = f.source().getCall(0), stagedA = call.changes.add[0], stagedB = call.changes.add[1];
    assert.ok(stagedA); assert.ok(stagedB);
    if (failure !== 'rejection') f.source().apply({ add: [stagedA], remove: [] });
    if (failure === 'source error') { f.source().error(); call.resolve(); }
    else call.reject(new Error(failure));
    await Promise.resolve();
    assert.equal(f.diagnostics.length, 1);
    assert.equal(f.frames.size, 0);
    assert.deepEqual(f.publishedRecords, []);
    assert.equal(f.book.get('a')?.feature.properties.revision, 10);
    assertLiterals(f.book, installedA, [11, 1], ['Revision 10']);
    assertLiterals(f.book, installedB, [21, 1], ['Revision 20']);
    assertLiterals(f.book, stagedA, [12, 1], ['Revision 11']);
    assertLiterals(f.book, stagedB, [22, 1], ['Revision 21']);
    if (failure !== 'rejection') assert.equal(f.source().features.get('a'), stagedA);
    f.publication.retire(); f.publication.restore();
    assert.equal(f.frames.size, 0);
    assertLiterals(f.book, stagedA, [12, 1], ['Revision 11']);
    f.upsert(point('a', 12));
    f.frame();
    const next = f.source().getCall(1), nextA = next.changes.add[0];
    assert.ok(nextA);
    if (failure === 'source error') { f.source().error(); next.resolve(); }
    else next.reject(new Error('Successive rejected update'));
    await Promise.resolve();
    assert.equal(f.diagnostics.length, 2);
    assert.equal(f.frames.size, 0);
    assert.deepEqual(f.publishedRecords, []);
    assert.equal(f.book.get('a')?.feature.properties.revision, 10);
    if (failure !== 'rejection') assert.equal(f.source().features.get('a'), stagedA);
    assertLiterals(f.book, installedA, [11, 1], ['Revision 10']);
    assertLiterals(f.book, stagedA, [12, 1], ['Revision 11']);
    assertLiterals(f.book, nextA, [13, 1], ['Revision 12']);
    f.upsert(point('a', 13));
    f.frame();
    f.source().succeed(2);
    await Promise.resolve();
    assertLiterals(f.book, installedA, [3, 2], ['Noto Sans Regular']);
    assertLiterals(f.book, stagedA, [3, 2], ['Noto Sans Regular']);
    assertLiterals(f.book, nextA, [3, 2], ['Noto Sans Regular']);
    assertLiterals(f.book, installedB, [21, 1], ['Revision 20']);
    assertLiterals(f.book, stagedB, [22, 1], ['Revision 21']);
    f.replaceStyle(); f.publication.restore();
    assertLiterals(f.book, installedB, [3, 2], ['Noto Sans Regular']);
    assertLiterals(f.book, stagedB, [22, 1], ['Revision 21']);
    assert.equal(f.book.get('b')?.markerKey, 'marker-21');
  });
}
