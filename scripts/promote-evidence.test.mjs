import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'promote-evidence.mjs');
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'ridgeline-promotion-'));
  const run = (command, args) => spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  assert.equal(run('git', ['init', '-q']).status, 0);
  writeFileSync(resolve(root, '.gitignore'), '.artifacts/\n');
  mkdirSync(resolve(root, '.scratch/fixture'), { recursive: true });
  writeFileSync(resolve(root, '.scratch/fixture/spec.md'), '# Fixture spec\n');
  mkdirSync(resolve(root, '.artifacts/browser-runs/packaged-fixture'), { recursive: true });
  const producer = '.artifacts/browser-runs/packaged-fixture';
  writeFileSync(resolve(root, producer, '.pin'), 'selected failure\n');
  writeFileSync(resolve(root, producer, 'summary.md'), '# Final summary\n[Spec](../../spec.md)\n');
  writeFileSync(resolve(root, producer, 'raw.json'), 'abc');
  writeFileSync(resolve(root, producer, 'capture.png'), Buffer.from([0, 255, 13, 10, 8]));
  writeFileSync(resolve(root, producer, 'intermediate.log'), 'keep transient\n');
  const plan = { destination: '.scratch/fixture/evidence/final',
    provenance: { spec: '.scratch/fixture/spec.md', reviewed: 'base...head',
      localVerification: 'historical fixture producer, no runtime correctness claim', remainingLimits: ['fixture only'] },
    reproduction: ['node scripts/promote-evidence.mjs .artifacts/plan.json --dry-run'],
    files: [{ source: `${producer}/summary.md`, name: 'summary.md' }, { source: `${producer}/capture.png`, name: 'capture.png' }],
    rawReports: [{ source: `${producer}/raw.json`, name: 'raw.json' }],
  };
  const promote = (...args) => {
    writeFileSync(resolve(root, '.artifacts/plan.json'), JSON.stringify(plan));
    return run(process.execPath, [script, '.artifacts/plan.json', ...args]);
  };
  return { root, producer, plan, promote, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('promotion verifies raw producer bytes in dry-run and publish while preserving pins and intermediate output', () => {
  const f = fixture();
  try {
    const dry = f.promote('--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(existsSync(resolve(f.root, f.plan.destination)), false);
    assert.ok(!readdirSync(resolve(f.root, '.artifacts')).some(name => name.startsWith('promotion-')));
    const published = f.promote();
    assert.equal(published.status, 0, published.stderr);
    const destination = resolve(f.root, f.plan.destination);
    const manifest = JSON.parse(readFileSync(resolve(destination, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.provenance, f.plan.provenance);
    assert.equal(manifest.rawArchive.members[0].sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const extracted = f.run('tar', ['-xOzf', resolve(destination, 'raw-reports.tar.gz'), 'raw.json']);
    assert.equal(extracted.status, 0, extracted.stderr);
    assert.equal(extracted.stdout, 'abc');
    assert.deepEqual(readFileSync(resolve(destination, 'capture.png')), Buffer.from([0, 255, 13, 10, 8]));
    assert.equal(readFileSync(resolve(f.root, f.producer, '.pin'), 'utf8'), 'selected failure\n');
    assert.equal(readFileSync(resolve(f.root, f.producer, 'intermediate.log'), 'utf8'), 'keep transient\n');
    assert.equal(f.run('git', ['check-ignore', `${f.producer}/intermediate.log`]).status, 0);
    assert.equal(f.run('git', ['check-ignore', `${f.plan.destination}/manifest.json`]).status, 1);
    const again = f.promote();
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /already exists/);
    assert.equal(readFileSync(resolve(destination, 'summary.md'), 'utf8'), '# Final summary\n[Spec](../../spec.md)\n');
  } finally { f.cleanup(); }
});

test('promotion rejects a symlinked producer without publishing or altering its target', () => {
  const f = fixture();
  try {
    const target = resolve(f.root, '.scratch/fixture/spec.md');
    symlinkSync(target, resolve(f.root, '.artifacts/linked.md'));
    f.plan.files[0].source = '.artifacts/linked.md';
    const result = f.promote();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink/);
    assert.equal(existsSync(resolve(f.root, f.plan.destination)), false);
    assert.equal(readFileSync(target, 'utf8'), '# Fixture spec\n');
    assert.equal(readFileSync(resolve(f.root, f.producer, '.pin'), 'utf8'), 'selected failure\n');
  } finally { f.cleanup(); }
});

test('promotion rejects a destination that escapes the versioned feature evidence area', () => {
  const f = fixture();
  try {
    f.plan.destination = '.scratch/../evidence';
    f.plan.files = [f.plan.files[1]];
    const result = f.promote();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Destination/);
    assert.equal(existsSync(resolve(f.root, 'evidence')), false);
  } finally { f.cleanup(); }
});

test('promotion refuses ignored sources reached outside the declared artifact area', () => {
  const f = fixture();
  try {
    writeFileSync(resolve(f.root, '.gitignore'), '.artifacts/\nnode_modules/\n');
    mkdirSync(resolve(f.root, 'node_modules'));
    writeFileSync(resolve(f.root, 'node_modules/source.md'), '# Unrelated cache\n');
    f.plan.files[0].source = '.artifacts/../node_modules/source.md';
    const result = f.promote();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /artifact/);
    assert.equal(existsSync(resolve(f.root, f.plan.destination)), false);
    assert.equal(readFileSync(resolve(f.root, 'node_modules/source.md'), 'utf8'), '# Unrelated cache\n');
  } finally { f.cleanup(); }
});

test('promotion rejects tracked producer files even inside an ignored artifact directory', () => {
  const f = fixture();
  try {
    assert.equal(f.run('git', ['add', '--force', `${f.producer}/raw.json`]).status, 0);
    const result = f.promote('--dry-run');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tracked/);
    assert.equal(existsSync(resolve(f.root, f.plan.destination)), false);
    assert.equal(readFileSync(resolve(f.root, f.producer, 'raw.json'), 'utf8'), 'abc');
    assert.equal(readFileSync(resolve(f.root, f.producer, '.pin'), 'utf8'), 'selected failure\n');
  } finally { f.cleanup(); }
});

test('malformed selected entries fail clearly and leave no partial evidence or staging output', () => {
  const f = fixture();
  try {
    f.plan.rawReports[0] = null;
    const result = f.promote();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /file entry/);
    assert.equal(existsSync(resolve(f.root, f.plan.destination)), false);
    assert.ok(!readdirSync(resolve(f.root, '.artifacts')).some(name => name.startsWith('promotion-')));
    assert.equal(readFileSync(resolve(f.root, f.producer, 'raw.json'), 'utf8'), 'abc');
  } finally { f.cleanup(); }
});

test('a broken retained link fails before publishing and leaves selected producer evidence pinned', () => {
  const f = fixture();
  try {
    writeFileSync(resolve(f.root, f.producer, 'summary.md'), '# Summary\n[Missing](missing.md)\n');
    const result = f.promote();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing evidence link/);
    assert.equal(existsSync(resolve(f.root, f.plan.destination)), false);
    assert.ok(!readdirSync(resolve(f.root, '.artifacts')).some(name => name.startsWith('promotion-')));
    assert.equal(readFileSync(resolve(f.root, f.producer, '.pin'), 'utf8'), 'selected failure\n');
    assert.equal(readFileSync(resolve(f.root, f.producer, 'raw.json'), 'utf8'), 'abc');
  } finally { f.cleanup(); }
});

test('curated links cannot depend on ignored transient producer paths', () => {
  const f = fixture();
  try {
    writeFileSync(resolve(f.root, f.producer, 'summary.md'), '# Summary\n[Raw](../../../../.artifacts/browser-runs/packaged-fixture/raw.json)\n');
    const result = f.promote();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /transient|retained/);
    assert.equal(existsSync(resolve(f.root, f.plan.destination)), false);
    assert.equal(readFileSync(resolve(f.root, f.producer, '.pin'), 'utf8'), 'selected failure\n');
  } finally { f.cleanup(); }
});

test('promotion and browser retention preserve pinned evidence until its owner releases it', () => {
  const f = fixture();
  const resources = pathToFileURL(resolve(import.meta.dirname, 'browser-resources.mjs')).href;
  try {
    const create = f.run(process.execPath, ['--input-type=module', '-e', `
      import { claimBrowserRun } from ${JSON.stringify(resources)};
      import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
      import { resolve } from 'node:path';
      process.env.RIDGELINE_BROWSER_MIN_FREE_BYTES = '0';
      const root = process.argv[1];
      const selected = claimBrowserRun(root, 'packaged');
      cpSync(resolve(root, '.artifacts/browser-runs/packaged-fixture'), selected.directory, { recursive: true });
      selected.finish(true);
      for (const status of ['running', 'interrupted']) {
        const directory = resolve(root, '.artifacts/browser-runs', 'packaged-' + status);
        mkdirSync(directory);
        writeFileSync(resolve(directory, '.browser-run.json'), JSON.stringify({
          owner: 'ridgeline-browser', version: 1, command: 'packaged', pid: process.pid, status,
        }));
      }
      for (let i = 0; i < 5; i++) claimBrowserRun(root, 'packaged').finish();
      console.log(JSON.stringify({ selected: selected.directory }));
    `, f.root]);
    assert.equal(create.status, 0, create.stderr);
    const selected = JSON.parse(create.stdout.trim().split('\n').at(-1)).selected;
    const producer = selected.slice(f.root.length + 1);
    for (const entry of [...f.plan.files, ...f.plan.rawReports])
      entry.source = entry.source.replace(f.producer, producer);
    assert.equal(f.promote('--dry-run').status, 0);
    const published = f.promote();
    assert.equal(published.status, 0, published.stderr);
    assert.equal(readFileSync(resolve(selected, 'raw.json'), 'utf8'), 'abc');
    assert.ok(existsSync(resolve(selected, '.pin')));
    const release = f.run(process.execPath, ['--input-type=module', '-e', `
      import { claimBrowserRun } from ${JSON.stringify(resources)};
      import { rmSync } from 'node:fs';
      import { resolve } from 'node:path';
      process.env.RIDGELINE_BROWSER_MIN_FREE_BYTES = '0';
      rmSync(resolve(process.argv[2], '.pin'));
      claimBrowserRun(process.argv[1], 'packaged').finish();
    `, f.root, selected]);
    assert.equal(release.status, 0, release.stderr);
    assert.equal(existsSync(selected), false, 'Released old producer should become eligible for retention');
    for (const status of ['running', 'interrupted'])
      assert.ok(existsSync(resolve(f.root, '.artifacts/browser-runs', 'packaged-' + status)));
    const archive = resolve(f.root, f.plan.destination, 'raw-reports.tar.gz');
    assert.equal(f.run('tar', ['-xOzf', archive, 'raw.json']).stdout, 'abc');
    assert.equal(readFileSync(resolve(f.root, f.plan.destination, 'summary.md'), 'utf8'), '# Final summary\n[Spec](../../spec.md)\n');
  } finally { f.cleanup(); }
});
