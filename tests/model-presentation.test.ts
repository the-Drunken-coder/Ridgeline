import assert from 'node:assert/strict';
import test from 'node:test';
import { modelFeedback, modelPresentationGeometry } from '../src/model-presentation';

test('feedback uses the displayed model altitude while labels clear the strongest static ring', () => {
  const frame = { id: 'aircraft', hasLabel: true, anchor: { x: 100, y: 80, depth: 0 }, labelAnchor: { x: 100, y: 80, depth: 0 },
    box: { minX: 94, minY: 72, maxX: 106, maxY: 88 } };
  const airborne = modelPresentationGeometry(frame);
  assert.deepEqual(airborne.center, [100, 80]);
  assert.equal(airborne.radius, 16);
  assert.deepEqual(airborne.labelOffset, [0, 26 / 12]);
  const raisedBody = modelPresentationGeometry({ ...frame, labelAnchor: { x: 100, y: 120, depth: 0 } });
  assert.deepEqual(raisedBody.center, [100, 80], 'The ring cannot move to the ground marker');
  assert.deepEqual(raisedBody.labelOffset, [0, 1.8]);
  assert.equal(modelFeedback(true, true), 'selected');
  assert.equal(modelFeedback(false, true), 'hover');
  assert.equal(modelFeedback(false, false), undefined);
});
