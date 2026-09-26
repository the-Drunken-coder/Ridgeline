import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ElevationBounds } from '../src/elevation-bounds';

test('DEM bounds never underestimate peaks, including odd tile sizes and unknown pixels', () => {
  const size = 5, values = Float32Array.from({ length: size * size }, (_, i) => i === 12 ? 500 : -i);
  const bounds = new ElevationBounds(values, size);
  for (let y0 = 0; y0 < size; y0++) for (let x0 = 0; x0 < size; x0++)
    for (let y1 = y0; y1 < size; y1++) for (let x1 = x0; x1 < size; x1++) {
      let actual = -Infinity;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) actual = Math.max(actual, values[y * size + x]!);
      assert.ok(bounds.maximum(x0, y0, x1, y1) >= actual);
    }
  values[12] = NaN;
  assert.equal(new ElevationBounds(values, size).maximum(1, 1, 3, 3), Infinity);
});
