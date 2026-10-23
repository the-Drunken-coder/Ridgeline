import assert from 'node:assert/strict';
import test from 'node:test';
import { cssToPixel, pixelToCss, waitForVisible } from './browser/browser-observation';

test('CSS and WebGL pixels use independent canvas scales and opposite vertical origins', () => {
  const image = { width: 600, height: 400, cssWidth: 300, cssHeight: 100, origin: 'bottom-left' as const };
  assert.deepEqual(cssToPixel(image, { x: 75, y: 25 }), { x: 150, y: 299 });
  assert.deepEqual(pixelToCss(image, { x: 150, y: 299 }), { x: 75.25, y: 25.125 });
});

test('screenshot pixels use their actual dimensions and retain the top-left origin', () => {
  const image = { width: 800, height: 600, cssWidth: 400, cssHeight: 300, origin: 'top-left' as const };
  assert.deepEqual(cssToPixel(image, { x: 100, y: 50 }), { x: 200, y: 100 });
  assert.deepEqual(pixelToCss(image, { x: 200, y: 100 }), { x: 100.25, y: 50.25 });
});

test('visible readiness has a deadline even when its observation never completes', { timeout: 1000 }, async () => {
  await assert.rejects(waitForVisible(() => new Promise<never>(() => {}), () => false,
    { timeout: 25, description: 'blocked pixel read' }), /blocked pixel read/);
});
