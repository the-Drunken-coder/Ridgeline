import { expect, test } from 'playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/styles/*', route => route.fulfill({ json: {
    version: 8, glyphs: 'https://example.test/fonts/{fontstack}/{range}.pbf', sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9efea' } }],
  } }));
  await page.route('https://example.test/fonts/**', route => route.fulfill({ path: 'tests/fixtures/noto-sans/0-255.pbf' }));
  await page.route('https://tiles.mapterhorn.com/tilejson.json', route => route.fulfill({ json: {
    tilejson: '3.0.0', tiles: ['https://tiles.mapterhorn.com/flat/{z}/{x}/{y}.png'], minzoom: 0, maxzoom: 12, encoding: 'terrarium',
  } }));
  await page.route('https://tiles.mapterhorn.com/flat/**', route => route.fulfill({ path: 'tests/fixtures/flat-terrain.png', contentType: 'image/png' }));
});

test('model example uses shared registrations and independent consumer appearances', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?scenario=models'); await expect(page.locator('#map-status')).toHaveText('Ready');
  await expect(page.getByRole('status', { name: 'Model example status' })).toHaveText('8 models · 0 icons', { timeout: 20000 });
  await expect(page.locator('#feature-count')).toHaveText('8 features');
  const canvas = page.locator('#map canvas').first();
  const png = await canvas.screenshot();
  const body = await page.evaluate(async data => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('No pixel reader');
    context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 0, image.width, image.height).data;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 1]! > pixels[i]! + 35 && pixels[i + 1]! > pixels[i + 2]! + 7 && pixels[i + 1]! > 80)
        return { x: i / 4 % image.width, y: Math.floor(i / 4 / image.width) };
    return null;
  }, png.toString('base64'));
  expect(body, 'A custom model must have visible rendered pixels').not.toBeNull();
  if (!body) throw new Error('No visible model');
  await canvas.hover({ position: body });
  await expect(page.getByRole('tooltip')).toBeVisible();
  await canvas.click({ position: body });
  await expect(page.locator('#selected-name')).not.toHaveText('No feature selected');
  await page.mouse.move(5, 5);
  await testInfo.attach('Models with independent appearances', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByLabel('Model sample', { exact: true }).selectOption('model-drone-color');
  await expect(page.locator('#selected-name')).toHaveText('Drone · custom');
  await page.getByLabel('Model appearance').selectOption('orange');
  await page.getByLabel('Model sample', { exact: true }).selectOption('model-drone-original');
  await expect(page.getByLabel('Model appearance')).toHaveValue('original');
  await page.getByRole('button', { name: 'Unload shared model' }).click();
  await expect(page.getByRole('status', { name: 'Model example status' })).toHaveText('6 models · 2 icons');
  await page.getByRole('button', { name: 'Load shared model', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Model example status' })).toHaveText('8 models · 0 icons');
  await page.getByLabel('Replacement model').selectOption('plane');
  await page.getByRole('button', { name: 'Replace shared model' }).click();
  await expect(page.getByRole('status', { name: 'Model example status' })).toHaveText('8 models · 0 icons');
  await page.getByRole('button', { name: 'Icons at distance' }).click();
  await expect(page.getByRole('status', { name: 'Model example status' })).toHaveText('0 models · 8 icons');
  await page.getByRole('button', { name: 'Models up close' }).click();
  await expect(page.getByRole('status', { name: 'Model example status' })).toHaveText('8 models · 0 icons');
  await page.getByRole('button', { name: 'Remove sample' }).click();
  await expect(page.locator('#feature-count')).toHaveText('7 features');
  await page.getByLabel('Test scenario').selectOption('empty');
  await expect(page.locator('#model-example')).toBeHidden();
  await expect(page.locator('#feature-count')).toHaveText('0 features');
  expect(errors).toEqual([]);
});

test('leaving the model example cancels pending consumer fetches', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let requested = false, release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/entity-models/drone.glb', async route => {
    requested = true;
    await delayed;
    await route.fulfill({ path: 'playground/public/entity-models/drone.glb' });
  });
  await page.goto('/?scenario=models');
  await expect.poll(() => requested).toBe(true);
  await expect(page.getByRole('status', { name: 'Model example status' })).toHaveText('Loading models…');
  await page.getByLabel('Test scenario').selectOption('empty');
  release();
  await expect(page.locator('#model-example')).toBeHidden();
  await expect(page.locator('#feature-count')).toHaveText('0 features');
  await page.getByLabel('Test scenario').selectOption('models');
  await expect(page.getByRole('status', { name: 'Model example status' })).toHaveText('8 models · 0 icons', { timeout: 20000 });
  await expect(page.locator('#feature-count')).toHaveText('8 features');
  expect(errors).toEqual([]);
});
