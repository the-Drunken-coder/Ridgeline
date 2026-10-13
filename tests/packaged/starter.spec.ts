import { expect, test } from 'playwright/test';

test('Adoption starter saves numeric drawing edits through installed declarations and disposes controls', async ({ page }, testInfo) => {
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


test('Adoption starter retains a rejected draft and restores saved shape metadata after reload', async ({ page }) => {
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
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Ready');
  await page.getByRole('combobox', { name: 'Example', exact: true }).selectOption('drawing');
  await expect(page.locator('#storage-status')).toHaveText('Restored 1 drawing(s).');
  expect(await page.evaluate(() => localStorage.getItem('ridgeline-starter-drawings-v1'))).toBe(saved);
  await canvas.click({ position: { x: 120, y: 150 } });
  await expect(page.locator('#selection')).toHaveText('Drawing');
  await page.getByRole('button', { name: 'Edit drawing', exact: true }).click();
  await expect(page.getByLabel('Distance (m)', { exact: true })).toHaveValue('500');
  await expect(page.getByLabel('Bearing (°)', { exact: true })).toHaveValue('90');
});

test('Adoption starter protects failed restoration through saves and Reset until explicit clearing', async ({ page }) => {
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
