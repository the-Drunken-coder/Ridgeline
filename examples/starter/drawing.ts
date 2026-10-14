import { disposeAll } from './dispose';
import { attachDrawing, attachDrawingControls } from '@ridgeline/map';
import type { MapFeature, Viewport } from '@ridgeline/map';

const storageKey = 'ridgeline-starter-drawings-v1';

/** The consumer owns stored features and atomically compares the original before accepting an edit. */
export function mountDrawing(viewport: Viewport, containers: { tools: HTMLElement; inspector: HTMLElement }, storage: { status: HTMLElement; reject: HTMLInputElement; clear: HTMLButtonElement }) {
  const saved = new Map<string, MapFeature>(viewport.getFeatures().map(feature => [feature.id, feature]));
  let restoreFailure: string | undefined;
  try {
    const serialized = localStorage.getItem(storageKey);
    if (serialized !== null) {
      const restored: unknown = JSON.parse(serialized);
      if (!Array.isArray(restored)) throw new Error('Stored drawings must be an array.');
      // The viewport validates the entire batch, including geometry and drawing metadata,
      // before accepting any feature. JSON itself cannot establish these TypeScript types.
      viewport.upsert(restored);
      for (const feature of viewport.getFeatures()) saved.set(feature.id, feature);
    }
    storage.status.textContent = saved.size ? `Restored ${saved.size} drawing(s).` : 'No saved drawings.';
  } catch (cause) {
    restoreFailure = cause instanceof Error ? cause.message : String(cause);
    storage.status.textContent = `Restore failed: ${restoreFailure}. Saved data is protected until you clear it.`;
  }
  storage.clear.hidden = restoreFailure === undefined;
  let nextId = 0;
  let acceptedId: string | undefined;
  const editor = attachDrawing(viewport, {
    createFeature: () => {
      while (saved.has(`drawing-${nextId}`)) nextId++;
      return { id: `drawing-${nextId++}`, properties: { name: 'Drawing' } };
    },
    submit: change => {
      // An incomplete working map must never replace data that failed restoration.
      if (restoreFailure !== undefined) {
        storage.status.textContent = 'Save rejected. Unreadable saved data is protected until you clear it.';
        return { accepted: false, reason: 'Restore failed. Clear the unreadable saved drawings before saving.' };
      }
      const feature = change.before ?? change.after;
      if (!feature) return { accepted: false, reason: 'No drawing was supplied.' };
      const current = saved.get(feature.id);
      if (JSON.stringify(current) !== JSON.stringify(change.before))
        return { accepted: false, reason: 'The stored feature changed. Reload before saving.' };
      if (storage.reject.checked) {
        storage.reject.checked = false;
        storage.status.textContent = 'Save rejected. Retry Finish to save the retained draft.';
        return { accepted: false, reason: 'Example storage rejected this save. Retry Finish.' };
      }
      const next = new Map(saved);
      // Preserve the drawing foreign member together with ordinary geometry.
      if (change.after) next.set(feature.id, structuredClone(change.after));
      else next.delete(feature.id);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next.values()]));
      } catch (cause) {
        storage.status.textContent = 'Storage unavailable. Free browser storage and retry Finish.';
        return { accepted: false, reason: cause instanceof Error ? cause.message : 'Browser storage failed.' };
      }
      saved.clear();
      for (const [id, value] of next) saved.set(id, value);
      storage.status.textContent = `Saved ${saved.size} drawing(s).`;
      acceptedId = change.after?.id;
      return { accepted: true };
    },
    snapping: { vertices: true, edges: true },
  });
  const clearSaved = () => {
    if (restoreFailure === undefined) return;
    try {
      localStorage.removeItem(storageKey);
      restoreFailure = undefined;
      storage.clear.hidden = true;
      storage.status.textContent = 'Unreadable saved drawings cleared. You can save the retained draft.';
    } catch (cause) {
      storage.status.textContent = `Clearing failed: ${cause instanceof Error ? cause.message : String(cause)}. Saved data remains protected.`;
    }
  };
  storage.clear.addEventListener('click', clearSaved);
  // Selection is application policy, applied only when the accepted feature reaches the viewport.
  const off = viewport.on('datachange', ({ ids }) => {
    if (acceptedId && ids.includes(acceptedId)) {
      const id = acceptedId; acceptedId = undefined; viewport.setSelection([id]);
    }
  });
  try {
    const controls = attachDrawingControls(viewport, editor, containers);
    let destroyed = false;
    return { editor, saved, destroy() {
      if (destroyed) return;
      destroyed = true;
      disposeAll([() => storage.clear.removeEventListener('click', clearSaved),
        () => controls.destroy(), () => editor.destroy(), off]);
    } };
  } catch (cause) {
    try { disposeAll([() => storage.clear.removeEventListener('click', clearSaved), off, () => editor.destroy()]); }
    catch (cleanupFailure) { throw new AggregateError([cause, cleanupFailure], 'Drawing initialization and cleanup failed.'); }
    throw cause;
  }
}
