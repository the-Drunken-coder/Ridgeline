import { test, expect } from 'playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { browserCatalog } from '../browser/catalog';
import type { BrowserCaseMetadata } from '../browser/catalog';

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

function registerCase(name: string, metadata: BrowserCaseMetadata) {
  test(name, async ({ page }, testInfo) => {
    if (metadata.crossOriginIsolated) {
      await page.route('**/*', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(),
          'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp',
        } });
      });
    }
    await page.addInitScript(context => { Reflect.set(window, 'browserEvidenceContext', context); }, { ...source, testCase: name });
    if (metadata.viewport) await page.setViewportSize(metadata.viewport);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    if (metadata.touch) {
      const session = await page.context().newCDPSession(page);
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await page.exposeFunction('browserTouch', async (action: string, points: { id: number; x: number; y: number }[]) => {
        const types = { start: 'touchStart', move: 'touchMove', end: 'touchEnd', cancel: 'touchCancel' } as const;
        if (action !== 'start' && action !== 'move' && action !== 'end' && action !== 'cancel') throw new Error('Invalid touch action');
        if (!Array.isArray(points) || points.some(point => !Number.isInteger(point.id) || !Number.isFinite(point.x) || !Number.isFinite(point.y)))
          throw new Error('Invalid touch coordinates');
        await session.send('Input.dispatchTouchEvent', { type: types[action], touchPoints: points });
      });
    }
    await page.exposeFunction('drawingPointer', async (action: string, x: number, y: number) => {
      if (!['move', 'click'].includes(action) || ![x, y].every(Number.isFinite)) throw new Error('Invalid pointer action');
      await page.locator('#map canvas').first().scrollIntoViewIfNeeded();
      const box = await page.locator('#map canvas').first().boundingBox();
      if (!box) throw new Error('Map canvas is not visible');
      if (action === 'move') await page.mouse.move(box.x + x, box.y + y);
      else await page.mouse.click(box.x + x, box.y + y);
    });
    await page.exposeFunction('browserWheel', (deltaY: number) => page.mouse.wheel(0, deltaY));
    await page.exposeFunction('browserKey', (key: string) => page.keyboard.press(key));
    await page.exposeFunction('browserKeyDown', (key: string) => page.keyboard.down(key));
    await page.exposeFunction('browserKeyUp', (key: string) => page.keyboard.up(key));
    await page.exposeFunction('browserStationaryClick', async () => {
      await page.mouse.down();
      await page.mouse.up();
    });
    await page.exposeFunction('browserClick', (selector: string) => page.locator(selector).click({ timeout: 5_000 }));
    await page.exposeFunction('browserFill', (selector: string, value: string) => page.locator(selector).fill(value, { timeout: 5_000 }));
    await page.exposeFunction('browserCaptureMap', async () => (await page.locator('#map').screenshot({ animations: 'disabled' })).toString('base64'));
    await page.exposeFunction('browserMouse', async (action: string, x: number, y: number) => {
      if (!['down', 'move', 'up', 'click'].includes(action) || ![x, y].every(Number.isFinite)) throw new Error('Invalid mouse action');
      await page.mouse.move(x, y);
      if (action === 'down') await page.mouse.down();
      else if (action === 'up') await page.mouse.up();
      else if (action === 'click') await page.mouse.click(x, y);
    });
    await page.exposeFunction('browserReleaseMouseElsewhere', async () => {
      const other = await page.context().newPage();
      try { await other.goto('about:blank'); await other.mouse.up(); }
      finally { await other.close(); await page.bringToFront(); }
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
        const observation = await page.evaluate(() => window.drawingDirectionObservation).catch(() => undefined);
        if (observation) {
          const capture = testInfo.outputPath('drawing-direction.png'), details = testInfo.outputPath('drawing-direction.json');
          await writeFile(capture, Buffer.from(observation.image, 'base64'));
          await writeFile(details, JSON.stringify({ wings: observation.wings, handle: observation.handle }));
          await testInfo.attach('Composed drawing direction', { path: capture, contentType: 'image/png' });
          await testInfo.attach('Drawing direction observation', { path: details, contentType: 'application/json' });
        }
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

for (const [name, metadata] of Object.entries<BrowserCaseMetadata>(browserCatalog)) {
  const observation = metadata.pixelObservation;
  if (observation) {
    test.describe(observation.describe, () => {
      test.use({ deviceScaleFactor: observation.deviceScaleFactor });
      test.describe.configure({ timeout: observation.timeout });
      registerCase(name, metadata);
    });
  } else registerCase(name, metadata);
}
