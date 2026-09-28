import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const root = resolve(import.meta.dirname, '..');
const consumer = resolve(root, '.artifacts/consumer');
function run(args, cwd = root) {
  const result = spawnSync('pnpm', args, { cwd, stdio: 'inherit', timeout: 180_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed with status ${result.status}`);
}

let browser;
let server;
try {
  run(['build']);
  run(['pack', '--pack-destination', '.artifacts']);
  // Reinstall the freshly packed artifact, even when the package version is unchanged.
  await rm(consumer, { recursive: true, force: true });
  run(['exec', 'node', 'scripts/prepare-consumer.mjs']);
  run(['install', '--prefer-offline'], consumer);
  run(['build'], consumer);
  server = await preview({ configFile: false, root: consumer, preview: { host: '127.0.0.1', port: 0 } });
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.exposeFunction('drawingPointer', async (action, x, y) => {
    if (action !== 'move' && action !== 'click') throw new Error(`Unknown pointer action: ${action}`);
    if (![x, y].every(value => typeof value === 'number' && Number.isFinite(value))) throw new Error('Pointer coordinates must be finite numbers.');
    await page.locator('#map').scrollIntoViewIfNeeded();
    const box = await page.locator('#map canvas').first().boundingBox();
    if (!box) throw new Error('Map canvas is not visible.');
    const position = { x: box.x + x, y: box.y + y };
    if (action === 'move') await page.mouse.move(position.x, position.y);
    else await page.mouse.click(position.x, position.y);
  });
  await page.exposeFunction('browserKey', async key => { await page.keyboard.press(key); });
  await page.exposeFunction('browserClick', async (x, y) => { await page.mouse.click(x, y); });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]);
  try {
    await page.waitForFunction(() => ['passed', 'failed'].includes(document.querySelector('#status')?.dataset.state), undefined, { timeout: 60_000 });
  } catch (error) { errors.push(String(error)); }
  const result = await page.evaluate(() => ({
    state: document.querySelector('#status').dataset.state,
    summary: document.querySelector('#status').textContent,
    checks: [...document.querySelectorAll('#results li')].map(row => row.textContent),
  }));
  for (const check of result.checks) console.log(check);
  console.log(result.summary);
  if (result.state !== 'passed' || errors.length) throw new Error(errors.join('\n') || result.summary);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
