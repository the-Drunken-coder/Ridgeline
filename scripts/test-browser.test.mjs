import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ridgeline-browser-lock-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'bin'));
  await writeFile(join(root, '.gitignore'), '.artifacts/\ncontrol-lab/test-results/\n');
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  await copyFile(new URL('./test-browser.mjs', import.meta.url), join(root, 'scripts/test-browser.mjs'));
  await copyFile(new URL('./browser-resources.mjs', import.meta.url), join(root, 'scripts/browser-resources.mjs'));
  await copyFile(new URL('./validate-consumer.mjs', import.meta.url), join(root, 'scripts/validate-consumer.mjs'));
  await writeFile(join(root, 'capacity.mjs'), `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
fs.statfsSync = () => {
  if (process.env.FIXTURE_CAPACITY === 'unreadable') throw new Error('capacity unavailable');
  return { bsize: 1n, bavail: BigInt(process.env.FIXTURE_CAPACITY) };
};
syncBuiltinESMExports();
`);
  // Keep the real runner and filesystem ownership. Substitute only costly build
  // and browser commands so overlap and failed setup can be exercised directly.
  await writeFile(join(root, 'bin/pnpm'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.FIXTURE_ROOT;
fs.appendFileSync(path.join(root, 'commands'), JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.env.FAIL_BUILD) process.exit(1);
if (process.env.FIXTURE_REPORT && process.argv.includes('playwright')) {
  fs.mkdirSync(path.join(root, '.artifacts/playwright'), { recursive: true });
  fs.writeFileSync(path.join(root, '.artifacts/playwright/report'), process.env.FIXTURE_REPORT);
  if (process.env.FIXTURE_REPORT_PROTECTION === 'symlink')
    fs.symlinkSync(path.join(root, 'external-evidence'), path.join(root, '.artifacts/playwright/external'));
  if (process.env.FIXTURE_REPORT_PROTECTION === 'tracked')
    require('node:child_process').execFileSync('git', ['add', '-f', '.artifacts/playwright/report'], { cwd: root });
  if (process.env.FAIL_BROWSER) process.exit(1);
}
if (process.env.INTERRUPT_BUILD) {
  const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true, stdio: 'ignore',
  });
  fs.writeFileSync(path.join(root, 'descendant.pid'), String(child.pid));
  child.unref();
  if (process.env.INTERRUPT_BUILD === 'signal') process.kill(process.pid, 'SIGTERM');
  setInterval(() => {}, 1000);
}

if (process.argv.includes('scripts/prepare-consumer.mjs')) fs.mkdirSync(path.join(root, '.artifacts/consumer/standalone/examples/starter'), { recursive: true });
if (process.env.PAUSE_BUILD && process.cwd() === root && process.argv[2] === 'build') {
  console.log('build paused');
  const timer = setInterval(() => {
    if (fs.existsSync(path.join(root, 'release'))) clearInterval(timer);
  }, 10);
}
`, { mode: 0o755 });
  const env = { ...process.env, FIXTURE_ROOT: root, PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH}` };
  delete env.RIDGELINE_BROWSER_MIN_FREE_BYTES;
  const args = [join(root, 'scripts/test-browser.mjs')];
  return {
    root, env, args,
    run: (extraEnv = {}) => spawnSync(process.execPath, args, {
      cwd: root, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 10_000,
    }),
  };
}

test('repeated finalization preserves the next run lock and previously retained evidence', async t => {
  for (const failed of [false, true]) {
    await t.test(failed ? 'failed run' : 'successful run', async t => {
      const f = await fixture(t);
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
        import { join } from 'node:path';
        import { claimBrowserRun } from './scripts/browser-resources.mjs';
        const root = process.cwd(), failed = ${failed};
        const output = join(root, '.artifacts/playwright');
        const lock = join(root, '.artifacts/browser-run.lock');
        const previous = claimBrowserRun(root, 'packaged');
        mkdirSync(output);
        writeFileSync(join(output, 'report'), 'original producer bytes');
        previous.capture();
        previous.finish(failed);
        const record = readFileSync(join(previous.directory, '.browser-run.json'), 'utf8');
        const current = claimBrowserRun(root, 'packaged');
        const owner = readFileSync(join(lock, 'owner'), 'utf8');
        writeFileSync(join(output, 'report'), 'current producer bytes');
        previous.finish(!failed);
        assert.equal(readFileSync(join(lock, 'owner'), 'utf8'), owner);
        assert.equal(readFileSync(join(previous.directory, '.browser-run.json'), 'utf8'), record);
        assert.equal(readFileSync(join(previous.directory, 'playwright/report'), 'utf8'), 'original producer bytes');
        assert.equal(existsSync(join(previous.directory, '.pin')), failed);
        assert.equal(JSON.parse(readFileSync(join(current.directory, '.browser-run.json'), 'utf8')).status, 'running');
        assert.throws(() => claimBrowserRun(root, 'packaged'), /already locked/);
        current.finish();
        assert.equal(existsSync(lock), false);
      `], { cwd: f.root, encoding: 'utf8', timeout: 10_000,
        env: { ...f.env, RIDGELINE_BROWSER_MIN_FREE_BYTES: '0' } });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    });
  }
});

test('finalization can retry after protected output retention fails', async t => {
  const f = await fixture(t);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { claimBrowserRun } from './scripts/browser-resources.mjs';
    const root = process.cwd(), owner = claimBrowserRun(root, 'packaged');
    const output = join(root, '.artifacts/playwright');
    const lock = join(root, '.artifacts/browser-run.lock');
    mkdirSync(output);
    writeFileSync(join(output, 'report'), 'failure producer bytes');
    writeFileSync(join(root, 'external-evidence'), 'protected external bytes');
    symlinkSync(join(root, 'external-evidence'), join(output, 'external'));
    owner.capture();
    assert.throws(() => owner.finish(true), /Refusing to retain protected browser output/);
    assert.equal(existsSync(lock), true);
    assert.throws(() => claimBrowserRun(root, 'packaged'), /already locked/);
    rmSync(join(output, 'external'));
    owner.finish(true);
    assert.equal(existsSync(lock), false);
    assert.equal(readFileSync(join(owner.directory, 'playwright/report'), 'utf8'), 'failure producer bytes');
    assert.equal(readFileSync(join(root, 'external-evidence'), 'utf8'), 'protected external bytes');
    assert.equal(JSON.parse(readFileSync(join(owner.directory, '.browser-run.json'), 'utf8')).status, 'failed');
    assert.equal(existsSync(join(owner.directory, '.pin')), true);
  `], { cwd: f.root, encoding: 'utf8', timeout: 10_000,
    env: { ...f.env, RIDGELINE_BROWSER_MIN_FREE_BYTES: '0' } });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('low disk space refuses setup and a restored filesystem permits a retry', async t => {
  const f = await fixture(t);
  const failed = f.run({ FIXTURE_CAPACITY: '48', NODE_OPTIONS: `--import=${join(f.root, 'capacity.mjs')}` });
  assert.ifError(failed.error);
  assert.equal(failed.status, 1, failed.stdout);
  assert.match(failed.stderr, /packaged.*available=48 bytes.*required=2147483648 bytes/);
  assert.match(failed.stderr, /Free space.*RIDGELINE_BROWSER_MIN_FREE_BYTES/);
  await assert.rejects(access(join(f.root, 'commands')));
  const retry = f.run({ FIXTURE_CAPACITY: '2147483648', NODE_OPTIONS: `--import=${join(f.root, 'capacity.mjs')}` });
  assert.ifError(retry.error);
  assert.equal(retry.status, 0, retry.stderr);
});

test('every browser entrypoint refuses unreadable or insufficient capacity before setup', async t => {
  const f = await fixture(t);
  for (const script of ['test-browser-app.mjs', 'measure-models.mjs']) {
    await copyFile(new URL(script, import.meta.url), join(f.root, 'scripts', script));
  }
  const entrypoints = [
    ['test-browser.mjs'], ['test-browser-app.mjs', 'playground'],
    ['test-browser-app.mjs', 'controls'], ['measure-models.mjs', '--verify'],
  ];
  for (const entrypoint of entrypoints) {
    for (const capacity of ['47', 'unreadable']) {
      const result = spawnSync(process.execPath, [join(f.root, 'scripts', entrypoint[0]), ...entrypoint.slice(1)], {
        cwd: f.root, encoding: 'utf8', env: { ...f.env, FIXTURE_CAPACITY: capacity, NODE_OPTIONS: `--import=${join(f.root, 'capacity.mjs')}` },
      });
      assert.equal(result.status, 1, `${entrypoint.join(' ')}: ${result.stdout}`);
      assert.match(result.stderr, /available=(47|unreadable) bytes.*required=2147483648 bytes/);
      await assert.rejects(access(join(f.root, 'commands')));
    }
  }
});

test('repeated runs retain three disposable records and keep pinned browser failures', async t => {
  const f = await fixture(t);
  const failed = f.run({ FIXTURE_REPORT: 'pinned screenshot bytes', FAIL_BROWSER: '1' });
  assert.equal(failed.status, 1, failed.stderr);
  const history = join(f.root, '.artifacts/browser-runs');
  const failure = (await readdir(history))[0];
  assert.equal(await readFile(join(history, failure, 'playwright/report'), 'utf8'), 'pinned screenshot bytes');
  await access(join(history, failure, '.pin'));
  let last;
  for (let index = 0; index < 6; index++) {
    last = f.run({ FIXTURE_REPORT: `success ${index}` });
    assert.equal(last.status, 0, last.stderr);
  }
  assert.equal((await readdir(history)).length, 4);
  assert.match(last.stdout, /Removed generated browser output:.*packaged-/);
  assert.equal(await readFile(join(history, failure, 'playwright/report'), 'utf8'), 'pinned screenshot bytes');
  await rm(join(history, failure, '.pin'));
  assert.equal(f.run().status, 0);
  await assert.rejects(access(join(history, failure)));
  assert.equal((await readdir(history)).length, 3);
});

test('hosted setup can run the same read-only preflight before dependency installation', async t => {
  const f = await fixture(t);
  for (const suite of ['packaged', 'playground', 'controls', 'measurement']) {
    const result = spawnSync(process.execPath, [join(f.root, 'scripts/browser-resources.mjs'), suite, '--preflight'], {
      cwd: f.root, encoding: 'utf8', env: { ...f.env, FIXTURE_CAPACITY: '47', NODE_OPTIONS: `--import=${join(f.root, 'capacity.mjs')}` },
    });
    assert.equal(result.status, 1, suite);
    assert.match(result.stderr, new RegExp(`${suite}.*available=47 bytes.*required=2147483648 bytes`));
    await assert.rejects(access(join(f.root, '.artifacts')));
  }
});

test('retention preserves interrupted ownership, tracked members, curated evidence and symlink targets', async t => {
  const f = await fixture(t);
  assert.equal(f.run().status, 0);
  const history = join(f.root, '.artifacts/browser-runs');
  const original = JSON.parse(await readFile(join(history, (await readdir(history))[0], '.browser-run.json'), 'utf8'));
  const protectedNames = ['running', 'interrupted', 'tracked', 'symlink', 'unknown', 'pinned'];
  for (const name of protectedNames) {
    const path = join(history, `packaged-${name}`);
    await mkdir(path);
    const record = { ...original, startedAt: '1999-12-31T00:00:00.000Z', completedAt: '2000-01-01T00:00:00.000Z', pid: 99999999 };
    if (['running', 'interrupted'].includes(name)) record.status = name;
    if (name === 'unknown') record.owner = 'someone-else';
    await writeFile(join(path, '.browser-run.json'), JSON.stringify(record));
    await writeFile(join(path, 'evidence'), `preserve ${name}`);
  }
  const external = await mkdtemp(join(tmpdir(), 'ridgeline-external-evidence-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  await writeFile(join(external, 'evidence'), 'external evidence');
  await symlink(external, join(history, 'packaged-symlink', 'outside'), 'dir');
  await symlink(join(external, 'missing'), join(history, 'packaged-symlink', 'dangling'));
  await writeFile(join(history, 'packaged-pinned/.pin'), 'selected evidence');
  assert.equal(spawnSync('git', ['add', '-f', '.artifacts/browser-runs/packaged-tracked/evidence'], { cwd: f.root }).status, 0);
  await mkdir(join(f.root, '.scratch/curated'), { recursive: true });
  await writeFile(join(f.root, '.scratch/curated/evidence'), 'curated evidence');
  await mkdir(join(f.root, 'tests/fixtures'), { recursive: true });
  await writeFile(join(f.root, 'tests/fixtures/permanent'), 'permanent fixture');
  for (let index = 0; index < 5; index++) {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
  }
  for (const name of protectedNames) assert.equal(await readFile(join(history, `packaged-${name}`, 'evidence'), 'utf8'), `preserve ${name}`);
  assert.equal(await readFile(join(external, 'evidence'), 'utf8'), 'external evidence');
  assert.equal(await readFile(join(f.root, '.scratch/curated/evidence'), 'utf8'), 'curated evidence');
  assert.equal(await readFile(join(f.root, 'tests/fixtures/permanent'), 'utf8'), 'permanent fixture');
  assert.equal((await readdir(history)).length, protectedNames.length + 3);
});

test('a symlinked generated destination is refused before writes, including a dangling link', async t => {
  for (const destination of ['.artifacts', '.artifacts/consumer', '.artifacts/browser-runs', '.artifacts/playwright']) {
    for (const dangling of [false, true]) {
      const f = await fixture(t);
      const external = join(f.root, 'external');
      await mkdir(external);
      await writeFile(join(external, 'evidence'), 'preserve target');
      await mkdir(join(f.root, destination, '..'), { recursive: true });
      await symlink(dangling ? join(external, 'missing') : external, join(f.root, destination), 'dir');
      const result = f.run();
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /must not follow a symlink/);
      await assert.rejects(access(join(f.root, 'commands')));
      assert.equal(await readFile(join(external, 'evidence'), 'utf8'), 'preserve target');
      assert.deepEqual(await readdir(external), ['evidence']);
    }
  }
});

test('a tracked member prevents fixed consumer replacement', async t => {
  const f = await fixture(t);
  const protectedFile = join(f.root, '.artifacts/consumer/evidence');
  await mkdir(join(f.root, '.artifacts/consumer'), { recursive: true });
  await writeFile(protectedFile, 'tracked evidence');
  assert.equal(spawnSync('git', ['add', '-f', '.artifacts/consumer/evidence'], { cwd: f.root }).status, 0);
  const result = f.run();
  assert.equal(result.status, 1, result.stderr);
  assert.equal(await readFile(protectedFile, 'utf8'), 'tracked evidence');
  assert.match(result.stderr, /Refusing to replace protected consumer output/);
});

test('malformed ownership records and protected latest outputs survive subsequent runs', async t => {
  const f = await fixture(t);
  assert.equal(f.run().status, 0);
  const history = join(f.root, '.artifacts/browser-runs');
  const unknown = join(history, 'packaged-malformed');
  await mkdir(unknown);
  await writeFile(join(unknown, '.browser-run.json'), 'null');
  assert.equal(f.run().status, 0, 'unknown records must be preserved without blocking valid work');
  const output = join(f.root, '.artifacts/playwright');
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'tracked'), 'preserve latest output');
  assert.equal(spawnSync('git', ['add', '-f', '.artifacts/playwright/tracked'], { cwd: f.root }).status, 0);
  const result = f.run({ FIXTURE_REPORT: 'new output' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Refusing to replace protected browser output/);
  assert.equal(await readFile(join(output, 'tracked'), 'utf8'), 'preserve latest output');
  await access(join(unknown, '.browser-run.json'));
});

test('incomplete or malformed completion metadata remains protected during retention', async t => {
  const f = await fixture(t);
  assert.equal(f.run().status, 0);
  const history = join(f.root, '.artifacts/browser-runs');
  const original = JSON.parse(await readFile(join(history, (await readdir(history))[0], '.browser-run.json'), 'utf8'));
  const complete = { ...original, startedAt: '2000-01-01T00:00:00.000Z', completedAt: '2000-01-02T00:00:00.000Z' };
  const malformed = [
    ['missing-owner', { owner: undefined }], ['missing-version', { version: undefined }],
    ['missing-command', { command: undefined }], ['missing-status', { status: undefined }],
    ['missing-pid', { pid: undefined }], ['text-pid', { pid: 'not a process' }],
    ['zero-pid', { pid: 0 }], ['fractional-pid', { pid: 1.5 }], ['unsafe-pid', { pid: Number.MAX_SAFE_INTEGER + 1 }],
    ['missing-invocation', { invocation: undefined }], ['null-invocation', { invocation: null }],
    ['empty-invocation', { invocation: [] }], ['non-string-argument', { invocation: ['node', 12] }],
    ['empty-argument', { invocation: [''] }], ['missing-start', { startedAt: undefined }],
    ['false-start', { startedAt: false }], ['invalid-start', { startedAt: 'not a date' }],
    ['noncanonical-start', { startedAt: '2000-01-01' }], ['missing-completion', { completedAt: undefined }],
    ['invalid-completion', { completedAt: 'not a date' }],
    ['normalized-invalid-date', { completedAt: '2000-02-31T00:00:00.000Z' }],
    ['noncanonical-completion', { completedAt: '2000-01-02T01:00:00.000+01:00' }],
    ['completion-before-start', { completedAt: '1999-12-31T00:00:00.000Z' }],
  ];
  for (const [name, changes] of malformed) {
    const path = join(history, `packaged-${name}`);
    await mkdir(path);
    await writeFile(join(path, '.browser-run.json'), JSON.stringify({ ...complete, ...changes }));
    await writeFile(join(path, 'producer.log'), `preserve ${name}`);
  }
  for (let index = 0; index < 4; index++) {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
  }
  for (const [name] of malformed)
    assert.equal(await readFile(join(history, `packaged-${name}`, 'producer.log'), 'utf8'), `preserve ${name}`);
  assert.equal((await readdir(history)).length, malformed.length + 3);
});

test('retention keeps the three newest real completion times across canonical date formats', async t => {
  const f = await fixture(t);
  const clock = join(f.root, 'clock.mjs');
  await writeFile(clock, `const NativeDate = Date;
globalThis.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [process.env.FIXTURE_RUN_TIME])); }
};
`);
  for (const date of ['2030-01-01T00:00:00.000Z', '2040-01-01T00:00:00.000Z', '2050-01-01T00:00:00.000Z', '+010000-01-01T00:00:00.000Z']) {
    const result = f.run({ NODE_OPTIONS: `--import=${clock}`, FIXTURE_RUN_TIME: date });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(f.run().status, 0);
  const history = join(f.root, '.artifacts/browser-runs');
  const dates = await Promise.all((await readdir(history)).map(async name =>
    JSON.parse(await readFile(join(history, name, '.browser-run.json'), 'utf8')).completedAt));
  assert.deepEqual(dates.sort(), ['+010000-01-01T00:00:00.000Z', '2040-01-01T00:00:00.000Z', '2050-01-01T00:00:00.000Z']);
});

test('completed wrapper runs with an empty forwarded argument retain only the newest three', async t => {
  const f = await fixture(t);
  f.args.push('--', '--grep', '');
  const history = join(f.root, '.artifacts/browser-runs');
  let oldest;
  for (let index = 0; index < 6; index++) {
    const result = f.run({ FIXTURE_REPORT: `empty argument ${index}` });
    assert.equal(result.status, 0, result.stderr);
    if (index === 0) oldest = (await readdir(history))[0];
  }
  const retained = await readdir(history);
  assert.equal(retained.length, 3);
  await assert.rejects(access(join(history, oldest)));
  const reports = await Promise.all(retained.map(async name => {
    const record = JSON.parse(await readFile(join(history, name, '.browser-run.json'), 'utf8'));
    assert.equal(record.status, 'complete');
    assert.deepEqual(record.invocation.slice(-2), ['--grep', '']);
    await assert.rejects(access(join(history, name, '.pin')));
    return readFile(join(history, name, 'playwright/report'), 'utf8');
  }));
  assert.deepEqual(reports.sort(), ['empty argument 3', 'empty argument 4', 'empty argument 5']);
  const commands = (await readFile(join(f.root, 'commands'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const browserCommands = commands.filter(args => args.includes('playwright'));
  assert.equal(browserCommands.length, 6);
  for (const args of browserCommands) assert.deepEqual(args.slice(-2), ['--grep', '']);
});

test('support runner forwards project and grep options after package-manager separators', async t => {
  for (const prefix of [['--support', '--'], ['--', '--support', '--']]) {
    await t.test(prefix.join(' '), async t => {
      const f = await fixture(t);
      f.args.push(...prefix, '--project=chromium', '--grep', 'Adoption starter');
      const result = f.run({ DISPLAY: ':fixture' });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      const commands = (await readFile(join(f.root, 'commands'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      assert.deepEqual(commands.filter(args => args.includes('playwright')), [[
        'exec', 'playwright', 'test', '--config', 'playwright.support.config.mjs',
        '--project=chromium', '--grep', 'Adoption starter',
      ]]);
    });
  }
});

test('a protected failed producer retains its lock until evidence is preserved and protection is resolved', async t => {
  for (const protection of ['symlink', 'tracked']) {
    await t.test(protection, async t => {
      const f = await fixture(t);
      await writeFile(join(f.root, 'external-evidence'), 'external producer bytes');
      const result = f.run({ FIXTURE_REPORT: 'failure producer bytes', FAIL_BROWSER: '1', FIXTURE_REPORT_PROTECTION: protection });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Refusing to retain protected browser output/);
      assert.match(result.stderr, /Browser lock retained.*output retention did not complete/);
      assert.match(result.stderr, /Preserve the latest output before clearing this directory/);
      const lock = join(f.root, '.artifacts/browser-run.lock');
      await access(lock);
      const history = join(f.root, '.artifacts/browser-runs');
      const owned = join(history, (await readdir(history))[0]);
      await access(join(owned, '.pin'));
      assert.equal(await readFile(join(f.root, '.artifacts/playwright/report'), 'utf8'), 'failure producer bytes');
      assert.equal(await readFile(join(f.root, 'external-evidence'), 'utf8'), 'external producer bytes');
      const before = await readFile(join(f.root, 'commands'), 'utf8');
      const blocked = f.run({ FIXTURE_REPORT: 'replacement producer bytes' });
      assert.equal(blocked.status, 1, blocked.stderr);
      assert.equal(await readFile(join(f.root, 'commands'), 'utf8'), before);
      assert.equal(await readFile(join(f.root, '.artifacts/playwright/report'), 'utf8'), 'failure producer bytes');
      // An owner explicitly retains the producer before clearing the lock. The
      // symlink target or tracked file is preserved outside later replacement.
      await copyFile(join(f.root, '.artifacts/playwright/report'), join(owned, 'retained-failure.log'));
      if (protection === 'symlink') await rm(join(f.root, '.artifacts/playwright/external'));
      else assert.equal(spawnSync('git', ['rm', '--cached', '--', '.artifacts/playwright/report'], { cwd: f.root }).status, 0);
      await rm(lock, { recursive: true });
      const recovered = f.run({ FIXTURE_REPORT: 'recovered producer bytes' });
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(await readFile(join(owned, 'retained-failure.log'), 'utf8'), 'failure producer bytes');
      assert.equal(await readFile(join(f.root, 'external-evidence'), 'utf8'), 'external producer bytes');
    });
  }
});

test('explicit per-run capacity overrides and app arguments reach the normal command', async t => {
  const f = await fixture(t);
  await copyFile(new URL('./test-browser-app.mjs', import.meta.url), join(f.root, 'scripts/test-browser-app.mjs'));
  for (const app of ['playground', 'controls']) {
    const result = spawnSync(process.execPath, [join(f.root, 'scripts/test-browser-app.mjs'), app, '--', '--grep=focused case'], {
      cwd: f.root, encoding: 'utf8', env: { ...f.env, FIXTURE_CAPACITY: '0', NODE_OPTIONS: `--import=${join(f.root, 'capacity.mjs')}`, RIDGELINE_BROWSER_MIN_FREE_BYTES: '0' },
    });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.match(await readFile(join(f.root, 'commands'), 'utf8'), /"--grep=focused case"/);
  const invalid = f.run({ RIDGELINE_BROWSER_MIN_FREE_BYTES: '-1' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /must be a nonnegative integer byte count/);
});

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

test('timed-out and signalled commands retain the lock while a descendant survives', async t => {
  for (const interruption of ['timeout', 'signal']) {
    await t.test(interruption, async t => {
      const f = await fixture(t);
      const preload = join(f.root, 'short-timeout.mjs');
      // Shorten only the timeout; use real spawnSync termination and an actual
      // surviving grandchild to preserve the process-tree failure mode.
      await writeFile(preload, `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const spawnSync = childProcess.spawnSync;
childProcess.spawnSync = (command, args, options) => spawnSync(command, args, { ...options, timeout: 2000 });
syncBuiltinESMExports();
`);
      const interrupted = f.run({ INTERRUPT_BUILD: interruption, NODE_OPTIONS: `--import=${preload}` });
      const descendant = Number(await readFile(join(f.root, 'descendant.pid'), 'utf8'));
      t.after(() => {
        try { process.kill(descendant, 'SIGKILL'); } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      });
      assert.ifError(interrupted.error);
      assert.equal(interrupted.status, 1);
      if (interruption === 'timeout') assert.match(interrupted.stderr, /ETIMEDOUT/);
      process.kill(descendant, 0);
      const history = join(f.root, '.artifacts/browser-runs');
      const ownedRun = join(history, (await readdir(history))[0]);
      assert.equal(JSON.parse(await readFile(join(ownedRun, '.browser-run.json'), 'utf8')).status, 'interrupted');
      await writeFile(join(ownedRun, 'partial-report'), 'child output may still be active');
      const blocked = f.run();
      assert.ifError(blocked.error);
      assert.equal(blocked.status, 1, 'a second run must not start while descendants may survive');
      assert.match(blocked.stderr, /already locked in this checkout/);
      assert.equal(await readFile(join(f.root, 'commands'), 'utf8'), '["build"]\n');
      assert.equal(await readFile(join(ownedRun, 'partial-report'), 'utf8'), 'child output may still be active');
    });
  }
});
