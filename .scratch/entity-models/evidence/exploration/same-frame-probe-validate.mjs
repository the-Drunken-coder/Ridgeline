import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const result = JSON.parse(await readFile('/tmp/ridgeline-model-context/same-frame-probe.json'));
assert.equal(result.scenarios.length, 6);
assert.deepEqual(result.pageErrors, []);
let prepared = 0, controls = 0;
for (const scenario of result.scenarios) {
  assert.deepEqual(scenario.errors, []);
  assert.equal(scenario.glError, 0);
  assert.ok(scenario.initial.red > 100 && scenario.initial.blue > 100);
  for (const command of [...scenario.commands, ...scenario.bursts.flatMap(b => b.commands)]) {
    assert.ok(command.frames.length);
    if (!command.changes.length) {
      assert.equal(command.frames.length, 1);
      assert.equal(command.prepareCallsAfter, command.prepareCallsBefore);
    } else if (command.mode === 'prepare') {
      prepared++;
      assert.equal(command.prepareCallsAfter, command.prepareCallsBefore + 1);
      assert.equal(command.firstFrameMatches, true);
      assert.equal(command.frames[0].red, command.hidden.circle ? 0 : scenario.initial.red);
      assert.equal(command.frames[0].blue, command.hidden.icon ? 0 : scenario.initial.blue);
    } else {
      controls++;
      assert.equal(command.firstFrameMatches, false);
      assert.equal(command.prepareCallsAfter, command.prepareCallsBefore);
    }
    if ('settledMatches' in command) assert.equal(command.settledMatches, true);
  }
  for (const count of Object.values(scenario.quietDelta)) assert.equal(count, 0);
}
assert.equal(prepared, 96);
assert.equal(controls, 96);
const summary = { validatedAt: new Date().toISOString(), preparedCommandsCorrectSameFrame: prepared, ordinaryCommandsOneFrameLate: controls, quietSecondsPerScenario: 5, scenarios: result.scenarios.map(s => ({ name: s.scenario.name, blend: s.initial.blend, visibleRedPixels: s.initial.red, visibleBluePixels: s.initial.blue, quietDelta: s.quietDelta })) };
await writeFile('/tmp/ridgeline-model-context/same-frame-probe-validation.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
