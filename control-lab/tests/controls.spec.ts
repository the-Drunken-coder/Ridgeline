import { expect, test, type Locator, type Page } from 'playwright/test';

type Position = { x: number; y: number };

async function center(locator: Locator): Promise<Position> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Expected a visible map element');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function expectNear(actual: Position, expected: Position, tolerance = 3) {
  expect(Math.hypot(actual.x - expected.x, actual.y - expected.y)).toBeLessThan(tolerance);
}

async function mapPoint(page: Page, xFraction: number, yFraction: number): Promise<Position> {
  const box = await page.locator('.map-surface').boundingBox();
  if (!box) throw new Error('Expected the map to be visible');
  return { x: box.x + box.width * xFraction, y: box.y + box.height * yFraction };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Select Alpha' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Ready.');
});

test('a selected unit moves to the clicked destination and leaves a trail', async ({ page }) => {
  const alpha = page.getByRole('button', { name: 'Select Alpha' });
  const bravo = page.getByRole('button', { name: 'Select Bravo' });
  const alphaBefore = await center(alpha);

  await bravo.click();
  await expect(bravo).toHaveAttribute('aria-pressed', 'true');
  await expect(alpha).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Move here' }).click();
  await expect(page.getByRole('button', { name: 'Click destination' })).toHaveAttribute('aria-pressed', 'true');

  const destination = await mapPoint(page, 0.72, 0.62);
  await page.mouse.click(destination.x, destination.y);

  await expect(page.getByRole('status')).toHaveText('bravo moved.');
  await expect(page.locator('.trail')).toHaveCount(1);
  expectNear(await center(bravo), destination);
  expectNear(await center(alpha), alphaBefore);
  await expect(page.getByRole('button', { name: 'Move here' })).toHaveAttribute('aria-pressed', 'false');
});

test('Shift-click adds and removes units, and Escape cancels targeting', async ({ page }) => {
  const alpha = page.getByRole('button', { name: 'Select Alpha' });
  const bravo = page.getByRole('button', { name: 'Select Bravo' });
  const charlie = page.getByRole('button', { name: 'Select Charlie' });
  const alphaBefore = await center(alpha);
  const bravoBefore = await center(bravo);
  const charlieBefore = await center(charlie);

  await bravo.click({ modifiers: ['Shift'] });
  await expect(alpha).toHaveAttribute('aria-pressed', 'true');
  await expect(bravo).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.selection')).toContainText('2 selected');

  await page.getByRole('button', { name: 'Move here' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status')).toHaveText('Cancelled.');
  const ignoredDestination = await mapPoint(page, 0.7, 0.6);
  await page.mouse.click(ignoredDestination.x, ignoredDestination.y);
  await expect(page.locator('.trail')).toHaveCount(0);
  expectNear(await center(alpha), alphaBefore);
  expectNear(await center(bravo), bravoBefore);

  await page.getByRole('button', { name: 'Move here' }).click();
  const destination = await mapPoint(page, 0.7, 0.6);
  await page.mouse.click(destination.x, destination.y);
  await expect(page.getByRole('status')).toHaveText('alpha, bravo moved.');
  await expect(page.locator('.trail')).toHaveCount(1);
  expect(Math.hypot((await center(alpha)).x - destination.x, (await center(alpha)).y - destination.y)).toBeLessThan(40);
  expect(Math.hypot((await center(bravo)).x - destination.x, (await center(bravo)).y - destination.y)).toBeLessThan(40);
  expectNear(await center(charlie), charlieBefore);

  await bravo.click({ modifiers: ['Shift'] });
  await expect(bravo).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.selection')).toContainText('1 selected');
});

test('dragging an armed map pans without placing an order', async ({ page }) => {
  const alpha = page.getByRole('button', { name: 'Select Alpha' });
  const bravo = page.getByRole('button', { name: 'Select Bravo' });
  const alphaBefore = await center(alpha);
  const bravoBefore = await center(bravo);
  await page.getByRole('button', { name: 'Move here' }).click();

  const start = await mapPoint(page, 0.52, 0.64);
  const end = { x: start.x + 75, y: start.y + 45 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByRole('button', { name: 'Click destination' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.trail')).toHaveCount(0);
  expectNear(await center(alpha), { x: alphaBefore.x + 75, y: alphaBefore.y + 45 });
  expectNear(await center(bravo), { x: bravoBefore.x + 75, y: bravoBefore.y + 45 });

  const destination = await mapPoint(page, 0.72, 0.66);
  await page.mouse.click(destination.x, destination.y);
  await expect(page.getByRole('status')).toHaveText('alpha moved.');
  await expect(page.locator('.trail')).toHaveCount(1);
  expectNear(await center(alpha), destination);
});

test('wheel zoom stays at the pointer, while Frame, Fit, and Reset restore navigation', async ({ page }) => {
  const alpha = page.getByRole('button', { name: 'Select Alpha' });
  const charlie = page.getByRole('button', { name: 'Select Charlie' });
  const beacon = page.locator('.beacon');
  const initialAlpha = await center(alpha);
  const initialBeacon = await center(beacon);
  const initialCharlie = await center(charlie);

  await page.mouse.move(initialBeacon.x, initialBeacon.y);
  await page.mouse.wheel(0, -300);
  await expect(page.locator('.selection')).not.toContainText('100%');
  expectNear(await center(beacon), initialBeacon);
  expect(Math.hypot((await center(alpha)).x - initialBeacon.x, (await center(alpha)).y - initialBeacon.y))
    .toBeGreaterThan(Math.hypot(initialAlpha.x - initialBeacon.x, initialAlpha.y - initialBeacon.y) + 20);

  await page.getByRole('button', { name: 'Reset camera' }).click();
  await expect(page.locator('.selection')).toContainText('100%');
  expectNear(await center(alpha), initialAlpha);
  expectNear(await center(beacon), initialBeacon);

  await charlie.click();
  await page.getByRole('button', { name: 'Frame' }).click();
  const stage = await page.locator('.stage').boundingBox();
  if (!stage) throw new Error('Expected the map stage to be visible');
  expectNear(await center(charlie), { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 });
  expect(Math.hypot((await center(charlie)).x - initialCharlie.x, (await center(charlie)).y - initialCharlie.y)).toBeGreaterThan(20);

  await page.getByRole('button', { name: 'Move here' }).click();
  const destination = await mapPoint(page, 0.72, 0.65);
  await page.mouse.click(destination.x, destination.y);
  await expect(page.locator('.trail')).toHaveCount(1);
  expectNear(await center(charlie), destination);

  await page.getByRole('button', { name: 'Reset scene' }).click();
  await expect(page.getByRole('status')).toHaveText('Scene reset.');
  await expect(alpha).toHaveAttribute('aria-pressed', 'true');
  await expect(charlie).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.trail')).toHaveCount(0);
  expectNear(await center(alpha), initialAlpha);
  expectNear(await center(charlie), initialCharlie);
});

test('wheel over units keeps the pointer anchor and leaves application controls alone', async ({ page }) => {
  const alpha = page.getByRole('button', { name: 'Select Alpha' });
  const bravo = page.getByRole('button', { name: 'Select Bravo' });
  const anchor = await center(alpha);
  const other = await center(bravo);
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -300);
  await expect(page.locator('.selection')).not.toContainText('100%');
  expectNear(await center(alpha), anchor);
  const zoomedOther = await center(bravo);
  expect(Math.hypot(zoomedOther.x - anchor.x, zoomedOther.y - anchor.y))
    .toBeGreaterThan(Math.hypot(other.x - anchor.x, other.y - anchor.y) + 20);

  const zoom = await page.locator('.selection').textContent();
  for (const control of [page.getByRole('button', { name: 'Move here' }), page.getByRole('button', { name: 'Zoom in', exact: true })]) {
    const position = await center(control);
    await page.mouse.move(position.x, position.y);
    await page.mouse.wheel(0, -300);
    // Consume a subsequent native input before checking that the wheel was ignored.
    await page.keyboard.press('Tab');
    await expect(page.locator('.selection')).toHaveText(zoom ?? '');
    expectNear(await center(bravo), zoomedOther);
  }

  await page.getByRole('button', { name: 'Move here' }).click();
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, 300);
  await expect(page.locator('.selection')).toContainText('100%');
  await expect(page.getByRole('button', { name: 'Click destination' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.trail')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status')).toHaveText('Cancelled.');
});
