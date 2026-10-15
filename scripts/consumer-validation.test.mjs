import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { checkPackage } from './check-package.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ridgeline-consumer-validation-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  for (const script of ['check-package.mjs', 'test-browser.mjs', 'browser-resources.mjs', 'validate-consumer.mjs'])
    await copyFile(new URL(script, import.meta.url), join(root, 'scripts', script));
  await symlink(resolve(import.meta.dirname, '../node_modules'), join(root, 'node_modules'), 'dir');
  await writeFile(join(root, '.gitignore'), '.artifacts/\n');
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  const consumer = join(root, '.artifacts/consumer');
  const starter = join(consumer, 'standalone/examples/starter');
  const config = await readFile(new URL('../examples/starter/tsconfig.json', import.meta.url), 'utf8');
  for (const directory of [consumer, starter]) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module',
      scripts: { build: 'tsc --noEmit && vite build' }, devDependencies: { typescript: '7.0.2', vite: '8.3.0' } }));
    await writeFile(join(directory, 'pnpm-workspace.yaml'), 'allowBuilds:\n  esbuild: true\n');
    await writeFile(join(directory, 'tsconfig.json'), config);
    await writeFile(join(directory, 'main.ts'), "document.body.dataset.built = 'yes';\n");
    await writeFile(join(directory, 'index.html'), '<!doctype html><html><body><script type="module" src="./main.ts"></script></body></html>');
  }
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@ridgeline/map', version: '0.1.0', files: ['README.md', 'docs/*.md'] }));
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'README.md'), '# Package\n[Guide](docs/guide.md#repeat-1)\n');
  const guide = '# Guide\n## Repeat\n## Repeat\n[Home](../README.md#package)\n';
  await writeFile(join(root, 'docs/guide.md'), guide);
  const archive = join(root, '.artifacts/ridgeline-map-0.1.0.tgz');
  const packageDirectory = join(root, 'archive/package');
  await mkdir(join(packageDirectory, 'docs'), { recursive: true });
  await copyFile(join(root, 'package.json'), join(packageDirectory, 'package.json'));
  await writeFile(join(packageDirectory, 'docs/guide.md'), guide);
  const pack = async markdown => {
    await writeFile(join(packageDirectory, 'README.md'), markdown);
    const result = spawnSync('tar', ['-czf', archive, '-C', join(root, 'archive'), 'package'], { encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  };
  await pack(await readFile(join(root, 'README.md'), 'utf8'));
  const pnpm = spawnSync('which', ['pnpm'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(pnpm, 'Installed pnpm is required for the real consumer builds.');
  await mkdir(join(root, 'bin'));
  // Only the unrelated library build and browser execution are substituted. The
  // entrypoint, lock, fresh installs, TypeScript/Vite builds and archive are real.
  await writeFile(join(root, 'bin/pnpm'), `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), child = require('node:child_process');
const root = process.env.FIXTURE_ROOT, args = process.argv.slice(2), cwd = process.cwd();
if (cwd === root && ['build', 'pack'].includes(args[0])) process.exit(0);
if (cwd === root && args.includes('scripts/prepare-consumer.mjs')) {
  fs.cpSync(path.join(root, 'template'), path.join(root, '.artifacts/consumer'), { recursive: true });
  process.exit(0);
}
if (args.includes('playwright')) { fs.writeFileSync(path.join(root, 'browser-ran'), 'yes'); process.exit(0); }
const result = child.spawnSync(process.env.FIXTURE_PNPM, args, { cwd, stdio: 'inherit' });
fs.appendFileSync(path.join(root, 'stages.jsonl'), JSON.stringify({ args, cwd, status: result.status }) + '\\n');
process.exit(result.status ?? 1);
`, { mode: 0o755 });
  const runValidation = async () => {
    await rm(join(root, 'template'), { recursive: true, force: true });
    await cp(consumer, join(root, 'template'), { recursive: true,
      filter: source => !source.includes('/node_modules') && !source.includes('/dist') && !source.endsWith('pnpm-lock.yaml') });
    await writeFile(join(root, 'stages.jsonl'), '');
    return spawnSync(process.execPath, ['scripts/test-browser.mjs'], { cwd: root, encoding: 'utf8', timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024, env: { ...process.env, FIXTURE_ROOT: root, FIXTURE_PNPM: pnpm,
        RIDGELINE_BROWSER_MIN_FREE_BYTES: '0', PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH}` } });
  };
  const stages = async () => (await readFile(join(root, 'stages.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  return { root, archive, consumer, starter, packageDirectory, pack, runValidation, stages };
}

test('consumer validation installs and builds the independent starter and accepts the final archive', { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  const result = await f.runValidation();
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal((await f.stages()).length, 5);
  await access(join(f.root, 'browser-ran'));
  for (const directory of [f.consumer, f.starter]) {
    assert.match(await readFile(join(directory, 'dist/index.html'), 'utf8'), /\/assets\/index-/);
    assert.equal(JSON.parse(await readFile(join(directory, 'node_modules/typescript/package.json'), 'utf8')).version, '7.0.2');
  }
  assert.deepEqual(checkPackage(f.root, f.archive), { files: 3, markdownFiles: 2, verifiedLinks: 2 });
});

test('consumer validation rejects broken starter configuration after the generated consumer succeeds', { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  const config = JSON.parse(await readFile(join(f.starter, 'tsconfig.json'), 'utf8'));
  config.compilerOptions.types = ['missing-starter-declarations'];
  await writeFile(join(f.starter, 'tsconfig.json'), JSON.stringify(config));
  const result = await f.runValidation();
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /Cannot find type definition file for 'missing-starter-declarations'/);
  const stages = await f.stages();
  assert.equal(stages.find(stage => stage.cwd === f.consumer && stage.args[0] === 'build')?.status, 0);
  assert.equal(stages.find(stage => stage.cwd === f.starter && stage.args[0] === 'build')?.status, 1);
  assert.equal(stages.length, 4, 'archive checks cannot substitute for the failed starter build');
  await assert.rejects(access(join(f.root, 'browser-ran')));
});

test('consumer validation rejects archive file and heading links after both actual consumer builds succeed', { timeout: 90_000 }, async t => {
  const f = await fixture(t);
  for (const [link, failure] of [['docs/absent.md', /Missing packaged file link/], ['docs/guide.md#absent-heading', /Missing packaged heading link/]]) {
    await f.pack(`# Package\n[Broken](${link})\n`);
    const result = await f.runValidation();
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, failure);
    const stages = await f.stages();
    assert.equal(stages.find(stage => stage.cwd === f.consumer && stage.args[0] === 'build')?.status, 0);
    assert.equal(stages.find(stage => stage.cwd === f.starter && stage.args[0] === 'build')?.status, 0);
    assert.equal(stages[4]?.status, 1);
    await assert.rejects(access(join(f.root, 'browser-ran')));
  }
});

test('final archive inventory rejects missing and unexpected shipped files', async t => {
  const f = await fixture(t);
  await rm(join(f.packageDirectory, 'docs/guide.md'));
  await f.pack('# Package\n');
  assert.throws(() => checkPackage(f.root, f.archive), /Missing: docs\/guide.md/);
  await copyFile(join(f.root, 'docs/guide.md'), join(f.packageDirectory, 'docs/guide.md'));
  await writeFile(join(f.packageDirectory, 'private.txt'), 'unshipped working material');
  await f.pack('# Package\n');
  assert.throws(() => checkPackage(f.root, f.archive), /Unexpected: private\.txt/);
});
