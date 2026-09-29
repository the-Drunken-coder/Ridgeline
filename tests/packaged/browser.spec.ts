import { test, expect } from 'playwright/test';

import { browserCases } from '../browser-cases';

for (const name of browserCases) {
  test(name, async ({ page }, testInfo) => {
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
    await page.exposeFunction('browserDrag', async (fromX: number, fromY: number, toX: number, toY: number) => {
      await page.mouse.move(fromX, fromY);
      await page.mouse.down();
      await page.mouse.move(toX, toY, { steps: 6 });
      await page.mouse.up();
    });
    let failure: unknown;
    try {
      await page.goto('/?case=' + encodeURIComponent(name));
      await page.waitForFunction(() => ['passed', 'failed'].includes(document.querySelector<HTMLElement>('#status')?.dataset.state ?? ''));
      const status = await page.locator('#status').evaluate(element => ({ state: (element as HTMLElement).dataset.state, text: element.textContent }));
      expect(status.state, status.text).toBe('passed');
      expect(errors, 'Uncaught browser errors').toEqual([]);
    } catch (error) {
      failure = error;
      if (!page.isClosed()) {
        const path = testInfo.outputPath('failure.png');
        await page.screenshot({ path }).then(() => testInfo.attach('failure screenshot', { path, contentType: 'image/png' })).catch(() => {});
      }
    } finally {
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
