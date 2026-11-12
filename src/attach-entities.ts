import { ModelMeasurement } from './model-measurement';
import { ModelLabels } from './model-labels';
import { ModelVisibility } from './model-visibility';
import { ModelRegistry } from './models';
import type { ModelGpu } from './model-renderer';
import { EntityScene } from './entities';
import { RidgelineError } from './errors';
import { getViewportAttachmentInternals } from './viewport-attachments';
import type { EntityInstallHooks, EntityRuntime } from './entity-runtime';
import type { Properties, Viewport } from './types';

const attached = new WeakSet<object>();
const CUSTOM_LAYERS = ['rl:camera-gpu', 'rl:entities', 'rl:models', 'rl:model-feedback'] as const;

function createAttachedRuntime<P extends Properties>(hooks: EntityInstallHooks<P>): EntityRuntime<P> {
  const map = hooks.map;
  const modelVisibility = new ModelVisibility(map);
  const modelLabels = new ModelLabels(map, ids => hooks.updatePublication(hooks.featuresFor(ids)));
  const measurement = new ModelMeasurement(map.getCanvas());
  const models = new ModelRegistry<ModelGpu>({
    measurement,
    diagnostic: hooks.diagnostic,
    changed: id => entities.modelsChanged(id),
  });
  const entities = new EntityScene<P>({
    measurement,
    models,
    map,
    publishCameraStyle: hooks.publishCameraStyle,
    configuration: hooks.configuration,
    style: hooks.getStyle,
    sampler: hooks.sampler,
    diagnostic: hooks.diagnostic,
    contextLost: () => hooks.onContextLost(),
    contextRestored: () => hooks.onContextRestored(),
    beginNativeFrame: hooks.beginNativeFrame,
    nativeAvailable: hooks.nativeAvailable,
    commitPresentation: (records, current) => modelLabels.commit(records, current),
    commitVisibility: (hidden, current) => modelVisibility.commit(hidden, current),
    representationChanged: ids => { if (!hooks.isDestroyed()) hooks.emitEntityChange(ids); },
    changed: ids => {
      hooks.updatePublication(hooks.featuresFor(ids));
      for (const id of ids) {
        if (hooks.isDestroyed()) return;
        hooks.synchronizeState(id);
      }
      if (!hooks.isDestroyed()) hooks.emitEntityChange(ids);
    },
  });
  return {
    attached: true,
    marker: feature => entities.marker(feature),
    labelProperties: (id, style) => modelLabels.properties(id, style),
    acceptsLabelHit: (id, stamp) => modelLabels.acceptsHit(id, stamp),
    pickAbove: (x, y, tolerance) => entities.pickAbove(x, y, tolerance),
    pickGround: (x, y, tolerance) => entities.pickGround(x, y, tolerance),
    query: rectangle => entities.query(rectangle),
    getState: id => entities.getState(id),
    validateFeature() {},
    accepted: count => { measurement.accepted(count); },
    set: (features, removed) => entities.set(features, removed),
    retry: () => entities.retry(),
    selection: ids => entities.selection(ids),
    preview: id => entities.preview(id),
    configure: reset => entities.configure(reset),
    attach: () => entities.attach(),
    destroy() {
      let failed = false;
      let failure: unknown;
      for (const dispose of [() => entities.destroy(), () => models.destroy(), () => modelLabels.destroy(), () => measurement.destroy()]) {
        try { dispose(); }
        catch (cause) { if (!failed) { failed = true; failure = cause; } }
      }
      if (failed) throw failure;
    },
    contextLost: () => entities.contextLost(),
    readinessFailed: error => {
      if (error instanceof RidgelineError) models.readinessFailed(error);
    },
    registerModel: (id, definition) => models.register(id, definition),
    unregisterModel: id => models.unregister(id),
    invalidatePresentation() {
      modelVisibility.invalidate();
      modelLabels.invalidate();
    },
    collectCustomLayers(target) {
      const found = [];
      for (const id of CUSTOM_LAYERS) {
        const layer = target.getLayer(id);
        if (layer) found.push(layer);
      }
      return found;
    },
  };
}

/** Opt-in models and GPU camera coverage for a viewport created by createViewport. */
export function attachEntities<P extends Properties>(viewport: Viewport<P>) {
  if (attached.has(viewport.map))
    throw new Error('Entities are already attached to this viewport.');
  const internals = getViewportAttachmentInternals(viewport);
  if (!internals)
    throw new Error('Entities require a viewport created by createViewport.');
  internals.installEntities(createAttachedRuntime);
  attached.add(viewport.map);
}

