import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { arch, cpus, loadavg, platform, release, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

register();
const { definitionPath, fixtureNames, parseSample, prepareInputs, settings, sha256, workloads } = await import('./cpu-workloads.ts');
const harnessRoot = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const loader = createRequire(import.meta.url).resolve('tsx');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    assert(['--base', '--candidate', '--out'].includes(flag) && args[i + 1] && !args[i + 1].startsWith('--') && !(flag in options), 'Invalid or duplicate option');
    options[flag] = resolve(args[i + 1]);
  }
  assert(Object.keys(options).length === 3, 'All options are required');
  return { base: options['--base'], candidate: options['--candidate'], out: options['--out'] };
}

async function sourceContext(path) {
  const root = await realpath(path);
  assert.equal(await realpath(git(root, 'rev-parse', '--show-toplevel')), root, 'Source must be a checkout root');
  const status = git(root, 'status', '--porcelain=v1', '--untracked-files=all');
  const untracked = git(root, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
  const untrackedHashes = await Promise.all(untracked.map(async name => ({ name, sha256: sha256(await readFile(join(root, name))) })));
  const require = createRequire(join(root, 'package.json'));
  const dependencies = Object.fromEntries(await Promise.all(['tsx', 'maplibre-gl', '@maplibre/maplibre-gl-style-spec'].map(async name => {
    const packagePath = require.resolve(`${name}/package.json`);
    return [name, JSON.parse(await readFile(packagePath, 'utf8')).version];
  })));
  return { root, revision: git(root, 'rev-parse', 'HEAD'), dirty: status.length > 0, status,
    diffSha256: sha256(execFileSync('git', ['-C', root, 'diff', '--binary', 'HEAD'], { maxBuffer: 16 * 1024 * 1024 })),
    untrackedHashes, lockfileSha256: sha256(await readFile(join(root, 'pnpm-lock.yaml'))), dependencies };
}

export function runChild({ args, cwd, prefix, timeoutMs = settings.timeoutMs }) {
  writeFileSync(`${prefix}.stdout`, '');
  writeFileSync(`${prefix}.stderr`, '');
  return new Promise((resolveChild, reject) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let failure;
    let killTimer;
    function stop(error) {
      failure ??= error;
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 1000);
    }
    const abort = signal => stop(new Error(`Child interrupted by ${signal}`));
    const onInterrupt = () => abort('SIGINT');
    const onTerminate = () => abort('SIGTERM');
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
    const timer = setTimeout(() => stop(new Error(`Child timeout after ${timeoutMs} ms`)), timeoutMs);
    let bytes = 0;
    for (const [stream, suffix] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', chunk => {
      if (bytes > 1024 * 1024) return;
      try {
        appendFileSync(`${prefix}.${suffix}`, chunk);
        bytes += chunk.length;
        if (bytes > 1024 * 1024) stop(new Error('Child output exceeded 1 MiB'));
        else if (suffix === 'stdout') stdout += chunk.toString();
      } catch (error) { stop(error); }
    });
    child.once('error', error => { failure ??= error; });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Child exited with code ${code}, signal ${signal}. See ${prefix}.stderr`));
      else resolveChild(stdout);
    });
  });
}

export function acceptSample(value, { workload, inputSha256, definitionSha256, reference }) {
  const sample = parseSample(value);
  assert.equal(sample.workload, workload, 'Child ran wrong workload');
  assert.equal(sample.inputSha256, inputSha256, 'Workload input hash mismatch');
  assert.equal(sample.definitionSha256, definitionSha256, 'Workload definition hash mismatch');
  if (workload === 'feature-snapshot') assert.deepEqual(sample.work, { features: settings.features, replacements: settings.features * settings.batches });
  if (reference) {
    assert.deepEqual(sample.work, reference.work, 'Work count mismatch');
    assert.equal(sample.outputSha256, reference.outputSha256, 'Output digest mismatch');
  }
  return sample;
}

export function summarize(samples) {
  return workloads.map(workload => {
    function stats(side) {
      const selected = samples.filter(sample => sample.workload === workload && sample.side === side);
      assert.equal(selected.length, settings.pairs, 'Incomplete paired samples');
      assert.deepEqual(selected.map(sample => sample.pair).sort((a, b) => a - b), Array.from({ length: settings.pairs }, (_, i) => i), 'Duplicate or missing pair');
      const values = selected.map(sample => sample.elapsedMs / sample.operations).sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return { medianMs: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
        minMs: values[0], maxMs: values.at(-1) };
    }
    const base = stats('base'), candidate = stats('candidate');
    return { workload, base, candidate, changePct: (candidate.medianMs / base.medianMs - 1) * 100 };
  });
}

export function renderSummary(report) {
  const lines = ['# Informational CPU microbenchmarks', '',
    'Synchronous kernel elapsed time only. These results do not establish FPS, production readiness, the largest-asset 50 ms trigger, or Mac acceptance.', '',
    `Execution status is ${report.status}. Timing deltas never fail execution.`, ''];
  if (report.status === 'failed') lines.push('Comparison incomplete. Inspect report.json and raw child stdout/stderr.', '', '```text', report.error.replaceAll('```', "'''"), '```');
  else {
    lines.push('Six timed pairs per workload with alternating AB/BA order and three untimed warmups per child.', '',
      '| Workload | Base median [min, max] ms/op | Candidate median [min, max] ms/op | Median delta |',
      '| --- | --- | --- | --- |');
    const format = value => `${value.medianMs.toFixed(3)} [${value.minMs.toFixed(3)}, ${value.maxMs.toFixed(3)}]`;
    for (const comparison of report.comparisons) lines.push(`| ${comparison.workload} | ${format(comparison.base)} | ${format(comparison.candidate)} | ${comparison.changePct.toFixed(2)}% |`);
    lines.push('', 'One operation is one GLB parse or one 1,000-feature upsert batch. Positive delta means increased elapsed time. No winner or latency acceptance is declared.');
  }
  return `${lines.join('\n')}\n`;
}

async function compare(options) {
  await mkdir(dirname(options.out), { recursive: true });
  await mkdir(options.out);
  await writeFile(join(options.out, '.pin'), 'CPU comparison evidence. Release deliberately.\n');
  let report = { status: 'failed', samples: [], error: 'Comparison has not completed' };
  const context = { startedAt: new Date().toISOString(), command: process.argv, settings, settingsSha256: sha256(JSON.stringify(settings)),
    environment: { node: process.version, execPath: process.execPath, platform: platform(), release: release(), arch: arch(),
      cpus: cpus(), totalmem: totalmem(), loadavg: loadavg(), runner: process.env.RUNNER_NAME,
      imageOS: process.env.ImageOS, imageVersion: process.env.ImageVersion, runnerOS: process.env.RUNNER_OS,
      githubSha: process.env.GITHUB_SHA, requestedBase: process.env.CPU_BASE_SHA, requestedCandidate: process.env.CPU_CANDIDATE_SHA },
    sampleOrder: [] };
  async function save() {
    await writeFile(join(options.out, 'report.json'), json({ schema: 1, ...context, ...report }));
    await writeFile(join(options.out, 'summary.md'), renderSummary(report));
  }
  await save();
  try {
    context.harnessRoot = harnessRoot;
    context.harnessSha256 = sha256(await readFile(fileURLToPath(import.meta.url)));
    context.definitionSha256 = sha256(await readFile(definitionPath));
    context.loader = { path: await realpath(loader), sha256: sha256(await readFile(loader)) };
    context.pnpm = execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim();
    context.sides = { base: await sourceContext(options.base), candidate: await sourceContext(options.candidate) };
    assert.equal(context.sides.candidate.root, harnessRoot, 'Run the candidate-owned comparator from its checkout');
    for (const side of ['base', 'candidate']) {
      const expected = process.env[side === 'base' ? 'CPU_BASE_SHA' : 'CPU_CANDIDATE_SHA'];
      if (expected) {
        assert.match(expected, /^[a-f0-9]{40}$/, 'Expected revision must be a full SHA');
        assert.equal(context.sides[side].revision, expected, `Unexpected ${side} revision`);
        assert.equal(context.sides[side].dirty, false, `Dirty CI ${side} checkout`);
      }
    }
    if (process.env.GITHUB_EVENT_PATH) {
      const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
      context.requestedPrHead = event?.pull_request?.head?.sha ?? null;
    }
    const fixtureRoot = join(options.out, 'fixtures');
    await mkdir(fixtureRoot);
    for (const name of fixtureNames) await copyFile(join(harnessRoot, 'playground/public/entity-models', name), join(fixtureRoot, name));
    const inputs = await prepareInputs(fixtureRoot);
    context.fixtures = inputs.fixtures;
    context.featuresSha256 = inputs.featuresSha256;
    context.inputSha256 = inputs.inputSha256;
    await save();
    for (const workload of workloads) {
      let reference;
      for (let pair = 0; pair < settings.pairs; pair++) {
        const sides = pair % 2 === 0 ? ['base', 'candidate'] : ['candidate', 'base'];
        for (const side of sides) {
          const order = context.sampleOrder.length;
          const prefix = join(options.out, `${String(order).padStart(2, '0')}-${workload}-${pair}-${side}`);
          const args = ['--import', loader, definitionPath, context.sides[side].root, fixtureRoot, workload];
          context.sampleOrder.push({ workload, pair, side, order, command: [process.execPath, ...args], prefix });
          await save();
          const stdout = await runChild({ args, cwd: harnessRoot, prefix });
          const sample = acceptSample(JSON.parse(stdout), { workload, inputSha256: inputs.inputSha256,
            definitionSha256: context.definitionSha256, reference });
          reference ??= sample;
          report.samples.push({ ...sample, side, pair, order });
          await save();
        }
      }
    }
    context.finalSides = { base: await sourceContext(options.base), candidate: await sourceContext(options.candidate) };
    assert.deepEqual(context.finalSides, context.sides, 'Source checkout changed during comparison');
    assert.equal(sha256(await readFile(definitionPath)), context.definitionSha256, 'Workload changed during comparison');
    assert.equal(sha256(await readFile(fileURLToPath(import.meta.url))), context.harnessSha256, 'Comparator changed during comparison');
    report = { status: 'complete', samples: report.samples, comparisons: summarize(report.samples) };
  } catch (error) {
    report = { status: 'failed', samples: report.samples, error: error instanceof Error ? error.stack ?? error.message : String(error) };
  }
  context.finishedAt = new Date().toISOString();
  context.finalLoadavg = loadavg();
  await save();
  process.stdout.write(`${join(options.out, 'report.json')}\n`);
  if (report.status === 'failed') process.stderr.write(`${report.error}\n`);
  return report.status === 'complete' ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${error.message}\nUsage: node scripts/compare-cpu.mjs --base CHECKOUT --candidate CHECKOUT --out FRESH_DIRECTORY\n`);
    process.exitCode = 2;
  }
  if (options) {
    try { process.exitCode = await compare(options); }
    catch (error) { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; }
  }
}
