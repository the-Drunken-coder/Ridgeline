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
export type ModelUploader<R extends ModelResources> = { upload(model: ParsedModel, current: () => boolean): R };
type Pending = { definition: ReturnType<typeof modelDefinition>; resolve(): void; reject(error: RidgelineError): void };
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
    entry.pending?.reject(this.cancelled(id));
    const promise = new Promise<void>((resolve, reject) => { entry.pending = { definition: snapshot, resolve, reject }; });
    this.entries.set(id, entry);
    this.options.changed(id);
    if (!this.destroyed) this.schedule();
    return promise;
  }
  unregister(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    entry.pending?.reject(this.cancelled(id));
    entry.ready?.resources.dispose();
    if (!this.destroyed) this.options.changed(id);
  }
  renderer(uploader?: ModelUploader<R>) {
    if (this.destroyed || this.uploader === uploader) return;
    this.uploader = uploader;
    for (const id of [...this.entries.keys()]) {
      if (this.destroyed) return;
      this.options.changed(id);
    }
    this.schedule();
  }
  readinessFailed(error: RidgelineError) {
    if (this.destroyed) return;
    this.failed = error;
    this.schedule();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.uploader = undefined;
    for (const [id, entry] of this.entries) {
      entry.pending?.reject(this.cancelled(id));
      entry.ready?.resources.dispose();
    }
    this.entries.clear();
  }
  private cancelled(id: string) { return new RidgelineError('MODEL_LOAD_CANCELLED', 'Model registration was cancelled.', { operation: 'registerModel', recoverable: true, modelId: id }); }
  private schedule() {
    if (this.scheduled || this.destroyed || (!this.uploader && !this.failed)) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this.flush(); });
  }
  private flush() {
    for (const [id, entry] of [...this.entries]) {
      const pending = entry.pending, uploader = this.uploader;
      if (!pending || (!uploader && !this.failed)) continue;
      const current = () => !this.destroyed && this.entries.get(id) === entry && entry.pending === pending;
      if (!current()) continue;
      let resources: R | undefined;
      try {
        if (this.failed) throw this.failed;
        if (!uploader) continue;
        const model = parseGlb(pending.definition.bytes);
        resources = uploader.upload(model, () => current() && this.uploader === uploader);
        if (!current() || this.uploader !== uploader) { resources.dispose(); continue; }
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
        if (!current()) continue;
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
}
