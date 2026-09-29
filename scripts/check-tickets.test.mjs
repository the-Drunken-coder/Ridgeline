import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const command = fileURLToPath(new URL('./check-tickets.mjs', import.meta.url));
const valid = `# Implement a consumer check
Status: ready-for-agent
Spec: [Consumer checks](../spec.md)
Blocked by: none
Acceptance depends on: none
Integration owner: coordinator, through this ticket

Own the validation script and its executable tests.

## Acceptance criteria

- A missing consumer report fails validation; exercise the command with an absent report.
`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ridgeline-tickets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, '.scratch', 'consumer-checks');
  await mkdir(join(directory, 'issues'), { recursive: true });
  await writeFile(join(directory, 'spec.md'), '# Consumer checks\n');
  return {
    directory,
    write: body => writeFile(join(directory, 'issues', '01-check.md'), body),
    run: () => spawnSync(process.execPath, [command], { cwd: root, encoding: 'utf8', timeout: 10_000 }),
  };
}

test('accepts implementation tickets and map-backed wayfinding tickets', async t => {
  const files = await fixture(t);
  await files.write(valid);
  assert.equal(files.run().status, 0);
  await writeFile(join(files.directory, 'map.md'), '# Investigation map\n');
  for (const type of ['research', 'prototype', 'grilling', 'task']) {
    await writeFile(join(files.directory, 'issues', `02-${type}.md`), `# Investigate\nType: ${type}\nStatus: claimed\n\nWhat should we build?\n`);
  }
  assert.equal(files.run().status, 0);
});

test('reports each missing or empty required field with its ticket path', async t => {
  const files = await fixture(t);
  for (const field of ['Status', 'Spec', 'Blocked by', 'Acceptance depends on', 'Integration owner']) {
    for (const replacement of ['', `${field}:   `]) {
      await files.write(valid.replace(new RegExp(`^${field}:.*$`, 'm'), replacement));
      const result = files.run();
      assert.equal(result.status, 1);
      assert.match(result.stderr, /issues\/01-check.md:/);
      assert.ok(result.stderr.includes(`nonempty ${field}:`), result.stderr);
    }
  }
});

test('rejects absent, external, malformed and noncanonical spec links', async t => {
  const files = await fixture(t);
  await writeFile(join(files.directory, 'other.md'), '# Other document\n');
  for (const spec of ['../spec.md', '[Spec](https://example.com/spec.md)', '[Spec](../other.md)', '[Spec](../absent.md)']) {
    await files.write(valid.replace('[Consumer checks](../spec.md)', spec));
    assert.match(files.run().stderr, /existing canonical/);
  }
  await files.write(valid);
  await rm(join(files.directory, 'spec.md'));
  assert.equal(files.run().status, 1);
});

test('rejects empty acceptance sections and criteria hidden in examples or later sections', async t => {
  const files = await fixture(t);
  const beforeCriteria = valid.split('## Acceptance criteria')[0];
  for (const section of [
    '', '## Acceptance criteria\n', '## Acceptance criteria\n-   \n',
    '## Acceptance criteria\n- [ ]   \n',
    '## Acceptance criteria\n\n## Comments\n- A later comment.\n',
    '```md\n## Acceptance criteria\n- Example only.\n```\n',
    '<!-- ## Acceptance criteria\n- Comment only. -->\n',
  ]) {
    await files.write(beforeCriteria + section);
    assert.equal(files.run().status, 1, section);
  }
});

test('does not exempt unknown ticket types or wayfinding types without a map', async t => {
  const files = await fixture(t);
  for (const type of ['research', 'implementation', 'unknown']) {
    await files.write(`# Missing requirements\nType: ${type}\n`);
    assert.equal(files.run().status, 1);
  }
});
