import { expect, test } from 'playwright/test';

test('motion controls reset and pending measurements retire when switching scenarios', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tiles.openfreemap.org/styles/*', route => route.fulfill({
    json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9efea' } }] },
  }));
  await page.route('https://tiles.mapterhorn.com/tilejson.json', route => route.fulfill({
    json: { tilejson: '3.0.0', tiles: ['https://tiles.mapterhorn.com/flat/{z}/{x}/{y}.png'], minzoom: 0, maxzoom: 12, encoding: 'terrarium' },
  }));
  await page.route('https://tiles.mapterhorn.com/flat/**', route => route.fulfill({
    path: 'tests/fixtures/flat-terrain.png', contentType: 'image/png',
  }));
  await page.goto('/?scenario=moving');
  await expect(page.locator('#map-status')).toHaveText('Ready');
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  const measure = page.getByRole('button', { name: 'Measure 10s', exact: true });
  const output = page.locator('#measurement');

  async function expectEmptyFor(duration: number) {
    const end = Date.now() + duration;
    do {
      await expect(page.locator('#feature-count')).toHaveText('0 features');
      await expect(page.locator('#selected-name')).toHaveText('No feature selected');
      await expect(output).toHaveText('No measurement yet');
      await page.waitForTimeout(100);
    } while (Date.now() < end);
  }

  for (const [scenario, count] of [['moving', '1,002 features'], ['airborne', '1,000 features'], ['airborne-single', '1 feature']] as const) {
    await page.getByLabel('Test scenario').selectOption(scenario);
    await expect(page.locator('#feature-count')).toHaveText(count);
    await expect(page.locator('#motion')).toBeVisible();
    await expect(output).toHaveText('No measurement yet');
    if (scenario !== 'moving') {
      await expect(page.locator('#selected-name')).toHaveText('Kestrel 01');
      await expect(page.locator('#airborne-demo')).toBeVisible();
    }
    await pause.click();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await pause.click();
    await measure.click();
    await expect(pause).toBeVisible();
    await expect(measure).toBeDisabled();
    await expect(output).toHaveText('Measuring for 10 seconds…');
    await page.getByLabel('Test scenario').selectOption('empty');
    await expect(page.locator('#motion')).toBeHidden();
    await expect(page.locator('#airborne-demo')).toBeHidden();
    await expect(page.locator('#measure')).toBeEnabled();
    await expectEmptyFor(500);
  }
  await expectEmptyFor(10_250);
  await page.getByLabel('Test scenario').selectOption('moving');
  await expect(pause).toBeVisible();
  await expect(measure).toBeEnabled();
  await expect(output).toHaveText('No measurement yet');
  await page.goto('about:blank');
  expect(errors).toEqual([]);
});
