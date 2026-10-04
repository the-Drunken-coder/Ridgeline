import assert from 'node:assert/strict';
import test from 'node:test';
import { modelChoice } from '../src/model-switching';
import type { ModelChoice } from '../src/model-switching';
import { DEFAULT_ENTITY_MODELS, modelSettings } from '../src/model-settings';

test('distance histories enter below the entrance and leave above the exit while equality retains the choice', () => {
  let previous: ModelChoice | undefined;
  const distances = [2000, 1900, 1899, 1900, 2000, 2100, 2101, 2100, 2000, 1900, 1800];
  const expected = [false, false, true, true, true, true, false, false, false, false, true];
  for (const [index, distance] of distances.entries()) {
    previous = modelChoice(previous, { modelId: 'shared', heading: 0, status: 'ready', eligible: true, distance, settings: DEFAULT_ENTITY_MODELS });
    assert.equal(previous?.model, expected[index], `distance ${distance} at step ${index}`);
  }
});

test('availability inside the band cannot create a model choice but temporary ineligibility preserves one', () => {
  const input = { modelId: 'shared', heading: 0, status: 'ready' as const, eligible: true, distance: 2000, settings: DEFAULT_ENTITY_MODELS };
  let choice = modelChoice(undefined, { ...input, status: 'loading', distance: 1800 });
  choice = modelChoice(choice, input);
  assert.equal(choice?.model, false);
  choice = modelChoice(choice, { ...input, distance: 1800 });
  assert.equal(choice?.model, true);
  choice = modelChoice(choice, { ...input, eligible: false });
  assert.equal(choice?.model, true);
  choice = modelChoice(choice, input);
  assert.equal(choice?.model, true);
  assert.equal(modelChoice(choice, { ...input, modelId: 'different' })?.model, false);
  assert.equal(modelChoice(choice, { ...input, status: 'unavailable' })?.model, false);
  assert.equal(modelChoice(choice, { ...input, heading: undefined })?.model, false);
  assert.equal(modelChoice(choice, { ...input, modelId: undefined }), undefined);
});

test('zero dead zone and changed effective settings use the same strict boundaries', () => {
  const settings = modelSettings(DEFAULT_ENTITY_MODELS, { deadZoneMeters: 0 });
  const input = { modelId: 'shared', heading: 0, status: 'ready' as const, eligible: true, distance: 2000, settings };
  let choice = modelChoice(undefined, input);
  assert.equal(choice?.model, false);
  choice = modelChoice(choice, { ...input, distance: 1999 });
  assert.equal(modelChoice(choice, input)?.model, true);
  assert.equal(modelChoice(choice, { ...input, settings: modelSettings(settings, { switchDistanceMeters: 1000 }) })?.model, false);
  for (const overrides of [{ switchDistanceMeters: 0 }, { deadZoneMeters: 4000 }, { minimumSizePixels: -1 }, { minimumSizePixels: Infinity }])
    assert.throws(() => modelSettings(DEFAULT_ENTITY_MODELS, overrides));
  assert.deepEqual(DEFAULT_ENTITY_MODELS, { switchDistanceMeters: 2000, deadZoneMeters: 200, minimumSizePixels: 40 });
});
