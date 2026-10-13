import { attachDrawing, attachInteractions, createViewport, RidgelineError, shapeGeometry } from '@ridgeline/map';
import type { FeatureStyle, MapFeature, Viewport } from '@ridgeline/map';
import { GeoJSONSource } from 'maplibre-gl';
import { groundModelGlb } from './model-placement-fixtures';
import { waitForVisible } from './browser-observation';

type Context = { container: HTMLDivElement; setCurrent(viewport: Viewport): void;
  until(predicate: () => boolean, description: string, timeout?: number): Promise<void> };
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const basemap = { version: 8 as const, sources: {}, layers: [{ id: 'background', type: 'background' as const, paint: { 'background-color': '#ffffff' } }] };
const point = (id: string, lng: number): MapFeature => ({ type: 'Feature', id, properties: {}, geometry: { type: 'Point', coordinates: [lng, 0] } });
async function idle(viewport: Viewport) {
  await new Promise<void>(resolve => { viewport.map.once('idle', () => resolve()); viewport.map.triggerRepaint(); });
}
async function pixel(viewport: Viewport, position: { x: number; y: number }) {
  return new Promise<Uint8Array>((resolve, reject) => {
    viewport.map.once('render', () => {
      const canvas = viewport.map.getCanvas(), gl = canvas.getContext('webgl2');
      if (!gl) { reject(new Error('WebGL2 unavailable')); return; }
      const ratio = canvas.width / canvas.clientWidth, color = new Uint8Array(4);
      gl.readPixels(Math.floor(position.x * ratio), canvas.height - 1 - Math.floor(position.y * ratio), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, color);
      resolve(color);
    }); viewport.map.triggerRepaint();
  });
}
async function observeGlyphs(viewport: Viewport, id: string) {
  const deadline = performance.now() + 8_000;
  let counts = [0, 0];
  do {
    counts = await new Promise<number[]>(resolve => {
      viewport.map.once('render', () => {
        const canvas = viewport.map.getCanvas(), gl = canvas.getContext('webgl2');
        check(gl, 'Glyph evidence requires WebGL2');
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const red = [0, 0];
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i]! > 180 && pixels[i + 1]! < 70 && pixels[i + 2]! < 70) red[0]!++;
          if (pixels[i + 2]! > 180 && pixels[i + 1]! < 70 && pixels[i]! < 70) red[1]!++;
        }
        resolve(red);
      }); viewport.map.triggerRepaint();
    });
    const index = id === 'first' ? 0 : 1;
    if (counts[index]! > 20 && counts[1 - index]! < 5) return;
  } while (performance.now() < deadline);
  throw new Error(`Visible glyphs disagree with placed ${id} label: red/blue counts ${counts}`);
}
function input() {
  const { browserMouse, browserKey, browserKeyDown, browserKeyUp, browserClick } = window;
  check(browserMouse && browserKey && browserKeyDown && browserKeyUp && browserClick, 'Native mouse/modifier/keyboard bridge unavailable');
  return { mouse: async (action: 'down' | 'move' | 'up' | 'click', x: number, y: number) => {
    const canvas = document.querySelector('#map canvas'); check(canvas, 'Native input canvas absent');
    const bounds = canvas.getBoundingClientRect(); await browserMouse(action, bounds.left + x, bounds.top + y);
  }, key: browserKey, down: browserKeyDown, up: browserKeyUp, click: browserClick };
}
async function click(viewport: Viewport, lng: number, shift = false) {
  const bridge = input(), position = viewport.map.project([lng, 0]);
  if (shift) await bridge.down('Shift');
  try { await bridge.mouse('click', position.x, position.y); } finally { if (shift) await bridge.up('Shift'); }
}
async function rectangle(viewport: Viewport, from: { x: number; y: number }, to: { x: number; y: number }, additive = false) {
  const bridge = input();
  await bridge.down('Alt'); if (additive) await bridge.down('Shift');
  try { await bridge.mouse('move', from.x, from.y); await bridge.mouse('down', from.x, from.y);
    await bridge.mouse('move', to.x, to.y); await bridge.mouse('up', to.x, to.y); }
  finally { if (additive) await bridge.up('Shift'); await bridge.up('Alt'); }
}
export const selectionWorkflowCases: readonly { name: string; run(context: Context): Promise<void> }[] = [
  { name: 'Feature presentation basemap changes survive elevation preparation abort callbacks', async run(context) {
    for (const trigger of ['abort', 'native'] as const) {
    let preparing = false, patched = false, aborted = false, switching = false;
    const feature = point('pending', 0); feature.entity = { altitude: { meters: 100, reference: 'ground' } };
    const viewport = createViewport({ container: context.container, basemap: { ...basemap, name: 'First' }, camera: { center: [0, 0], zoom: 15 },
      features: [feature], logger: () => {}, entityVisibility: { footprints: false, zones: false, groundLines: false }, elevationSampler: {
        sample: () => null,
        prepare: (_positions, signal) => new Promise<void>(resolve => {
          preparing = true;
          signal.addEventListener('abort', () => {
            aborted = true;
            if (trigger === 'abort' && !patched) { patched = true; viewport.configure({ entityVisibility: { ...viewport.getConfiguration().entityVisibility, groundLines: true } }); }
            resolve();
          }, { once: true });
        }),
      } });
    context.setCurrent(viewport);
    try {
      await viewport.ready; await context.until(() => preparing, 'real pending elevation preparation');
      viewport.map.on('styledataloading', () => {
        if (trigger === 'native' && switching && !patched) { patched = true; viewport.configure({ entityVisibility: { ...viewport.getConfiguration().entityVisibility, groundLines: true } }); }
      });
      switching = true;
      viewport.configure({ basemap: { ...basemap, name: 'Second', layers: [{ ...basemap.layers[0]!, id: 'second-background' }] },
        elevation: { tiles: ['https://unused.invalid/elevation/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 512 } });
      check(aborted && patched && viewport.getConfiguration().entityVisibility.groundLines, `${trigger} callback did not retain the patch and required elevation reset`);
      await context.until(() => viewport.map.getStyle()?.name === 'Second' && Boolean(viewport.map.getLayer('second-background')) && Boolean(viewport.map.getLayer('rl:points')), 'native basemap after preparation abort reentry');
      viewport.setCamera({ center: [.001, 0] });
      check(viewport.map.getCenter().lng === .001, 'Callback reentry left the camera unusable');
    } finally { viewport.destroy(); }
    }
  } },
];
