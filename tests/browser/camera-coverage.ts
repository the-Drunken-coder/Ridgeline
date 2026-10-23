import { createViewport, RidgelineError } from '@ridgeline/map';
import type { CameraAttachment, MapFeature } from '@ridgeline/map';
import { GeoJSONSource } from 'maplibre-gl';
import type { ImageSource } from 'maplibre-gl';
import { style, point, check, pointer, untilPixel, pixelAt } from './helpers';
import { observeIdle } from './browser-idle';
import { captureMapPixels } from './browser-observation';
import { solidGlb } from './model-fixtures';
import type { BrowserCaseContext, BrowserCaseModule } from './context';

async function recoverPartialReattachment({ own, container, until }: BrowserCaseContext) {
  const basemap = `https://ridgeline.invalid/partial-camera-style-${crypto.randomUUID()}.json`;
  const fetch = window.fetch;
  const requests: { signal: AbortSignal; release(): void; returned: boolean }[] = [];
  window.fetch = async (input, options) => {
    const request = new Request(input, options);
    if (request.url !== basemap) return fetch.call(window, input, options);
    const index = requests.length;
    await new Promise<void>(resolve => { requests.push({ signal: request.signal, release: resolve, returned: false }); });
    requests[index]!.returned = true;
    return new Response(JSON.stringify(style(index === 0 ? '#ff0000' : '#303030')), { headers: { 'content-type': 'application/json' } });
  };
  const dem = document.createElement('canvas'); dem.width = dem.height = 256;
  dem.getContext('2d')!.fillRect(0, 0, 256, 256);
  const owners = ['rl:camera-gpu', 'rl:entities', 'rl:models', 'rl:model-feedback'];
  const errors: RidgelineError[] = [];
  let armed = false, failedAllocations = 0, attachedAtFailure: string[] = [], expectedFailure: RidgelineError | undefined;
  const air = own(createViewport({ container, basemap: style(), terrain: true,
    elevation: { tiles: [dem.toDataURL()], encoding: 'custom', redFactor: 0, greenFactor: 0, blueFactor: 0, baseShift: 0, maxzoom: 0 },
    camera: { center: [0, 0], zoom: 16 }, elevationSampler: { sample: () => 0 },
    style: feature => ({ color: '#00ffff', radius: 10,
      selected: feature.id === 'retained-model' ? { color: '#ffff00', lineWidth: 5, modelBrightness: 0 } : { enabled: false } }),
    logger: () => {}, onError: error => {
      errors.push(error);
      if (!armed || failedAllocations !== 1 || !(error.cause instanceof Error) || error.cause.message !== 'Cannot allocate camera shader.') return;
      armed = false; expectedFailure = error;
      attachedAtFailure = owners.filter(id => air.map.getLayer(id));
      air.configure({ basemap });
    } }));
  await air.ready;
  const gl = air.map.getCanvas().getContext('webgl2'), extension = gl?.getExtension('WEBGL_lose_context');
  if (!gl || !extension) throw new Error('Actual partial-attachment context loss is unavailable');
  const createProgram = gl.createProgram.bind(gl);
  Object.defineProperty(gl, 'createProgram', { configurable: true, writable: true, value: () => {
    if (armed && failedAllocations === 0 && air.map.getLayer('rl:camera-gpu') && !air.map.getLayer('rl:entities')) {
      failedAllocations++; return null;
    }
    return createProgram();
  } });
  const diagnosticSummary = () => errors.map(error => `${error.code}: ${error.message}; ${String(error.cause)}; ${JSON.stringify(error.context)}`).join(', ');
  const checkModelPixels = async () => {
    const { bytes } = await captureMapPixels(air);
    let model = 0, feedback = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      const red = bytes[i]!, green = bytes[i + 1]!, blue = bytes[i + 2]!;
      if (red > green + 80 && blue > green + 80) model++;
      if (red > blue + 80 && green > blue + 80 && Math.abs(red - green) < 30) feedback++;
    }
    check(model > 100 && feedback > 30, `Partial-attachment model or selected feedback pixels missing: model=${model}, feedback=${feedback}`);
  };
  try {
    await air.registerModel('retained-box', { bytes: solidGlb(), metersPerUnit: 12 });
    const camera: CameraAttachment = { id: 'before-partial', type: 'camera', terrainVisibility: true,
      color: '#00ff00', bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: 0, wireframe: false };
    const feature: MapFeature = { ...point('partial-camera'), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [camera] } };
    const model: MapFeature = { ...point('retained-model', -.0015), entity: { heading: 0, model: { id: 'retained-box' } } };
    const pin = point('partial-pin', -.0027);
    air.upsert([feature, model, pin]); air.setSelection([model.id, pin.id]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready' && air.getEntityState(model.id)?.representation === 'model' && air.map.loaded(), 'complete camera and selected model before partial reattachment');
    check(owners.every(id => air.map.getLayer(id)) && Boolean(air.map.getTerrain()), 'Partial-attachment history requires all four live owners and native terrain');
    await untilPixel(air, [0, .0008], true, 'completed camera before partial reattachment');
    await checkModelPixels();
    armed = true;
    air.configure({ basemap: style('#101010') });
    await until(() => requests.length === 1 && !air.map.style?._loaded, 'diagnostic observer holds another native basemap request');
    check(failedAllocations === 1 && expectedFailure?.code === 'UPDATE_FAILED', `Expected one genuine camera allocation failure: ${diagnosticSummary()}`);
    check(attachedAtFailure.join() === 'rl:camera-gpu', `Diagnostic did not interrupt partial reattachment: ${attachedAtFailure.join()}`);
    gl.createProgram = createProgram;
    let lost = false, restored = false;
    air.map.once('webglcontextlost', () => { lost = true; });
    extension.loseContext();
    await until(() => lost, 'actual loss after partial reattachment and diagnostic basemap replacement');
    check(requests[0]!.signal.aborted, 'Partial-attachment loss did not abort the held native request');
    air.upsert([{ ...feature, entity: { ...feature.entity, attachments: [{ ...camera, id: 'after-partial', color: '#0000ff', bearing: 180 }] } }]);
    const accepted = JSON.stringify(air.getFeatures()), selection = air.getSelection().join();
    air.map.once('webglcontextrestored', () => { restored = true; });
    extension.restoreContext();
    await until(() => restored && requests.length === 2, 'partial reattachment restores the current accepted HTTP basemap');
    check(!requests[1]!.signal.aborted, 'Partial-attachment restoration cancelled the current request');
    requests[1]!.release();
    await until(() => owners.slice(1).every(id => air.map.getLayer(id)), 'entity, model and feedback layers reattach after actual loss');
    air.retryUpdates();
    await until(() => errors.some(error => error !== expectedFailure) || air.getEntityState(feature.id)?.coverage === 'ready' && air.getEntityState(model.id)?.representation === 'model', 'current model and camera recover after explicit retry');
    check(errors.length === 1 && errors[0] === expectedFailure, `Partial reattachment reported an unrelated failure: ${diagnosticSummary()}`);
    await untilPixel(air, [0, -.0008], true, 'current camera after partial reattachment recovery');
    const mask = await pixelAt(air, [0, -.0008], 8000, 'partial reattachment current mask color');
    check(mask.blue > mask.green + 35, `Partial-attachment recovery restored stale coverage: ${JSON.stringify(mask)}`);
    await untilPixel(air, [0, .0008], false, 'old partial-attachment camera remains retired');
    await checkModelPixels();
    const native = await pixelAt(air, [-.0027, 0], 8000, 'native feature after partial reattachment');
    check(native.green > native.red + 35 && native.blue > native.red + 35, `Partial-attachment recovery lost native feature pixels: ${JSON.stringify(native)}`);
    let picked: string[] = [];
    const offClick = air.on('click', event => { picked = [...event.features.map(feature => feature.id), ...event.attachments.map(hit => hit.attachmentId)]; });
    try {
      for (const [position, id] of [ [[0, -.0008], 'after-partial'], [[-.0015, 0], model.id], [[-.0027, 0], pin.id] ] as const) {
        picked = [];
        await pointer('click', air.map.project([position[0], position[1]]));
        check(picked.includes(id), `Partial-attachment recovery lost picking for ${id}`);
      }
    } finally { offClick(); }
    requests[0]!.release();
    await until(() => requests[0]!.returned, 'late aborted partial-attachment style response arrives');
    const base = await pixelAt(air, [.0025, .0012], 8000, 'current basemap after partial reattachment and late response');
    check([base.red, base.green, base.blue].every(value => Math.abs(value - 48) < 3), `Partial-attachment recovery lost current native basemap pixels: ${JSON.stringify(base)}`);
    check(JSON.stringify(air.getFeatures()) === accepted && air.getSelection().join() === selection, 'Partial-attachment recovery changed accepted data or selection');
    check(air.getConfiguration().basemap === basemap && Boolean(air.map.getTerrain()) && air.map.queryTerrainElevation({ lng: 0, lat: 0 }) === 0, 'Partial-attachment recovery lost current basemap or terrain');
    await until(() => air.map.loaded(), 'partial-attachment recovery settles');
    check(gl.getError() === gl.NO_ERROR, 'Partial-attachment recovery contaminated the restored WebGL context');
    await observeIdle(air, 'partial reattachment and diagnostic basemap context recovery').assertQuiet();
    check(errors.length === 1 && errors[0] === expectedFailure, `Late partial-attachment recovery failure: ${diagnosticSummary()}`);
  } finally {
    gl.createProgram = createProgram;
    for (const request of requests) request.release();
    window.fetch = fetch; air.destroy();
  }
}

async function recoverCompletionLoss({ own, container, until }: BrowserCaseContext) {
  const errors: RidgelineError[] = [];
  const air = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 16 },
    elevationSampler: { sample: () => 0 }, logger: () => {}, onError: error => errors.push(error) }));
  await air.ready;
  const gl = air.map.getCanvas().getContext('webgl2'), extension = gl?.getExtension('WEBGL_lose_context');
  if (!gl || !extension) throw new Error('Actual completion context loss is unavailable');
  const clientWaitSync = gl.clientWaitSync.bind(gl);
  const held = new Set<WebGLSync>();
  let release = false, readsAfterLoss = 0;
  gl.clientWaitSync = (sync, flags, timeout) => {
    if (gl.isContextLost()) readsAfterLoss++;
    if (!release) { held.add(sync); return gl.TIMEOUT_EXPIRED; }
    return clientWaitSync(sync, flags, timeout);
  };
  const camera: CameraAttachment = { id: 'before-loss', type: 'camera', terrainVisibility: true,
    color: '#00ff00', bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: 0, wireframe: false };
  const features: MapFeature[] = [-.003, .003].map((lng, index) => ({ ...point(`completion-${index}`, lng),
    entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [camera] } }));
  let lost = false, armed = false, completedEntity: string | undefined, otherCoverage: string | undefined;
  air.map.once('webglcontextlost', () => { lost = true; });
  const offCompletion = air.on('entitychange', ({ ids }) => {
    if (!armed) return;
    const completed = features.find(feature => ids.includes(feature.id) && air.getEntityState(feature.id)?.coverage === 'ready');
    if (!completed) return;
    armed = false; completedEntity = completed.id;
    otherCoverage = air.getEntityState(features.find(feature => feature.id !== completed.id)!.id)?.coverage;
    extension.loseContext();
  });
  let picked: string[] = [];
  const offClick = air.on('click', event => { picked = event.attachments.map(hit => `${hit.entityId}/${hit.attachmentId}`); });
  const pickAt = async (lng: number, lat: number) => {
    picked = [];
    await pointer('click', air.map.project([lng, lat]));
    return picked;
  };
  try {
    air.upsert(features);
    await until(() => held.size === 2, 'both camera entities have pending GPU fences');
    check(features.every(feature => air.getEntityState(feature.id)?.coverage === 'loading'), 'A camera completed before the loss observer was armed');
    armed = true; release = true;
    await until(() => lost, 'real context loss from first completed camera observer');
    check(Boolean(completedEntity) && otherCoverage === 'loading', 'Context loss did not run from one completion while the other camera was pending');
    check(readsAfterLoss === 0 && !errors.some(error => error.code === 'UPDATE_FAILED'),
      `Completion read another fence after physical loss: ${readsAfterLoss}; ${errors.map(error => `${error.code}: ${String(error.cause)}`).join(', ')}`);
    const current: MapFeature[] = features.map(feature => ({ ...feature, entity: { ...feature.entity,
      attachments: [{ ...camera, id: 'after-loss', bearing: 180, color: '#0000ff' }] } }));
    air.upsert(current);
    let restored = false;
    air.map.once('webglcontextrestored', () => { restored = true; });
    extension.restoreContext();
    await until(() => restored && current.every(feature => air.getEntityState(feature.id)?.coverage === 'ready'), 'both current camera entities recover without retry');
    for (const [index, lng] of [-.003, .003].entries()) {
      check((await pickAt(lng, -.0008)).includes(`completion-${index}/after-loss`), 'Restored camera picking did not use current attachment geometry');
      check(!(await pickAt(lng, .0008)).some(hit => hit.startsWith(`completion-${index}/`)), 'Restoration revived the old camera direction');
      await untilPixel(air, [lng, -.0008], true, 'current camera pixels after completion loss');
      const pixel = await pixelAt(air, [lng, -.0008], 8000, 'current camera color after completion loss');
      check(pixel.blue > pixel.green + 35, `Completion recovery restored stale mask color: ${JSON.stringify(pixel)}`);
      await untilPixel(air, [lng, .0008], false, 'old camera pixels remain retired');
    }
    check(!errors.some(error => error.code === 'UPDATE_FAILED'), 'Context cancellation became a persistent camera failure');
    check(gl.getError() === gl.NO_ERROR, 'Completion recovery left a WebGL error');
    await until(() => air.map.loaded(), 'completion recovery settles');
    await observeIdle(air, 'two camera completion context recovery').assertQuiet();
  } finally {
    offCompletion(); offClick(); gl.clientWaitSync = clientWaitSync; air.destroy();
  }
}

async function recoverPendingBasemap({ own, container, until }: BrowserCaseContext) {
  const basemap = `https://ridgeline.invalid/camera-style-${crypto.randomUUID()}.json`;
  const fetch = window.fetch;
  const requests: { signal: AbortSignal; release: () => void; returned: boolean }[] = [];
  window.fetch = async (input, options) => {
    const request = new Request(input, options);
    if (request.url !== basemap) return fetch.call(window, input, options);
    const index = requests.length;
    await new Promise<void>(resolve => { requests.push({ signal: request.signal, release: resolve, returned: false }); });
    requests[index]!.returned = true;
    // Deliver the aborted response too, so MapLibre's native HTTP loader must
    // reject it before the detached style can affect the current map.
    return new Response(JSON.stringify(style(index === 0 ? '#ff0000' : '#303030')), { headers: { 'content-type': 'application/json' } });
  };
  const dem = document.createElement('canvas'); dem.width = dem.height = 256;
  dem.getContext('2d')!.fillRect(0, 0, 256, 256);
  const errors: RidgelineError[] = [];
  const air = own(createViewport({ container, basemap: style(), terrain: true,
    elevation: { tiles: [dem.toDataURL()], encoding: 'custom', redFactor: 0, greenFactor: 0, blueFactor: 0, baseShift: 0, maxzoom: 0 },
    camera: { center: [0, 0], zoom: 16 }, elevationSampler: { sample: () => 0 },
    style: () => ({ color: '#00ffff', radius: 10, selected: { enabled: false } }),
    logger: () => {}, onError: error => errors.push(error) }));
  try {
    await air.ready;
    const camera: CameraAttachment = { id: 'before-loading', type: 'camera', terrainVisibility: true,
      color: '#00ff00', bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: 0, wireframe: false };
    const feature: MapFeature = { ...point('loading-camera'), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [camera] } };
    const pin = point('retained-pin', -.0025);
    air.upsert([feature, pin]); air.setSelection([pin.id]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready' && air.map.loaded() && air.map.queryTerrainElevation({ lng: 0, lat: 0 }) === 0, 'initialized native terrain and camera before pending style');
    await untilPixel(air, [0, .0008], true, 'camera pixels before pending basemap');
    await untilPixel(air, [-.0025, 0], true, 'native feature pixels before pending basemap');
    check(Boolean(air.map.getTerrain()), 'Pending style history requires initialized native terrain');
    air.configure({ basemap });
    await until(() => requests.length === 1 && !air.map.style?._loaded, 'accepted basemap URL is still unloaded');
    check(!air.map.getLayer('rl:points'), 'Pending basemap retained the previous loaded style');
    const gl = air.map.getCanvas().getContext('webgl2'), extension = gl?.getExtension('WEBGL_lose_context');
    if (!gl || !extension) throw new Error('Actual pending-style context loss is unavailable');
    let lost = false, restored = false;
    air.map.once('webglcontextlost', () => { lost = true; });
    extension.loseContext();
    await until(() => lost, 'real context loss while accepted basemap is unloaded');
    check(requests[0]!.signal.aborted, 'Original pending style request was not cancelled');
    const current: MapFeature = { ...feature, entity: { ...feature.entity,
      attachments: [{ ...camera, id: 'after-loading', color: '#0000ff', bearing: 180 }] } };
    air.upsert([current]);
    const accepted = JSON.stringify(air.getFeatures());
    air.map.once('webglcontextrestored', () => { restored = true; });
    extension.restoreContext();
    await until(() => restored, 'pending-style native context restoration');
    await until(() => requests.length === 2, 'restoration requests the current accepted basemap again');
    check(!requests[1]!.signal.aborted, 'Current restored style request was cancelled');
    requests[1]!.release();
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready' && air.map.loaded(), 'current pending basemap and camera restored');
    check(Boolean(air.map.getTerrain()) && air.map.queryTerrainElevation({ lng: 0, lat: 0 }) === 0, 'Pending basemap recovery lost configured native terrain');
    check(JSON.stringify(air.getFeatures()) === accepted && air.getSelection().join() === pin.id, 'Pending basemap recovery changed accepted snapshots or selection');
    check(air.getConfiguration().basemap === basemap && air.map.getZoom() === 16, 'Pending basemap recovery changed configuration or camera');
    await untilPixel(air, [0, -.0008], true, 'current mask pixels after pending basemap recovery');
    const mask = await pixelAt(air, [0, -.0008], 8000, 'pending basemap current mask color');
    check(mask.blue > mask.green + 35, `Pending basemap restored stale mask appearance: ${JSON.stringify(mask)}`);
    await untilPixel(air, [0, .0008], false, 'pending basemap retired old camera geometry');
    await untilPixel(air, [-.0025, 0], true, 'retained native feature pixels after pending basemap');
    const pinPixel = await pixelAt(air, [-.0025, 0], 8000, 'retained native feature color');
    check(pinPixel.green > pinPixel.red + 35 && pinPixel.blue > pinPixel.red + 35, `Pending basemap lost retained native feature pixels: ${JSON.stringify(pinPixel)}`);
    let picked: string[] = [];
    const offClick = air.on('click', event => { picked = [...event.features.map(feature => feature.id), ...event.attachments.map(hit => hit.attachmentId)]; });
    try {
      await pointer('click', air.map.project([0, -.0008]));
      check(picked.includes('after-loading'), 'Pending basemap recovery lost current camera picking');
      picked = [];
      await pointer('click', air.map.project([-.0025, 0]));
      check(picked.includes(pin.id), 'Pending basemap recovery lost retained native feature picking');
    } finally { offClick(); }
    requests[0]!.release();
    await until(() => requests[0]!.returned, 'stale aborted style response delivered after the current response');
    const base = await pixelAt(air, [.0025, .0012], 8000, 'current basemap after late aborted response');
    check([base.red, base.green, base.blue].every(value => Math.abs(value - 48) < 3), `Stale basemap response overwrote current pixels: ${JSON.stringify(base)}`);
    check(errors.length === 0 && gl.getError() === gl.NO_ERROR, `Pending basemap recovery reported a failure: ${errors.map(error => `${error.code}: ${error.message}; ${String(error.cause)}; ${JSON.stringify(error.context)}`).join(', ')}`);
    await until(() => air.map.loaded(), 'pending basemap recovery settles');
    await observeIdle(air, 'pending accepted basemap context recovery').assertQuiet();
    check(air.map.getPaintProperty('background', 'background-color') === '#303030', 'Late aborted response replaced the current basemap');
    check(Boolean(air.map.getTerrain()), 'Late aborted response disabled current native terrain');
    for (const change of ['patch', 'replacement'] as const) {
      let reentered = false;
      const onTerrain = () => {
        if (air.map.getTerrain() || reentered) return;
        reentered = true;
        air.configure(change === 'patch' ? { exaggeration: 2 } : { basemap: style('#505050') });
      };
      air.map.on('terrain', onTerrain);
      const hadTerrain = Boolean(air.map.getTerrain());
      try { air.configure({ basemap: style(change === 'patch' ? '#404040' : '#606060') }); }
      finally { air.map.off('terrain', onTerrain); }
      check(reentered, `Basemap replacement did not retire terrain through its owning style: ${change}, terrain before=${hadTerrain}, after=${Boolean(air.map.getTerrain())}, basemap=${JSON.stringify(air.getConfiguration().basemap)}`);
      await until(() => air.map.loaded() && Boolean(air.map.getTerrain()), 'terrain callback configuration settles');
      check(air.getConfiguration().exaggeration === 2, 'Terrain retirement lost the reentrant configuration patch');
      const pixel = await pixelAt(air, [.0025, .0012], 8000, 'basemap selected from terrain callback');
      const expected = change === 'patch' ? 64 : 80;
      check([pixel.red, pixel.green, pixel.blue].every(value => Math.abs(value - expected) < 3), 'Outer basemap replacement overwrote the current callback configuration');
    }
  } finally {
    for (const request of requests) request.release();
    window.fetch = fetch; air.destroy();
  }
}


export const cameraCoverageCases = {
  "Terrain visibility colors the approach green and the hill shadow red": async caseContext => {
    const { own, container, until } = caseContext;
    const meters = Math.PI / 180 * 6371008.8;
    const hill = (_lng: number, lat: number) => 150 * Math.exp(-(((lat * meters - 300) / 40) ** 2));
    const air = own(createViewport({ container, basemap: style('#000000'),
      elevationSampler: { sample: hill }, camera: { center: [0, 480 / meters], zoom: 15, pitch: 0 },
      entityVisibility: { footprints: true, zones: false, groundLines: false }, logger: () => {} }));
    await air.ready;
    air.upsert([{ ...point('hill-shadow'), entity: { altitude: { meters: 100, reference: 'sea-level' },
      attachments: [{ id: 'camera', type: 'camera', color: '#00ff00', terrainVisibility: true, blockedColor: '#ff0000', fillOpacity: .6, blockedOpacity: .6, bearing: 0, elevation: -15, fovX: 60, fovY: 40, range: 2000 }] } }]);
    await until(() => air.getEntityState('hill-shadow')?.coverage === 'ready', 'hill coverage');
    await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
    const pixels = await new Promise<number[]>(resolve => {
      air.map.once('render', () => {
        const canvas = air.map.getCanvas(), gl = canvas.getContext('webgl2')!, greens: number[] = [];
        for (const north of [210, 750]) {
          const p = air.map.project([0, north / meters]), pixel = new Uint8Array(4), scale = canvas.width / canvas.clientWidth;
          gl.readPixels(Math.round(p.x * scale), canvas.height - 1 - Math.round(p.y * scale), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          greens.push(north === 210 ? pixel[1]! : pixel[0]!);
        }
        resolve(greens);
      });
      air.map.triggerRepaint();
    });
    check(pixels[0]! > 50, `Visible approach lost coverage: ${pixels}`);
    check(pixels[1]! > 50, `Blocked far slope was not red: ${pixels}`);
    const maskLayer=air.map.getStyle().layers.find(layer=>layer.id.startsWith('rl:camera-mask:'));
    check(!!maskLayer,'Missing GPU coverage layer');
    const mask=air.map.getSource<ImageSource>(maskLayer!.id)!.image;
    check(mask instanceof ImageData,'Expected completed GPU mask pixels');
    if(mask instanceof ImageData) {
      let mixed=0;
      for(let i=0;i<mask.data.length;i+=4) if(mask.data[i+3]!>0 && mask.data[i]!>0 && mask.data[i+1]!>0) mixed++;
      check(mixed<mask.width*mask.height*.03,`Contour transition is too broad: ${mixed} mixed pixels`);
    }
    check(air.map.getPaintProperty(maskLayer!.id,'raster-resampling')==='linear','Measured contours use square-pixel magnification');

    air.destroy();
  },
  "Camera volume covers rising terrain inside its true FOV": async caseContext => {
    const { own, container, until } = caseContext;
    const meters = Math.PI / 180 * 6371008.8;
    const hill = (_lng: number, lat: number) => 100 * Math.exp(-(((lat * meters - 120) / 60) ** 2));
    const air = own(createViewport({container, basemap: style('#000000'), elevationSampler: {sample: hill},
      camera: {center: [0,80/meters], zoom:18, pitch:0}, logger:()=>{}}));
    await air.ready;
    air.upsert([{...point('near-hill'),entity:{altitude:{meters:100,reference:'sea-level'},attachments:[{
      id:'camera',type:'camera',terrainVisibility:true,color:'#00ff00',fillOpacity:.6,blockedColor:'#ff0000',blockedOpacity:.6,
      bearing:0,elevation:-15,fovX:60,fovY:40,range:1000,
    }]}}]);
    await until(()=>air.getEntityState('near-hill')?.coverage==='ready','near hillside coverage');
    await new Promise<void>(resolve=>air.map.once('idle',()=>resolve()));
    const pixel=await new Promise<Uint8Array>(resolve=>{
      air.map.once('render',()=>{
        const canvas=air.map.getCanvas(),gl=canvas.getContext('webgl2')!,p=air.map.project([0,80/meters]);
        const scale=canvas.width/canvas.clientWidth,value=new Uint8Array(4);
        gl.readPixels(Math.round(p.x*scale),canvas.height-1-Math.round(p.y*scale),1,1,gl.RGBA,gl.UNSIGNED_BYTE,value);
        resolve(value);
      });air.map.triggerRepaint();
    });
    check(pixel[1]!>100&&pixel[0]!<25,`Finite camera volume excluded visible hillside: ${pixel}`);
    air.destroy();
  },
  "Raster tile arrivals recover camera coverage despite unrelated missing terrain": async caseContext => {
    const { own, container, until } = caseContext;
    const dem=document.createElement('canvas');dem.width=dem.height=256;
    const context=dem.getContext('2d')!;context.fillStyle='#000000';context.fillRect(0,0,256,256);
    const air=own(createViewport({container,basemap:style(),elevation:{tiles:[dem.toDataURL()],encoding:'custom',redFactor:0,greenFactor:0,blueFactor:0,baseShift:0,maxzoom:12},logger:()=>{}}));
    await air.ready;
    air.upsert([{...point('outside'),geometry:{type:'Point',coordinates:[0,86]},entity:{}}]);
    await until(()=>air.getEntityState('outside')?.coverage==='unavailable','out-of-range terrain');
    air.remove(['outside']);
    const location:MapFeature={...point('warm'),geometry:{type:'Point',coordinates:[.07,.044]},entity:{}};
    air.upsert([location]);await until(()=>air.getEntityState('warm')?.ground===0,'camera center tile');
    air.upsert([{...location,id:'border-camera',entity:{altitude:{meters:100,reference:'ground'},attachments:[{
      id:'camera',type:'camera',terrainVisibility:true,bearing:0,elevation:-45,fovX:60,fovY:40,range:2000,
    }]}}]);
    await until(()=>air.getEntityState('border-camera')?.coverage==='ready','neighboring terrain patch recovers without retry');
    air.destroy();
  },
  "A displayed camera failure removes only its coverage and retry uses current inputs": async caseContext => {
    const { own, container, until } = caseContext;
    const errors: RidgelineError[] = [];
    const air = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 16 }, elevationSampler: { sample: () => 0 },
      logger: () => {}, onError: error => errors.push(error) }));
    await air.ready;
    air.upsert([{ ...point('ground-survivor'), entity: { attachments: [{ id: 'zone', type: 'circle', radius: 50 }] } }]);
    await until(() => air.getEntityState('ground-survivor')?.coverage === 'ready', 'unrelated ground coverage');
    const failingCamera: CameraAttachment = { id: 'camera', type: 'camera', terrainVisibility: true,
      color: '#00ff00', bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: .1, wireframe: true };
    const feature: MapFeature = { ...point('failing-camera'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [failingCamera] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'initial camera coverage');
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const clientWaitSync = gl.clientWaitSync.bind(gl);
    let fail = false;
    gl.clientWaitSync = (sync, flags, timeout) => fail ? gl.WAIT_FAILED : clientWaitSync(sync, flags, timeout);
    const cameraMask = () => air.map.getStyle().layers.find(layer => layer.id.startsWith('rl:camera-mask:'));
    let pickedAttachment = '';
    air.on('click', event => { pickedAttachment = event.attachments.find(hit => hit.entityId === feature.id)?.attachmentId ?? ''; });
    const pickCoverage = async () => {
      const point = air.map.project([.0006, .0004]);
      pickedAttachment = '';
      await pointer('click', point);
      return pickedAttachment;
    };
    try {
      const initialMask = cameraMask();
      check(Boolean(initialMask), 'Initial camera mask missing');
      check(await pickCoverage() === 'camera', 'Initial camera coverage was not pickable');
      air.upsert([{ ...feature, entity: { ...feature.entity!, attachments: [{ ...failingCamera, bearing: 15 }] } }]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'loading', 'camera replacement pending');
      fail = true;
      await until(() => errors.some(error => error.code === 'UPDATE_FAILED'), 'displayed camera failure diagnostic');
      await until(() => air.getEntityState(feature.id)?.coverage === 'unavailable', 'failed camera coverage');
      check(!cameraMask(), 'Failed camera mask remained visible');
      check(await pickCoverage() === '', 'Failed camera coverage remained pickable');
      check(air.getEntityState('ground-survivor')?.coverage === 'ready', 'Camera failure removed unrelated ground coverage');
      fail = false;
      air.upsert([{ ...feature, entity: { ...feature.entity!, attachments: [{ ...failingCamera, bearing: 30, color: '#0000ff' }] } }]);
      air.retryUpdates();
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'current camera retry');
      const mask = cameraMask();
      const source = mask && air.map.getSource<ImageSource>(mask.id)?.image;
      check(source instanceof ImageData && source.data.some((value, index) => index % 4 === 2 && value > 100), 'Retry restored stale camera appearance instead of current inputs');
      check(air.getEntityState('ground-survivor')?.coverage === 'ready', 'Current camera retry disturbed unrelated ground coverage');
      check(await pickCoverage() === 'camera', 'Current camera coverage was not pickable after retry');
    } finally {
      gl.clientWaitSync = clientWaitSync;
      air.destroy();
    }
    await recoverPendingBasemap(caseContext);
  },
  "Failed GPU target allocation releases its resources and retries": async caseContext => {
    const { own, container, until } = caseContext;
    const errors: RidgelineError[] = [];
    const air = own(createViewport({ container, basemap: style(), elevationSampler: { sample: () => 0 },
      logger: () => {}, onError: error => errors.push(error) }));
    await air.ready;
    air.upsert([{...point('plain-zone'),entity:{attachments:[{id:'zone',type:'circle',radius:50}]}}]);
    await until(()=>air.getEntityState('plain-zone')?.coverage==='ready','plain zone ready');
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const createFramebuffer = gl.createFramebuffer.bind(gl), deleteFramebuffer = gl.deleteFramebuffer.bind(gl);
    const createTexture = gl.createTexture.bind(gl), deleteTexture = gl.deleteTexture.bind(gl);
    const checkFramebufferStatus = gl.checkFramebufferStatus.bind(gl);
    const frames = new Set<WebGLFramebuffer>(), textures = new Set<WebGLTexture>();
    gl.createFramebuffer = () => { const value = createFramebuffer(); if (value) frames.add(value); return value; };
    gl.createTexture = () => { const value = createTexture(); if (value) textures.add(value); return value; };
    gl.deleteFramebuffer = value => { if (value) frames.delete(value); deleteFramebuffer(value); };
    gl.deleteTexture = value => { if (value) textures.delete(value); deleteTexture(value); };
    gl.checkFramebufferStatus = () => gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
    try {
      air.upsert([{ ...point('gpu-failure'), entity: { altitude: { meters: 100, reference: 'ground' },
        attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300 }] } }]);
      await until(() => air.getEntityState('gpu-failure')?.coverage === 'unavailable', 'GPU allocation failure');
      check(air.getEntityState('plain-zone')?.coverage==='ready','GPU failure changed unrelated ground coverage');
      check(errors.some(error => error.code === 'UPDATE_FAILED'), 'GPU failure did not report a diagnostic');
      check(frames.size === 0 && textures.size === 0, `Failed GPU allocation leaked ${frames.size} framebuffers and ${textures.size} textures`);
      gl.checkFramebufferStatus = checkFramebufferStatus;
      air.retryUpdates();
      await until(() => air.getEntityState('gpu-failure')?.coverage === 'ready', 'GPU allocation recovery');
    } finally {
      gl.checkFramebufferStatus = checkFramebufferStatus;
      air.destroy();
      gl.createFramebuffer = createFramebuffer; gl.deleteFramebuffer = deleteFramebuffer;
      gl.createTexture = createTexture; gl.deleteTexture = deleteTexture;
    }
    await recoverPartialReattachment(caseContext);
  },
  "A null GPU synchronization result reports failure and recovers on retry": async caseContext => {
    const { own, container, until } = caseContext;
    const errors: RidgelineError[] = [];
    const air = own(createViewport({ container, basemap: style(), elevationSampler: { sample: () => 0 },
      logger: () => {}, onError: error => errors.push(error) }));
    await air.ready;
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const fenceSync = gl.fenceSync.bind(gl);
    let failOnce = true;
    gl.fenceSync = (condition, flags) => {
      if (failOnce) { failOnce = false; return null; }
      return fenceSync(condition, flags);
    };
    const feature: MapFeature = { ...point('null-fence'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, bearing: 0, elevation: -45,
        fovX: 60, fovY: 40, range: 300 }] } };
    try {
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'unavailable', 'null GPU sync failure');
      check(errors.some(error => error.code === 'UPDATE_FAILED'), 'Null GPU sync did not report a diagnostic');
      check(!air.map.getStyle().layers.some(layer => layer.id.startsWith('rl:camera-mask:')), 'Failed sync published camera coverage');
      gl.fenceSync = fenceSync;
      air.retryUpdates();
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'GPU sync retry');
      check(air.map.getStyle().layers.some(layer => layer.id.startsWith('rl:camera-mask:')), 'Retry did not publish camera coverage');
    } finally { gl.fenceSync = fenceSync; air.destroy(); }
  },
  "Coverage readiness follows every camera, pose changes, and ground placement": async caseContext => {
    const { own, container, until } = caseContext;
    const air = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 16 }, elevationSampler: { sample: () => 0 }, logger: () => {} }));
    await air.ready;
    air.upsert([{...point('ground'),entity:{attachments:[{id:'zone',type:'circle',radius:50}]}}]);
    await until(()=>air.getEntityState('ground')?.coverage==='ready','ground geometry ready');
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const clientWaitSync = gl.clientWaitSync.bind(gl);
    const texImage2D = gl.texImage2D;
    const source=air.map.getSource<GeoJSONSource>('rl:entity-ground')!,setData=source.setData.bind(source);
    let sensorTargets=0,groundUploads=0;
    gl.texImage2D=new Proxy(texImage2D,{apply(target,context:WebGL2RenderingContext,args:unknown[]){
      if(args[3]===2048&&args[4]===2048)sensorTargets++;
      return Reflect.apply(target,context,args);
    }});
    source.setData=(...args)=>{groundUploads++;return setData(...args);};
    let first: WebGLSync | undefined;
    let releaseSecond = false;
    let heldWaits = 0;
    let completionBudget: number | undefined;
    gl.clientWaitSync = (sync, flags, timeout) => {
      first ??= sync;
      if (sync !== first && (!releaseSecond || completionBudget === 0)) {
        heldWaits++;
        return gl.TIMEOUT_EXPIRED;
      }
      const status = clientWaitSync(sync, flags, timeout);
      if (sync !== first && status !== gl.TIMEOUT_EXPIRED && completionBudget !== undefined) completionBudget--;
      return status;
    };
    const camera: CameraAttachment = { id: 'first', type: 'camera', terrainVisibility: true,
      bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: .1, wireframe: true };
    const published = () => air.map.getStyle().layers.filter(layer => layer.id.startsWith('rl:camera-mask:'))
      .filter(layer => air.map.getSource<ImageSource>(layer.id)?.image instanceof ImageData).length;
    const feature: MapFeature = { ...point('two-cameras'), entity: { altitude: { meters: 100, reference: 'ground' },
      attachments: [camera, { ...camera, id: 'second', bearing: 90 }] } };
    const masks = () => air.map.getStyle().layers
      .filter(layer => layer.id.startsWith('rl:camera-mask:'))
      .map(layer => air.map.getSource<ImageSource>(layer.id)?.image)
      .filter((image): image is ImageData => image instanceof ImageData);
    const maskSignature = () => masks().map(image => {
      let sum = 0;
      for (let index = 0; index < image.data.length; index += 4) sum = (sum + image.data[index]! * 3 + image.data[index + 1]! * 5 + image.data[index + 2]! * 7 + image.data[index + 3]!) % 0x1_0000_0000;
      return sum;
    });
    let pickedAttachments: string[] = [];
    air.on('click', event => { pickedAttachments = event.attachments.filter(hit => hit.entityId === feature.id).map(hit => hit.attachmentId); });
    const pickAt = async (lng: number, lat: number) => {
      const point = air.map.project([lng, lat]);
      pickedAttachments = [];
      await pointer('click', point);
      return pickedAttachments;
    };
    try {
      air.upsert([feature]);
      await until(() => published() === 1, 'first camera publishes while second is pending');
      check(air.getEntityState('two-cameras')?.coverage === 'loading', 'Entity became ready before its second camera published');
      check((await pickAt(0, .0008)).includes('first'), 'First camera result was not pickable');
      check(!(await pickAt(.0008, 0)).includes('second'), 'Second camera result published before its fence completed');
      releaseSecond = true;
      await until(() => air.getEntityState('two-cameras')?.coverage === 'ready', 'both camera masks published');
      check(published() === 2, 'Ready entity is missing camera coverage');
      check(sensorTargets===2,`Two cameras allocated ${sensorTargets} sensor targets instead of sharing one pair`);
      check(groundUploads===1,`GPU publication resubmitted unchanged ground geometry ${groundUploads} times`);
      releaseSecond = false;
      const oldSignature = maskSignature();
      check(oldSignature.length === 2, 'Initial camera images missing');
      heldWaits = 0;
      let before = air.getEntityState(feature.id)!.computedAt;
      air.upsert([{ ...feature, geometry: { type: 'Point', coordinates: [.0001,0] } }]);
      await until(() => air.getEntityState(feature.id)!.computedAt > before, 'camera replacement before equivalent configuration');
      await until(() => heldWaits > 0, 'camera replacement fence held');
      air.configure({ projection: 'flat', terrain: false, exaggeration: 1 });
      check(air.getEntityState(feature.id)?.coverage === 'loading', 'Equivalent configuration lost the pending camera state');
      check(JSON.stringify(maskSignature()) === JSON.stringify(oldSignature), 'Equivalent configuration dropped completed camera coverage');
      releaseSecond = true;
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'equivalent configuration republishes camera coverage');
      releaseSecond = false;
      const movedSignature = maskSignature();
      before = air.getEntityState(feature.id)!.computedAt;
      for (const lng of [.0002, .0003]) {
        air.upsert([{ ...feature, geometry: { type: 'Point', coordinates: [lng,0] } }]);
        await until(() => air.getEntityState(feature.id)!.computedAt > before, 'moved camera submitted');
        before = air.getEntityState(feature.id)!.computedAt;
        check(air.getEntityState(feature.id)?.coverage === 'loading', 'Old camera pose was reported ready for new input');
        check(JSON.stringify(maskSignature()) === JSON.stringify(movedSignature), 'Previous camera result disappeared while replacement was pending');
      }
      completionBudget = 1;
      releaseSecond = true;
      await until(() => {
        const current = maskSignature();
        return current.length === 2 && current[0] !== movedSignature[0];
      }, 'intermediate camera result published');
      check(air.getEntityState(feature.id)?.coverage === 'loading', 'Intermediate camera result marked the newest request ready');
      completionBudget = undefined;
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'moved camera masks published');
      check((await pickAt(.0003, .0008)).includes('first'), 'Final camera result was not pickable at the current position');
      before = air.getEntityState(feature.id)!.computedAt;
      air.upsert([{ ...feature, entity: { ...feature.entity!, altitude: { meters: 0, reference: 'ground' } } }]);
      await until(() => air.getEntityState(feature.id)!.computedAt > before, 'ground-level camera computed');
      check(air.getEntityState(feature.id)?.coverage === 'ready', 'Known ground-level camera stayed loading');
      check(!air.map.getLayer('rl:camera-gpu'), 'Ground-level camera retained GPU geometry');
    } finally { gl.clientWaitSync = clientWaitSync; gl.texImage2D=texImage2D;source.setData=setData;air.destroy(); }
    await recoverCompletionLoss(caseContext);
  },
  "Rejected camera frames do not replace the displayed picking mask": async caseContext => {
    const { own, container, until } = caseContext;
    const air = own(createViewport({ container, basemap: style(), camera: { center: [0, 0], zoom: 16 }, elevationSampler: { sample: () => 0 }, logger: () => {} }));
    await air.ready;
    const camera: CameraAttachment = { id: 'camera', type: 'camera', terrainVisibility: true,
      color: '#00ff00', bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: 0, wireframe: false };
    const feature: MapFeature = { ...point('rejected-camera'), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [camera] } };
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const clientWaitSync = gl.clientWaitSync.bind(gl);
    let first: WebGLSync | undefined;
    let release = false;
    let completions = 0;
    let heldWaits = 0;
    gl.clientWaitSync = (sync, flags, timeout) => {
      first ??= sync;
      if (sync !== first && (!release || completions === 0)) {
        heldWaits++;
        return gl.TIMEOUT_EXPIRED;
      }
      const status = clientWaitSync(sync, flags, timeout);
      if (sync !== first && status !== gl.TIMEOUT_EXPIRED && completions > 0) completions--;
      return status;
    };
    let picked = '';
    air.on('click', event => { picked = event.attachments.find(hit => hit.entityId === feature.id)?.attachmentId ?? ''; });
    const pickAt = async (lng: number, lat: number) => {
      const point = air.map.project([lng, lat]);
      picked = '';
      await pointer('click', point);
      return picked;
    };
    try {
      air.upsert([feature]);
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'initial camera coverage');
      check(await pickAt(0, .0008) === camera.id, 'Initial camera coverage was not pickable');
      release = false;
      const moved = { ...feature, geometry: { type: 'Point' as const, coordinates: [.003, 0] as [number, number] },
        entity: { ...feature.entity!, attachments: [{ ...camera, bearing: 180 }] } };
      let before = air.getEntityState(feature.id)!.computedAt;
      air.upsert([moved]);
      await until(() => air.getEntityState(feature.id)!.computedAt > before, 'moved camera submission');
      await until(() => heldWaits > 0, 'moved camera fence held');
      const changed = { ...moved, entity: { ...moved.entity!, attachments: [{ ...camera, color: '#0000ff', bearing: 180, volumeOpacity: 0, wireframe: false }] } };
      before = air.getEntityState(feature.id)!.computedAt;
      air.upsert([changed]);
      await until(() => air.getEntityState(feature.id)!.computedAt > before, 'appearance replacement');
      const previousHolds = heldWaits;
      release = true;
      completions = 1;
      await until(() => heldWaits > previousHolds, 'replacement frame held after rejected result');
      check(await pickAt(0, .0008) === camera.id, 'Rejected readback replaced the displayed picking mask');
      check(await pickAt(0, -.0008) === '', 'Rejected readback created a south-side picking hit');
      gl.clientWaitSync = clientWaitSync;
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'replacement camera coverage');
    } finally {
      gl.clientWaitSync = clientWaitSync;
      air.destroy();
    }
  },
  "Retained camera masks survive a style rebuild during terrain retry": async caseContext => {
    const { own, container, until } = caseContext;
    let available = true;
    let finish: (() => void) | undefined;
    const dem = document.createElement('canvas'); dem.width = dem.height = 256;
    const context = dem.getContext('2d')!; context.fillRect(0, 0, 256, 256);
    const air = own(createViewport({ container, basemap: style(), terrain: true,
      elevation: { tiles: [dem.toDataURL()], encoding: 'custom', redFactor: 0, greenFactor: 0, blueFactor: 0, baseShift: 0, maxzoom: 0 },
      camera: { center: [0, 0], zoom: 16 }, elevationSampler: {
      sample: () => available ? 0 : null,
      prepare: async () => new Promise<void>(resolve => { finish = resolve; }),
    }, logger: () => {} }));
    await air.ready;
    const camera: CameraAttachment = { id: 'camera', type: 'camera', terrainVisibility: true,
      bearing: 0, elevation: -45, fovX: 60, fovY: 40, range: 300, volumeOpacity: 0, wireframe: false };
    const feature: MapFeature = { ...point('retained-camera'), entity: { altitude: { meters: 100, reference: 'ground' }, attachments: [camera] } };
    await until(() => air.map.loaded() && air.map.queryTerrainElevation({ lng: 0, lat: 0 }) === 0, 'native terrain before camera publication');
    check(Boolean(air.map.getTerrain()), 'The late camera history requires native terrain');
    let lateInput: (() => void) | undefined;
    const installInputLayer = () => {
      if (!air.map.getLayer('late-camera-input')) air.map.addLayer({ id: 'late-camera-input', type: 'custom', prerender() {
        const action = lateInput; lateInput = undefined; action?.();
      }, render() {} }, 'rl:models');
    };
    const duringFrame = (action: () => void) => { lateInput = action; air.map.triggerRepaint(); };
    installInputLayer();
    duringFrame(() => air.upsert([feature]));
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'initial retained camera');
    let picked = '';
    const off = air.on('click', event => { picked = event.attachments.find(hit => hit.entityId === feature.id)?.attachmentId ?? ''; });
    const pickAt = async (lng: number, lat: number) => {
      const point = air.map.project([lng, lat]);
      picked = '';
      await pointer('click', point);
      return picked;
    };
    try {
      check(await pickAt(0, .0008) === camera.id, 'Initial retained camera was not pickable');
      await untilPixel(air, [0, .0008], true, 'Late camera pixels on native terrain');
      duringFrame(() => air.remove([feature.id]));
      await until(() => !air.map.getLayer('rl:camera-gpu'), 'late camera removal');
      check(await pickAt(0, .0008) === '', 'Late removal retained camera picking');
      await untilPixel(air, [0, .0008], false, 'Late camera pixel retirement');
      duringFrame(() => air.upsert([feature]));
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'late camera identity reuse');
      available = false;
      air.retryUpdates();
      await until(() => Boolean(finish) && air.getEntityState(feature.id)?.coverage === 'loading', 'pending retained retry');
      air.configure({ basemap: style('#ffffff') });
      await until(() => Boolean(air.map.getLayer('rl:camera-gpu')), 'camera layer after style rebuild');
      check(await pickAt(0, .0008) === camera.id, 'Style rebuild dropped retained camera picking');
      await untilPixel(air, [0, .0008], true, 'Retained camera pixels after native terrain style rebuild');
      available = true;
      finish!(); finish = undefined;
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'retained camera retry');
      installInputLayer();
      const gl = air.map.getCanvas().getContext('webgl2'), extension = gl?.getExtension('WEBGL_lose_context');
      if (!gl || !extension) throw new Error('Actual camera context loss is unavailable');
      let lost = false, loseAfterPreparation = true;
      air.map.once('webglcontextlost', () => { lost = true; });
      const current: MapFeature = { ...feature, entity: { ...feature.entity,
        attachments: [{ ...camera, id: 'after-loss', color: '#0000ff' }] } };
      const offPreparation = air.on('entitychange', () => {
        if (!loseAfterPreparation || air.getEntityState(feature.id)?.coverage !== 'loading') return;
        loseAfterPreparation = false; extension.loseContext();
      });
      try {
        duringFrame(() => air.upsert([current]));
        await until(() => lost, 'context loss during pending camera topology publication');
      } finally { offPreparation(); }
      let restored = false;
      air.map.once('webglcontextrestored', () => { restored = true; });
      extension.restoreContext();
      await until(() => restored && air.getEntityState(feature.id)?.coverage === 'ready', 'current camera after actual context restoration');
      await until(() => air.map.loaded(), 'restored native camera settles');
      check(Boolean(air.map.getTerrain()), 'Context restoration did not restore configured native terrain');
      check(await pickAt(0, .0008) === 'after-loss', 'Context restoration revived the retired camera identity');
      await untilPixel(air, [0, .0008], true, 'Current camera pixels after context restoration');
      const pixel = await pixelAt(air, [0, .0008], 8000, 'current restored camera color');
      check(pixel.blue > pixel.green + 35, `Context restoration republished stale camera appearance: ${JSON.stringify(pixel)}`);
      await observeIdle(air, 'camera topology restoration').assertQuiet();
      installInputLayer();
      duringFrame(() => air.remove([feature.id]));
      await until(() => !air.map.getLayer('rl:camera-gpu'), 'restored camera retirement');
      await untilPixel(air, [0, .0008], false, 'Restored camera pixels retired');
      duringFrame(() => air.upsert([current]));
      await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'camera before native teardown');
      let replacement: ReturnType<typeof createViewport> | undefined;
      duringFrame(() => {
        air.destroy();
        check(!air.map.getCanvas().isConnected, 'Camera teardown retained its canvas during the native frame');
        replacement = own(createViewport({ container, basemap: style(), logger: () => {} }));
      });
      await until(() => Boolean(replacement), 'camera teardown remount');
      if (!replacement) throw new Error('Replacement viewport was not mounted');
      await replacement.ready;
      air.destroy();
      check(replacement.map.getCanvas().isConnected && container.classList.contains('maplibregl-map'), 'Old camera retirement removed the replacement viewport');
      await until(() => replacement?.map.loaded() === true, 'replacement viewport settles');
      await observeIdle(replacement, 'native camera teardown remount').assertQuiet();
    } finally {
      finish?.();
      off();
      air.destroy();
    }
  },
  "GPU visibility preserves flat-ground coverage at long range and caches terrain during movement": async caseContext => {
    const { own, container, until } = caseContext;
    const meters = Math.PI / 180 * 6371008.8;
    let samples = 0;
    const air = own(createViewport({ container, basemap: style('#000000'),
      elevationSampler: { sample: () => { samples++; return 0; }, prepare: async () => {} },
      camera: { center: [0, 4000 / meters], zoom: 16, pitch: 0 }, logger: () => {} }));
    await air.ready;
    const feature: MapFeature = { ...point('gpu-flat'), entity: { altitude: { meters: 2000, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, color: '#00ff00', blockedColor: '#ff0000',
        fillOpacity: .6, blockedOpacity: .6, wireframe:true, volumeOpacity:.1, bearing: 0, elevation: -10, fovX: 60, fovY: 40, range: 6001 }] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'GPU flat coverage');
    await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
    const pixels = await new Promise<number[][]>(resolve => {
      air.map.once('render', () => {
        const canvas=air.map.getCanvas(), gl=canvas.getContext('webgl2')!, values:number[][]=[];
        for (const east of [-200,200]) {
          const p=air.map.project([east/meters,4000/meters]), pixel=new Uint8Array(4), scale=canvas.width/canvas.clientWidth;
          gl.readPixels(Math.round(p.x*scale),canvas.height-1-Math.round(p.y*scale),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
          values.push([...pixel]);
        }
        resolve(values);
      }); air.map.triggerRepaint();
    });
    check(pixels.every(p => p[1]! > 100 && p[0]! < 25), 'Flat terrain falsely blocked: '+JSON.stringify(pixels));
    // Count actual sensor-depth submissions while changing appearance on a stationary camera.
    const gl = air.map.getCanvas().getContext('webgl2')!;
    const drawElements = gl.drawElements;
    let sensorPasses = 0;
    gl.drawElements = function(...args: Parameters<WebGL2RenderingContext['drawElements']>) {
      const viewport = this.getParameter(this.VIEWPORT) as Int32Array;
      if (viewport[2] === 2048 && this.getParameter(this.FRAMEBUFFER_BINDING)) sensorPasses++;
      return drawElements.apply(this, args);
    };
    try {
      const camera = feature.entity!.attachments![0] as CameraAttachment;
      const maskId = air.map.getStyle().layers.find(layer => layer.id.startsWith('rl:camera-mask:'))!.id;
      for (const opacity of [.2, .8, .4]) {
        air.upsert([{...feature, entity: {...feature.entity!, attachments: [{...camera, color: '#0000ff', fillOpacity: opacity}]}}]);
        await until(() => {
          const image = air.map.getSource<ImageSource>(maskId)?.image;
          return image instanceof ImageData && image.data.some((value, i) => i % 4 === 2 && value === 255 && Math.abs(image.data[i+1]! - opacity*255) < 2);
        }, 'cached visibility restyled');
      }
      check(sensorPasses === 0, `Appearance edits reran ${sensorPasses} sensor depth passes`);
      air.upsert([feature]);
      await until(() => {
        const image = air.map.getSource<ImageSource>(maskId)?.image;
        return image instanceof ImageData && image.data.some((value, i) => i % 4 === 1 && value === 255);
      }, 'original appearance restored');
      check(sensorPasses === 0, 'Restoring appearance reran visibility');
      air.upsert([{...feature, entity: {...feature.entity!, attachments: [{...camera, bearing: 15}]}}]);
      await until(() => sensorPasses > 0, 'changed camera aim recomputed depth');
    } finally { gl.drawElements = drawElements; }
    const assertSynchronized=()=>{
      const gpu=air.map.getLayer('rl:camera-gpu') as unknown as {implementation:{cameras:Map<string,{published?:{origin:number[]}}>}};
      const geometry=air.map.getLayer('rl:entities') as unknown as {implementation:{draws:{attachmentId?:string;vertices:number[][]}[]}};
      const published=gpu.implementation.cameras.values().next().value?.published;
      const corner=geometry.implementation.draws.find(draw=>draw.attachmentId==='camera')?.vertices[0];
      check(!!published&&!!corner,'Published camera geometry missing');
      check(JSON.stringify(published!.origin)===JSON.stringify(corner),'Wireframe and mask use different poses');
    };
    const initialSamples=samples;
    for(let i=0;i<24;i++) {
      air.upsert([{...feature,geometry:{type:'Point',coordinates:[i*.000001,0]}}]);
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      assertSynchronized();
    }
    assertSynchronized();
    check(samples-initialSamples<=30,'Movement rebuilt terrain: '+(samples-initialSamples)+' samples');
    air.remove([feature.id]);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    check(!air.map.getStyle().layers.some(layer=>layer.id.startsWith('rl:camera-mask:')), 'Removed GPU mask remains');
    check(!air.map.getLayer('rl:camera-gpu'), 'Last camera removal retained GPU resources');
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'GPU camera recreated after removal');
    await new Promise<void>(resolve => {
      air.map.once('style.load', () => resolve());
      air.configure({ basemap: style('#101010') });
    });
    await until(() => {
      const mask = air.map.getStyle().layers.find(layer => layer.id.startsWith('rl:camera-mask:'));
      const image = mask && air.map.getSource<ImageSource>(mask.id)?.image;
      return image instanceof ImageData && image.data.some((value, i) => i % 4 === 3 && value > 0);
    }, 'GPU mask republished after style replacement');
    air.configure({ entityVisibility: { footprints: false, zones: false, groundLines: false } });
    await until(() => !air.map.getLayer('rl:camera-gpu'), 'Hidden cameras release GPU resources');
    air.configure({ entityVisibility: { footprints: true, zones: false, groundLines: false } });
    await until(() => Boolean(air.map.getLayer('rl:camera-gpu')) && air.getEntityState(feature.id)?.coverage === 'ready', 'Visible camera restores GPU resources');
    air.destroy();
  },
  "GPU grid stays clear across a sloped plane during movement": async caseContext => {
    const { own, container, until } = caseContext;
    const meters = Math.PI / 180 * 6371008.8;
    let samples = 0;
    const air = own(createViewport({ container, basemap: style('#000000'),
      elevationSampler: { sample: (_lng, lat) => { samples++; return lat * meters * .4; } },
      camera: { center: [0, 4000 / meters], zoom: 16, pitch: 0 }, logger: () => {} }));
    await air.ready;
    const feature: MapFeature = { ...point('gpu-flat'), entity: { altitude: { meters: 2000, reference: 'ground' },
      attachments: [{ id: 'camera', type: 'camera', terrainVisibility: true, color: '#00ff00', blockedColor: '#ff0000',
        fillOpacity: .6, blockedOpacity: .6, bearing: 0, elevation: -10, fovX: 60, fovY: 40, range: 6001 }] } };
    air.upsert([feature]);
    await until(() => air.getEntityState(feature.id)?.coverage === 'ready', 'GPU flat coverage');
    await new Promise<void>(resolve => air.map.once('idle', () => resolve()));
    const pixels = await new Promise<number[][]>(resolve => {
      air.map.once('render', () => {
        const canvas=air.map.getCanvas(), gl=canvas.getContext('webgl2')!, values:number[][]=[];
        for (const east of [-200,200]) {
          const p=air.map.project([east/meters,4000/meters]), pixel=new Uint8Array(4), scale=canvas.width/canvas.clientWidth;
          gl.readPixels(Math.round(p.x*scale),canvas.height-1-Math.round(p.y*scale),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
          values.push([...pixel]);
        }
        resolve(values);
      }); air.map.triggerRepaint();
    });
    check(pixels.every(p => p[1]! > 100 && p[0]! < 25), 'Flat terrain falsely blocked: '+JSON.stringify(pixels));
    const maskId=air.map.getStyle().layers.find(layer=>layer.id.startsWith('rl:camera-mask:'))!.id;
    const assertClear=()=> {
      const image=air.map.getSource<ImageSource>(maskId)!.image;
      check(image instanceof ImageData,'GPU mask missing');
      if(image instanceof ImageData){
        let red=0,filled=0;
        for(let i=0;i<image.data.length;i+=4)if(image.data[i+3]!>0){filled++;if(image.data[i]!>25)red++;}
        check(filled>100,'Slope mask unexpectedly empty');
        check(red===0,`Unobstructed slope has ${red}/${filled} false blocked pixels`);
      }
    };
    assertClear();
    const initialSamples=samples;
    for(let i=0;i<24;i++) {
      air.upsert([{...feature,geometry:{type:'Point',coordinates:[i*.000001,0]}}]);
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      assertClear();
    }
    check(samples-initialSamples<=30,'Movement rebuilt terrain: '+(samples-initialSamples)+' samples');
    air.remove([feature.id]);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    check(!air.map.getStyle().layers.some(layer=>layer.id.startsWith('rl:camera-mask:')), 'Removed GPU mask remains');
    air.destroy();
  },
} satisfies BrowserCaseModule;
