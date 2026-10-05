import assert from 'node:assert/strict';
import test from 'node:test';
import { foregroundPixels } from './pixels';

test('transparent globe background is empty while opaque and translucent model pixels count', () => {
  const image = { width: 3, height: 2, data: new Uint8ClampedArray([
    0, 0, 0, 0, 247, 247, 247, 255, 0, 200, 0, 128,
    0, 0, 0, 1, 255, 100, 20, 255, 0, 0, 0, 255,
  ]) };
  assert.equal(foregroundPixels(image, { minX: 0, minY: 0, maxX: 1, maxY: 1 }), 0);
  assert.equal(foregroundPixels(image, { minX: 0, minY: 0, maxX: 3, maxY: 2 }), 3);
});
