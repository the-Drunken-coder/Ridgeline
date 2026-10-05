import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The observed setup sizes and retention limits are recorded in docs/ci-validation.md.
const defaultMinimumBytes = 2_147_483_648n;
const retainedRuns = 3;
const outputs = {
  packaged: ['.artifacts/playwright'],
  playground: ['.artifacts/playground-tests'],
  controls: ['control-lab/test-results'],
  measurement: ['.artifacts/model-measurement/verification.json'],
};
const destinations = {
  packaged: ['.artifacts/consumer', 'dist'],
  playground: ['.artifacts', 'playground-dist', 'dist'],
  controls: ['.artifacts', 'control-lab/dist'],
  measurement: ['.artifacts/model-measurement/consumer', '.artifacts/model-measurement/assets', 'dist'],
};

function statIfPresent(path) {
  try { return lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function hasSymlink(path) {
  if (lstatSync(path).isSymbolicLink()) return true;
  return lstatSync(path).isDirectory() && readdirSync(path).some(name => hasSymlink(resolve(path, name)));
}

function isIgnoredAndUntracked(root, path) {
  const pathspec = relative(root, path);
  const tracked = spawnSync('git', ['ls-files', '-z', '--', pathspec], { cwd: root, encoding: 'utf8' });
  // A missing directory still matches directory-only ignore rules. Omitting the
  // slash would reject a fresh control-lab checkout before its first run.
  const ignoredPath = statIfPresent(path)?.isFile() ? pathspec : `${pathspec}/`;
  const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', ignoredPath], { cwd: root });
  return tracked.status === 0 && tracked.stdout === '' && ignored.status === 0;
}

function completedRunTime(record, command) {
  if (record?.owner !== 'ridgeline-browser' || record.version !== 1 || record.command !== command ||
      !['complete', 'failed'].includes(record.status) || !Number.isSafeInteger(record.pid) || record.pid <= 0 ||
      !Array.isArray(record.invocation) || !record.invocation.length ||
      !record.invocation.every(argument => typeof argument === 'string') || !record.invocation[0].length ||
      typeof record.startedAt !== 'string' || typeof record.completedAt !== 'string') return;
  const started = Date.parse(record.startedAt), completed = Date.parse(record.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started ||
      new Date(started).toISOString() !== record.startedAt || new Date(completed).toISOString() !== record.completedAt) return;
  return completed;
}

function pruneRuns(root, pool, command) {
  const eligible = [];
  for (const name of readdirSync(pool)) {
    const path = resolve(pool, name);
    if (!name.startsWith(`${command === 'measurement' ? 'run' : command}-`) ||
        hasSymlink(path) || existsSync(resolve(path, '.pin')) || !isIgnoredAndUntracked(root, path)) continue;
    let record;
    try { record = JSON.parse(readFileSync(resolve(path, '.browser-run.json'), 'utf8')); } catch { continue; }
    // Running, interrupted, unknown, and malformed records never become eligible
    // merely because their original parent PID no longer exists.
    const completedAt = completedRunTime(record, command);
    if (completedAt === undefined) continue;
    eligible.push({ path, completedAt });
  }
  eligible.sort((a, b) => b.completedAt - a.completedAt);
  for (const { path } of eligible.slice(retainedRuns)) {
    rmSync(path, { recursive: true });
    console.log(`Removed generated browser output: ${path}`);
  }
}

// Generated output may be absent, so inspect its nearest existing parent. Refuse
// symlinked destinations rather than testing one disk and writing to another.
export function checkBrowserCapacity(root, command, targets) {
  const override = process.env.RIDGELINE_BROWSER_MIN_FREE_BYTES;
  if (override !== undefined && !/^\d+$/.test(override)) {
    throw new Error(`${command}: RIDGELINE_BROWSER_MIN_FREE_BYTES must be a nonnegative integer byte count.`);
  }
  const required = override === undefined ? defaultMinimumBytes : BigInt(override);
  for (const destination of targets) {
    const path = resolve(root, destination);
    const withinRoot = relative(root, path);
    if (withinRoot === '..' || withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot)) {
      throw new Error(`${command}: generated output must remain inside the checkout: ${path}`);
    }
    let current = root;
    for (const part of withinRoot.split(sep)) {
      current = resolve(current, part);
      if (statIfPresent(current)?.isSymbolicLink()) {
        throw new Error(`${command}: generated output must not follow a symlink: ${current}`);
      }
    }
    let filesystem = path;
    while (!existsSync(filesystem)) filesystem = dirname(filesystem);
    let available;
    try {
      const capacity = statfsSync(filesystem, { bigint: true });
      if (capacity.bsize <= 0n || capacity.bavail < 0n) throw new Error('invalid filesystem capacity');
      available = capacity.bavail * capacity.bsize;
      if (available < 0n) throw new Error('negative available capacity');
    } catch (error) {
      throw new Error(`${command}: disk preflight for ${path}: available=unreadable bytes, required=${required} bytes. Restore filesystem access and retry. Free space or explicitly set RIDGELINE_BROWSER_MIN_FREE_BYTES for this run.`, { cause: error });
    }
    if (available < required) {
      throw new Error(`${command}: disk preflight for ${path}: available=${available} bytes, required=${required} bytes. Free space and retry, or explicitly set RIDGELINE_BROWSER_MIN_FREE_BYTES for this run.`);
    }
  }
}

export function claimBrowserRun(root, command) {
  if (!Object.hasOwn(outputs, command)) throw new Error(`Unknown browser command: ${command}`);
  const pool = resolve(root, command === 'measurement' ? '.artifacts/model-measurement' : '.artifacts/browser-runs');
  checkBrowserCapacity(root, `${command} browser validation`, [...destinations[command], ...outputs[command], relative(root, pool)]);
  for (const output of outputs[command]) {
    const path = resolve(root, output);
    if (!isIgnoredAndUntracked(root, path) || existsSync(resolve(path, '.pin'))) {
      throw new Error(`Refusing to replace protected browser output: ${path}`);
    }
  }
  const lock = resolve(root, '.artifacts/browser-run.lock');
  mkdirSync(dirname(lock), { recursive: true });
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(`Browser validation is already locked in this checkout: ${lock}. Wait for the active run to finish. If it was interrupted, stop its remaining processes before removing this directory.`);
  }
  let directory;
  const record = { version: 1, owner: 'ridgeline-browser', command, invocation: [process.execPath, ...process.argv.slice(1)],
    pid: process.pid, startedAt: new Date().toISOString(), status: 'running' };
  try {
    writeFileSync(resolve(lock, 'owner'), `PID: ${process.pid}\n${command}\n`);
    mkdirSync(pool, { recursive: true });
    pruneRuns(root, pool, command);
    directory = resolve(pool, `${command === 'measurement' ? 'run' : command}-${record.startedAt.replaceAll(':', '-')}-${randomUUID()}`);
    mkdirSync(directory);
    writeFileSync(resolve(directory, '.browser-run.json'), JSON.stringify(record, null, 2));
  } catch (error) {
    rmSync(lock, { recursive: true, force: true });
    throw error;
  }
  let interrupted = false;
  let captureOutputs = false;
  let finished = false;
  return {
    directory,
    capture() { captureOutputs = true; },
    interrupt() { interrupted = true; },
    replaceConsumer() {
      const consumer = resolve(root, command === 'packaged' ? '.artifacts/consumer' : '.artifacts/model-measurement/consumer');
      if (!['packaged', 'measurement'].includes(command)) throw new Error(`${command} has no generated consumer.`);
      if (statIfPresent(consumer)?.isSymbolicLink() || existsSync(resolve(consumer, '.pin')) || !isIgnoredAndUntracked(root, consumer)) {
        throw new Error(`Refusing to replace protected consumer output: ${consumer}`);
      }
      // rm removes links inside the disposable consumer without following them.
      // Its pnpm dependencies use links, so preserving their targets is required.
      rmSync(consumer, { recursive: true, force: true });
    },
    run(executable, args, cwd = root, timeout = 180_000) {
      if (args.includes('playwright')) captureOutputs = true;
      const result = spawnSync(executable, args, { cwd, stdio: 'inherit', timeout,
        env: { ...process.env, RIDGELINE_BROWSER_COMMAND: JSON.stringify(record.invocation) } });
      if (result.error?.code === 'ETIMEDOUT' || result.signal) interrupted = true;
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`${executable} ${args.join(' ')} failed with status ${result.status}`);
    },
    finish(failed = false) {
      // A later run may already own the shared lock after this owner finishes.
      if (finished) return;
      if (interrupted) {
        writeFileSync(resolve(directory, '.browser-run.json'), JSON.stringify({ ...record, status: 'interrupted' }, null, 2));
        console.error(`Browser lock retained at ${lock}. Stop remaining child processes before removing this directory.`);
        return;
      }
      let finalized = false;
      try {
        if (failed) writeFileSync(resolve(directory, '.pin'), 'Failed run. Preserve until explicitly released after evidence curation.\n');
        if (captureOutputs) {
          for (const output of outputs[command]) {
            const source = resolve(root, output);
            if (!statIfPresent(source)) continue;
            if (hasSymlink(source) || !isIgnoredAndUntracked(root, source))
              throw new Error(`Refusing to retain protected browser output: ${source}`);
            cpSync(source, resolve(directory, basename(output)), { recursive: true });
          }
        }
        writeFileSync(resolve(directory, '.browser-run.json'), JSON.stringify({ ...record, status: failed ? 'failed' : 'complete', completedAt: new Date().toISOString() }, null, 2));
        pruneRuns(root, pool, command);
        finalized = true;
      } finally {
        if (finalized) {
          rmSync(lock, { recursive: true, force: true });
          finished = true;
        } else console.error(`Browser lock retained at ${lock}: output retention did not complete. Preserve the latest output before clearing this directory.`);
      }
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, mode, ...extra] = process.argv.slice(2);
    if (!Object.hasOwn(destinations, command) || mode !== '--preflight' || extra.length) {
      throw new Error('Usage: node scripts/browser-resources.mjs packaged|playground|controls|measurement --preflight');
    }
    const root = resolve(import.meta.dirname, '..');
    checkBrowserCapacity(root, `${command} browser validation`, [...destinations[command], ...outputs[command]]);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
