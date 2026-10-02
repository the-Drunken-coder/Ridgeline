import { expect, test } from 'playwright/test';

test('applied drawing selection updates the production sidebar and actions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Replace network map resources, keeping the production application and viewport intact.
  await page.route('https://tiles.openfreemap.org/styles/*', route => route.fulfill({
    json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9efea' } }] },
  }));
  await page.route('https://tiles.mapterhorn.com/tilejson.json', route => route.fulfill({
    json: { tilejson: '3.0.0', tiles: ['https://tiles.mapterhorn.com/flat/{z}/{x}/{y}.png'], minzoom: 0, maxzoom: 12, encoding: 'terrarium' },
  }));
  await page.route('https://tiles.mapterhorn.com/flat/**', route => route.fulfill({
    path: 'tests/fixtures/flat-terrain.png', contentType: 'image/png',
  }));
  await page.goto('/?scenario=drawing');
  await expect(page.locator('#map-status')).toHaveText('Ready');
  const selected = page.locator('#selected-name');
  const locate = page.locator('#locate');
  const clear = page.locator('#clear-selection');
  await expect(selected).toHaveText('Survey area');
  await expect(locate).toBeEnabled();
  await expect(clear).toBeEnabled();
  await expect(page.locator('#drawing-inspector')).toContainText('Survey area');

  await page.locator('#map-settings summary').click();
  await page.getByLabel('Terrain', { exact: true }).uncheck();
  await page.getByLabel('Hillshade', { exact: true }).uncheck();
  await page.locator('#map-settings summary').click();

  await page.getByRole('button', { name: 'Line', exact: true }).click();
  const canvas = page.locator('#map canvas').first();
  await canvas.click({ position: { x: 200, y: 250 } });
  await canvas.click({ position: { x: 400, y: 350 } });
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(selected).toHaveText('Drawing');
  await expect(page.locator('#selected-id')).not.toHaveText('drawing-0');
  await expect(locate).toBeEnabled();
  await expect(clear).toBeEnabled();
  await canvas.click({ position: { x: 30, y: 30 } });
  await expect(selected).toHaveText('No feature selected');
  await expect(locate).toBeDisabled();
  await expect(clear).toBeDisabled();

  for (let repeat = 0; repeat < 2; repeat++) {
    await page.getByLabel('Test scenario').selectOption('empty');
    await expect(selected).toHaveText('No feature selected');
    await expect(locate).toBeDisabled();
    await expect(clear).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toHaveCount(0);
    await page.getByLabel('Test scenario').selectOption('drawing');
    await expect(selected).toHaveText('Survey area');
    await expect(locate).toBeEnabled();
    await expect(clear).toBeEnabled();
  }
  await page.goto('about:blank');
  expect(errors).toEqual([]);
});
