import type { MapFeature, Viewport } from '@ridgeline/map';
import type { StyleSpecification } from 'maplibre-gl';

export const style = (color = '#e9efea'): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': color } }] });
export const point = (id: string, lng = 0): MapFeature => ({ type: 'Feature', id, properties: { name: id }, geometry: { type: 'Point', coordinates: [lng, 0] } });
export const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

export async function until(predicate: () => boolean, description: string, timeout = 8_000) {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeout) throw new Error(`Timed out: ${description}`);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
}

export async function pointer(action: 'move' | 'click', point: { x: number; y: number }) {
  const drawingPointer = window.drawingPointer;
  if (!drawingPointer) throw new Error('Playwright pointer bridge is unavailable.');
  await drawingPointer(action, point.x, point.y);
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

export async function browserKey(key: string) {
  if (!window.browserKey) throw new Error('Playwright keyboard bridge is unavailable.');
  await window.browserKey(key);
}

export async function browserClick(selector: string) {
  if (!window.browserClick) throw new Error('Playwright click bridge is unavailable.');
  await window.browserClick(selector);
}

export async function browserDrag(fromX: number, fromY: number, toX: number, toY: number) {
  if (!window.browserDrag) throw new Error('Playwright drag bridge is unavailable.');
  await window.browserDrag(fromX, fromY, toX, toY);
}

export async function pixelAt(viewport: Viewport, coordinates: [number, number], timeoutMs: number, description: string): Promise<{ red: number; green: number; blue: number }> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); viewport.map.off('render', onRender); };
    const onRender = () => {
      cleanup();
      try {
        const canvas = viewport.map.getCanvas();
        const gl = canvas.getContext('webgl2');
        if (!gl) throw new Error(`WebGL2 unavailable while reading pixel: ${description}`);
        const scale = canvas.width / canvas.clientWidth;
        const point = viewport.map.project(coordinates);
        const pixel = new Uint8Array(4);
        gl.readPixels(Math.round(point.x * scale), canvas.height - 1 - Math.round(point.y * scale), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const [red, green, blue] = pixel;
        if (red === undefined || green === undefined || blue === undefined) throw new Error(`Incomplete pixel sample: ${description}`);
        resolve({ red, green, blue });
      } catch (error) { reject(error); }
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for map render: ${description}`));
    }, timeoutMs);
    try {
      viewport.map.on('render', onRender);
      viewport.map.triggerRepaint();
    } catch (error) { cleanup(); reject(error); }
  });
}

export async function untilPixel(viewport: Viewport, coordinates: [number, number], visible: boolean, description: string) {
  const start = performance.now();
  while (true) {
    const remaining = 8_000 - (performance.now() - start);
    if (remaining <= 0) throw new Error(`Timed out: ${description}`);
    const { red, green, blue } = await pixelAt(viewport, coordinates, remaining, description);
    const isLine = Math.max(red, green, blue) - Math.min(red, green, blue) > 35;
    if (isLine === visible) return;
    if (performance.now() - start > 8_000) throw new Error(`Timed out: ${description} (${red}, ${green}, ${blue})`);
  }
}
