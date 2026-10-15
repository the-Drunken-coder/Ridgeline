import assert from 'node:assert/strict';
import { test } from 'node:test';
import { disposeAll } from '../examples/starter/dispose';

test('Starter cleanup releases later owners and preserves the original failure', () => {
  const first = new Error('First owner failed'), released: string[] = [];
  assert.throws(() => disposeAll([
    () => { released.push('first'); throw first; },
    () => { released.push('second'); },
    () => { released.push('viewport'); },
  ]), error => error === first);
  assert.deepEqual(released, ['first', 'second', 'viewport']);
});

test('Starter cleanup preserves every independent failure', () => {
  const first = new Error('Controls failed'), second = new Error('Editor failed');
  assert.throws(() => disposeAll([() => { throw first; }, () => { throw second; }]),
    error => error instanceof AggregateError && error.errors[0] === first && error.errors[1] === second);
});
