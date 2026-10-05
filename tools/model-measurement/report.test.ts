import assert from 'node:assert/strict';
import test from 'node:test';
import { distribution } from './report';

test('measurement reports unavailable and insufficient samples without invented percentiles', () => {
  assert.deepEqual(distribution([]), { samples: 0, status: 'unavailable' });
  assert.deepEqual(distribution([16]), { samples: 1, status: 'insufficient-samples' });
  assert.deepEqual(distribution([32, 16, 20, 18]), { samples: 4, status: 'available', p50: 18, p95: 32, p99: 32 });
});

import { correlateUpdates } from './report';
test('latency belongs to the accepted revision, with overwritten updates retained as superseded', () => {
  const updates = [{ sequence: 1, start: 10, end: 12 }, { sequence: 2, start: 20, end: 22 }, { sequence: 3, start: 30, end: 32 }];
  const records = [
    { name: 'accepted-update', startTime: 11, duration: 0, detail: { revision: 1 } },
    { name: 'accepted-update', startTime: 21, duration: 0, detail: { revision: 2 } },
    { name: 'accepted-update', startTime: 31, duration: 0, detail: { revision: 3 } },
    { name: 'frame', startTime: 25, duration: 0, detail: { updateRevision: 2, drawnModels: 100 } },
  ];
  assert.deepEqual(correlateUpdates(updates, records, [{ sequence: 2, time: 28 }], true, 100), [
    { ...updates[0], revision: 1, model: 'superseded', native: 'superseded' },
    { ...updates[1], revision: 2, model: 5, native: 8 },
    { ...updates[2], revision: 3, model: 'pending', native: 'pending' },
  ]);
});


test('icon baseline has no model latency, invalid samples fail, and nested accepted updates stay ambiguous', () => {
  assert.throws(() => distribution([NaN, 1]), /finite/);
  const updates = [{ sequence: 0, start: 1, end: 3 }];
  const accepted = [1, 2].map(revision => ({ name: 'accepted-update', startTime: revision, duration: 0, detail: { revision } }));
  assert.equal(correlateUpdates(updates, accepted, [], true, 100)[0]!.model, 'ambiguous-acceptance');
  assert.equal(correlateUpdates(updates, accepted, [], true, 0)[0]!.model, 'not-applicable');
  assert.equal(correlateUpdates(updates, [], [], false, 100)[0]!.native, 'unavailable');
});
