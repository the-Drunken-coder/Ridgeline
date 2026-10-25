import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, freemem, loadavg, release, totalmem, uptime } from 'node:os';
import { resolve } from 'node:path';
import { claimBrowserRun } from '../browser-resources.mjs';
import { validateConsumer } from '../validate-consumer.mjs';
import { checkShards } from '../check-shards.mjs';

const root = resolve(import.meta.dirname, '../..');
const original = 'c747d780d2dcf73efed2a2857d4cb1cb48cd6121';
const target = 'Reliability drawing date-line storage snapping and reload globe with terrain';
const directory = resolve(root, '.artifacts/date-line-diagnostics', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, '.pin'), 'Bounded PR #122 diagnostic experiment. Retain passing and failing captures.\n');
function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
  return result.stdout;
}
function snapshot() {
  const disk = statfsSync(root);
  return { dateNow: Date.now(), node: process.version, platform: process.platform, arch: process.arch, osRelease: release(),
    cpuModel: cpus()[0]?.model, logicalCpus: cpus().length, availableParallelism: availableParallelism(),
    totalMemory: totalmem(), freeMemory: freemem(), loadAverage: loadavg(), uptime: uptime(),
    availableDiskBytes: disk.bsize * disk.bavail,
    runner: Object.fromEntries(['GITHUB_SHA', 'GITHUB_REF', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'RUNNER_OS', 'RUNNER_ARCH',
      'ImageOS', 'ImageVersion'].map(key => [key, process.env[key] ?? null])) };
}
const manifest = { originalRuntimeRevision: original, diagnosticRevision: git('rev-parse', 'HEAD').trim(),
  dirtyStatus: git('status', '--short'), originalSourceTree: git('rev-parse', `${original}:src`).trim(),
  environment: snapshot(), commands: [], samples: [], errors: [] };
manifest.versions = Object.fromEntries([['pnpm', ['--version']], ['pnpm', ['exec', 'playwright', '--version']]].map(([executable, args]) => {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
  return [args.includes('playwright') ? 'playwright' : 'pnpm', result.stdout.trim()];
}));
writeFileSync(resolve(directory, 'dirty.patch'), git('diff', 'HEAD'));
writeFileSync(resolve(directory, 'diagnostic.patch'), git('diff', original));
const save = () => writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
save();
let owner;
const deadline = performance.now() + 11 * 60_000;
function run(args, cwd = root, timeout = 180_000) {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) throw new Error('Eleven-minute experiment budget exhausted. Remaining samples are incomplete.');
  manifest.commands.push({ executable: 'pnpm', args, cwd, before: snapshot(),
    jsonOutput: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ?? null,
    blobOutput: process.env.PLAYWRIGHT_BLOB_OUTPUT_DIR ?? null, limitMs: Math.min(timeout, remaining) });
  save();
  owner.run('pnpm', args, cwd, Math.min(timeout, remaining));
}
const config = ['exec', 'playwright', 'test', '--config', 'playwright.packaged.config.mjs', '--workers=1', '--retries=0'];
try {
  for (const path of ['src', 'tests/browser/catalog.ts', 'playwright.packaged.config.mjs', 'pnpm-lock.yaml']) {
    if (git('diff', original, '--', path) || git('ls-files', '--others', '--exclude-standard', '--', path))
      throw new Error(`Protected original input changed: ${path}`);
  }
  owner = claimBrowserRun(root, 'packaged');
  run(['build']);
  run(['pack', '--pack-destination', '.artifacts']);
  owner.replaceConsumer();
  run(['exec', 'node', 'scripts/prepare-consumer.mjs']);
  validateConsumer(root, run);
  const archive = resolve(root, '.artifacts/ridgeline-map-0.1.0.tgz');
  manifest.packageSha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
  cpSync(archive, resolve(directory, 'ridgeline-map-0.1.0.tgz'));
  cpSync(resolve(root, '.artifacts/consumer/dist'), resolve(directory, 'consumer-dist'), { recursive: true });
  cpSync(resolve(root, '.artifacts/consumer/pnpm-lock.yaml'), resolve(directory, 'consumer-pnpm-lock.yaml'));
  process.env.PLAYWRIGHT_JSON_OUTPUT_FILE = resolve(directory, 'discovery.json');
  run([...config, '--list', '--reporter=json']);
  const discovery = JSON.parse(readFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, 'utf8'));
  function titles(suites) {
    return suites.flatMap(suite => [...(suite.specs ?? []).map(spec => spec.title), ...titles(suite.suites ?? [])]);
  }
  manifest.discoveryTitles = titles(discovery.suites);
  if (manifest.discoveryTitles.length !== 257) throw new Error('Expected all 257 original case identities');
  const modes = Array.from({ length: 10 }, (_, index) => ({ name: `focused-${String(index + 1).padStart(2, '0')}`, args: [`--grep=${target}$`] }));
  modes.push({ name: 'original-shard-2-of-4', args: ['--shard=2/4'] });
  manifest.plan = modes;
  for (const mode of modes) {
    const output = resolve(directory, mode.name);
    mkdirSync(output);
    process.env.PLAYWRIGHT_JSON_OUTPUT_FILE = resolve(output, 'discovery.json');
    run([...config, ...mode.args, '--list', '--reporter=json']);
    const expected = JSON.parse(readFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, 'utf8'));
    process.env.PLAYWRIGHT_JSON_OUTPUT_FILE = resolve(output, 'results.json');
    process.env.PLAYWRIGHT_BLOB_OUTPUT_DIR = resolve(output, 'blob-report');
    const sample = { mode: mode.name, before: snapshot(), errors: [] };
    manifest.samples.push(sample);
    save();
    if (mode.name !== 'original-shard-2-of-4' && deadline - performance.now() < 4 * 60_000 + 110_000) {
      sample.errors.push('Incomplete focused sample. Preserve four minutes for shard collection and the full 90-second case plus cleanup.');
      sample.after = snapshot();
      save();
      continue;
    }
    try { run([...config, ...mode.args, '--reporter=list,blob,json'], root, deadline - performance.now()); }
    catch (error) {
      sample.errors.push(String(error));
      // A timed-out owned command can leave descendants alive. Keep its lock and stop this sequence.
      if (error.code === 'ETIMEDOUT' || /failed with status null$/.test(error.message) || performance.now() >= deadline) throw error;
    } finally {
      if (existsSync(resolve(root, '.artifacts/playwright')))
        cpSync(resolve(root, '.artifacts/playwright'), resolve(output, 'playwright'), { recursive: true });
      sample.after = snapshot();
      save();
    }
    try {
      const result = JSON.parse(readFileSync(resolve(output, 'results.json'), 'utf8'));
      sample.executed = checkShards(expected, [result], 1);
      if (!titles(result.suites).includes(target)) throw new Error('Target case was absent from the sample');
      if (result.stats.unexpected || result.stats.skipped || result.stats.flaky || result.errors.length)
        throw new Error('Sample report contains failed, skipped, flaky, or infrastructure results');
    } catch (error) { sample.errors.push(String(error)); }
    save();
  }
} catch (error) { manifest.errors.push(String(error)); }
finally {
  const failed = manifest.errors.length > 0 || manifest.samples.length !== 11 || manifest.samples.some(sample => sample.errors.length);
  manifest.failed = failed;
  manifest.completed = snapshot();
  save();
  owner?.finish(failed);
  console.log(`Diagnostic evidence retained at ${directory}`);
  if (failed) process.exitCode = 1;
}
