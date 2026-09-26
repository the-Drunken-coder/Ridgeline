/** Conservative maxima over DEM pixels. Unknown pixels prevent skipping an area. */
export class ElevationBounds {
  private levels: { size: number; values: Float32Array }[];

  constructor(values: Float32Array, size: number) {
    this.levels = [{ values, size }];
    while (size > 1) {
      const nextSize = Math.ceil(size / 2), next = new Float32Array(nextSize * nextSize);
      for (let y = 0; y < nextSize; y++) for (let x = 0; x < nextSize; x++) {
        let maximum = -Infinity;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const xx = x * 2 + dx, yy = y * 2 + dy;
          if (xx >= size || yy >= size) continue;
          const value = values[yy * size + xx]!;
          maximum = Math.max(maximum, Number.isFinite(value) ? value : Infinity);
        }
        next[y * nextSize + x] = maximum;
      }
      this.levels.push({ values: next, size: nextSize });
      values = next; size = nextSize;
    }
  }

  /** Inclusive pixel rectangle; covering blocks may overestimate, never underestimate. */
  maximum(x0: number, y0: number, x1: number, y1: number) {
    const level = Math.min(this.levels.length - 1, Math.floor(Math.log2(Math.max(x1 - x0 + 1, y1 - y0 + 1))));
    const stride = 2 ** level, { values, size } = this.levels[level]!;
    let maximum = -Infinity;
    for (let y = Math.floor(y0 / stride); y <= Math.floor(y1 / stride); y++)
      for (let x = Math.floor(x0 / stride); x <= Math.floor(x1 / stride); x++) {
        const value = values[y * size + x]!;
        maximum = Math.max(maximum, Number.isFinite(value) ? value : Infinity);
      }
    return maximum;
  }
}
