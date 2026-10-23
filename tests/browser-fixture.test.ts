import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCaseFixture } from './browser/fixture';
import { createCaseRegistry } from './browser/registry';

test('Browser registry executes only the selected case setup and body', async () => {
  const events: string[] = [];
  const registry = createCaseRegistry(['first', 'second'], [{
    first: async (fixture: ReturnType<typeof createCaseFixture>) => {
      fixture.own({ destroy: () => events.push('first cleanup') });
      events.push('first setup');
    },
    second: async () => { throw new Error('Unselected setup ran.'); },
  }]);
  const fixture = createCaseFixture();
  await registry.run('first', () => { events.push('context'); return fixture; });
  fixture.cleanup();
  assert.deepEqual(events, ['context', 'first setup', 'first cleanup']);
  await assert.rejects(registry.run('unknown', () => { throw new Error('Unknown setup ran.'); }), /Unknown browser case/);
});

test('Browser registry rejects duplicate missing unknown and unordered bindings before setup', () => {
  let runs = 0;
  const run = async () => { runs++; };
  assert.throws(() => createCaseRegistry(['first'], [{ first: run }, { first: run }]), /Duplicate browser case binding/);
  assert.throws(() => createCaseRegistry(['first', 'second'], [{ first: run }]), /Missing browser case bindings.*second/);
  assert.throws(() => createCaseRegistry(['first'], [{ first: undefined }]), /Missing browser case binding/);
  assert.throws(() => createCaseRegistry(['first'], [{ first: run, unknown: run }]), /Unknown browser case binding/);
  assert.throws(() => createCaseRegistry(['first', 'first'], [{ first: run }]), /Duplicate browser case catalog/);
  assert.throws(() => createCaseRegistry(['first', 'second'], [{ second: run, first: run }]), /registered check order/);
  assert.equal(runs, 0);
});

test('Browser fixture retires multiple owners and replacements after a selected case fails', async () => {
  const destroyed: string[] = [];
  const fixture = createCaseFixture();
  const registry = createCaseRegistry(['replace'], [{ replace: async () => {
    const first = fixture.own({ destroy: () => destroyed.push('first') });
    fixture.own(first);
    fixture.own({ destroy: () => destroyed.push('replacement') });
    throw new Error('Case failed after remount.');
  } }]);
  await assert.rejects(registry.run('replace', () => undefined), /Case failed after remount/);
  fixture.cleanup();
  fixture.cleanup();
  assert.deepEqual(destroyed, ['first', 'replacement']);
});

test('Browser fixture attempts independent cleanup and retires reentrant replacement owners', () => {
  const failure = new Error('First teardown failed.');
  const destroyed: string[] = [];
  const fixture = createCaseFixture();
  fixture.own({ destroy() {
    destroyed.push('first');
    fixture.cleanup();
    fixture.own({ destroy: () => destroyed.push('replacement') });
    throw failure;
  } });
  fixture.own({ destroy: () => destroyed.push('second') });
  assert.throws(() => fixture.cleanup(), error => error === failure);
  assert.deepEqual(destroyed, ['first', 'second', 'replacement']);
  fixture.cleanup();
  assert.throws(() => fixture.own({ destroy: () => destroyed.push('late') }), /already cleaned up/);
  assert.deepEqual(destroyed, ['first', 'second', 'replacement', 'late']);
});

test('Browser fixture preserves all cleanup failures and owns resources before observation', () => {
  const failures = [new Error('first'), new Error('second')];
  const fixture = createCaseFixture(() => { throw new Error('Observation failed.'); });
  let destroys = 0;
  for (const failure of failures) assert.throws(() => fixture.own({ destroy() { destroys++; throw failure; } }), /Observation failed/);
  assert.throws(() => fixture.cleanup(), error => error instanceof AggregateError &&
    error.errors.length === 2 && error.errors.every((failure: unknown, index: number) => failure === failures[index]));
  assert.equal(destroys, 2);
});
