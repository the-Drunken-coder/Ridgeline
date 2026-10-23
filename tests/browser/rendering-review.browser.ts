import { createViewport, RidgelineError } from '@ridgeline/map';
import type { MapFeature, Viewport } from '@ridgeline/map';
import { captureMapPixels, pixelToCss, waitForVisible } from './browser-observation';
import type { PixelImage } from './browser-observation';
import { encodeGlb, solidGlb } from './model-fixtures';

import type { BrowserCaseContext as Context, BrowserCaseModule } from './context';
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const airborne = (id = 'target'): MapFeature & { entity: NonNullable<MapFeature['entity']> } => ({ type: 'Feature', id, properties: {},
  geometry: { type: 'Point', coordinates: [0, 0] }, entity: { altitude: { reference: 'sea-level', meters: 100 } } });
function create(context: Context, errors: RidgelineError[] = []) {
  const viewport = context.own(createViewport({ container: context.container,
    basemap: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }] },
    camera: { center: [0, 0], zoom: 17, pitch: 0 }, elevationSampler: { sample: () => 0 },
    style: () => ({ color: '#00ff00', radius: 10 }), onError: error => errors.push(error), logger: () => {} }));
  return viewport;
}
function bounds(image: PixelImage, color: 'green' | 'blue' | 'magenta') {
  let left = image.width, right = -1, top = image.height, bottom = -1, count = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 4, r = image.bytes[i]!, g = image.bytes[i + 1]!, b = image.bytes[i + 2]!;
    if (image.bytes[i + 3]! < 128) continue;
    if (color === 'green' ? g > r + 100 && g > b + 100 : color === 'blue' ? b > r + 30 && b > g + 30 : r > g + 80 && b > g + 80) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
    }
  }
  return { count, width: (right - left + 1) * image.cssWidth / image.width,
    height: (bottom - top + 1) * image.cssHeight / image.height,
    center: pixelToCss(image, { x: (left + right) / 2, y: (top + bottom) / 2 }) };
}
async function visible(viewport: Viewport, color: 'green' | 'blue' | 'magenta') {
  return waitForVisible(() => captureMapPixels(viewport), image => bounds(image, color).count > 40,
    { timeout: 10000, description: `${color} rendering review pixels` });
}
async function click(point: { x: number; y: number }) {
  check(window.drawingPointer, 'Native pointer bridge unavailable');
  await window.drawingPointer('click', point.x, point.y);
}
function wireRun(image: PixelImage, marker: { x: number; y: number }) {
  const x = Math.floor((marker.x + 5) * image.width / image.cssWidth);
  const runs: { start: number; count: number }[] = [];
  let start = -1;
  for (let y = 0; y <= image.height; y++) {
    const i = (y * image.width + x) * 4;
    const wire = y < image.height && Math.abs(image.bytes[i]! - 139) < 8 &&
      Math.abs(image.bytes[i + 1]! - 171) < 8 && Math.abs(image.bytes[i + 2]! - 151) < 8;
    if (wire && start < 0) start = y;
    if (!wire && start >= 0) { runs.push({ start, count: y - start }); start = -1; }
  }
  const run = runs.filter(run => run.count * image.cssHeight / image.height > 2).sort((a, b) => a.count - b.count)[0];
  check(run, 'No isolated camera wireframe cross-section');
  return { width: run.count * image.cssHeight / image.height,
    center: pixelToCss(image, { x, y: run.start + (run.count - 1) / 2 }) };
}
function excessiveGlb() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  return encodeGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { componentType: 5125, count: 6000, type: 'SCALAR' }],
    meshes: [{ primitives: Array.from({ length: 40 }, () => ({ attributes: { POSITION: 0 }, indices: 1 })) }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], extras: { padding: ' '.repeat(6000) },
  }, new Uint8Array(positions.buffer));
}
async function allocationFailure(viewport: Viewport) {
  try { await viewport.registerModel('bounded', { bytes: excessiveGlb() }); }
  catch (error) {
    check(error instanceof RidgelineError && error.code === 'MODEL_LOAD_FAILED' && error.context.modelId === 'bounded' &&
      error.context.operation === 'registerModel' && error.cause instanceof Error && error.cause.message === 'GLB_DECODED_ALLOCATION_LIMIT',
    `Unexpected allocation rejection ${String(error)}`);
    return;
  }
  throw new Error('Cumulative allocation unexpectedly registered');
}


export const renderingReviewCases = {
  "Attachment markers and wireframes keep CSS size across map pixel ratios": async (context) => {
    check(devicePixelRatio === 2, 'This case requires browser deviceScaleFactor 2');
    const errors: RidgelineError[] = [], viewport = create(context, errors), feature = airborne();
    feature.entity.attachments = [{ id: 'camera', type: 'camera', range: 150, bearing: 0, elevation: -45,
      fovX: 50, fovY: 30, fillOpacity: 0, outline: false, wireframe: true, wireframeWidth: 8 }];
    const hits: { ids: string[]; attachments: string[] }[] = [];
    viewport.on('click', event => hits.push({ ids: event.features.map(feature => feature.id), attachments: event.attachments.map(hit => hit.attachmentId) }));
    try {
      await viewport.ready; viewport.upsert([feature]);
      for (const ratio of [1, 2, 1.25]) {
        viewport.map.setPixelRatio(ratio);
        const image = await visible(viewport, 'green'), marker = bounds(image, 'green');
        check(Math.abs(marker.width - 20) <= 1.1 && Math.abs(marker.height - 20) <= 1.1,
          `Marker CSS size ${marker.width} x ${marker.height} at map ratio ${ratio}`);
        const wire = wireRun(image, marker.center);
        check(Math.abs(wire.width - 8) <= 1.1, `Wireframe CSS width ${wire.width} at map ratio ${ratio}`);
        check(viewport.queryFeatures([{ x: marker.center.x - 1, y: marker.center.y - 1 },
          { x: marker.center.x + 1, y: marker.center.y + 1 }]).features.some(feature => feature.id === 'target'), 'Visible marker query missed');
        await click(marker.center); check(hits.at(-1)?.ids.includes('target'), 'Visible marker click missed');
        await click(wire.center); check(hits.at(-1)?.attachments.includes('camera'), 'Visible wireframe click missed');
      }
      check(errors.length === 0, `Unexpected rendering diagnostics ${errors.map(error => error.message)}`);
    } finally { viewport.destroy(); }
  },
  "Attachment picking follows successful frames and clears on native draw failure": async (context) => {
    const errors: RidgelineError[] = [], viewport = create(context, errors);
    const addLayer = viewport.map.addLayer;
    let fail = false, injected = 0, wrapped = false;
    viewport.map.addLayer = function (layer, before) {
      if (layer.id === 'rl:entities' && layer.type === 'custom') {
        wrapped = true;
        const render = layer.render;
        layer.render = function (gl, input) {
          const draw = gl.drawArrays;
          gl.drawArrays = function (...args) {
            if (fail) { injected++; throw new Error('TEST_ENTITY_DRAW_FAILURE'); }
            return draw.apply(this, args);
          };
          try { return render.call(this, gl, input); } finally { gl.drawArrays = draw; }
        };
      }
      return addLayer.call(this, layer, before);
    };
    const feature = airborne();
    feature.entity.attachments = [{ id: 'body', type: 'sphere', radius: 40, color: '#0000ff' }];
    const clicks: string[][] = [], diagnosticHits: number[] = [];
    const center = () => ({ x: viewport.map.getCanvas().clientWidth / 2, y: viewport.map.getCanvas().clientHeight / 2 });
    const query = () => { const point = center(); return viewport.queryFeatures([
      { x: point.x - 2, y: point.y - 2 }, { x: point.x + 2, y: point.y + 2 }]); };
    viewport.on('click', event => clicks.push(event.attachments.map(hit => hit.attachmentId)));
    viewport.on('diagnostic', error => {
      if (error.code === 'UPDATE_FAILED' && error.context.operation === 'entities') diagnosticHits.push(query().attachments.length);
    });
    try {
      await viewport.ready; check(wrapped, 'Entity native renderer was not wrapped');
      fail = true; viewport.upsert([feature]);
      await context.until(() => errors.some(error => error.cause instanceof Error && error.cause.message === 'TEST_ENTITY_DRAW_FAILURE'), 'initial native entity failure');
      check(injected === 1 && diagnosticHits[0] === 0, 'Initial failure retained a hit or retried automatically');
      check(bounds(await captureMapPixels(viewport), 'blue').count === 0, 'Failed first frame left attachment pixels');
      await click(center()); check(clicks.at(-1)?.length === 0, 'Never-drawn attachment was clickable');
      fail = false; viewport.retryUpdates();
      await visible(viewport, 'blue'); await click(center());
      check(clicks.at(-1)?.includes('body'), 'Successful retry did not restore actual attachment picking');
      fail = true; viewport.upsert([{ ...feature, properties: { revision: 2 } }]);
      await context.until(() => injected === 2, 'failure after a successful frame');
      check(diagnosticHits.length === 2 && diagnosticHits[1] === 0, 'Failure diagnostics observed old attachment hits');
      check(bounds(await captureMapPixels(viewport), 'blue').count === 0, 'Failed replacement left attachment pixels');
      check(query().attachments.length === 0, 'Failed displayed geometry remained in rectangle queries');
      await click(center()); check(clicks.at(-1)?.length === 0, 'Failed attachment remained clickable');
      check(viewport.getFeature('target')?.properties.revision === 2, 'Failure changed accepted data');
      fail = false; viewport.retryUpdates(); await visible(viewport, 'blue'); await click(center());
      check(clicks.at(-1)?.includes('body'), 'Second explicit retry did not recover picking');
    } finally { viewport.map.addLayer = addLayer; viewport.destroy(); }
  },
  "Model allocation rejection preserves public registration and recovers": async (context) => {
    const errors: RidgelineError[] = [], viewport = create(context, errors), feature = airborne();
    feature.entity = { ...feature.entity, heading: 0, model: { id: 'bounded' } };
    try {
      await viewport.ready; viewport.upsert([feature]); viewport.setSelection(['target']);
      await allocationFailure(viewport);
      check(viewport.getEntityState('target')?.model?.status === 'failed', 'Initial allocation failure status absent');
      await visible(viewport, 'green');
      await viewport.registerModel('bounded', { bytes: solidGlb(), metersPerUnit: 10 });
      await context.until(() => viewport.getEntityState('target')?.representation === 'model', 'valid registration recovery');
      const first = bounds(await visible(viewport, 'magenta'), 'magenta');
      await allocationFailure(viewport);
      check(viewport.getEntityState('target')?.model?.status === 'ready', 'Rejected replacement discarded working registration');
      check(bounds(await visible(viewport, 'magenta'), 'magenta').count === first.count, 'Rejected replacement changed working model pixels');
      check(viewport.getSelection()[0] === 'target', 'Rejected model changed consumer selection');
      await viewport.registerModel('bounded', { bytes: solidGlb(), metersPerUnit: 5 });
      const recovered = bounds(await visible(viewport, 'magenta'), 'magenta');
      check(recovered.count > 40, 'Valid model replacement did not render');
      check(errors.filter(error => error.cause instanceof Error && error.cause.message === 'GLB_DECODED_ALLOCATION_LIMIT').length === 2,
        'Allocation causes did not reach the public diagnostic path');
      const clicks: string[][] = [];
      viewport.on('click', event => clicks.push(event.features.map(feature => feature.id)));
      await click(recovered.center); check(clicks.at(-1)?.includes('target'), 'Recovered public model was not selectable');
    } finally { viewport.destroy(); }
  },
} satisfies BrowserCaseModule;
