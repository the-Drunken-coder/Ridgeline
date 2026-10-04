import { RidgelineError } from './errors';
import { parseGlb } from './model-glb';
import type { ParsedModel } from './model-glb';
import { modelDefinition } from './model-settings';
import type { EntityModelState, ModelDefinition } from './types';

export type ModelResources = { dispose(): void };
export type RegisteredModel<R extends ModelResources = ModelResources> = {
  definition: ReturnType<typeof modelDefinition>;
  model: ParsedModel;
  resources: R;
};
export type ModelUploader<R extends ModelResources> = {
  upload(model: ParsedModel, current: () => boolean, signal: AbortSignal): R | Promise<R>;
};
type Pending = { definition: ReturnType<typeof modelDefinition>; resolve(): void; reject(error: RidgelineError): void;
  attempt?: AbortController };
type Registration<R extends ModelResources> = { ready?: RegisteredModel<R>; pending?: Pending; failed?: boolean };

/** Owns registration revisions and resources independently of entity and basemap lifetime. */
export class ModelRegistry<R extends ModelResources = ModelResources> {
  private entries = new Map<string, Registration<R>>();
  private uploader?: ModelUploader<R>;
  private failed?: RidgelineError;
  private destroyed = false;
  private scheduled = false;
  constructor(private options: { changed(id: string): void; diagnostic(error: RidgelineError): void }) {}
  status(id: string): EntityModelState {
    const entry = this.entries.get(id);
    return { id, status: entry?.ready ? 'ready' : entry?.pending ? 'loading' : entry?.failed ? 'failed' : 'unavailable',
      replacementPending: Boolean(entry?.ready && entry.pending) };
  }
  get(id: string) { return this.entries.get(id)?.ready; }
  get available() { return Boolean(this.uploader) && !this.destroyed; }
  async register(id: string, definition: ModelDefinition): Promise<void> {
    if (this.destroyed) throw new RidgelineError('DESTROYED', 'This model registry has been destroyed.', { operation: 'registerModel', recoverable: false, modelId: id });
    let snapshot: ReturnType<typeof modelDefinition>;
    try {
      if (typeof id !== 'string' || !id.trim()) throw new Error('A model needs a nonempty ID.');
      snapshot = modelDefinition(definition);
    } catch (cause) {
      const error = new RidgelineError('MODEL_INVALID', 'Invalid model registration.', { operation: 'registerModel', recoverable: true, modelId: id }, cause);
      this.options.diagnostic(error); throw error;
    }
    const entry = this.entries.get(id) ?? {};
    const previous = entry.pending;
    const promise = new Promise<void>((resolve, reject) => { entry.pending = { definition: snapshot, resolve, reject }; });
    this.entries.set(id, entry);
    this.cancel(id, previous);
    this.options.changed(id);
    if (!this.destroyed) this.schedule();
    return promise;
  }
  unregister(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.cancel(id, entry.pending);
    entry.ready?.resources.dispose();
    if (!this.destroyed) this.options.changed(id);
  }
  renderer(uploader?: ModelUploader<R>) {
    if (this.destroyed || this.uploader === uploader) return;
    this.uploader = uploader;
    // Detaching a renderer ends its decode attempt, but the registration still waits for a usable one.
    for (const entry of this.entries.values()) this.stop(entry.pending);
    for (const id of [...this.entries.keys()]) {
      if (this.destroyed) return;
      this.options.changed(id);
    }
    this.schedule();
  }
  readinessFailed(error: RidgelineError) {
    if (this.destroyed) return;
    this.failed = error;
    for (const entry of this.entries.values()) this.stop(entry.pending);
    this.schedule();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.uploader = undefined;
    for (const [id, entry] of this.entries) {
      this.cancel(id, entry.pending);
      entry.ready?.resources.dispose();
    }
    this.entries.clear();
  }
  private cancelled(id: string) { return new RidgelineError('MODEL_LOAD_CANCELLED', 'Model registration was cancelled.', { operation: 'registerModel', recoverable: true, modelId: id }); }
  private stop(pending?: Pending) {
    const attempt = pending?.attempt;
    if (pending) pending.attempt = undefined;
    attempt?.abort();
  }
  private cancel(id: string, pending?: Pending) {
    this.stop(pending);
    pending?.reject(this.cancelled(id));
  }
  private schedule() {
    if (this.scheduled || this.destroyed || (!this.uploader && !this.failed)) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this.flush(); });
  }
  private flush() {
    for (const [id, entry] of [...this.entries]) {
      const pending = entry.pending, uploader = this.uploader;
      if (!pending || pending.attempt || (!uploader && !this.failed)) continue;
      const attempt = new AbortController();
      pending.attempt = attempt;
      void this.load(id, entry, pending, attempt, uploader);
    }
  }
  private async load(id: string, entry: Registration<R>, pending: Pending, attempt: AbortController, uploader?: ModelUploader<R>) {
    const current = () => !this.destroyed && this.entries.get(id) === entry && entry.pending === pending &&
      pending.attempt === attempt && this.uploader === uploader && !attempt.signal.aborted;
    let resources: R | undefined;
    try {
      if (this.failed) throw this.failed;
      if (!uploader || !current()) return;
      const model = parseGlb(pending.definition.bytes);
      resources = await uploader.upload(model, current, attempt.signal);
      if (!current()) { resources.dispose(); return; }
      const previous = entry.ready;
      entry.ready = { definition: pending.definition, model, resources };
      resources = undefined;
      entry.pending = undefined;
      entry.failed = false;
      previous?.resources.dispose();
      pending.resolve();
      this.options.changed(id);
    } catch (cause) {
      resources?.dispose();
      if (!current()) return;
      const unsupported = cause instanceof Error && /UNSUPPORTED|ONLY_EXPECTED|VERSION_2_REQUIRED/.test(cause.message);
      const error = new RidgelineError(unsupported ? 'MODEL_UNSUPPORTED' : 'MODEL_LOAD_FAILED',
        `Model registration failed${cause instanceof Error ? ': ' + cause.message : '.'}`, { operation: 'registerModel', recoverable: true, modelId: id }, cause);
      entry.pending = undefined; entry.failed = true;
      pending.reject(error);
      this.options.changed(id);
      if (!this.destroyed && this.entries.get(id) === entry && !entry.pending) this.options.diagnostic(error);
    }
  }
}
