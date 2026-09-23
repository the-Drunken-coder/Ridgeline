import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_HILLSHADE, resolveHillshade } from '../src/hillshade';
import { RidgelineError } from '../src/errors';

test('hillshade patches preserve settings and isolate direction arrays', () => {
  const directions = [225, 270, 315];
  const first = resolveHillshade({ method: 'multidirectional', direction: directions });
  directions[0] = 0;
  const next = resolveHillshade({ intensity: .7, direction: undefined }, first);
  assert.deepEqual(next.direction, [225, 270, 315]);
  assert.equal(next.intensity, .7);
  assert.equal(next.method, 'multidirectional');
  assert.notEqual(next.direction, first.direction);
  assert.equal(DEFAULT_HILLSHADE.intensity, .35);
});

test('hillshade rejects invalid ranges and multiple lights for single-light methods', () => {
  for (const settings of [
    { intensity: NaN }, { intensity: -1 }, { intensity: 1.01 },
    { direction: 360 }, { altitude: 91 }, { direction: [] },
    { direction: [225, 315] }, { altitude: [30, 60] },
  ]) {
    assert.throws(() => resolveHillshade(settings), error => error instanceof RidgelineError && error.code === 'INVALID_CONFIGURATION');
  }
  assert.doesNotThrow(() => resolveHillshade({ method: 'multidirectional', direction: [225, 315], altitude: [30, 60] }));
});
