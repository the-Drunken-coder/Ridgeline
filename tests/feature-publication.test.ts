import assert from 'node:assert/strict';
import test from 'node:test';
import { createFeaturePublication } from '../src/feature-publication';
import type { FeatureChanges, FeaturePublicationSource } from '../src/feature-publication';
import { FeatureStore } from '../src/features';
import type { RidgelineError } from '../src/errors';
import type { MapFeature, Properties } from '../src/types';

const point = (id: string, revision = 0): MapFeature => ({ type: 'Feature', id, properties: { revision }, geometry: { type: 'Point', coordinates: [0, 0] } });
type ErrorListener = Parameters<FeaturePublicationSource['on']>[1];

/** A source whose worker completions and error events are controlled by the test. */
class ControlledSource implements FeaturePublicationSource {
  readonly features = new Map<string, MapFeature>();
  readonly listeners = new Set<ErrorListener>();
  readonly calls: { changes: FeatureChanges; resolve: () => void; reject: (cause: Error) => void }[] = [];
  constructor(features: MapFeature[]) { for (const feature of features) this.features.set(feature.id, feature); }
  updateData(changes: FeatureChanges) {
    return new Promise<void>((resolve, reject) => { this.calls.push({ changes, resolve, reject }); });
  }
  on(_type: 'error', listener: ErrorListener) { this.listeners.add(listener); }
  off(_type: 'error', listener: ErrorListener) { this.listeners.delete(listener); }
  error() { for (const listener of this.listeners) listener({ error: new Error('Worker failed') }); }
  apply(changes: FeatureChanges) {
    for (const feature of changes.add) this.features.set(feature.id, feature);
    for (const id of changes.remove) this.features.delete(id);
  }
  succeed(index: number) {
    const call = this.calls[index]!;
    this.apply(call.changes);
    call.resolve();
  }
}

function fixture(render: (feature: MapFeature) => MapFeature = feature => feature) {
  const store = new FeatureStore<Properties>();
  const diagnostics: RidgelineError[] = [];
  const published: string[] = [];
  const frames = new Map<number, () => void>();
  let frameId = 0;
  let beforeSubmissions = 0;
  let source: ControlledSource | undefined;
  const publication = createFeaturePublication({
    store, render, diagnostic: error => diagnostics.push(error),
    target: { current: () => source, create: features => { source = new ControlledSource(features); } },
    beforeSubmit: () => { beforeSubmissions++; }, published: id => published.push(id),
    frames: {
      request(callback) { const id = ++frameId; frames.set(id, callback); return id; },
      cancel(id) { frames.delete(id); },
    },
  });
  return {
    publication, store, diagnostics, published, frames,
    source() { assert.ok(source); return source; },
    get beforeSubmissions() { return beforeSubmissions; },
    upsert(...features: MapFeature[]) { publication.update(store.upsert(features)); },
    remove(...ids: string[]) { publication.update([], store.remove(ids)); },
    frame() { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(); },
    replaceStyle() { publication.retire(); source = undefined; },
  };
}

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
  assert.equal(f.beforeSubmissions, 2);
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
  f.source().calls[0]!.reject(new Error('Partial failure'));
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
  f.source().calls[0]!.resolve();
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
    return feature;
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
  retired.calls[0]!.reject(new Error('Retired source failed'));
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

test('restoration isolates preparation failures and keeps those IDs available for explicit retry', async () => {
  let broken = true;
  const f = fixture(feature => {
    if (broken && feature.id === 'broken') throw new Error('Broken style');
    return feature;
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
  f.source().calls[0]!.reject(new Error('Late failure'));
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
