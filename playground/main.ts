import { attachInteractions, createViewport, DEFAULT_ELEVATION } from '@ridgeline/map';
import type { MapFeature, RidgelineError } from '@ridgeline/map';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@ridgeline/map/style.css';
import './style.css';
import { groups, movingFeatures, overlapFeatures, registerSampleIcons, terrainFeatures } from './samples';
import type { Sample } from './samples';

setWorkerUrl(workerUrl);

function element<T extends HTMLElement>(selector: string, type: new (...args: never[]) => T): T {
  const result = document.querySelector(selector);
  if (!(result instanceof type)) throw new Error(`Missing ${selector}`);
  return result;
}
const mapContainer = element('#map', HTMLDivElement);
const scenario = element('#scenario', HTMLSelectElement);
const terrain = element('#terrain', HTMLInputElement);
const hillshade = element('#hillshade', HTMLInputElement);
const projection = element('#projection', HTMLSelectElement);
const pitch = element('#pitch', HTMLInputElement);
const notice = element('#notice', HTMLDivElement);
const diagnostics = element('#diagnostics', HTMLDivElement);
const lastEvent = element('#last-event', HTMLParagraphElement);
const mapStatus = element('#map-status', HTMLSpanElement);
const selectionName = element('#selected-name', HTMLDivElement);
const measurement = element('#measurement', HTMLOutputElement);
const measureButton = element('#measure', HTMLButtonElement);
const pauseButton = element('#pause', HTMLButtonElement);
const locateButton = element('#locate', HTMLButtonElement);
const clearButton = element('#clear-selection', HTMLButtonElement);
const lifetime = new AbortController();
let currentScenario = 'terrain';
let failingElevation = false;
let motionTimer: ReturnType<typeof setInterval> | undefined;
let tick = 0;
let paused = false;
let benchmarkFrame = 0;
let measuring = false;
let renderedFrames = 0;
const updateCosts: number[] = [];
let sidcDemo: ReturnType<typeof import('./sidc-demo').mountSidcDemo> | undefined;
let scenarioRevision = 0;
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
  camera: { center: [6.88, 45.92], zoom: 12.5, pitch: 55, bearing: -20 },
  style: feature => ({ color: feature.properties.color, icon: feature.properties.icon, label: feature.properties.label, radius: feature.properties.icon ? 7 : 4 }),
  onError: showError,
});
registerSampleIcons(viewport);
viewport.map.on('render', () => { if (measuring) renderedFrames++; });

function renderSelection() {
  sidcDemo?.renderSelection();
  const id = viewport.getSelection()[0];
  const feature = id ? viewport.getFeature(id) : undefined;
  selectionName.replaceChildren();
  if (feature) {
    const icon = feature.properties.icon ? viewport.getIcon(feature.properties.icon) : undefined;
    if (icon?.url) { const image = document.createElement('img'); image.src = icon.url; image.alt = ''; selectionName.append(image); }
    selectionName.append(document.createTextNode(viewport.getName(feature)));
  } else selectionName.textContent = 'No feature selected';
  element('#selected-id', HTMLElement).textContent = feature?.id ?? 'None';
  element('#selected-type', HTMLElement).textContent = feature?.properties.kind ?? 'None';
  locateButton.disabled = !feature; clearButton.disabled = !feature;
}
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
function createInteractions() { return attachInteractions(viewport, {
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
viewport.on('selectionrequest', ({ ids }) => { viewport.setSelection(ids); renderSelection(); lastEvent.textContent = ids[0] ? `Selected ${viewport.getName(viewport.getFeature(ids[0])!)}` : 'Selection cleared'; });
viewport.on('click', event => { if (event.features.length > 1) lastEvent.textContent = `${event.features.length} candidates at this location`; });
const featureIds = new Set<string>();
viewport.on('datachange', ({ ids, removed }) => {
  for (const id of ids) featureIds.add(id);
  for (const id of removed) featureIds.delete(id);
  element('#feature-count', HTMLParagraphElement).textContent = `${featureIds.size.toLocaleString()} features`;
  if (removed.length) renderSelection();
});
viewport.on('camerachange', camera => { pitch.value = String(Math.round(camera.pitch ?? 0)); });
viewport.map.on('idle', () => { if (mapStatus.textContent === 'Retrying elevation' && diagnostics.hidden) mapStatus.textContent = 'Ready'; });

function stopBenchmark() { measuring = false; cancelAnimationFrame(benchmarkFrame); measureButton.disabled = false; }
function stopMotion() { if (motionTimer) clearInterval(motionTimer); motionTimer = undefined; stopBenchmark(); }
function resetCamera() {
  if (currentScenario === 'sidc') viewport.setCamera({ center: [6.87,45.924], zoom: 13.5, pitch: 0, bearing: 0 });
  else if (currentScenario === 'overlap') viewport.setCamera({ center: [6.869,45.925], zoom: 14.3, pitch: 0, bearing: 0 });
  else if (currentScenario === 'moving') viewport.setCamera({ center: [6.869,45.92], zoom: 12.9, pitch: 0, bearing: 0 });
  else viewport.setCamera({ center: [6.88,45.92], zoom: 12.5, pitch: 55, bearing: -20 });
}
function loadScenario() {
  const revision = ++scenarioRevision;
  sidcDemo?.destroy(); sidcDemo = undefined;
  stopMotion(); currentScenario = scenario.value; tick = 0; paused = false;
  document.body.classList.toggle('sidc-scenario', currentScenario === 'sidc');
  element('#sidc-demo', HTMLElement).hidden = currentScenario !== 'sidc';
  element('#selection', HTMLElement).hidden = currentScenario === 'sidc';
  pauseButton.textContent = 'Pause'; measurement.textContent = 'No measurement yet'; diagnostics.hidden = true;
  element('#groups', HTMLDivElement).hidden = currentScenario !== 'overlap';
  element('#motion', HTMLElement).hidden = currentScenario !== 'moving';
  viewport.clear(); viewport.setSelection([]); renderSelection();
  const nextFailingElevation = currentScenario === 'error';
  if (failingElevation !== nextFailingElevation) {
    viewport.configure({ elevation: nextFailingElevation ? {
      tiles: [`${location.origin}/unavailable-elevation/{z}/{x}/{y}.png`], encoding: 'terrarium', tileSize: 512, maxzoom: 12,
    } : DEFAULT_ELEVATION });
    failingElevation = nextFailingElevation;
  }
  if (currentScenario === 'error') { terrain.checked = true; viewport.configure({ terrain: true }); }
  if (currentScenario === 'overlap') viewport.upsert(overlapFeatures());
  else if (currentScenario === 'moving') {
    viewport.upsert([...movingFeatures(), ...terrainFeatures().filter(feature => feature.geometry.type !== 'Point')]);
    motionTimer = setInterval(() => {
      if (paused || document.hidden) return;
      const updates = movingFeatures(++tick, 100);
      const start = performance.now(); viewport.upsert(updates);
      if (measuring) updateCosts.push(performance.now() - start);
    }, 100);
  } else if (currentScenario === 'sidc') {
    const content = element('#sidc-content', HTMLDivElement);
    content.textContent = 'Loading SIDC Kit…';
    void import('./sidc-demo').then(({ mountSidcDemo }) => {
      if (disposed || revision !== scenarioRevision) return;
      sidcDemo = mountSidcDemo({ viewport, container: content, onPlacementChange: setSymbolPlacement, onSelectionChange: renderSelection });
    }).catch(() => {
      if (disposed || revision !== scenarioRevision) return;
      content.textContent = 'SIDC Kit could not load. ';
      const retry = document.createElement('button'); retry.textContent = 'Retry demo'; retry.onclick = loadScenario; content.append(retry);
    });
  } else if (currentScenario !== 'empty') viewport.upsert(terrainFeatures());
  notice.hidden = currentScenario !== 'empty'; notice.textContent = 'No features. Choose a test scenario to add sample data.';
  resetCamera(); lastEvent.textContent = scenario.selectedOptions[0]?.textContent ?? 'Scenario changed';
  mapStatus.textContent = 'Ready';
}
function listen(element: HTMLElement, type: string, action: () => void) { element.addEventListener(type, action, { signal: lifetime.signal }); }
listen(scenario, 'change', loadScenario);
listen(terrain, 'change', () => viewport.configure({ terrain: terrain.checked }));
listen(hillshade, 'change', () => viewport.configure({ hillshade: hillshade.checked }));
listen(projection, 'change', () => viewport.configure({ projection: projection.value === 'globe' ? 'globe' : 'flat' }));
listen(element('#basemap', HTMLSelectElement), 'change', () => viewport.configure({ basemap: `https://tiles.openfreemap.org/styles/${element('#basemap', HTMLSelectElement).value}` }));
listen(pitch, 'input', () => viewport.setCamera({ pitch: Number(pitch.value) }));
listen(element('#reset-camera', HTMLButtonElement), 'click', resetCamera);
listen(element('#show-all', HTMLButtonElement), 'click', resetCamera);
listen(clearButton, 'click', () => { viewport.setSelection([]); renderSelection(); });
listen(locateButton, 'click', () => { const id = viewport.getSelection()[0]; const feature = id && viewport.getFeature(id); if (feature) locate(feature); });
listen(element('#dismiss-error', HTMLButtonElement), 'click', () => { diagnostics.hidden = true; });
listen(element('#retry-elevation', HTMLButtonElement), 'click', () => { viewport.configure({ elevation: DEFAULT_ELEVATION }); failingElevation = false; diagnostics.hidden = true; mapStatus.textContent = 'Retrying elevation'; });
listen(pauseButton, 'click', () => { paused = !paused; pauseButton.textContent = paused ? 'Resume' : 'Pause'; });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-group]')) listen(button, 'click', () => {
  const group = groups.find(group => group.count === Number(button.dataset.group));
  if (group) viewport.setCamera({ center: [group.center[0]!, group.center[1]!], zoom: 17, pitch: 0, bearing: 0 });
});
listen(measureButton, 'click', () => {
  if (currentScenario !== 'moving') return;
  stopBenchmark(); paused = false; pauseButton.textContent = 'Pause'; measuring = true; renderedFrames = 0; measureButton.disabled = true; updateCosts.length = 0;
  measurement.textContent = 'Measuring for 10 seconds…';
  const start = performance.now(), intervals: number[] = []; let last = start;
  const percentile = (values: number[]) => [...values].sort((a,b) => a-b)[Math.floor(values.length * .95)] ?? 0;
  const sample = (now: number) => {
    if (!measuring) return;
    if (document.hidden) { measurement.textContent = 'Measurement canceled because this tab was hidden.'; stopBenchmark(); return; }
    intervals.push(now - last); last = now;
    if (now - start < 10_000) { benchmarkFrame = requestAnimationFrame(sample); return; }
    const seconds = (now - start) / 1_000;
    measurement.textContent = `${Math.round(intervals.length / seconds)} UI frames/s · p95 UI frame ${percentile(intervals).toFixed(1)} ms · ${(renderedFrames / seconds).toFixed(1)} map renders/s · p95 update submission ${percentile(updateCosts).toFixed(2)} ms · ${updateCosts.length} batches. Map renders are demand-driven; worker/GPU duration is not measured.`;
    stopBenchmark();
  };
  benchmarkFrame = requestAnimationFrame(sample);
});
void viewport.ready.then(loadScenario).catch(error => { notice.textContent = 'The map could not start. See the diagnostic for details.'; if (error instanceof Error) console.error(error); });
function dispose() { disposed = true; ++scenarioRevision; sidcDemo?.destroy(); interactions?.destroy(); stopMotion(); lifetime.abort(); viewport.destroy(); }
window.addEventListener('pagehide', dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
