import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const consumer = resolve(root, '.artifacts/consumer');
const lock = resolve(root, '.artifacts/browser-run.lock');
let ownsLock = false;
let retainLock = false;

function run(args, cwd = root, timeout = 180_000) {
  const result = spawnSync('pnpm', args, { cwd, stdio: 'inherit', timeout });
  // Timeout and signal termination do not establish that pnpm's descendants
  // stopped writing. Preserve ownership for manual recovery in either case.
  if (result.error?.code === 'ETIMEDOUT' || result.signal) retainLock = true;
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed with status ${result.status}`);
}

try {
  mkdirSync(resolve(root, '.artifacts'), { recursive: true });
  try {
    // Claim the entire checkout before building or replacing shared artifacts.
    mkdirSync(lock);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(`Packaged browser validation is already locked in this checkout: ${lock}. Wait for the active run to finish. If it was interrupted, stop its remaining processes before removing this directory.`);
  }
  ownsLock = true;
  writeFileSync(resolve(lock, 'owner'), `PID: ${process.pid}\n`);
  run(['build']);
  run(['pack', '--pack-destination', '.artifacts']);
  await rm(consumer, { recursive: true, force: true });
  run(['exec', 'node', 'scripts/prepare-consumer.mjs']);
  run(['install', '--prefer-offline'], consumer);
  run(['build'], consumer);
  const forwarded = process.argv.slice(2);
  if (forwarded[0] === '--') forwarded.shift();
  run(['exec', 'playwright', 'test', '--config', 'playwright.packaged.config.mjs', ...forwarded], root, 1_800_000);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  // An interrupted process leaves the lock for manual recovery: child commands
  // may still be writing artifacts, so a dead parent PID is not enough to steal it.
  if (ownsLock && !retainLock) rmSync(lock, { recursive: true, force: true });
  if (ownsLock && retainLock) console.error(`Browser lock retained at ${lock}. Stop remaining child processes before removing this directory.`);
}
