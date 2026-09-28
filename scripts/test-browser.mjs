import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const consumer = resolve(root, '.artifacts/consumer');

function run(args, cwd = root, timeout = 180_000) {
  const result = spawnSync('pnpm', args, { cwd, stdio: 'inherit', timeout });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed with status ${result.status}`);
}

try {
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
}
