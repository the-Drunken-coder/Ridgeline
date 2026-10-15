import { resolve } from 'node:path';
import { claimBrowserRun } from './browser-resources.mjs';
import { validateConsumer } from './validate-consumer.mjs';

const root = resolve(import.meta.dirname, '..');
let owner;
const run = (args, cwd = root, timeout = 180_000) => owner.run('pnpm', args, cwd, timeout);

try {
  owner = claimBrowserRun(root, 'packaged');
  run(['build']);
  run(['pack', '--pack-destination', '.artifacts']);
  owner.replaceConsumer();
  run(['exec', 'node', 'scripts/prepare-consumer.mjs']);
  validateConsumer(root, run);
  const forwarded = process.argv.slice(2);
  if (forwarded[0] === '--') forwarded.shift();
  const support = forwarded.includes('--support');
  if (support) forwarded.splice(forwarded.indexOf('--support'), 1);
  if (forwarded[0] === '--') forwarded.shift();
  const command = ['exec', 'playwright', 'test', '--config', support ? 'playwright.support.config.mjs' : 'playwright.packaged.config.mjs', ...forwarded];
  // Linux Firefox needs a display for WebGL. Keep the owned process tree under the same run lock.
  if (support && process.platform === 'linux' && !process.env.DISPLAY)
    owner.run('xvfb-run', ['-a', 'pnpm', ...command], root, 1_800_000);
  else run(command, root, 1_800_000);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  owner?.finish(process.exitCode === 1);
}
