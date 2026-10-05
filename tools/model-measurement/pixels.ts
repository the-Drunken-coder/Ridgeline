type Pixels = { width: number; height: number; data: Uint8ClampedArray };
/** Count foreground within a physical-pixel region, including supported translucent materials. */
export function foregroundPixels(image: Pixels, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  let count = 0;
  for (let y = Math.max(0, Math.floor(bounds.minY)); y < Math.min(image.height, bounds.maxY); y++)
    for (let x = Math.max(0, Math.floor(bounds.minX)); x < Math.min(image.width, bounds.maxX); x++) {
      const i = (y * image.width + x) * 4;
      if (image.data[i + 3]! > 16 && Math.max(Math.abs(image.data[i]! - 247), Math.abs(image.data[i + 1]! - 247), Math.abs(image.data[i + 2]! - 247)) > 30) count++;
    }
  return count;
}
