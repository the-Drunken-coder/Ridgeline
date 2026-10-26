import { attachInteractions, attachMapControls, createViewport, DEFAULT_ELEVATION } from '@ridgeline/map';
import type { MapFeature, RidgelineError } from '@ridgeline/map';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@ridgeline/map/style.css';
import './style.css';
import { registerSampleIcons } from './samples';
import type { Sample } from './samples';
import { element } from './dom';
import { defaultCamera, mountScenario, scenarioId } from './scenarios';
import type { ActiveScenario } from './scenarios';

setWorkerUrl(workerUrl);

const mapContainer = element('#map', HTMLDivElement);
const scenario = element('#scenario', HTMLSelectElement);
scenario.add(new Option('Entity models', 'models'));
const modelContainer = document.createElement('section'); modelContainer.id = 'model-example'; modelContainer.hidden = true;
element('#selection', HTMLElement).after(modelContainer);
const terrain = element('#terrain', HTMLInputElement);
const hillshade = element('#hillshade', HTMLInputElement);
const projection = element('#projection', HTMLSelectElement);
const pitch = element('#pitch', HTMLInputElement);
const notice = element('#notice', HTMLDivElement);
const diagnostics = element('#diagnostics', HTMLDivElement);
const lastEvent = element('#last-event', HTMLParagraphElement);
const mapStatus = element('#map-status', HTMLSpanElement);
const selectionName = element('#selected-name', HTMLDivElement);
const locateButton = element('#locate', HTMLButtonElement);
const clearButton = element('#clear-selection', HTMLButtonElement);
const groupSelection = element('#group-selection', HTMLInputElement);
const lifetime = new AbortController();
let activeScenario: ActiveScenario | undefined;
let disposed = false;
let placingSymbol = false;

function showError(error: RidgelineError) {
  diagnostics.hidden = false;
  if (error.context.operation === 'create') notice.textContent = 'The map could not start. See the diagnostic for details.';
  element('#error-title', HTMLElement).textContent = error.context.recoverable ? 'Map resource unavailable' : 'Map could not start';
  element('#error-message', HTMLParagraphElement).textContent = error.message;
  element('#error-code', HTMLElement).textContent = `${error.code} · ${error.context.operation}`;
  element('#retry-elevation', HTMLButtonElement).hidden = error.code !== 'ELEVATION_UNAVAILABLE';
  mapStatus.textContent = error.context.recoverable ? 'Map available with a resource error' : 'Initialization failed';
}
const viewport = createViewport<Sample>({
  container: mapContainer, terrain: true, hillshade: true,
  camera: defaultCamera,
  style: feature => ({ color: feature.properties.color, icon: feature.properties.icon, label: feature.properties.label, radius: feature.properties.icon ? 7 : 4,
    selected: { color: '#b15624', radius: 9, lineWidth: 4 },
    hover: { color: '#24664c', radius: 7 },
    modelAppearance: activeScenario?.appearance?.(feature.id) }),
  onError: showError,
});
const mapControls = attachMapControls(viewport, { coordinates: { format: 'ddm' } });
registerSampleIcons(viewport);

function renderSelection() {
  const ids = viewport.getSelection();
  const id = ids[0];
  const feature = id ? viewport.getFeature(id) : undefined;
  selectionName.replaceChildren();
  if (ids.length > 1) {
    selectionName.textContent = `${ids.length} selected`;
    const names = document.createElement('ul');
    names.className = 'selected-list';
    for (const selectedId of ids) {
      const item = viewport.getFeature(selectedId);
      if (!item) continue;
      const row = document.createElement('li'); row.textContent = viewport.getName(item); names.append(row);
    }
    selectionName.append(names);
  } else if (feature) {
    const icon = feature.properties.icon ? viewport.getIcon(feature.properties.icon) : undefined;
    if (icon?.url) { const image = document.createElement('img'); image.src = icon.url; image.alt = ''; selectionName.append(image); }
    selectionName.append(document.createTextNode(viewport.getName(feature)));
  } else selectionName.textContent = 'No feature selected';
  element('#selected-id', HTMLElement).textContent = ids.length > 1 ? ids.join(', ') : feature?.id ?? 'None';
  element('#selected-type', HTMLElement).textContent = ids.length > 1 ? 'Group' : feature?.properties.kind ?? 'None';
  locateButton.disabled = !feature; clearButton.disabled = !feature;
}
const offSelection = viewport.on('selectionchange', renderSelection);
function locate(feature: MapFeature<Sample>) {
  if (feature.geometry.type === 'Point') {
    const [lng, lat] = feature.geometry.coordinates;
    if (lng !== undefined && lat !== undefined) viewport.setCamera({ center: [lng, lat], zoom: Math.max(15, viewport.map.getZoom()) });
  } else {
    const positions = feature.geometry.type === 'LineString' ? feature.geometry.coordinates : feature.geometry.coordinates.flat();
    const lngs = positions.map(point => point[0]!), lats = positions.map(point => point[1]!);
    viewport.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]]);
  }
}
function locateSelection() {
  const features = viewport.getSelection().flatMap(id => { const feature = viewport.getFeature(id); return feature ? [feature] : []; });
  if (features.length === 1) { locate(features[0]!); return; }
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  const center = viewport.map.getCenter().lng;
  for (const feature of features) {
    const positions = feature.geometry.type === 'Point' ? [feature.geometry.coordinates]
      : feature.geometry.type === 'LineString' ? feature.geometry.coordinates : feature.geometry.coordinates.flat();
    for (const position of positions) {
      const longitude = position[0]! + Math.round((center - position[0]!) / 360) * 360;
      west = Math.min(west, longitude); east = Math.max(east, longitude);
      south = Math.min(south, position[1]!); north = Math.max(north, position[1]!);
    }
  }
  if (Number.isFinite(west)) viewport.fitBounds([[west, south], [east, north]]);
}
function createInteractions() { return attachInteractions(viewport, {
  additiveSelection: groupSelection.checked,
  boxSelection: groupSelection.checked,
  contextMenu: (event, close) => {
    const feature = event.features[0];
    if (!feature) return null;
    const menu = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = viewport.getName(feature); menu.append(name);
    for (const [label, action] of [
      ['Locate on map', () => locate(feature)],
      ['Select feature', () => { viewport.setSelection([feature.id]); renderSelection(); }],
    ] as const) {
      const button = document.createElement('button'); button.textContent = label;
      button.onclick = () => { action(); close(); lastEvent.textContent = `${label} · ${viewport.getName(feature)}`; };
      menu.append(button);
    }
    return menu;
  },
}); }
let interactions: ReturnType<typeof attachInteractions> | undefined = createInteractions();
function setSymbolPlacement(active: boolean) {
  placingSymbol = active;
  mapContainer.classList.toggle('placing-symbol', active);
  if (active) { interactions?.destroy(); interactions = undefined; }
  // Reattach after the placement click finishes dispatching so it cannot also select.
  else queueMicrotask(() => { if (!disposed && !placingSymbol && !interactions) interactions = createInteractions(); });
}
viewport.on('selectionrequest', ({ ids }) => { viewport.setSelection(ids); renderSelection(); lastEvent.textContent = ids.length > 1 ? `${ids.length} features selected` : ids[0] ? `Selected ${viewport.getName(viewport.getFeature(ids[0])!)}` : 'Selection cleared'; });
viewport.on('click', event => {
  const attachment = event.attachments[0];
  if (attachment) lastEvent.textContent = `${attachment.entityId} · ${attachment.attachmentId}`;
  else if (event.features.length > 1) lastEvent.textContent = `${event.features.length} candidates at this location`;
});
const featureIds = new Set<string>();
viewport.on('datachange', ({ ids, removed }) => {
  for (const id of ids) featureIds.add(id);
  for (const id of removed) featureIds.delete(id);
  element('#feature-count', HTMLParagraphElement).textContent = `${featureIds.size.toLocaleString()} ${featureIds.size === 1 ? 'feature' : 'features'}`;
  if (removed.length) renderSelection();
});
viewport.on('camerachange', camera => { pitch.value = String(Math.round(camera.pitch ?? 0)); });
viewport.map.on('idle', () => { if (mapStatus.textContent === 'Retrying elevation' && diagnostics.hidden) mapStatus.textContent = 'Ready'; });

function resetCamera() { activeScenario?.resetCamera(); }
function loadScenario() {
  if (disposed) return;
  activeScenario?.destroy(); activeScenario = undefined;
  activeScenario = mountScenario(scenarioId(scenario.value), {
    viewport, modelContainer, onPlacementChange: setSymbolPlacement, onSelectionChange: renderSelection, reload: loadScenario,
  });
  renderHint();
  resetCamera(); lastEvent.textContent = scenario.selectedOptions[0]?.textContent ?? 'Scenario changed';
  mapStatus.textContent = 'Ready';
}
function listen(element: HTMLElement, type: string, action: () => void) { element.addEventListener(type, action, { signal: lifetime.signal }); }
function renderHint() {
  element('#interaction-hint', HTMLSpanElement).textContent = scenario.value === 'drawing'
    ? 'Snap to vertices or edges · Alt bypasses snapping · Finish completes touch drawing'
    : groupSelection.checked ? 'Shift-click toggles selection · Alt-drag selects a group · Alt-Shift-drag adds'
    : 'Click to select · hover for a name · right-click for actions';
}
listen(groupSelection, 'change', () => {
  interactions?.destroy(); interactions = undefined;
  if (!placingSymbol) interactions = createInteractions();
  renderHint();
});
listen(scenario, 'change', loadScenario);
listen(terrain, 'change', () => viewport.configure({ terrain: terrain.checked }));
listen(hillshade, 'change', () => viewport.configure({ hillshade: hillshade.checked }));
listen(projection, 'change', () => viewport.configure({ projection: projection.value === 'globe' ? 'globe' : 'flat' }));
listen(element('#basemap', HTMLSelectElement), 'change', () => viewport.configure({ basemap: `https://tiles.openfreemap.org/styles/${element('#basemap', HTMLSelectElement).value}` }));
listen(pitch, 'input', () => viewport.setCamera({ pitch: Number(pitch.value) }));
listen(element('#reset-camera', HTMLButtonElement), 'click', resetCamera);
listen(element('#show-all', HTMLButtonElement), 'click', resetCamera);
listen(clearButton, 'click', () => { viewport.setSelection([]); renderSelection(); });
listen(locateButton, 'click', locateSelection);
listen(element('#dismiss-error', HTMLButtonElement), 'click', () => { diagnostics.hidden = true; });
listen(element('#retry-elevation', HTMLButtonElement), 'click', () => { viewport.configure({ elevation: DEFAULT_ELEVATION }); diagnostics.hidden = true; mapStatus.textContent = 'Retrying elevation'; });
const initialScenario = new URLSearchParams(location.search).get('scenario');
if (initialScenario && [...scenario.options].some(option => option.value === initialScenario)) scenario.value = initialScenario;
void viewport.ready.then(loadScenario).catch(error => { notice.textContent = 'The map could not start. See the diagnostic for details.'; if (error instanceof Error) console.error(error); });
function dispose() { if (disposed) return; disposed = true; offSelection(); activeScenario?.destroy(); activeScenario = undefined; interactions?.destroy(); mapControls.destroy(); lifetime.abort(); viewport.destroy(); }
window.addEventListener('pagehide', dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
