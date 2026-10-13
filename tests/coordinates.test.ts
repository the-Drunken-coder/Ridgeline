import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCoordinate, parseCoordinate, geographicBearing, geographicDestination, geographicDistance } from '../src/coordinates';
import { RidgelineError } from '../src/errors';

test('coordinate formats round trip geographic boundaries and carry rounded units', () => {
  for (const point of [[180, 90], [-180, -90], [6.87204, 45.92513], [-0.00001, -0.00001]] as const) {
    for (const format of ['dd', 'ddm', 'dms'] as const) {
      const result = parseCoordinate(formatCoordinate(point, { format, precision: 5 }));
      assert.ok(Math.abs(result[0] - point[0]) < 0.00001);
      assert.ok(Math.abs(result[1] - point[1]) < 0.00001);
    }
  }
  assert.equal(formatCoordinate([179.99999999, 89.99999999], { format: 'dms', precision: 1 }), '180° 0\' 0.0" E, 90° 0\' 0.0" N');
  assert.equal(formatCoordinate([-0, -0], { precision: 0 }), '0° E, 0° N');
  assert.deepEqual(parseCoordinate('-0.5, +45.25'), [-0.5, 45.25]);
  assert.deepEqual(parseCoordinate('6° 52′ 19.3″ W, 45° 55′ 30.5″ S'), [-6 - 52 / 60 - 19.3 / 3600, -45 - 55 / 60 - 30.5 / 3600]);
});

test('coordinate parser rejects ambiguous signs, invalid axes and malformed or out-of-range units', () => {
  for (const input of ['91 N, 10 E', '-6 W, 45 N', '6° 60\' E, 45 N', '6° 30\' 60" E, 45 N',
    '6.5° 20\' E, 45 N', '6 E 7, 45 N', 'Infinity, 0', '181, 0', '0, 90.1', '6 45', '6, 45, 7'])
    assert.throws(() => parseCoordinate(input));
  assert.throws(() => formatCoordinate([0, 0], { precision: 9 }));
  assert.throws(() => geographicDestination([0, 0], -1, 0));
});

test('spherical coordinate helpers agree across the date line and at high latitude', () => {
  const start = [179.999, 70] as const;
  const end = geographicDestination(start, 2000, 95);
  assert.ok(end[0] < 0, 'destination crosses the date line');
  assert.ok(Math.abs(geographicDistance(start, end) - 2000) < 1e-6);
  assert.ok(Math.abs(geographicBearing(start, end) - 95) < 1e-8);
});

test('direction rejects undefined spherical bearings without rejecting nearby valid routes', () => {
  for (const [from, to] of [
    [[12, 34], [12, 34]], [[180, 0], [-180, 0]],
    [[0, 20], [180, -20]], [[10, 90], [-50, 90]],
    [[10, 90], [20, -90]], [[0, -90], [0, 0]],
  ] as const) {
    assert.throws(() => geographicBearing(from, to), error => error instanceof RidgelineError &&
      error.code === 'INVALID_CONFIGURATION' && error.context.operation === 'coordinates.bearing');
  }
  assert.ok(Number.isFinite(geographicBearing([0, 0], [0.00000001, 0])));
  assert.ok(Number.isFinite(geographicBearing([0, 20], [179.99999999, -20])));
  assert.equal(geographicBearing([35, 80], [120, 90]), 0);
  assert.equal(geographicBearing([35, -80], [120, -90]), 180);
});

test('pole destinations remain valid while a pole origin has no north-based direction', () => {
  const radius = 6_371_008.8;
  for (const latitude of [-90, 90]) {
    assert.deepEqual(geographicDestination([35, latitude], 0, 90), [35, latitude]);
    assert.throws(() => geographicDestination([35, latitude], 1, 90), error =>
      error instanceof RidgelineError && error.context.operation === 'coordinates.destination');
    const result = geographicDestination([35, 0], Math.PI * radius / 2, latitude > 0 ? 0 : 180);
    assert.ok(Math.abs(result[1] - latitude) < 1e-8);
    assert.ok(Math.abs(geographicDistance([35, 0], result) - Math.PI * radius / 2) < 1e-6);
  }
});


test('rounded zero uses the positive hemisphere in every format', () => {
  for (const format of ['dd', 'ddm', 'dms'] as const) {
    const text = formatCoordinate([-1e-10, -1e-10], { format, precision: 2 });
    assert.match(text, / E, .* N$/);
    assert.deepEqual(parseCoordinate(text), [0, 0]);
  }
});
