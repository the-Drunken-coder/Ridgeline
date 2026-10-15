import { createViewport } from '@ridgeline/map';
import type { MapFeature, RidgelineError, Viewport } from '@ridgeline/map';
import { observeIdle } from './browser-idle';
import { captureMapPixels, cssToPixel, waitForVisible } from './browser-observation';

type Context = { container: HTMLDivElement; setCurrent(viewport: Viewport): void;
  until(predicate: () => boolean, description: string, timeout?: number): Promise<void> };
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

async function flatDem() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d'); check(context, 'DEM fixture canvas unavailable');
  context.fillStyle = 'rgb(128,0,0)'; context.fillRect(0, 0, 256, 256);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  check(blob, 'DEM fixture PNG encoding failed');
  return blob;
}

export const groundAreaReviewCases: readonly { name: string; run(context: Context): Promise<void> }[] = [
  { name: 'Large ground areas complete through the raster viewport and stay quiet after eviction', async run(context) {
    const blob = await flatDem(), prefix = 'https://ground-area-review.test/dem/';
    const fetch = globalThis.fetch, tiles = new Set<string>(), zooms = new Set<string>();
    let requests = 0;
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith(prefix)) return fetch(input, init);
      init?.signal?.throwIfAborted();
      const key = url.slice(prefix.length);
      requests++; tiles.add(key); zooms.add(key.split('/')[0]!);
      return new Response(blob, { headers: { 'content-type': 'image/png' } });
    };
    const errors: RidgelineError[] = [], clicks: { entityId: string; attachmentId: string }[][] = [];
    let viewport: Viewport | undefined;
    try {
      viewport = createViewport({ container: context.container,
        basemap: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }] },
        camera: { center: [6, 46], zoom: 12, pitch: 0 }, terrain: false, hillshade: false,
        elevation: { tiles: [`${prefix}{z}/{x}/{y}.png`], encoding: 'terrarium', minzoom: 12, maxzoom: 12, tileSize: 256 },
        style: () => ({ color: '#ff0000', radius: 6 }), onError: error => errors.push(error), logger: () => {} });
      context.setCurrent(viewport);
      const map = viewport;
      map.on('click', event => clicks.push(event.attachments));
      await map.ready;
      const feature: MapFeature = { type: 'Feature', id: 'large-ground', properties: {},
        geometry: { type: 'Point', coordinates: [6, 46] },
        entity: { attachments: [{ id: 'area', type: 'circle', radius: 100000, color: '#0000ff' }] } };
      map.upsert([feature]);
      await context.until(() => {
        check(requests <= 8000, `Ground sampling did not converge after ${requests} raster downloads`);
        check(errors.length === 0, `Ground sampling diagnostics ${errors.map(error => error.message).join(', ')}`);
        return map.getEntityState('large-ground')?.coverage === 'ready';
      }, '100 km ground circle raster readiness', 60000);
      const state = map.getEntityState('large-ground');
      check(state?.placement === 'ground' && state.ground === 0 && state.coverage === 'ready',
        `Unexpected public ground state ${JSON.stringify(state)}`);
      check(tiles.size > 512, `Only ${tiles.size} unique raster tiles downloaded`);
      check(zooms.size === 1 && zooms.has('12'), `Unexpected raster zooms ${[...zooms]}`);
      const target = map.map.project([6.04, 46]);
      await waitForVisible(() => captureMapPixels(map), image => {
        const pixel = cssToPixel(image, target), index = (pixel.y * image.width + pixel.x) * 4;
        return image.bytes[index + 2]! > image.bytes[index]! + 30 && image.bytes[index + 2]! > image.bytes[index + 1]! + 30;
      }, { timeout: 8000, description: 'blue ground area away from its red entity marker' });
      const matches = (hit: { entityId: string; attachmentId: string }) => hit.entityId === 'large-ground' && hit.attachmentId === 'area';
      check(map.queryFeatures([{ x: target.x - 1, y: target.y - 1 }, { x: target.x + 1, y: target.y + 1 }]).attachments.some(matches),
        'Visible ground area absent from public rectangle query');
      check(window.drawingPointer, 'Native pointer bridge unavailable');
      await window.drawingPointer('click', target.x, target.y);
      check(clicks.at(-1)?.some(matches), 'Native click missed the visible ground attachment');
      let settled = false;
      const idle = () => { settled = true; };
      map.map.on('idle', idle);
      try {
        map.map.triggerRepaint();
        await context.until(() => settled && map.map.loaded() && !map.map.isMoving(), 'ground area native settlement', 8000);
      } finally { map.map.off('idle', idle); }
      const completedRequests = requests;
      const observation = await observeIdle(map, '100 km raster ground area after eviction').assertQuiet();
      check(requests === completedRequests, `Settled terrain requested ${requests - completedRequests} raster tiles`);
      check(map.getEntityState('large-ground')?.coverage === 'ready', 'Quiet interval lost current ground readiness');
      check(errors.length === 0, `Unexpected ground diagnostics ${errors.map(error => error.message).join(', ')}`);
      Reflect.set(window, 'groundAreaReviewResult', { requests, uniqueTiles: tiles.size, zooms: [...zooms],
        state: map.getEntityState('large-ground'), click: clicks.at(-1), quietMs: observation.observedMs, renders: observation.renders });
    } finally {
      Reflect.set(window, 'groundAreaReviewDownloads', { requests, uniqueTiles: tiles.size, zooms: [...zooms],
        state: viewport?.getEntityState('large-ground'), errors: errors.map(error => error.message) });
      try { viewport?.destroy(); } finally { globalThis.fetch = fetch; }
    }
  } },
];
