type Color = [number, number, number, number];
type Rgb = [number, number, number];

const FALLBACK_COLOR: [number, number, number] = [0.13, 0.43, 0.36];
const MAX_COLOR_CACHE_SIZE = 128;
const colors = new Map<string, Rgb>();

export type ColorContextBehavior = 'fallback' | 'throw';
export type ColorOptions = {
  contextBehavior?: ColorContextBehavior;
  initialCss?: string;
};

/** Convert a CSS color once while keeping consumer-controlled cache growth bounded. */
export function parseColor(
  css: string,
  alpha: number,
  options: ColorOptions = {},
): Color {
  const key = JSON.stringify([options.initialCss ?? '#000000', css]);
  const cached = colors.get(key);
  if (cached) return [cached[0], cached[1], cached[2], alpha];

  const context = new OffscreenCanvas(1, 1).getContext('2d');
  if (!context) {
    if (options.contextBehavior === 'throw') throw new Error('Color parsing requires a 2D canvas context.');
    return [FALLBACK_COLOR[0], FALLBACK_COLOR[1], FALLBACK_COLOR[2], alpha];
  }

  if (options.initialCss !== undefined) context.fillStyle = options.initialCss;
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const pixel = context.getImageData(0, 0, 1, 1).data;
  const rgb: Rgb = [pixel[0]! / 255, pixel[1]! / 255, pixel[2]! / 255];
  colors.set(key, rgb);
  if (colors.size > MAX_COLOR_CACHE_SIZE) {
    const oldest = colors.keys().next().value;
    if (oldest !== undefined) colors.delete(oldest);
  }
  return [rgb[0], rgb[1], rgb[2], alpha];
}
