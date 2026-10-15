import { starterCases } from '../support-cases.ts';
import { expect, test } from 'playwright/test';

test(starterCases.save, async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/starter/index.html?offline');
  await expect(page.locator('#status')).toHaveText('Ready');
  await expect(page.getByLabel('Map center coordinates')).toContainText('E');
  await page.getByRole('combobox', { name: 'Example', exact: true }).selectOption('drawing');
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  const canvas = page.locator('#map canvas').first();
  await canvas.click({ position: { x: 120, y: 150 } });
  await canvas.click({ position: { x: 340, y: 220 } });
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('#selection')).toHaveText('Drawing');
  await expect(page.getByRole('button', { name: 'Edit drawing', exact: true })).toBeEnabled();

  const edit = page.getByRole('button', { name: 'Edit drawing', exact: true });
  await edit.focus(); await page.keyboard.press('Enter');
  const distance = page.getByLabel('Distance (m)', { exact: true });
  const bearing = page.getByLabel('Bearing (°)', { exact: true });
  await distance.fill('500'); await page.keyboard.press('Tab');
  await expect(bearing).toBeFocused();
  await bearing.fill('90'); await page.keyboard.press('Tab');
  const finish = page.getByRole('button', { name: 'Finish', exact: true });
  await finish.focus(); await page.keyboard.press('Enter');
  await expect(edit).toBeEnabled();
  await edit.click();
  await expect(distance).toHaveValue('500');
  await expect(bearing).toHaveValue('90');
  await testInfo.attach('Drawing starter', { body: await page.screenshot(), contentType: 'image/png' });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await distance.fill('250'); await page.keyboard.press('Tab');
  await expect(bearing).toBeFocused();
  await expect(distance).toHaveValue('250');
  await testInfo.attach('Narrow drawing starter', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByRole('combobox', { name: 'Example', exact: true }).selectOption('selection');
  await expect(page.locator('.rl-drawing-inspector')).toHaveCount(0);
  await expect(page.locator('.rl-drawing-tools')).toHaveCount(0);
  await expect(page.locator('#selection')).toHaveText('No feature selected');
  await expect(page.locator('#help')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('about:blank');
  expect(errors).toEqual([]);
});


test(starterCases.restore, async ({ page }) => {
  await page.goto('/starter/index.html?offline');
  await expect(page.locator('#status')).toHaveText('Ready');
  await page.getByRole('combobox', { name: 'Example', exact: true }).selectOption('drawing');
  await expect(page.locator('#storage-status')).toHaveText('No saved drawings.');
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  const canvas = page.locator('#map canvas').first();
  await canvas.click({ position: { x: 120, y: 150 } });
  await canvas.click({ position: { x: 340, y: 220 } });
  await page.getByLabel('Reject next save', { exact: true }).check();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('#storage-status')).toContainText('Save rejected');
  await expect(page.locator('#selection')).toHaveText('No feature selected');
  expect(await page.evaluate(() => localStorage.getItem('ridgeline-starter-drawings-v1'))).toBeNull();
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('#storage-status')).toHaveText('Saved 1 drawing(s).');
  await page.getByRole('button', { name: 'Edit drawing', exact: true }).click();
  await page.getByLabel('Distance (m)', { exact: true }).fill('500');
  await page.keyboard.press('Tab');
  await page.getByLabel('Bearing (°)', { exact: true }).fill('90');
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit drawing', exact: true })).toBeEnabled();
  const saved = await page.evaluate(() => localStorage.getItem('ridgeline-starter-drawings-v1'));
  if (saved === null) throw new Error('Drawing was not stored.');
  expect(JSON.parse(saved)).toMatchObject([{ drawing: { version: 1, shape: { kind: 'line' } } }]);
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let workerRequests = 0;
  const workerPattern = '**/maplibre-gl-worker*.js';
  await page.context().route(workerPattern, async route => {
    workerRequests++;
    await gate;
    await route.continue();
  });
  const restoredStartVisible = async () => {
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error('Restored drawing canvas is missing.');
    const clip = {
      x: Math.floor(bounds.x), y: Math.floor(bounds.y),
      width: Math.ceil(bounds.x + bounds.width) - Math.floor(bounds.x),
      height: Math.ceil(bounds.y + bounds.height) - Math.floor(bounds.y),
    };
    // Observe the held canvas without element stability or font barriers.
    // WebKit's fonts.ready can wait behind the deliberately held worker load.
    // This pinned Playwright switch affects only this geometry snapshot.
    const previousFontWait = process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
    process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
    let pixels: Buffer;
    try {
      pixels = await page.screenshot({ clip, scale: 'css', timeout: 10_000 });
    } finally {
      if (previousFontWait === undefined) delete process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
      else process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = previousFontWait;
    }
    return page.evaluate(async ({ encoded, width, height, startX, startY }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      if (image.width !== width || image.height !== height)
        throw new Error('Restored drawing screenshot must use the canvas CSS pixel space.');
      const surface = document.createElement('canvas');
      surface.width = image.width; surface.height = image.height;
      const context = surface.getContext('2d');
      if (!context) throw new Error('Restored drawing pixel observation requires Canvas2D.');
      context.drawImage(image, 0, 0);
      // The offline starter draws one dark green line on a pale background.
      // Segment edits move its end; its saved start remains at the first click.
      const sample = context.getImageData(Math.round(startX) - 2, Math.round(startY) - 2, 5, 5).data;
      for (let i = 0; i < sample.length; i += 4) {
        if (sample[i]! < 128 && sample[i + 1]! >= 64 && sample[i + 1]! < 160 && sample[i + 2]! < 128)
          return true;
      }
      return false;
    }, {
      encoded: pixels.toString('base64'), width: clip.width, height: clip.height,
      startX: bounds.x - clip.x + 120, startY: bounds.y - clip.y + 150,
    });
  };
  try {
    // WebKit includes held worker imports in the load event. DOM readiness
    // lets the test reach restoration while that real response is still held.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#status')).toHaveText('Ready');
    await page.getByRole('combobox', { name: 'Example', exact: true }).selectOption('drawing');
    await expect(page.locator('#storage-status')).toHaveText('Restored 1 drawing(s).');
    expect(await page.evaluate(() => localStorage.getItem('ridgeline-starter-drawings-v1'))).toBe(saved);
    expect(workerRequests, 'Native renderer worker was not held').toBeGreaterThan(0);
    expect(await restoredStartVisible(), 'Held native workers must leave the restored start unpublished').toBe(false);
    await canvas.click({ position: { x: 120, y: 150 } });
    await expect(page.locator('#selection')).toHaveText('No feature selected');
    release();
    // Store restoration precedes native publication. Wait for visible geometry,
    // then perform one successful click rather than retrying an early miss.
    await expect.poll(restoredStartVisible, {
      timeout: 20_000, message: 'Restored drawing start must be visibly published before selection',
    }).toBe(true);
    await canvas.click({ position: { x: 120, y: 150 } });
    await expect(page.locator('#selection')).toHaveText('Drawing');
    await page.getByRole('button', { name: 'Edit drawing', exact: true }).click();
    await expect(page.getByLabel('Distance (m)', { exact: true })).toHaveValue('500');
    await expect(page.getByLabel('Bearing (°)', { exact: true })).toHaveValue('90');
  } finally {
    release();
    // This test's Playwright context owns and retires the interception route.
  }
});

test(starterCases.protect, async ({ page }) => {
  await page.goto('/starter/index.html?offline');
  await expect(page.locator('#status')).toHaveText('Ready');
  // The first feature would be visible at the map center if restoration accepted a partial batch.
  const original = '[ { "type": "Feature", "id": "stored-point", "geometry": { "type": "Point", "coordinates": [6.88, 45.925] }, "properties": { "name": "Stored point" } }, { "type": "Feature", "id": "broken", "geometry": { "type": "LineString", "coordinates": [] }, "properties": {} } ]';
  await page.evaluate(value => localStorage.setItem('ridgeline-starter-drawings-v1', value), original);
  const mode = page.getByRole('combobox', { name: 'Example', exact: true });
  await mode.selectOption('drawing');
  await expect(page.locator('#storage-status')).toContainText('Restore failed');
  const canvas = page.locator('#map canvas').first();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Starter map canvas is missing.');
  await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  await expect(page.locator('#selection')).toHaveText('No feature selected');
  await expect(page.getByRole('button', { name: 'Edit drawing', exact: true })).toHaveCount(0);

  const finish = page.getByRole('button', { name: 'Finish', exact: true });
  const distance = page.getByLabel('Distance (m)', { exact: true });
  const draw = async () => {
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await canvas.click({ position: { x: 120, y: 150 } });
    await canvas.click({ position: { x: 340, y: 220 } });
    await distance.fill('500');
    await page.keyboard.press('Tab');
    await finish.click();
    await expect(page.locator('#storage-status')).toContainText('Save rejected');
    expect(await page.evaluate(() => localStorage.getItem('ridgeline-starter-drawings-v1'))).toBe(original);
    await expect(distance).toHaveValue('500');
    await expect(finish).toBeEnabled();
    await expect(page.locator('#selection')).toHaveText('No feature selected');
  };
  await draw();
  await distance.fill('250');
  await page.keyboard.press('Tab');
  await finish.click();
  await expect(distance).toHaveValue('250');
  expect(await page.evaluate(() => localStorage.getItem('ridgeline-starter-drawings-v1'))).toBe(original);

  await page.getByRole('button', { name: 'Reset example', exact: true }).click();
  await expect(page.locator('#storage-status')).toContainText('Restore failed');
  expect(await page.evaluate(() => localStorage.getItem('ridgeline-starter-drawings-v1'))).toBe(original);
  await draw();
  await mode.selectOption('selection');
  await mode.selectOption('drawing');
  await expect(page.locator('#storage-status')).toContainText('Restore failed');
  await draw();

  await page.getByRole('button', { name: 'Clear unreadable saved drawings', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('ridgeline-starter-drawings-v1'))).toBeNull();
  await expect(distance).toHaveValue('500');
  await finish.click();
  await expect(page.locator('#storage-status')).toHaveText('Saved 1 drawing(s).');
  await expect(page.locator('#selection')).toHaveText('Drawing');
  await expect(page.getByRole('button', { name: 'Edit drawing', exact: true })).toBeEnabled();
  const saved = await page.evaluate(() => localStorage.getItem('ridgeline-starter-drawings-v1'));
  expect(saved).not.toBe(original);
  expect(JSON.parse(saved ?? 'null')).toMatchObject([{ drawing: { version: 1, shape: { kind: 'line' } } }]);
});
