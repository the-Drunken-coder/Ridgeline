import { explainSidc, renderSymbol, searchSymbols } from 'sidc-kit';
import type { ExplainSidcResult } from 'sidc-kit';
import type { IconDefinition, MapFeature, Viewport } from '@ridgeline/map';
import type { Sample } from './samples';

const samples = [
  { sidc: '130310001412110000000000000000', coordinates: [6.865, 45.923] },
  { sidc: '130310001512110000000000000000', coordinates: [6.873, 45.918] },
  { sidc: '130610001412110000000000000000', coordinates: [6.877, 45.929] },
];

/** Consumer-owned SIDC workflow. Only generic features and icons reach Ridgeline. */
export function mountSidcDemo({ viewport, container, onPlacementChange, onSelectionChange }: {
  viewport: Viewport<Sample>;
  container: HTMLElement;
  onPlacementChange: (active: boolean) => void;
  onSelectionChange: () => void;
}) {
  container.innerHTML = `
    <label for="sidc-search">Search symbols</label>
    <input id="sidc-search" type="search" value="infantry" placeholder="Try friendly infantry" autocomplete="off" disabled>
    <div id="sidc-results" aria-live="polite"></div>
    <section class="sidc-preview" aria-label="Symbol preview" hidden>
      <h2>Symbol preview</h2><div id="sidc-preview-name" class="sidc-symbol-name"></div>
      <code id="sidc-preview-code"></code><p id="sidc-preview-status" role="status"></p>
      <button id="sidc-retry" hidden>Retry preview</button>
      <button id="sidc-place" class="sidc-primary" disabled>Place on map</button>
    </section>
    <div id="sidc-placement" role="status" hidden><p>Click the map to place one symbol.</p><button id="sidc-cancel">Cancel · Esc</button></div>
    <section class="sidc-inspector" aria-label="Selected symbol"><h2>Selected on map</h2><div id="sidc-inspection" aria-live="polite"></div></section>
    <p id="sidc-status" role="status">Loading sample symbols…</p>
    <button id="sidc-reset" disabled>Reset demo</button>`;
  const search = container.querySelector<HTMLInputElement>('#sidc-search')!;
  const results = container.querySelector<HTMLDivElement>('#sidc-results')!;
  const preview = container.querySelector<HTMLElement>('.sidc-preview')!;
  const previewName = container.querySelector<HTMLDivElement>('#sidc-preview-name')!;
  const previewCode = container.querySelector<HTMLElement>('#sidc-preview-code')!;
  const previewStatus = container.querySelector<HTMLParagraphElement>('#sidc-preview-status')!;
  const retry = container.querySelector<HTMLButtonElement>('#sidc-retry')!;
  const place = container.querySelector<HTMLButtonElement>('#sidc-place')!;
  const placement = container.querySelector<HTMLDivElement>('#sidc-placement')!;
  const inspection = container.querySelector<HTMLDivElement>('#sidc-inspection')!;
  const status = container.querySelector<HTMLParagraphElement>('#sidc-status')!;
  const resetButton = container.querySelector<HTMLButtonElement>('#sidc-reset')!;
  const lifetime = new AbortController();
  const placed = new Map<string, string>();
  const icons = new Map<string, Promise<IconDefinition>>();
  let choice: ExplainSidcResult | undefined;
  let prepared = false;
  let armed = false;
  let disposed = false;
  let previewRevision = 0;
  let resetRevision = 0;
  let nextId = 0;

  function iconId(sidc: string) { return `sidc-demo:${sidc}`; }
  function iconImage(url: string) {
    const image = new Image(); image.src = url; image.alt = ''; image.className = 'sidc-symbol';
    return image;
  }
  function svgUrl(sidc: string) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSymbol(sidc, { size: 64 }).svg)}`;
  }
  function prepareIcon(sidc: string): Promise<IconDefinition> {
    const existing = viewport.getIcon(iconId(sidc));
    if (existing) return Promise.resolve(existing);
    const pending = icons.get(sidc);
    if (pending) return pending;
    const promise = (async () => {
      const url = svgUrl(sidc);
      const image = new Image(); image.src = url;
      await image.decode();
      const definition = { image, url, pixelRatio: 2 };
      if (!disposed) viewport.registerIcon(iconId(sidc), definition);
      return definition;
    })().catch(error => { icons.delete(sidc); throw error; });
    icons.set(sidc, promise);
    return promise;
  }
  function cancelPlacement() {
    if (armed) onPlacementChange(false);
    armed = false; placement.hidden = true;
    place.disabled = !prepared; place.textContent = 'Place on map';
  }
  async function choose(symbol: ExplainSidcResult) {
    const revision = ++previewRevision;
    cancelPlacement(); choice = symbol; prepared = false;
    preview.hidden = false; place.disabled = true; retry.hidden = true;
    previewName.textContent = symbol.name; previewCode.textContent = symbol.sidc;
    previewStatus.textContent = 'Rendering symbol…';
    for (const button of results.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.sidc === symbol.sidc));
    try {
      const icon = await prepareIcon(symbol.sidc);
      if (disposed || revision !== previewRevision) return;
      if (icon.url) previewName.prepend(iconImage(icon.url));
      previewStatus.textContent = 'Curated match'; prepared = true; place.disabled = false;
    } catch {
      if (disposed || revision !== previewRevision) return;
      previewStatus.textContent = 'This symbol could not be rendered. Choose another result or retry.';
      retry.hidden = false;
    }
  }
  function updateSearch() {
    ++previewRevision; cancelPlacement(); choice = undefined; prepared = false;
    preview.hidden = true; place.disabled = true; results.replaceChildren();
    const matches = searchSymbols(search.value, { limit: 8 });
    for (const symbol of matches) {
      const button = document.createElement('button'); button.className = 'sidc-result'; button.dataset.sidc = symbol.sidc;
      const name = document.createElement('span'); name.textContent = symbol.name;
      // A failed thumbnail must not hide the result or prevent retrying its preview.
      try { button.append(iconImage(svgUrl(symbol.sidc))); } catch { /* The preview reports render errors. */ }
      button.append(name); button.onclick = () => { void choose(symbol); };
      results.append(button);
    }
    if (matches[0]) void choose(matches[0]);
    else results.textContent = search.value.trim() ? 'No matching symbols. Try infantry or armor.' : 'Enter a symbol name to search the curated set.';
  }
  function feature(symbol: ExplainSidcResult, coordinates: number[]): MapFeature<Sample> {
    const id = `sidc-demo-${nextId++}`;
    placed.set(id, symbol.sidc);
    return { type: 'Feature', id, geometry: { type: 'Point', coordinates }, properties: {
      name: symbol.name, kind: 'SIDC symbol', color: '#24664c', icon: iconId(symbol.sidc), label: symbol.name,
    } };
  }
  function renderSelection() {
    inspection.replaceChildren();
    const id = viewport.getSelection()[0];
    const sidc = id && placed.get(id);
    if (!sidc) { inspection.textContent = 'No symbol selected. Select one on the map to inspect it.'; return; }
    const symbol = explainSidc(sidc);
    const title = document.createElement('div'); title.className = 'sidc-symbol-name';
    const icon = viewport.getIcon(iconId(sidc));
    if (icon?.url) title.append(iconImage(icon.url));
    title.append(document.createTextNode(symbol.name));
    const code = document.createElement('code'); code.textContent = sidc;
    const fields = document.createElement('dl');
    const parts = { ...symbol.parts, coverage: symbol.coverage };
    const labels = { standard: 'Standard', symbolSet: 'Symbol set', affiliation: 'Affiliation', status: 'Status', domain: 'Domain', entity: 'Entity', entityType: 'Entity type', entitySubtype: 'Subtype', echelon: 'Echelon', coverage: 'Coverage' };
    for (const key of Object.keys(labels) as (keyof typeof labels)[]) {
      const value = parts[key];
      if (!value) continue;
      const term = document.createElement('dt'); term.textContent = labels[key];
      const detail = document.createElement('dd'); detail.textContent = value;
      fields.append(term, detail);
    }
    const remove = document.createElement('button'); remove.textContent = 'Remove selected';
    remove.onclick = () => {
      cancelPlacement(); placed.delete(id); viewport.remove([id]);
      onSelectionChange(); renderSelection();
      status.textContent = placed.size ? `${placed.size} demo symbols.` : 'No symbols on the map. Place a symbol or reset the demo.';
    };
    inspection.append(title, code, fields, remove);
  }
  async function reset() {
    const revision = ++resetRevision; ++previewRevision;
    cancelPlacement(); choice = undefined; prepared = false; preview.hidden = true; results.replaceChildren();
    search.disabled = true; resetButton.disabled = true;
    placed.clear(); viewport.clear(); viewport.setSelection([]); onSelectionChange(); renderSelection();
    status.textContent = 'Loading sample symbols…';
    try {
      await Promise.all(samples.map(sample => prepareIcon(sample.sidc)));
      if (disposed || revision !== resetRevision) return;
      const initial = samples.map(sample => feature(explainSidc(sample.sidc), sample.coordinates));
      viewport.upsert(initial); viewport.setSelection(initial[0] ? [initial[0].id] : []);
      onSelectionChange(); renderSelection(); status.textContent = '3 sample symbols. Changes reset when this scenario is reopened.';
    } catch {
      if (disposed || revision !== resetRevision) return;
      status.textContent = 'Sample symbols could not load. Use Reset demo to retry, or search for another symbol.';
    }
    if (disposed || revision !== resetRevision) return;
    search.disabled = false; resetButton.disabled = false; search.value = 'infantry'; updateSearch();
  }
  search.addEventListener('input', updateSearch, { signal: lifetime.signal });
  retry.addEventListener('click', () => { if (choice) void choose(choice); }, { signal: lifetime.signal });
  place.addEventListener('click', () => {
    if (!choice || !prepared) return;
    armed = true; placement.hidden = false; place.disabled = true; place.textContent = 'Choose a map location';
    onPlacementChange(true); viewport.map.getCanvas().focus({ preventScroll: true });
  }, { signal: lifetime.signal });
  container.querySelector('#sidc-cancel')!.addEventListener('click', cancelPlacement, { signal: lifetime.signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && armed) { event.preventDefault(); cancelPlacement(); place.focus(); }
  }, { signal: lifetime.signal });
  resetButton.addEventListener('click', () => { void reset(); }, { signal: lifetime.signal });
  const unsubscribe = viewport.on('click', event => {
    if (!armed || !choice || !prepared) return;
    const longitude = ((event.lngLat.lng + 180) % 360 + 360) % 360 - 180;
    const added = feature(choice, [longitude, event.lngLat.lat]);
    viewport.upsert([added]); viewport.setSelection([added.id]);
    cancelPlacement(); onSelectionChange(); renderSelection(); status.textContent = `${placed.size} demo symbols.`;
  });
  void reset();
  return {
    renderSelection,
    destroy() { disposed = true; ++previewRevision; ++resetRevision; cancelPlacement(); lifetime.abort(); unsubscribe(); container.replaceChildren(); },
  };
}
