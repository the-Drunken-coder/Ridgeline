import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ridgeline-measurement-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'tools/model-measurement'), { recursive: true });
  await copyFile(new URL('./test-measurement.mjs', import.meta.url), join(root, 'scripts/test-measurement.mjs'));
  await symlink(resolve('node_modules'), join(root, 'node_modules'));
  await writeFile(join(root, 'tools/model-measurement/report.test.ts'), `import test from 'node:test';
test('fixture report', () => console.log('report producer output'));
`);
  await writeFile(join(root, 'tools/model-measurement/instrumentation.test.mjs'), `import test from 'node:test';
test('fixture probe', () => {
  console.error('probe producer error context');
  throw new Error('fixture probe failed');
});
`);
  await writeFile(join(root, 'event.json'), JSON.stringify({ pull_request: { head: { sha: 'pr-head-fixture' } } }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--quiet');
  git('add', 'scripts', 'tools');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture checkout');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return { root, revision: git('rev-parse', 'HEAD'), run: (args = []) => spawnSync(process.execPath, ['scripts/test-measurement.mjs', ...args], {
    cwd: root, encoding: 'utf8', timeout: 15_000,
    env: { ...env, GITHUB_EVENT_PATH: join(root, 'event.json'), GITHUB_SHA: 'hosted-merge-fixture',
      GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '2', GITHUB_REPOSITORY: 'fixture/repo' },
  }) };
}

test('failed measurement retains producer bytes and distinguishes PR head from tested checkout', async t => {
  const f = await fixture(t);
  const result = f.run();
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const artifacts = join(f.root, '.artifacts/validation/model-measurement');
  const runs = await readdir(artifacts);
  assert.equal(runs.length, 1);
  const run = join(artifacts, runs[0]);
  const context = JSON.parse(await readFile(join(run, 'context.json'), 'utf8'));
  assert.equal(context.checkout, f.root);
  assert.equal(context.revision, f.revision);
  assert.equal(context.prHeadRevision, 'pr-head-fixture');
  assert.equal(context.workflowRevision, 'hosted-merge-fixture');
  assert.equal(context.runUrl, 'https://github.com/fixture/repo/actions/runs/1234/attempts/2');
  assert.deepEqual(context.command, ['pnpm', 'test:measurement']);
  assert.deepEqual(context.stages.map(stage => stage.status), [0, 1]);
  const reportOutput = await readFile(join(run, context.stages[0].stdout), 'utf8');
  const probeOutput = await readFile(join(run, context.stages[1].stdout), 'utf8');
  assert.ok(result.stdout.includes(reportOutput));
  assert.ok(result.stdout.includes(probeOutput));
  assert.match(probeOutput, /probe producer error context/);
  assert.match(probeOutput, /fixture probe failed/);
});

test('hosted setup can retain checkout context before measurement prerequisites exist', async t => {
  const f = await fixture(t);
  await rm(join(f.root, 'node_modules'));
  await rm(join(f.root, 'tools'), { recursive: true });
  const result = f.run(['--record-context']);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const artifacts = join(f.root, '.artifacts/validation/model-measurement');
  const runs = await readdir(artifacts);
  const context = JSON.parse(await readFile(join(artifacts, runs[0], 'context.json'), 'utf8'));
  assert.equal(context.revision, f.revision);
  assert.equal(context.prHeadRevision, 'pr-head-fixture');
  assert.deepEqual(context.stages, []);
});
