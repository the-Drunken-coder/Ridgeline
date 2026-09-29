import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ridgeline-browser-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'bin'));
  await copyFile(new URL('./test-browser.mjs', import.meta.url), join(root, 'scripts/test-browser.mjs'));
  // Keep the real runner and filesystem ownership. Substitute only costly build
  // and browser commands so overlap and failed setup can be exercised directly.
  await writeFile(join(root, 'bin/pnpm'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.FIXTURE_ROOT;
fs.appendFileSync(path.join(root, 'commands'), JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.env.FAIL_BUILD) process.exit(1);
if (process.argv.includes('scripts/prepare-consumer.mjs')) fs.mkdirSync(path.join(root, '.artifacts/consumer'), { recursive: true });
if (process.env.PAUSE_BUILD && process.cwd() === root && process.argv[2] === 'build') {
  console.log('build paused');
  const timer = setInterval(() => {
    if (fs.existsSync(path.join(root, 'release'))) clearInterval(timer);
  }, 10);
}
`, { mode: 0o755 });
  const env = { ...process.env, FIXTURE_ROOT: root, PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH}` };
  const args = [join(root, 'scripts/test-browser.mjs')];
  return {
    root, env, args,
    run: (extraEnv = {}) => spawnSync(process.execPath, args, {
      cwd: root, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 10_000,
    }),
  };
}

test('overlapping browser runs fail before commands or consumer replacement; the owner can finish', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const consumer = join(f.root, '.artifacts/consumer');
  await mkdir(consumer, { recursive: true });
  await writeFile(join(consumer, 'existing'), 'preserve until owner resumes');
  const first = spawn(process.execPath, f.args, {
    cwd: f.root, env: { ...f.env, PAUSE_BUILD: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  let stdout = '';
  let stderr = '';
  first.stdout.on('data', chunk => { stdout += chunk; });
  first.stderr.on('data', chunk => { stderr += chunk; });
  const finished = new Promise((resolve, reject) => {
    first.on('error', reject);
    first.on('close', code => resolve(code));
  });
  t.after(async () => {
    if (first.exitCode === null) {
      try { process.kill(-first.pid, 'SIGKILL'); } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    await finished;
  });
  await new Promise((resolve, reject) => {
    first.on('error', reject);
    first.stdout.on('data', () => { if (stdout.includes('build paused')) resolve(); });
    first.on('close', () => reject(new Error(`Owner exited before setup: ${stderr}`)));
  });
  const second = f.run();
  assert.ifError(second.error);
  assert.equal(second.status, 1);
  assert.match(second.stderr, /already locked in this checkout/);
  assert.equal(await readFile(join(consumer, 'existing'), 'utf8'), 'preserve until owner resumes');
  assert.equal(await readFile(join(f.root, 'commands'), 'utf8'), '["build"]\n');
  assert.match(await readFile(join(f.root, '.artifacts/browser-run.lock/owner'), 'utf8'), new RegExp(`PID: ${first.pid}`));

  await writeFile(join(f.root, 'release'), '');
  assert.equal(await finished, 0, stderr);
  const next = f.run();
  assert.ifError(next.error);
  assert.equal(next.status, 0, next.stderr);
});

test('a failed build releases the browser lock for the next run', async t => {
  const f = await fixture(t);
  const failed = f.run({ FAIL_BUILD: '1' });
  assert.ifError(failed.error);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /pnpm build failed/);
  const next = f.run();
  assert.ifError(next.error);
  assert.equal(next.status, 0, next.stderr);
});

test('an abandoned lock is retained until explicitly removed', async t => {
  const f = await fixture(t);
  const lock = join(f.root, '.artifacts/browser-run.lock');
  await mkdir(lock, { recursive: true });
  await writeFile(join(lock, 'owner'), 'interrupted run');
  const blocked = f.run();
  assert.ifError(blocked.error);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /stop its remaining processes before removing/);
  assert.equal(await readFile(join(lock, 'owner'), 'utf8'), 'interrupted run');
  await rm(lock, { recursive: true });
  const next = f.run();
  assert.ifError(next.error);
  assert.equal(next.status, 0, next.stderr);
});
