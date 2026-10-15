import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectSupportCases, supportCases } from '../tests/support-cases.ts';

test('Support discovery refuses a renamed required workflow', () => {
  const renamed = supportCases.map((name, index) => index === 0 ? 'Renamed workflow' : name);
  assert.throws(() => selectSupportCases(renamed), /Required support workflows are not registered/);
  assert.deepEqual(selectSupportCases([...supportCases, 'Unrelated regression']), supportCases);
});
