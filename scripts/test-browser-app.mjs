import { resolve } from 'node:path';
import { claimBrowserRun } from './browser-resources.mjs';

const root = resolve(import.meta.dirname, '..');
const app = process.argv[2];
let owner;
try {
  if (app !== 'playground' && app !== 'controls') throw new Error('Choose playground or controls.');
  owner = claimBrowserRun(root, app);
  const forwarded = process.argv.slice(3);
  if (forwarded[0] === '--') forwarded.shift();
  owner.run('pnpm', ['exec', 'playwright', 'test', '-c', app === 'playground' ? 'playwright.playground.config.mjs' : 'control-lab/playwright.config.ts', ...forwarded], root, 1_800_000);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  owner?.finish(process.exitCode === 1);
}
