import { RidgelineError } from './errors';
import type { FeatureStore } from './features';
import type { MapFeature, Properties } from './types';

export type FeatureChanges = { add: MapFeature[]; remove: string[] };
type SourceErrorListener = (event: { error: unknown }) => void;

/** The GeoJSON operations used by publication, with source identity preserved. */
export interface FeaturePublicationSource {
  updateData(changes: FeatureChanges): Promise<unknown>;
  on(type: 'error', listener: SourceErrorListener): unknown;
  off(type: 'error', listener: SourceErrorListener): unknown;
}

export interface FeaturePublicationTarget {
  current(): FeaturePublicationSource | undefined;
  create(features: MapFeature[]): void;
}

type PublicationOptions<P extends Properties> = {
  store: Pick<FeatureStore<P>, 'get' | 'all'>;
  target: FeaturePublicationTarget;
  render: (feature: MapFeature<P>) => MapFeature;
  diagnostic: (error: RidgelineError) => void;
  beforeSubmit: () => void;
  published: (id: string) => void;
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
    if (!source || !pending.size) return;
    const token = Symbol();
    submitting = token;
    const current = () => !destroyed && active && submitting === token && target.current() === source;
    const changes = [...pending.entries()];
    pending.clear();
    const add: MapFeature[] = [];
    const remove: string[] = [];
    const submitted: string[] = [];
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
          if (feature) add.push(render(feature)); else remove.push(id);
          submitted.push(id);
        } catch (cause) {
          if (!current()) return;
          preparationFailed(id, cause);
        }
        if (!current()) return;
      }
      if (!submitted.length) return;
      options.beforeSubmit();
      if (!current()) return;
      source.on('error', onSourceError);
      // Replacements and removals can safely repeat after a partial renderer failure.
      await source.updateData({ add, remove });
      if (current() && !rejected) for (const id of submitted) options.published(id);
    } catch (cause) {
      reject(cause);
    } finally {
      source.off('error', onSourceError);
      if (submitting === token) {
        submitting = null;
        if (pending.size) schedule();
      }
    }
  }

  /** Retire before replacing the style. Old submissions cannot affect its successor. */
  function retire() {
    active = false;
    submitting = null;
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
      for (const id of failed) if (!pending.has(id)) pending.set(id, store.get(id) ?? null);
      failed.clear();
      schedule();
    },
    /** Rebuild from accepted data, including changes received while the style was absent. */
    restore() {
      if (destroyed) return;
      retire();
      active = true;
      pending.clear();
      failed.clear();
      if (!target.current()) {
        const features: MapFeature[] = [];
        for (const feature of store.all()) {
          try { features.push(render(feature)); }
          catch (cause) { preparationFailed(feature.id, cause); }
        }
        target.create(features);
      }
    },
    retire,
    destroy() {
      destroyed = true;
      retire();
      pending.clear();
      failed.clear();
    },
  };
}
