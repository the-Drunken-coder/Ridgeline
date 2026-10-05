import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ridgeline-measurement-cleanup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['scripts', 'bin', 'tools/model-measurement', 'playground/public/entity-models']) {
    await mkdir(join(root, directory), { recursive: true });
  }
  for (const script of ['measure-models.mjs', 'browser-resources.mjs']) {
    await copyFile(new URL(script, import.meta.url), join(root, 'scripts', script));
  }
  await writeFile(join(root, '.gitignore'), '.artifacts/\n');
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: '@ridgeline/map', version: '0.1.0',
    dependencies: { 'maplibre-gl': 'fixture' }, devDependencies: { vite: 'fixture', typescript: 'fixture' },
  }));
  await writeFile(join(root, 'tools/model-measurement/consumer.ts'), '// fixture consumer\n');
  await writeFile(join(root, 'playground/public/entity-models/drone.glb'), 'fixture original asset');
  for (const args of [['init', '--quiet'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '--allow-empty', '-m', 'fixture']]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  // Exercise the real entrypoint and filesystem ownership. Substitute only
  // package setup and the browser/preview boundaries that can reject teardown.
  const command = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.FIXTURE_ROOT;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(root, 'commands'), JSON.stringify(args) + '\\n');
const artifacts = path.join(root, '.artifacts/model-measurement');
if (args[0] === 'pack') fs.writeFileSync(path.join(artifacts, 'ridgeline-map-0.1.0.tgz'), 'fixture package bytes');
if (args.includes('scripts/model-workloads.ts')) {
  fs.mkdirSync(path.join(artifacts, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(artifacts, 'assets/manifest.json'), '{}');
}
`;
  for (const executable of ['pnpm', 'node']) await writeFile(join(root, 'bin', executable), command, { mode: 0o755 });
  const close = resource => `async close() {
    appendFileSync(process.env.FIXTURE_ROOT + '/closed', '${resource}\\n');
    if (process.env.FAIL_${resource.toUpperCase()}_CLOSE) throw new Error('${resource} cleanup failed');
  }`;
  const modules = {
    playwright: `import { appendFileSync } from 'node:fs';
const engine = { async launch() { return {
  async newPage() { return {
    on() {}, async goto() {}, async waitForFunction() {},
    async evaluate() { return { result: { verified: true }, error: process.env.FAIL_MEASUREMENT ? 'measurement failed' : undefined }; },
  }; },
  version() { return 'fixture'; }, ${close('browser')},
}; } };
export { engine as chromium, engine as firefox };
`,
    vite: `import { appendFileSync } from 'node:fs';
export async function preview() { return { ${close('server')} }; }
`,
  };
  for (const [name, source] of Object.entries(modules)) {
    const directory = join(root, 'node_modules', name);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module', exports: './index.mjs' }));
    await writeFile(join(directory, 'index.mjs'), source);
  }
  const env = { ...process.env, FIXTURE_ROOT: root, RIDGELINE_BROWSER_MIN_FREE_BYTES: '0',
    PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH}` };
  return {
    root,
    run: (extraEnv = {}) => spawnSync(process.execPath, [join(root, 'scripts/measure-models.mjs'), '--verify'], {
      cwd: root, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 10_000,
    }),
  };
}

for (const measurementFailed of [true, false]) {
  test(`cleanup failures after ${measurementFailed ? 'failed' : 'successful'} measurement close both resources and retain ownership`, async t => {
    for (const resources of [['browser'], ['server'], ['browser', 'server']]) {
      await t.test(resources.join(' and '), async t => {
        const f = await fixture(t);
        const result = f.run({
          ...(measurementFailed ? { FAIL_MEASUREMENT: '1' } : {}),
          ...Object.fromEntries(resources.map(resource => [`FAIL_${resource.toUpperCase()}_CLOSE`, '1'])),
        });
        assert.ifError(result.error);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.equal(await readFile(join(f.root, 'closed'), 'utf8'), 'browser\nserver\n');
        for (const resource of resources) assert.match(result.stderr, new RegExp(`${resource} cleanup failed`));
        if (measurementFailed) {
          assert.match(result.stderr, /Error: measurement failed/);
          assert.ok(result.stderr.lastIndexOf('Error: measurement failed') > result.stderr.lastIndexOf('cleanup failed'),
            'the uncaught measurement failure must remain primary');
        } else {
          assert.doesNotMatch(result.stderr, /Error: measurement failed/);
          const verification = JSON.parse(await readFile(join(f.root, '.artifacts/model-measurement/verification.json'), 'utf8'));
          assert.equal(verification.verified, true);
        }
        const history = join(f.root, '.artifacts/model-measurement');
        const run = (await readdir(history)).find(name => name.startsWith('run-'));
        const recordPath = join(history, run, '.browser-run.json');
        assert.equal(JSON.parse(await readFile(recordPath, 'utf8')).status, 'interrupted');
        await access(join(f.root, '.artifacts/browser-run.lock'));
        const commands = await readFile(join(f.root, 'commands'), 'utf8');
        const evidence = await readFile(recordPath, 'utf8');
        const blocked = f.run();
        assert.equal(blocked.status, 1, blocked.stderr);
        assert.match(blocked.stderr, /already locked in this checkout/);
        assert.equal(await readFile(join(f.root, 'commands'), 'utf8'), commands);
        assert.equal(await readFile(recordPath, 'utf8'), evidence);
      });
    }
  });
}

test('successful cleanup releases ownership and records the measurement result', async t => {
  for (const measurementFailed of [true, false]) {
    await t.test(measurementFailed ? 'failed measurement' : 'successful measurement', async t => {
      const f = await fixture(t);
      const result = f.run(measurementFailed ? { FAIL_MEASUREMENT: '1' } : {});
      assert.ifError(result.error);
      assert.equal(result.status, measurementFailed ? 1 : 0, result.stderr);
      assert.equal(await readFile(join(f.root, 'closed'), 'utf8'), 'browser\nserver\n');
      await assert.rejects(access(join(f.root, '.artifacts/browser-run.lock')));
      const history = join(f.root, '.artifacts/model-measurement');
      const run = (await readdir(history)).find(name => name.startsWith('run-'));
      assert.equal(JSON.parse(await readFile(join(history, run, '.browser-run.json'), 'utf8')).status,
        measurementFailed ? 'failed' : 'complete');
      if (measurementFailed) {
        assert.match(result.stderr, /Error: measurement failed/);
        await access(join(history, run, '.pin'));
      } else {
        const verification = JSON.parse(await readFile(join(history, run, 'verification.json'), 'utf8'));
        assert.equal(verification.verified, true);
      }
    });
  }
});

test('output finalization failure preserves the measurement error and retained lock', async t => {
  for (const measurementFailed of [true, false]) {
    await t.test(measurementFailed ? 'failed measurement' : 'successful measurement', async t => {
      const f = await fixture(t);
      const preload = join(f.root, 'retention-failure.mjs');
      await writeFile(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const writeFileSync = fs.writeFileSync;
fs.writeFileSync = (path, data, ...args) => {
  if (String(path).endsWith('/.browser-run.json') && ['failed', 'complete'].includes(JSON.parse(data).status)) {
    throw new Error('retention failed');
  }
  return writeFileSync(path, data, ...args);
};
syncBuiltinESMExports();
`);
      const result = f.run({ NODE_OPTIONS: `--import=${preload}`, ...(measurementFailed ? { FAIL_MEASUREMENT: '1' } : {}) });
      assert.ifError(result.error);
      assert.equal(result.status, 1, result.stderr);
      assert.equal(await readFile(join(f.root, 'closed'), 'utf8'), 'browser\nserver\n');
      assert.match(result.stderr, /retention failed/);
      assert.match(result.stderr, /Browser lock retained.*output retention did not complete/);
      if (measurementFailed) {
        assert.match(result.stderr, /Error: measurement failed/);
        assert.ok(result.stderr.lastIndexOf('Error: measurement failed') > result.stderr.lastIndexOf('retention failed'));
      }
      await access(join(f.root, '.artifacts/browser-run.lock'));
      assert.match(f.run().stderr, /already locked in this checkout/);
    });
  }
});
