import { RidgelineError } from './errors';
import type { FeatureStore } from './features';
import type { MapFeature, Properties } from './types';

export type FeatureChanges = { add: MapFeature[]; remove: string[] };
type SourceErrorListener = (event: { error: unknown }) => void;

/** The GeoJSON operations used by publication, with source identity preserved. */
export interface FeaturePublicationSource {
  updateData(changes: FeatureChanges): Promise<unknown>;
  setData(data: { type: 'FeatureCollection'; features: MapFeature[] }): Promise<unknown>;
  on(type: 'error', listener: SourceErrorListener): unknown;
  off(type: 'error', listener: SourceErrorListener): unknown;
}

export interface FeaturePublicationTarget {
  current(): FeaturePublicationSource | undefined;
  create(features: MapFeature[]): void;
  watchInitial?(failed: (cause: unknown) => void): () => void;
}

type PublicationOptions<P extends Properties> = {
  store: Pick<FeatureStore<P>, 'get' | 'all'>;
  target: FeaturePublicationTarget;
  render: (feature: MapFeature<P>) => MapFeature;
  sourceId?: (id: string) => string;
  diagnostic: (error: RidgelineError) => void;
  published: (id: string, feature: MapFeature<P> | null) => void;
  restored?: (features: MapFeature<P>[]) => void;
  frames?: { request: (callback: () => void) => number; cancel: (id: number) => void };
};

/** Publishes accepted snapshots. Failed IDs wait for explicit retry or a newer change. */
export function createFeaturePublication<P extends Properties>(options: PublicationOptions<P>) {
  const { store, target, render, diagnostic } = options;
  const frames = options.frames ?? { request: (callback: () => void) => requestAnimationFrame(callback), cancel: (id: number) => cancelAnimationFrame(id) };
  const pending = new Map<string, MapFeature<P> | null>();
  const failed = new Set<string>();
  let submitting: symbol | null = null;
  let active = false;
  let destroyed = false;
  let frame = 0;
  let releaseInitial: (() => void) | undefined;
  let initialFailed = false;
  let resetRequested = false;
  let restoration = Symbol();

  function preparationFailed(id: string, cause: unknown) {
    if (!pending.has(id)) failed.add(id);
    diagnostic(new RidgelineError('UPDATE_FAILED', 'Unable to prepare a feature update. Update this feature or call retryUpdates() to retry.', { operation: 'upsert', recoverable: true, featureId: id }, cause));
  }

  function schedule() {
    if (!frame && active && !submitting && !destroyed) frame = frames.request(() => { void flush(); });
  }

  async function flush() {
    frame = 0;
    if (destroyed || !active || submitting) return;
    const source = target.current();
    if (!source || (!pending.size && !resetRequested)) return;
    const token = Symbol();
    submitting = token;
    const current = () => !destroyed && submitting === token && target.current() === source;
    const resetting = resetRequested;
    const changes = resetting ? store.all().map(feature => [feature.id, feature] as const) : [...pending.entries()];
    pending.clear();
    resetRequested = false;
    const add: MapFeature[] = [];
    const remove: string[] = [];
    const submitted: string[] = [];
    const submittedSnapshots = new Map<string, MapFeature<P> | null>();
    let rejected = false;
    function reject(cause: unknown) {
      if (!current() || rejected) return;
      rejected = true;
      for (const id of submitted) if (!pending.has(id)) failed.add(id);
      diagnostic(new RidgelineError('UPDATE_FAILED', 'The renderer could not apply a feature update. Call retryUpdates() to retry.', { operation: 'upsert', recoverable: true }, cause));
    }
    // MapLibre can emit a worker error while resolving updateData successfully.
    const onSourceError: SourceErrorListener = event => reject(event.error);
    try {
      for (const [id, feature] of changes) {
        failed.delete(id);
        try {
          if (feature) {
            const rendered = render(feature);
            // A callback may synchronously replace or remove this ID.
            if (pending.has(id)) continue;
            add.push(rendered);
          } else remove.push(options.sourceId?.(id) ?? id);
          submitted.push(id);
          submittedSnapshots.set(id, feature);
        } catch (cause) {
          if (!current() || !active) return;
          preparationFailed(id, cause);
        }
        if (!current() || !active) return;
      }
      if (!submitted.length && !resetting) return;
      source.on('error', onSourceError);
      // Replacements and removals can safely repeat after a partial renderer failure.
      if (resetting) await source.setData({ type: 'FeatureCollection', features: add });
      else await source.updateData({ add, remove });
      if (current() && active && !rejected) {
        if (resetting) {
          initialFailed = false;
          options.restored?.([...submittedSnapshots.values()].filter((feature): feature is MapFeature<P> => feature !== null));
        }
        for (const id of submitted) options.published(id, submittedSnapshots.get(id) ?? null);
      }
    } catch (cause) {
      reject(cause);
    } finally {
      source.off('error', onSourceError);
      if (submitting === token) {
        submitting = null;
        if (pending.size || resetRequested) schedule();
      }
    }
  }

  /** Pause new work. Keep the in-flight token until its source settles or is replaced. */
  function retire() {
    restoration = Symbol();
    active = false;
    frames.cancel(frame);
    frame = 0;
  }

  return {
    update(features: readonly MapFeature<P>[], removed: readonly string[] = []) {
      if (destroyed) return;
      for (const feature of features) { failed.delete(feature.id); pending.set(feature.id, feature); }
      for (const id of removed) { failed.delete(id); pending.set(id, null); }
      schedule();
    },
    retry() {
      if (destroyed) return;
      if (initialFailed) resetRequested = true;
      for (const id of failed) if (!pending.has(id)) pending.set(id, store.get(id) ?? null);
      failed.clear();
      schedule();
    },
    /** Resume a retained source, or rebuild from accepted data after style replacement. */
    restore() {
      if (destroyed) return;
      if (target.current()) {
        // A retained source still owns its in-flight submission and retry history.
        active = true;
        if (pending.size || resetRequested) schedule();
        return;
      }
      retire();
      releaseInitial?.();
      releaseInitial = undefined;
      submitting = null;
      active = true;
      pending.clear();
      failed.clear();
      initialFailed = false;
      resetRequested = false;
      const token = restoration;
      const current = () => !destroyed && active && restoration === token;
      const features: MapFeature[] = [];
      const preparedSnapshots: MapFeature<P>[] = [];
      for (const feature of store.all()) {
        if (!current()) return;
        try {
          const rendered = render(feature);
          if (!current()) return;
          if (pending.has(feature.id) || !store.get(feature.id)) continue;
          features.push(rendered);
          preparedSnapshots.push(feature);
        }
        catch (cause) {
          if (!current()) return;
          preparationFailed(feature.id, cause);
        }
      }
      if (!current()) return;
      target.create(features);
      if (!current()) return;
      options.restored?.(preparedSnapshots);
      if (!current()) return;
      const source = target.current();
      if (source) releaseInitial = target.watchInitial?.(cause => {
        if (destroyed || target.current() !== source) return;
        initialFailed = true;
        for (const feature of store.all()) if (!pending.has(feature.id)) failed.add(feature.id);
        if (submitting) return; // The in-flight submission reports the same source error.
        diagnostic(new RidgelineError('UPDATE_FAILED', 'The feature source could not load. Call retryUpdates() to retry.',
          { operation: 'upsert', recoverable: true, sourceId: 'rl:features' }, cause));
      });
      if (pending.size || resetRequested) schedule();
    },
    retire,
    destroy() {
      destroyed = true;
      releaseInitial?.();
      retire();
      pending.clear();
      failed.clear();
    },
  };
}
