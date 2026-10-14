import { disposeAll } from './dispose';
import { attachInteractions, attachMapControls, createViewport } from '@ridgeline/map';
import type { MapFeature } from '@ridgeline/map';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@ridgeline/map/style.css';
import { mountDrawing } from './drawing';

setWorkerUrl(workerUrl);
function element<T extends HTMLElement>(selector: string, type: new (...args: never[]) => T): T {
  const value = document.querySelector(selector);
  if (!(value instanceof type)) throw new Error(`Missing ${selector}`);
  return value;
}
const map = element('#map', HTMLDivElement), mode = element('#example', HTMLSelectElement);
const status = element('#status', HTMLSpanElement), selection = element('#selection', HTMLParagraphElement);
const help = element('#help', HTMLElement);
const emptyBasemap = { version: 8 as const, sources: {}, layers: [{ id: 'background', type: 'background' as const, paint: { 'background-color': '#e9efea' } }] };
const offline = new URLSearchParams(location.search).has('offline');
const viewport = createViewport({ container: map, camera: { center: [6.88, 45.925], zoom: 12 },
  ...(offline ? { basemap: emptyBasemap } : {}),
  style: feature => ({ color: '#32624c', radius: 8, lineWidth: 3,
    selected: { color: '#b15624', radius: 11 }, hover: { color: '#24664c', radius: 10 },
    ...(offline ? {} : { label: String(feature.properties.name ?? ''), labelStyle: { size: 14, color: '#243a31', haloColor: '#ffffff', haloWidth: 2 } }) }),
  onError: error => { status.textContent = error.message; },
});
const controls = attachMapControls(viewport, { coordinates: true, fullscreen: false });
const interactions = attachInteractions(viewport, { additiveSelection: true, boxSelection: true });
const sample = (id: string, position: [number, number], name: string): MapFeature => ({ type: 'Feature', id,
  geometry: { type: 'Point', coordinates: position }, properties: { name } });
let active: { destroy(): void } | undefined;
const offSelection = viewport.on('selectionchange', ({ ids }) => {
  selection.textContent = ids.map(id => { const feature = viewport.getFeature(id); return feature ? viewport.getName(feature) : id; }).join(', ') || 'No feature selected';
});
const offRequest = viewport.on('selectionrequest', ({ ids }) => { viewport.setSelection(ids); });
function reset() {
  const previous = active; active = undefined; previous?.destroy();
  viewport.clear(); viewport.setSelection([]);
  viewport.setCamera({ center: [6.88, 45.925], zoom: 12, pitch: 0, bearing: 0 }, { duration: 0 });
  document.body.dataset.mode = mode.value;
  help.hidden = mode.value !== 'selection';
  if (mode.value === 'drawing') {
    active = mountDrawing(viewport, { tools: element('#drawing-tools', HTMLDivElement), inspector: element('#drawing-inspector', HTMLDivElement) }, { status: element('#storage-status', HTMLParagraphElement), reject: element('#reject-save', HTMLInputElement), clear: element('#clear-saved', HTMLButtonElement) });
  } else viewport.upsert([sample('west', [6.87, 45.925], 'West point'), sample('east', [6.89, 45.925], 'East point')]);
  viewport.map.resize();
}
const abort = new AbortController();
mode.addEventListener('change', reset, { signal: abort.signal });
element('#reset', HTMLButtonElement).addEventListener('click', reset, { signal: abort.signal });
element('#clear-selection', HTMLButtonElement).addEventListener('click', () => viewport.setSelection([]), { signal: abort.signal });
void viewport.ready.then(() => { status.textContent = 'Ready'; reset(); }, () => {
  // createViewport's onError already owns the visible readiness failure.
  // Keep reset exceptions outside this rejection handler so they remain visible.
});
window.addEventListener('pagehide', () => {
  const previous = active; active = undefined;
  disposeAll([() => abort.abort(), () => previous?.destroy(), offSelection, offRequest,
    () => interactions.destroy(), () => controls.destroy(), () => viewport.destroy()]);
}, { once: true });
