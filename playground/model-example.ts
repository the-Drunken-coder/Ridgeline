import type { MapFeature, ModelAppearance, Viewport } from '@ridgeline/map';
import type { Sample } from './samples';

const catalog = [
  { id: 'drone', name: 'Drone', headingOffset: 0, altitude: 35 },
  { id: 'tank', name: 'Tank', headingOffset: 90 },
  { id: 'plane', name: 'Jet', headingOffset: 0, altitude: 60 },
  { id: 'boat', name: 'Speedboat', headingOffset: 0 },
] as const;
const palette: Record<string, ModelAppearance | undefined> = {
  original: { mode: 'original' }, fallback: undefined,
  teal: { mode: 'color', color: '#168578' }, orange: { mode: 'color', color: '#e47a24' }, indigo: { mode: 'color', color: 'rebeccapurple' },
};
const center: [number, number] = [6.869, 45.925];

/** Fetching, palette choices and sample actions belong to this consumer, not the viewport. */
export function mountModelExample(viewport: Viewport<Sample>, container: HTMLElement) {
  const lifetime = new AbortController(), appearances = new Map<string, string>();
  const previousVisibility = viewport.getConfiguration().entityVisibility;
  let disposed = false, busy = false, failure = '', revision = 0;
  container.innerHTML = `<h2>Entity models</h2><p>Two samples share each model. Hover or select one on the map.</p>
    <label class="setting">Sample<select aria-label="Model sample"><option value="">Choose on map</option></select></label>
    <label class="setting">Appearance<select aria-label="Model appearance"><option value="original">Original</option><option value="fallback">Magenta fallback</option><option value="teal">Teal</option><option value="orange">Orange</option><option value="indigo">Indigo</option></select></label>
    <div class="action-row"><button data-action="near">Models up close</button><button data-action="far">Icons at distance</button></div>
    <label class="setting">Replace with<select aria-label="Replacement model"></select></label>
    <div class="action-row"><button data-action="replace">Replace shared model</button><button data-action="unload">Unload shared model</button><button data-action="load">Load shared model</button><button data-action="remove">Remove sample</button><button data-action="reset">Reset samples</button></div>
    <p role="status" aria-label="Model example status">Loading models…</p><a href="/entity-models/credits.html" target="_blank" rel="noreferrer">Model credits and licenses</a>`;
  const sample = container.querySelector<HTMLSelectElement>('[aria-label="Model sample"]')!;
  const appearance = container.querySelector<HTMLSelectElement>('[aria-label="Model appearance"]')!;
  const replacement = container.querySelector<HTMLSelectElement>('[aria-label="Replacement model"]')!;
  const status = container.querySelector<HTMLElement>('[role="status"]')!;
  for (const asset of catalog) replacement.add(new Option(asset.name, asset.id));
  const samples: MapFeature<Sample>[] = catalog.flatMap((asset, column) => ['original', 'color'].map((mode, row) => ({
    type: 'Feature', id: `model-${asset.id}-${mode}`, geometry: { type: 'Point', coordinates: [center[0] + (column - 1.5) * .0016, center[1] + (row - .5) * .0014] },
    properties: { name: `${asset.name} · ${mode === 'color' ? 'custom' : 'original'}`, kind: asset.name, color: '#216e5b',
      icon: asset.id === 'tank' ? 'truck' : asset.id === 'boat' ? 'supply' : 'survey', label: `${asset.name} · ${mode === 'color' ? 'custom' : 'original'}` },
    entity: { heading: 25, model: { id: `example:${asset.id}` },
      ...('altitude' in asset ? { altitude: { meters: asset.altitude, reference: 'ground' as const }, attachments: mode === 'color' ? [
        { id: 'sensor', type: 'camera' as const, bearing: 90, elevation: -35, fovX: 35, fovY: 25, range: 100,
          color: '#3875aa', volumeOpacity: .1, wireframe: true },
      ] : [] } : { attachments: mode === 'color' ? [{ id: 'physical-area', type: 'circle' as const, radius: 20, color: '#3875aa' }] : [] }),
    },
  })));
  function selected() {
    const id = viewport.getSelection()[0]; return id && samples.some(sample => sample.id === id) ? viewport.getFeature(id) : undefined;
  }
  function render() {
    if (disposed) return;
    const selectedFeature = selected(), id = selectedFeature?.id ?? '';
    sample.replaceChildren(new Option('Choose on map', ''), ...samples.filter(feature => viewport.getFeature(feature.id))
      .map(feature => new Option(feature.properties.name, feature.id)));
    sample.value = id; appearance.value = appearances.get(id) ?? 'original'; appearance.disabled = !id || busy;
    const installed = selectedFeature?.entity?.model && viewport.getEntityState(id)?.model?.status === 'ready';
    for (const button of container.querySelectorAll<HTMLButtonElement>('button')) {
      const action = button.dataset.action;
      button.disabled = busy || (['replace', 'remove', 'unload', 'load'].includes(action ?? '') && !id) ||
        (action === 'unload' && !installed) || (action === 'load' && Boolean(installed));
    }
    const states = samples.flatMap(feature => { const state = viewport.getEntityState(feature.id); return state ? [state] : []; });
    status.textContent = failure || (busy ? 'Loading models…' : `${states.filter(state => state.representation === 'model').length} models · ${states.filter(state => state.representation === 'icon').length} icons`);
  }
  async function load(target: string, asset: typeof catalog[number], owner: number) {
    const response = await fetch(`/entity-models/${asset.id}.glb`, { signal: lifetime.signal });
    if (!response.ok) throw new Error(`Could not load ${asset.name} (${response.status}).`);
    const bytes = await response.arrayBuffer();
    if (!disposed && owner === revision) await viewport.registerModel(target, { bytes, metersPerUnit: 1, headingOffset: asset.headingOffset });
  }
  async function run(work: (owner: number) => Promise<unknown>) {
    if (busy || disposed) return;
    const owner = ++revision;
    busy = true; failure = ''; render();
    try { await work(owner); } catch (error) { if (!disposed && owner === revision) failure = error instanceof Error ? error.message : 'Model could not load.'; }
    finally {
      // A failed reset can leave sibling fetches pending after Promise.all settles.
      if (!disposed && owner === revision) { ++revision; busy = false; render(); }
    }
  }
  function reset() {
    appearances.clear();
    for (const feature of samples) appearances.set(feature.id, feature.id.endsWith('-original') ? 'original' : 'teal');
    void run(async owner => {
      await Promise.all(catalog.map(asset => load(`example:${asset.id}`, asset, owner)));
      if (!disposed && owner === revision) { viewport.upsert(samples); viewport.setSelection(['model-drone-color']); }
    });
  }
  function resetCamera() { viewport.setCamera({ center, zoom: 17, pitch: 50, bearing: -20 }); }
  sample.addEventListener('change', () => viewport.setSelection(sample.value ? [sample.value] : []), { signal: lifetime.signal });
  appearance.addEventListener('change', () => {
    const feature = selected(); if (!feature) return;
    appearances.set(feature.id, appearance.value); viewport.upsert([feature]);
  }, { signal: lifetime.signal });
  for (const button of container.querySelectorAll<HTMLButtonElement>('button')) button.addEventListener('click', () => {
    const feature = selected(), target = feature?.entity?.model?.id;
    switch (button.dataset.action) {
      case 'near': resetCamera(); break;
      case 'far': viewport.setCamera({ center, zoom: 13, pitch: 35, bearing: -20 }); break;
      case 'reset': reset(); break;
      case 'remove': if (feature) { viewport.remove([feature.id]); render(); } break;
      case 'unload': if (target) { viewport.unregisterModel(target); render(); } break;
      case 'load': { const asset = catalog.find(asset => `example:${asset.id}` === target); if (target && asset) void run(owner => load(target, asset, owner)); break; }
      case 'replace': { const asset = catalog.find(asset => asset.id === replacement.value); if (target && asset) void run(owner => load(target, asset, owner)); break; }
    }
  }, { signal: lifetime.signal });
  const offSelection = viewport.on('selectionchange', render), offEntities = viewport.on('entitychange', render);
  viewport.configure({ entityVisibility: { footprints: true, zones: true, groundLines: true } });
  reset();
  return {
    appearance(id: string) { return palette[appearances.get(id) ?? 'fallback']; },
    resetCamera,
    destroy() {
      if (disposed) return;
      disposed = true; ++revision; lifetime.abort(); offSelection(); offEntities();
      for (const asset of catalog) viewport.unregisterModel(`example:${asset.id}`);
      viewport.configure({ entityVisibility: previousVisibility });
      container.replaceChildren();
    },
  };
}
