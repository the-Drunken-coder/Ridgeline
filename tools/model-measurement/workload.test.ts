import test from 'node:test';
import assert from 'node:assert/strict';
import { features, matrix, style, validateSettings } from './workload';

test('the matrix isolates appearance, geometry, projection and pixel ratio while keeping the icon baseline workload', () => {
  assert.equal(matrix().length, 72);
  const models = features(5, 'original'), icons = features(5, 'icons');
  assert.equal(models.length, 1100); assert.equal(models.filter(feature => feature.entity?.model).length, 100);
  for (const id of ['drone', 'tank', 'plane', 'boat']) assert.equal(models.filter(feature => feature.entity?.model?.id === id).length, 25);
  assert.deepEqual(icons.map(f => f.geometry), models.map(f => f.geometry));
  assert.equal(icons.filter(feature => feature.entity?.model).length, 0);
  assert.notDeepEqual(features(6, 'original')[0]!.geometry, models[0]!.geometry);
  assert.deepEqual(features(5, 'original'), models);
  assert.equal(style(models[0]!, 'original').modelAppearance?.mode, 'original');
  assert.equal(style(models[0]!, 'assigned').modelAppearance?.mode, 'color');
  assert.equal(style(models[2]!, 'mixed').modelAppearance, undefined);
});
test('short or unidentified runs cannot claim hardware sampling', () => {
  const settings = { ...matrix()[0]!, mode: 'hardware' as const, instrumentation: true, gpu: true, warmupMs: 10_000, durationMs: 30_000, repeats: 3 };
  assert.throws(() => validateSettings(settings), /metadata/);
  const machine = { device: 'Apple M1 laptop', os: 'macOS version', gpu: 'Apple M1', driver: 'Metal OS driver', browser: 'Safari version', displayHz: 60 };
  assert.doesNotThrow(() => validateSettings(settings, machine));
  assert.throws(() => validateSettings({ ...settings, durationMs: 1000 }, machine), /30 s/);
});
