import assert from 'node:assert/strict';
import { test } from 'node:test';
import { supportCases } from '../tests/browser/catalog.ts';
import { createCaseRegistry } from '../tests/browser/registry.ts';

test('Support discovery refuses a renamed required workflow', () => {
  for (const title of supportCases) {
    assert.throws(() => createCaseRegistry([title], [{ 'Renamed workflow': async () => {} }]), /Unknown browser case binding/);
    assert.throws(() => createCaseRegistry([title], []), /Missing browser case bindings/);
  }
});
