import type { Viewport } from '@ridgeline/map';

type Point = { x: number; y: number };
export type PixelGeometry = {
  width: number; height: number; cssWidth: number; cssHeight: number;
  origin: 'top-left' | 'bottom-left';
};
export type PixelImage = PixelGeometry & { bytes: Uint8Array };

export function cssToPixel(image: PixelGeometry, point: Point): Point {
  const x = Math.floor(point.x * image.width / image.cssWidth);
  const y = Math.floor(point.y * image.height / image.cssHeight);
  return { x, y: image.origin === 'bottom-left' ? image.height - 1 - y : y };
}

export function pixelToCss(image: PixelGeometry, point: Point): Point {
  return {
    x: (point.x + .5) * image.cssWidth / image.width,
    y: (image.origin === 'bottom-left' ? image.height - point.y - .5 : point.y + .5) * image.cssHeight / image.height,
  };
}

export function captureMapPixels(viewport: Viewport, timeout = 8000): Promise<PixelImage> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); viewport.map.off('render', capture); };
    const capture = () => {
      cleanup();
      try {
        const canvas = viewport.map.getCanvas(), gl = canvas.getContext('webgl2');
        if (!gl) throw new Error('WebGL2 unavailable during pixel observation');
        const bounds = canvas.getBoundingClientRect();
        const bytes = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        resolve({ bytes, width: canvas.width, height: canvas.height,
          cssWidth: bounds.width, cssHeight: bounds.height, origin: 'bottom-left' });
      } catch (error) { reject(error); }
    };
    const timer = setTimeout(() => {
      cleanup(); reject(new Error('Timed out waiting for a rendered pixel observation'));
    }, timeout);
    viewport.map.on('render', capture);
    try { viewport.map.triggerRepaint(); } catch (error) { cleanup(); reject(error); }
  });
}

// The caller keeps its fixture-specific pixel criterion and receives the exact
// successful observation, including coordinates for subsequent real input.
export async function waitForVisible<T>(observe: (remainingMs: number) => Promise<T>, visible: (result: T) => boolean,
  options: { timeout: number; description: string; interval?: number }): Promise<T> {
  const deadline = performance.now() + options.timeout;
  const failure = new Error(`Timed out waiting for visible pixels: ${options.description}`);
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { stopped = true; reject(failure); }, options.timeout);
  });
  async function poll() {
    while (!stopped && performance.now() < deadline) {
      const result = await observe(Math.max(1, deadline - performance.now()));
      if (stopped) break;
      if (performance.now() <= deadline && visible(result)) return result;
      const remaining = deadline - performance.now();
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(options.interval ?? 100, remaining)));
    }
    throw failure;
  }
  try { return await Promise.race([poll(), expired]); }
  finally { stopped = true; clearTimeout(timer); }
}
