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

test('accepts implementation tickets and plan-backed exploration tickets', async t => {
  const files = await fixture(t);
  await files.write(valid);
  assert.equal(files.run().status, 0);
  await writeFile(join(files.directory, 'plan.md'), '# Investigation plan\n');
  for (const type of ['research', 'prototype', 'task']) {
    await writeFile(join(files.directory, 'issues', `02-${type}.md`), `# Investigate\nType: ${type}\nStatus: claimed\n\nWhat should we build?\n`);
  }
  assert.equal(files.run().status, 0);
});

test('accepts migrated snapshots linking their canonical GitHub issue without live metadata', async t => {
  const files = await fixture(t);
  await rm(join(files.directory, 'spec.md'));
  await files.write(`# Consumer check\n\nCanonical issue: [Consumer check](https://github.com/the-Drunken-coder/Ridgeline/issues/38)\n\nHistorical snapshot: migrated to GitHub Issues.\n\n## Original scope\n\nRetained for reference.\n`);
  const result = files.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Checked 0 implementation tickets/);
});

test('rejects malformed and foreign canonical issue links even on otherwise valid tickets', async t => {
  const files = await fixture(t);
  for (const canonicalIssue of [
    '',
    'migrated',
    'https://github.com/the-Drunken-coder/Ridgeline/issues/38',
    '[Issue](https://github.com/other/Ridgeline/issues/38)',
    '[Issue](https://example.com/the-Drunken-coder/Ridgeline/issues/38)',
    '[Issue](https://github.com/the-Drunken-coder/Ridgeline/pull/38)',
    '[Issue](https://github.com/the-Drunken-coder/Ridgeline/issues/0)',
    '[Issue](https://github.com/the-Drunken-coder/Ridgeline/issues/-1)',
    '[Issue](https://github.com/the-Drunken-coder/Ridgeline/issues/38extra)',
  ]) {
    await files.write(`Canonical issue: ${canonicalIssue}\n${valid}`);
    const result = files.run();
    assert.equal(result.status, 1, canonicalIssue);
    assert.match(result.stderr, /Canonical issue: must link/);
  }
});

test('does not exempt tickets when the canonical issue appears only in examples or later sections', async t => {
  const files = await fixture(t);
  const canonicalIssue = 'Canonical issue: [Issue](https://github.com/the-Drunken-coder/Ridgeline/issues/38)';
  for (const body of [
    `\`\`\`md\n${canonicalIssue}\n\`\`\`\n`,
    `<!-- ${canonicalIssue} -->\n`,
    `## Comments\n${canonicalIssue}\n`,
  ]) {
    await files.write(body);
    assert.equal(files.run().status, 1, body);
  }
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

test('does not exempt unknown ticket types or exploration types without a plan', async t => {
  const files = await fixture(t);
  for (const type of ['research', 'implementation', 'unknown']) {
    await files.write(`# Missing requirements\nType: ${type}\n`);
    assert.equal(files.run().status, 1);
  }
});

test('requires a plan file before accepting exploration tickets', async t => {
  const files = await fixture(t);
  await files.write('# Investigate behavior\nType: research\nStatus: claimed\n');
  await writeFile(join(files.directory, 'map.md'), '# Questions\n');
  assert.equal(files.run().status, 1);
  await mkdir(join(files.directory, 'plan.md'));
  assert.equal(files.run().status, 1);
  await rm(join(files.directory, 'plan.md'), { recursive: true });
  await writeFile(join(files.directory, 'plan.md'), '# Research plan\n');
  assert.equal(files.run().status, 0);
  await files.write('# Investigate behavior\nType: unknown\nStatus: claimed\n');
  assert.equal(files.run().status, 1);
});

test('ignores fenced examples with longer closers, indentation, or no closer', async t => {
  const files = await fixture(t);
  for (const [opener, closer] of [
    ['```md', '````'],
    ['~~~md', '~~~~'],
    ['   ```md', '  ```'],
    ['```md', ''],
  ]) {
    await files.write(`${opener}\n${valid}${closer}\n`);
    const result = files.run();
    assert.equal(result.status, 1, opener + '\n' + closer);
    assert.match(result.stderr, /missing nonempty Spec:/);
    assert.match(result.stderr, /Acceptance criteria must contain/);
    if (closer) {
      await files.write(`${opener}\n# Example\n${closer}\n${valid}`);
      assert.equal(files.run().status, 0, 'real ticket after ' + closer);
    }
  }
});

test('does not end a fenced example at a shorter, mismatched, or annotated fence', async t => {
  const files = await fixture(t);
  for (const falseCloser of ['```', '~~~~', '```` example', '    ````']) {
    await files.write(`\`\`\`\`md\n${falseCloser}\n${valid}\`\`\`\`\n`);
    const result = files.run();
    assert.equal(result.status, 1, falseCloser);
    assert.match(result.stderr, /Acceptance criteria must contain/);
  }
});
