import { test, expect } from 'playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { browserCases } from '../browser-cases';

function git(...args: string[]) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
  return result.stdout;
}
function command() {
  if (!process.env.RIDGELINE_BROWSER_COMMAND) return [process.execPath, ...process.argv.slice(1)];
  const value: unknown = JSON.parse(process.env.RIDGELINE_BROWSER_COMMAND);
  if (!Array.isArray(value) || !value.every((item: unknown) => typeof item === 'string'))
    throw new Error('Invalid browser command evidence');
  return value;
}
const source = { revision: git('rev-parse', 'HEAD').trim(), status: git('status', '--short'),
  diffSha256: createHash('sha256').update(git('diff', 'HEAD')).digest('hex'), command: command() };

function registerCase(name: string) {
  test(name, async ({ page }, testInfo) => {
    await page.addInitScript(context => { Reflect.set(window, 'browserEvidenceContext', context); }, { ...source, testCase: name });
    if (name === 'Reliability drawing restores rejected handle edits on a third visible world copy' ||
      name === 'Reliability drawing preserves rejected handle edits after camera turns and reversal')
      await page.setViewportSize({ width: 2000, height: 720 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('drawingPointer', async (action: string, x: number, y: number) => {
      if (!['move', 'click'].includes(action) || ![x, y].every(Number.isFinite)) throw new Error('Invalid pointer action');
      await page.locator('#map canvas').first().scrollIntoViewIfNeeded();
      const box = await page.locator('#map canvas').first().boundingBox();
      if (!box) throw new Error('Map canvas is not visible');
      if (action === 'move') await page.mouse.move(box.x + x, box.y + y);
      else await page.mouse.click(box.x + x, box.y + y);
    });
    await page.exposeFunction('browserKey', (key: string) => page.keyboard.press(key));
    await page.exposeFunction('browserKeyDown', (key: string) => page.keyboard.down(key));
    await page.exposeFunction('browserKeyUp', (key: string) => page.keyboard.up(key));
    await page.exposeFunction('browserStationaryClick', async () => {
      await page.mouse.down();
      await page.mouse.up();
    });
    await page.exposeFunction('browserClick', (selector: string) => page.locator(selector).click({ timeout: 5_000 }));
    await page.exposeFunction('browserFill', (selector: string, value: string) => page.locator(selector).fill(value, { timeout: 5_000 }));
    await page.exposeFunction('browserMouse', async (action: string, x: number, y: number) => {
      if (!['down', 'move', 'up', 'click'].includes(action) || ![x, y].every(Number.isFinite)) throw new Error('Invalid mouse action');
      await page.mouse.move(x, y);
      if (action === 'down') await page.mouse.down();
      else if (action === 'up') await page.mouse.up();
      else if (action === 'click') await page.mouse.click(x, y);
    });
    await page.exposeFunction('browserDrag', async (fromX: number, fromY: number, toX: number, toY: number, button: 'left' | 'right' = 'left') => {
      await page.mouse.move(fromX, fromY);
      await page.mouse.down({ button });
      await page.mouse.move(toX, toY, { steps: 6 });
      await page.mouse.up({ button });
    });
    let failure: unknown;
    try {
      await page.goto('/?case=' + encodeURIComponent(name));
      await page.waitForFunction(() => ['passed', 'failed'].includes(document.querySelector<HTMLElement>('#status')?.dataset.state ?? ''));
      const status = await page.locator('#status').evaluate(element => ({ state: (element as HTMLElement).dataset.state, text: element.textContent }));
      expect(status.state, status.text).toBe('passed');
      expect(errors, 'Uncaught browser errors').toEqual([]);
      if (['chromium', 'firefox', 'webkit'].includes(testInfo.project.name)) {
        const environment = await page.evaluate(() => {
          const captured: unknown = Reflect.get(window, 'browserEnvironment');
          return captured ?? { userAgent: navigator.userAgent, platform: navigator.platform,
            touchPoints: navigator.maxTouchPoints, devicePixelRatio, renderer: null, vendor: null };
        });
        await testInfo.attach('Browser environment', { body: JSON.stringify({ ...environment, browserVersion: page.context().browser()?.version(), ...source }, null, 2), contentType: 'application/json' });
      }
    } catch (error) {
      failure = error;
      if (!page.isClosed()) {
        const path = testInfo.outputPath('failure.png');
        await page.screenshot({ path }).then(() => testInfo.attach('failure screenshot', { path, contentType: 'image/png' })).catch(() => {});
      }
    } finally {
      try {
        const evidence = await page.evaluate(() => {
          const value: unknown = Reflect.get(window, 'browserIdleObservations');
          return Array.isArray(value) && value.length ? value : null;
        });
        if (evidence) {
          const path = testInfo.outputPath('idle-observations.json');
          await writeFile(path, JSON.stringify(evidence, null, 2));
          await testInfo.attach('Browser idle observations', { path, contentType: 'application/json' });
        }
      } catch (error) {
        failure = failure ? new AggregateError([failure, error], 'Browser case and evidence capture failed') : error;
      }
      try {
        await page.evaluate(() => {
          if (!window.cleanupBrowserCase) throw new Error('Browser case cleanup hook is unavailable.');
          window.cleanupBrowserCase();
        });
      } catch (error) {
        failure = failure ? new AggregateError([failure, error], 'Browser case and cleanup failed') : error;
      }
    }
    if (failure) throw failure;
  });
}

for (const name of browserCases) {
  if (name === 'Model pixel observation aligns visible picking across canvas ratios and rejects absent models') {
    test.describe('Model observation at browser DPR 2', () => {
      test.use({ deviceScaleFactor: 2 });
      test.describe.configure({ timeout: 90_000 });
      registerCase(name);
    });
  } else registerCase(name);
}
