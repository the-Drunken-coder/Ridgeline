import { createViewport } from '@ridgeline/map';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
setWorkerUrl(workerUrl);
import type { MapFeature, Viewport } from '@ridgeline/map';
import '@ridgeline/map/style.css';
import { observeModels } from './observer';
import { observeGpu } from './gpu';
import { summarize, distribution } from './report';
import type { NativeObservation, Update } from './report';
import { camera, caseId, features, matrix, modelSettings, style, validateSettings } from './workload';
import type { Machine, Settings, WorkloadProperties } from './workload';
import { verify } from './verify';
import { foregroundPixels } from './pixels';

type Variant = { path: string; variant: string; triangles: number; sha256: string; bytes: number };
type Manifest = { assets: { id: string; variants: Variant[] }[]; fixtures: ({ id: string } & Variant)[] };
const container = document.querySelector<HTMLDivElement>('#map')!;
const status = document.querySelector<HTMLElement>('#status')!;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean, description: string) {
  const deadline = performance.now() + 30_000;
  while (!predicate()) { if (performance.now() > deadline) throw new Error(`Timed out: ${description}`); await pause(20); }
}
function flatTerrain() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d')!; context.fillStyle = 'rgb(128,0,0)'; context.fillRect(0, 0, 256, 256);
  return { tiles: [canvas.toDataURL()], tileSize: 256, encoding: 'terrarium' as const, maxzoom: 0 };
}
function coordinates(feature: MapFeature) { return feature.geometry.type === 'Point' ? feature.geometry.coordinates : []; }
function poseKey(value: readonly number[]) { return `${value[0]},${value[1]}`; }
function renderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2'); if (!gl) throw new Error('WebGL2 unavailable.');
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return { vendor: String(gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR)), renderer: String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
    version: String(gl.getParameter(gl.VERSION)), shadingLanguage: String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)) };
}
async function snapshot(viewport: Viewport<WorkloadProperties>, current: MapFeature<WorkloadProperties>[]) {
  return new Promise<{ png: string; nativeRenderedIds: number; modelPatchPixels: number[]; stateModelCount: number }>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Snapshot frame timed out.')), 10_000);
    viewport.map.once('render', () => {
      clearTimeout(timeout);
      const canvas = viewport.map.getCanvas(), gl = canvas.getContext('webgl2')!;
      const rgba = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height;
      const image = new ImageData(canvas.width, canvas.height);
      for (let y = 0; y < canvas.height; y++) image.data.set(rgba.subarray(y * canvas.width * 4, (y + 1) * canvas.width * 4), (canvas.height - y - 1) * canvas.width * 4);
      copy.getContext('2d')!.putImageData(image, 0, 0);
      const ratio = canvas.width / canvas.clientWidth;
      const patches = current.slice(0, 100).map(feature => {
        const c = coordinates(feature), point = viewport.map.project([c[0]!, c[1]!]);
        return foregroundPixels(image, { minX: (point.x - 14) * ratio, minY: (point.y - 23) * ratio,
          maxX: (point.x + 14) * ratio, maxY: (point.y + 6) * ratio });
      });
      const native = viewport.map.queryRenderedFeatures(undefined, { layers: ['rl:icons'] });
      resolve({ png: copy.toDataURL(), nativeRenderedIds: new Set(native.filter(feature => current.some(value => value.id === feature.properties._rl_feature_id && !value.entity?.model)).map(feature => feature.properties._rl_feature_id)).size,
        modelPatchPixels: patches, stateModelCount: current.filter(feature => viewport.getEntityState(feature.id)?.representation === 'model').length });
    });
    viewport.map.triggerRepaint();
  });
}

async function run(settings: Settings, machine?: Machine) {
  validateSettings(settings, machine);
  const manifest: Manifest = await fetch('/assets/manifest.json').then(response => response.json());
  const observer = observeModels(), diagnostics: string[] = [], updates: Update[] = [], native: NativeObservation[] = [];
  const raf: { time: number; interval: number }[] = [], renders: number[] = [], nativeProbeCpu: number[] = [];
  const registrations: { id: string; start: number; end: number; status: string }[] = [];
  const expectedNative = settings.variant === 'icons' ? 1100 : 1000;
  const nativeCoverage: { time: number; visible: number; expected: number; revisions: [number, number][]; unattributed: number }[] = [];
  const poses = new Map<string, number>(), generations: string[][] = [];
  let current = features(0, settings.variant), sequence = 0, running = true, moving = false;
  let animation = 0, tick: ReturnType<typeof setTimeout> | undefined, previousRaf = 0;
  const viewport = createViewport<WorkloadProperties>({ container, features: [], projection: settings.projection,
    camera, basemap: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f7f7f7' } }] },
    terrain: true, elevation: flatTerrain(), elevationSampler: { sample: () => 0 }, exaggeration: 1, entityModels: modelSettings,
    style: feature => style(feature, settings.appearance), logger: () => {}, onError: error => diagnostics.push(`${error.code}: ${error.message}`) });
  viewport.map.setPixelRatio(settings.pixelRatio);
  const canvas = viewport.map.getCanvas(); canvas.dataset.ridgelineMeasure = String(settings.instrumentation);
  const gpu = observeGpu(viewport.map, settings.instrumentation && settings.gpu);
  const start = performance.now();
  const publish = () => {
    current = features(sequence, settings.variant);
    if (settings.instrumentation) {
      const keys = current.filter(feature => settings.variant === 'icons' || !feature.properties.model).map(feature => `${feature.id}:${poseKey(coordinates(feature))}`);
      for (const key of keys) poses.set(key, sequence);
      generations.push(keys);
      if (generations.length > 150) for (const key of generations.shift()!) poses.delete(key);
    }
    const began = performance.now(); viewport.upsert(current); const end = performance.now();
    updates.push({ sequence, start: began, end }); sequence++;
    const targetFeature = current[10 + sequence % 80]!, location = coordinates(targetFeature), screen = viewport.map.project([location[0]!, location[1]!]);
    const bounds = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: bounds.left + screen.x, clientY: bounds.top + screen.y - 8 }));
  };
  const onRender = () => {
    const time = performance.now(); renders.push(time);
    if (!settings.instrumentation) return;
    const counts = new Map<number, number>(), seen = new Set<string>(); let unattributed = 0;
    for (const hit of viewport.map.queryRenderedFeatures(undefined, { layers: ['rl:icons'] })) {
      const id: unknown = hit.properties._rl_feature_id;
      if (typeof id !== 'string' || settings.variant !== 'icons' && !id.startsWith('icon-') || seen.has(id)) continue;
      const state = hit.id === undefined ? undefined : viewport.map.getFeatureState({ source: 'rl:features', id: hit.id });
      if (!state || state.model || state.editing) continue;
      seen.add(id);
      const key: unknown = hit.properties._rl_marker;
      if (typeof key !== 'string') { unattributed++; continue; }
      try {
        const decoded: unknown = JSON.parse(key);
        const revision = Array.isArray(decoded) && Array.isArray(decoded[0]) ? poses.get(`${id}:${poseKey(decoded[0])}`) : undefined;
        if (revision === undefined) unattributed++; else counts.set(revision, (counts.get(revision) ?? 0) + 1);
      } catch { unattributed++; }
    }
    nativeCoverage.push({ time, visible: seen.size, expected: expectedNative, revisions: [...counts], unattributed });
    for (const [revision, count] of counts) if (count === expectedNative) native.push({ sequence: revision, time });
    nativeProbeCpu.push(performance.now() - time);
  };
  const segments: { camera: 'stationary' | 'moving'; repeat: number; start: number; end: number }[] = [];
  try {
    await viewport.ready;
    // Use the public advanced projection API to retain genuine globe drawing at this close zoom.
    if (settings.projection === 'globe') viewport.map.setProjection({ type: 'vertical-perspective' });
    const icon = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < icon.length; i += 4) { icon[i] = 35; icon[i + 1] = 108; icon[i + 2] = 160; icon[i + 3] = 255; }
    viewport.registerIcon('measurement-icon', { image: new ImageData(icon, 8, 8) });
    if (settings.variant !== 'icons') {
      const assets = settings.variant === 'materials' ? manifest.fixtures : manifest.assets.map(asset => ({ id: asset.id, ...asset.variants.find(value => value.variant === settings.variant)! }));
      for (const asset of assets) {
        const bytes = await fetch(`/assets/${asset.path}`).then(response => { if (!response.ok) throw new Error(`Asset fetch: ${asset.path}`); return response.arrayBuffer(); });
        const began = performance.now();
        try { await viewport.registerModel(asset.id, { bytes, headingOffset: asset.id === 'tank' ? 90 : 0 }); registrations.push({ id: asset.id, start: began, end: performance.now(), status: 'ready' }); }
        catch (error) { registrations.push({ id: asset.id, start: began, end: performance.now(), status: String(error) }); throw error; }
      }
    }
    publish(); viewport.setSelection(['model-0', 'model-4']); viewport.preview('model-8');
    await until(() => viewport.map.loaded() && current.every(feature => Boolean(viewport.getEntityState(feature.id))), 'assets, terrain and native sources');
    const backend = renderer(canvas);
    if (settings.mode === 'hardware' && /swiftshader|llvmpipe|software rasterizer/i.test(backend.renderer)) throw new Error('Software rendering cannot be recorded as a hardware run.');
    viewport.map.on('render', onRender);
    const animate = (time: number) => {
      if (!running) return;
      if (previousRaf) raf.push({ time, interval: time - previousRaf }); previousRaf = time;
      if (moving) viewport.map.jumpTo({ bearing: Math.sin((time - start) / 3000) * 8, center: [camera.center[0] + Math.sin((time - start) / 4000) * .0003, camera.center[1]] });
      animation = requestAnimationFrame(animate);
    };
    animation = requestAnimationFrame(animate);
    let target = performance.now() + 100;
    const update = () => {
      if (!running) return;
      publish(); target += 100;
      // Do not replay a burst of missed updates after a long frame. Sequence/cadence remain recorded.
      if (target < performance.now()) target = performance.now() + 100;
      tick = setTimeout(update, Math.max(0, target - performance.now()));
    };
    tick = setTimeout(update, 100);
    await pause(settings.warmupMs);
    const warmReady = performance.now();
    for (let repeat = 0; repeat < settings.repeats; repeat++) for (const cameraMode of ['stationary', 'moving'] as const) {
      moving = cameraMode === 'moving';
      if (!moving) viewport.map.jumpTo(camera);
      status.textContent = `${caseId(settings)} ${settings.instrumentation ? 'on' : 'off'} ${cameraMode} ${repeat + 1}/${settings.repeats}`;
      const began = performance.now(); await pause(settings.durationMs);
      segments.push({ camera: cameraMode, repeat, start: began, end: performance.now() });
    }
    running = false; clearTimeout(tick); cancelAnimationFrame(animation);
    await until(() => viewport.map.loaded(), 'last native update');
    const visibility = await snapshot(viewport, current);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Map did not reach idle.')), 30_000);
      viewport.map.once('idle', () => { clearTimeout(timer); resolve(); }); viewport.map.triggerRepaint();
    });
    const idleStart = renders.length; await pause(5000); const idleFrames = renders.length - idleStart;
    observer.drain(); await gpu.destroy(); observer.drain();
    const expectedModels = settings.variant === 'icons' ? 0 : 100;
    const failures: string[] = [];
    if (canvas.clientWidth !== 1280 || canvas.clientHeight !== 720 || canvas.width !== 1280 * settings.pixelRatio || canvas.height !== 720 * settings.pixelRatio) failures.push('Canvas dimensions do not match the case.');
    if (visibility.nativeRenderedIds !== expectedNative) failures.push(`Final native visibility ${visibility.nativeRenderedIds}/${expectedNative}.`);
    if (visibility.modelPatchPixels.some(value => value === 0)) failures.push('At least one model-capable geographic patch has no foreground pixels.');
    if (visibility.stateModelCount !== expectedModels) failures.push(`Final model state count ${visibility.stateModelCount}/${expectedModels}.`);
    if (viewport.getSelection().join(',') !== 'model-0,model-4') failures.push('Selected instances were not retained.');
    if (idleFrames !== 0) failures.push(`Idle interval contained ${idleFrames} map renders.`);
    if (diagnostics.length || canvas.dataset.ridgelineMeasureError) failures.push('Runtime or instrumentation diagnostics occurred.');
    if (settings.instrumentation && expectedModels && !observer.records.some(record => record.name === 'frame' && record.detail.drawnModels === 100 && record.detail.clippedBoxes === 100)) failures.push('No complete drawn model frame with 100 clipped boxes was observed.');
    const results = segments.map(segment => {
      const inSegment = (time: number) => time >= segment.start && time < segment.end;
      const phaseRecords = observer.records.filter(record => inSegment(record.startTime));
      // Frames after the interval may display its last accepted update; retain them for latency attribution.
      const summary = summarize(observer.records, updates.filter(update => inSegment(update.start)), native, raf.filter(frame => inSegment(frame.time)), settings.instrumentation, expectedModels);
      const phaseSummary = summarize(phaseRecords, [], [], [], settings.instrumentation, expectedModels);
      return { ...segment, ...summary, phases: phaseSummary.phases, placementCpuMs: phaseSummary.placementCpuMs, projectionScalingCpuMs: phaseSummary.projectionScalingCpuMs,
        gpuMs: distribution(gpu.samples.filter(sample => inSegment(sample.issuedAt)).map(sample => sample.milliseconds)) };
    });
    return { schema: 1, date: new Date().toISOString(), caseId: caseId(settings), settings, machine, userAgent: navigator.userAgent,
      backend, canvas: { cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight, width: canvas.width, height: canvas.height, devicePixelRatio, mapPixelRatio: viewport.map.getPixelRatio() },
      projection: { configured: settings.projection, effective: viewport.map.getProjection(), transitionsObserved: gpu.projections },
      configuration: { camera, modelSettings, terrain: true, terrainSource: 'embedded Terrarium zero meters', exaggeration: 1, updateEveryMs: 100, features: 1100, modelTypes: 4, instancesPerType: 25, nativeLatencyScope: 'all expected native icon IDs at one accepted revision', expectedNative, selection: viewport.getSelection(), previewId: 'model-8', pointer: 'synthetic DOM mousemove once per update, plus stationary hover refresh' },
      manifest, cold: { start, warmReady, registrations }, results, raw: { raf, renders, updates, native, nativeCoverage, nativeProbeCpu, timings: observer.records, gpu: gpu.samples, rejectedGpu: gpu.rejected },
      gpuStatus: gpu.status, visibility, idleFrames, diagnostics, validation: { status: failures.length ? 'failed' : 'observed', failures }, instrumentationError: canvas.dataset.ridgelineMeasureError,
      acceptance: settings.mode === 'smoke' ? 'unrated tooling smoke; target hardware acceptance pending' : 'hardware observations only; review full matrix and correctness evidence before acceptance' };
  } catch (cause) {
    observer.drain();
    window.measurementFailure = { settings, machine, error: String(cause), diagnostics, updates, native, nativeCoverage, timings: observer.records, gpu: gpu.samples };
    throw new Error(`${String(cause)}\n${JSON.stringify({ loaded: viewport.map.loaded(), styleLoaded: viewport.map.isStyleLoaded(), tilesLoaded: viewport.map.areTilesLoaded(), states: current.reduce<Record<string, number>>((counts, feature) => { const state = viewport.getEntityState(feature.id); const key = state ? `${state.placement}/${state.representation}` : 'absent'; counts[key] = (counts[key] ?? 0) + 1; return counts; }, {}), diagnostics })}`, { cause });
  } finally {
    running = false; clearTimeout(tick); cancelAnimationFrame(animation); viewport.map.off('render', onRender);
    await gpu.destroy(); viewport.destroy(); observer.destroy();
  }
}

declare global { interface Window { modelMeasurement: { run: typeof run; matrix: typeof matrix }; measurementResult?: unknown; measurementError?: string; measurementFailure?: unknown } }
window.modelMeasurement = { run, matrix };
const params = new URLSearchParams(location.search);
if (params.has('verify')) verify().then(value => { window.measurementResult = value; }, error => { window.measurementError = String(error); });
else {
  const form = document.querySelector<HTMLFormElement>('#controls')!;
  const select = form.querySelector<HTMLSelectElement>('[name=case]')!;
  for (const value of matrix()) { const option = document.createElement('option'); option.value = JSON.stringify(value); option.textContent = caseId(value); select.append(option); }
  form.onsubmit = async event => {
    event.preventDefault(); const data = new FormData(form); const button = form.querySelector<HTMLButtonElement>('button')!; button.disabled = true;
    try {
      const value = JSON.parse(String(data.get('case'))), smoke = data.get('mode') === 'smoke';
      const machine: Machine = { device: String(data.get('device')), os: String(data.get('os')), gpu: String(data.get('gpu')), driver: String(data.get('driver')), browser: String(data.get('browser')), displayHz: Number(data.get('hz')) };
      const reports = [];
      for (const instrumentation of [false, true]) reports.push(await run({ ...value, mode: smoke ? 'smoke' : 'hardware', instrumentation, gpu: true,
        warmupMs: smoke ? 1000 : 10_000, durationMs: smoke ? 2000 : 30_000, repeats: smoke ? 1 : 3 }, machine));
      const provenance = await fetch('/provenance.json').then(response => response.json());
      const url = URL.createObjectURL(new Blob([JSON.stringify({ provenance, reports }, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `ridgeline-${caseId(value)}.json`; link.click(); URL.revokeObjectURL(url);
      status.textContent = 'Saved paired off/on observations. Hardware acceptance requires review of the complete matrix.';
    } catch (error) {
      status.textContent = String(error);
      if (window.measurementFailure) {
        const provenance = await fetch('/provenance.json').then(response => response.json());
        const url = URL.createObjectURL(new Blob([JSON.stringify({ provenance, failure: window.measurementFailure }, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'ridgeline-measurement-failure.json'; link.click(); URL.revokeObjectURL(url);
      }
    } finally { button.disabled = false; }
  };
}
