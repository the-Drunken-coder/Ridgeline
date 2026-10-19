import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { acceptSample, renderSummary, runChild, summarize } from './compare-cpu.mjs';
import { operations, settings, workloads } from './cpu-workloads.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const hash = 'a'.repeat(64);
const payload = () => ({ workload: 'glb-parse', elapsedMs: 40, operations: 40,
  work: { batches: 40, triangles: 400, vertices: 1200 }, inputSha256: hash, definitionSha256: hash, outputSha256: hash });
const expected = { workload: 'glb-parse', inputSha256: hash, definitionSha256: hash };

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'ridgeline-cpu-'));
  t.after(() => rm(path, { force: true, recursive: true }));
  return path;
}

test('child protocol rejects missing, malformed, zero and incompatible samples', () => {
  const reference = acceptSample(payload(), expected);
  const invalid = [null, {}, { ...payload(), elapsedMs: 0 }, { ...payload(), elapsedMs: NaN },
    { ...payload(), operations: 0 }, { ...payload(), operations: 39 }, { ...payload(), work: {} },
    { ...payload(), work: { batches: 40, triangles: -1, vertices: 1200 } },
    { ...payload(), inputSha256: 'b'.repeat(64) }, { ...payload(), definitionSha256: 'b'.repeat(64) },
    { ...payload(), outputSha256: 'invalid' },
    { ...payload(), outputSha256: 'b'.repeat(64) },
    { ...payload(), work: { batches: 40, triangles: 401, vertices: 1200 } }];
  for (const value of invalid) assert.throws(() => acceptSample(value, { ...expected, reference }));
});

test('statistics require complete pairs and report median, range and percentage without acceptance', () => {
  const samples = workloads.flatMap(workload => Array.from({ length: settings.pairs }, (_, pair) =>
    ['base', 'candidate'].map(side => ({ ...payload(), workload, pair, side,
      elapsedMs: (pair + 1) * (side === 'candidate' ? 2 : 1) * operations(workload), operations: operations(workload) }))).flat());
  const comparisons = summarize(samples);
  assert.deepEqual(comparisons[0].base, { medianMs: 3.5, minMs: 1, maxMs: 6 });
  assert.deepEqual(comparisons[0].candidate, { medianMs: 7, minMs: 2, maxMs: 12 });
  assert.equal(comparisons[0].changePct, 100);
  assert.throws(() => summarize(samples.slice(1)), /Incomplete/);
  assert.throws(() => summarize([...samples.slice(1), { ...samples[0], pair: 1 }]), /Duplicate or missing/);
  const summary = renderSummary({ status: 'complete', samples, comparisons });
  assert.match(summary, /Informational CPU microbenchmarks/);
  assert.match(summary, /100.00%/);
  assert.match(summary, /do not establish FPS/);
  assert.match(summary, /Mac acceptance/);
  assert.doesNotMatch(summary, /winner is|faster|slower/);
  assert.match(renderSummary({ status: 'failed', samples: [], error: 'incomplete' }), /Comparison incomplete/);
});

test('child failure retains exact stdout and stderr before rejecting', async t => {
  const out = await directory(t);
  const prefix = join(out, 'failure');
  await assert.rejects(runChild({ args: ['-e', 'process.stdout.write("partial"); process.stderr.write("kernel failed"); process.exit(7)'], cwd: root, prefix }), /code 7/);
  assert.equal(await readFile(`${prefix}.stdout`, 'utf8'), 'partial');
  assert.equal(await readFile(`${prefix}.stderr`, 'utf8'), 'kernel failed');
});

test('timeout reaps the exact child even when it ignores SIGTERM', async t => {
  const out = await directory(t);
  const prefix = join(out, 'timeout');
  await assert.rejects(runChild({ args: ['-e', 'process.on("SIGTERM",()=>{}); console.log(process.pid); setInterval(()=>{},1000)'], cwd: root, prefix, timeoutMs: 500 }), /timeout/);
  const pid = Number((await readFile(`${prefix}.stdout`, 'utf8')).trim());
  assert(pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

function cli(args) {
  return spawnSync(process.execPath, ['scripts/compare-cpu.mjs', ...args], { cwd: root, encoding: 'utf8', timeout: 15_000 });
}

test('CLI rejects usage and existing output without overwriting evidence', async t => {
  for (const args of [[], ['--base', root], ['--unknown', root], ['--base', root, '--base', root]]) {
    const result = cli(args);
    assert.ifError(result.error);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage:/);
  }
  const out = await directory(t);
  await writeFile(join(out, 'sentinel'), 'preserved');
  const result = cli(['--base', root, '--candidate', root, '--out', out]);
  assert.equal(result.status, 1);
  assert.equal(await readFile(join(out, 'sentinel'), 'utf8'), 'preserved');
});

test('CLI retains pinned failed reports for missing kernels and malformed or empty child output', async t => {
  const temp = await directory(t);
  const base = join(temp, 'base');
  await mkdir(join(base, 'src'), { recursive: true });
  await writeFile(join(base, 'package.json'), '{"type":"module"}');
  await writeFile(join(base, 'pnpm-lock.yaml'), 'fixture lockfile');
  await symlink(join(root, 'node_modules'), join(base, 'node_modules'));
  for (const args of [['init', '--quiet'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture']]) {
    const git = spawnSync('git', args, { cwd: base, encoding: 'utf8' });
    assert.equal(git.status, 0, git.stderr);
  }
  for (const [index, source] of [null, 'process.stdout.write("malformed"); process.exit(0);', 'process.exit(0);', 'console.error("kernel failure"); process.exit(9);'].entries()) {
    if (source) await writeFile(join(base, 'src/model-glb.ts'), source);
    const out = join(temp, `run-${index}`);
    const result = cli(['--base', base, '--candidate', root, '--out', out]);
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(await readFile(join(out, '.pin'), 'utf8'), 'CPU comparison evidence. Release deliberately.\n');
    const report = JSON.parse(await readFile(join(out, 'report.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.samples.length, 0);
    assert.equal(report.sampleOrder.length, 1, report.error);
    const prefix = report.sampleOrder[0].prefix;
    const stderr = await readFile(`${prefix}.stderr`, 'utf8');
    const stdout = await readFile(`${prefix}.stdout`, 'utf8');
    if (index === 0) assert.match(stderr, /Cannot find module/);
    if (index === 1) assert.equal(stdout, 'malformed');
    if (index === 2) assert.equal(stdout, '');
    if (index === 3) assert.match(stderr, /kernel failure/);
    assert.match(await readFile(join(out, 'summary.md'), 'utf8'), /Comparison incomplete/);
  }
});
