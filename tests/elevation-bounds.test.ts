import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ElevationBounds } from '../src/elevation-bounds';

test('DEM bounds stay finite and conservative for known pixels, including odd tile sizes', () => {
  const size = 5, values = Float32Array.from({ length: size * size }, (_, i) => i === 12 ? 500 : -i);
  const bounds = new ElevationBounds(values, size);
  for (let y0 = 0; y0 < size; y0++) for (let x0 = 0; x0 < size; x0++)
    for (let y1 = y0; y1 < size; y1++) for (let x1 = x0; x1 < size; x1++) {
      let actual = -Infinity;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) actual = Math.max(actual, values[y * size + x]!);
      const maximum = bounds.maximum(x0, y0, x1, y1);
      assert.ok(Number.isFinite(maximum), `Known terrain returned an unbounded maximum at ${x0},${y0}..${x1},${y1}`);
      assert.ok(maximum >= actual, `Peak was underestimated at ${x0},${y0}..${x1},${y1}`);
    }
  assert.ok(bounds.maximum(0, 0, 1, 1) === 0, 'A known low area should have a useful local bound');
  assert.equal(bounds.maximum(2, 2, 2, 2), 500);
  assert.equal(bounds.maximum(4, 4, 4, 4), -24, 'The odd-sized final pixel must be included');
});

test('unknown DEM pixels prevent an unsafe finite bound only where they can contribute', () => {
  const size = 5, values = Float32Array.from({ length: size * size }, (_, i) => i === 12 ? NaN : -i);
  const bounds = new ElevationBounds(values, size);
  assert.equal(bounds.maximum(1, 1, 3, 3), Infinity);
  assert.ok(bounds.maximum(0, 0, 1, 1) === 0);
});
