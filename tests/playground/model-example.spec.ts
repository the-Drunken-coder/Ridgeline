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
  test.setTimeout(240_000);
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
    const teal = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false;
      const i = (y * image.width + x) * 4;
      return pixels[i + 1]! > pixels[i]! + 35 && pixels[i + 1]! > pixels[i + 2]! + 7 && pixels[i + 1]! > 80;
    };
    let best = { x: 0, y: 0, neighbors: 0 };
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      if (!teal(x, y)) continue;
      let neighbors = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (teal(x + dx, y + dy)) neighbors++;
      if (neighbors > best.neighbors) best = { x, y, neighbors };
    }
    return best;
  }, png.toString('base64'));
  // A filled body cluster excludes the thin, similarly colored physical ground lines.
  expect(body.neighbors, 'A custom model must have visible rendered pixels').toBeGreaterThan(30);
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
  await expect(page.getByRole('status', { name: 'Model example status' })).toHaveText('8 models · 0 icons', { timeout: 20000 });
  await page.getByLabel('Replacement model').selectOption('plane');
  await page.getByRole('button', { name: 'Replace shared model' }).click();
  await expect(page.getByRole('status', { name: 'Model example status' })).toHaveText('8 models · 0 icons', { timeout: 20000 });
  await page.getByRole('button', { name: 'Icons at distance' }).click();
  await expect(page.getByRole('status', { name: 'Model example status' })).toHaveText('0 models · 8 icons');
  await page.getByRole('button', { name: 'Models up close' }).click();
  await expect(page.getByRole('status', { name: 'Model example status' })).toHaveText('8 models · 0 icons', { timeout: 20000 });
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
  await expect(page.getByRole('status', { name: 'Model example status' })).toHaveText('8 models · 0 icons', { timeout: 60000 });
  await expect(page.locator('#feature-count')).toHaveText('8 features');
  expect(errors).toEqual([]);
});

test('model example opens from the default terrain scene', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(page.locator('#map-status')).toHaveText('Ready');
  await page.getByLabel('Test scenario').selectOption('models');
  await expect(page.getByRole('status', { name: 'Model example status' })).toHaveText('8 models · 0 icons', { timeout: 60000 });
  await expect(page.locator('#feature-count')).toHaveText('8 features');
  await expect(page.locator('#diagnostics')).toBeHidden();
});

test('a failed reset cannot replace a newer accepted shared model', async ({ page }) => {
  test.setTimeout(240_000);
  let firstDrone = true, firstBoat = true, oldBoatRequested = false, oldBoatDelivered = false, releaseBoat!: () => void;
  const delayedBoat = new Promise<void>(resolve => { releaseBoat = resolve; });
  await page.route('**/entity-models/drone.glb', route => {
    if (firstDrone) { firstDrone = false; return route.fulfill({ status: 500, body: 'Temporary sample fetch failure' }); }
    return route.fulfill({ path: 'playground/public/entity-models/drone.glb' });
  });
  await page.route('**/entity-models/boat.glb', async route => {
    const old = firstBoat; firstBoat = false;
    if (old) { oldBoatRequested = true; await delayedBoat; }
    await route.fulfill({ path: 'playground/public/entity-models/boat.glb' });
    if (old) oldBoatDelivered = true;
  });
  await page.goto('/?scenario=models');
  await expect.poll(() => oldBoatRequested).toBe(true);
  await expect(page.getByRole('status', { name: 'Model example status' })).toHaveText('Could not load Drone (500).');
  await page.getByRole('button', { name: 'Reset samples' }).click();
  await expect(page.getByRole('status', { name: 'Model example status' })).toHaveText('8 models · 0 icons', { timeout: 60000 });
  const canvas = page.locator('#map canvas').first();
  await page.getByLabel('Model sample', { exact: true }).selectOption('model-boat-original');
  await page.getByRole('button', { name: 'Locate', exact: true }).click();
  await expect.poll(blueBoatPixels, { timeout: 60000 }).toBeGreaterThan(10);
  await page.getByLabel('Replacement model').selectOption('tank');
  await page.getByRole('button', { name: 'Replace shared model' }).click();
  await expect(page.getByRole('status', { name: 'Model example status' })).toHaveText('8 models · 0 icons', { timeout: 20000 });
  async function blueBoatPixels() {
    const png = await canvas.screenshot();
    return page.evaluate(async data => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('No pixel reader');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(image.width / 2 - 30, image.height / 2 - 30, 60, 60).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 2]! > pixels[i]! + 30 && pixels[i + 2]! > pixels[i + 1]! + 20) count++;
      return count;
    }, png.toString('base64'));
  }
  await expect.poll(blueBoatPixels, { timeout: 60000 }).toBeLessThan(5);
  releaseBoat();
  await expect.poll(() => oldBoatDelivered).toBe(true);
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    expect(await blueBoatPixels(), 'The late blue boat must not overwrite the accepted tank').toBeLessThan(5);
    await page.waitForTimeout(250);
  }
});
