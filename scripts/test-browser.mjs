import { resolve } from 'node:path';
import { claimBrowserRun } from './browser-resources.mjs';

const root = resolve(import.meta.dirname, '..');
const consumer = resolve(root, '.artifacts/consumer');
let owner;
const run = (args, cwd = root, timeout = 180_000) => owner.run('pnpm', args, cwd, timeout);

try {
  owner = claimBrowserRun(root, 'packaged');
  run(['build']);
  run(['pack', '--pack-destination', '.artifacts']);
  owner.replaceConsumer();
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
  owner?.finish(process.exitCode === 1);
}
