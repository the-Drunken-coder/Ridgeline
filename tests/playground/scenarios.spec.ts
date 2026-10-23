import { expect, test } from 'playwright/test';

for (const [scenario, count, terrain] of [
  ['moving', '1,002 features', 'delayed'],
  ['airborne', '1,000 features', 'delayed'],
  ['airborne-single', '1 feature', 'delayed'],
  ['airborne-single', '1 feature', 'ready'],
] as const) {
  const label = terrain === 'ready' ? `${scenario}, ready terrain` : scenario;
  test(`motion controls reset and pending measurements retire when switching scenarios (${label})`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 800, height: 640 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://tiles.openfreemap.org/styles/*', route => route.fulfill({
      json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9efea' } }] },
    }));
    await page.route('https://tiles.mapterhorn.com/tilejson.json', route => route.fulfill({
      json: { tilejson: '3.0.0', tiles: ['https://tiles.mapterhorn.com/flat/{z}/{x}/{y}.png'], minzoom: 0, maxzoom: 12, encoding: 'terrarium' },
    }));
    let releaseTerrain = () => {};
    const terrainReady = new Promise<void>(resolve => { releaseTerrain = resolve; });
    await page.route('https://tiles.mapterhorn.com/flat/**', async route => {
      await terrainReady;
      await route.fulfill({ path: 'tests/fixtures/flat-terrain.png', contentType: 'image/png' });
    });
    try {
      await page.goto('/?scenario=moving');
      await expect(page.locator('#map-status')).toHaveText('Ready');
      const pause = page.getByRole('button', { name: 'Pause', exact: true });
      const measure = page.getByRole('button', { name: 'Measure 10s', exact: true });
      const output = page.locator('#measurement');
      const scenarioControl = page.getByLabel('Test scenario');

      async function expectEmptyFor(duration: number) {
        const end = Date.now() + duration;
        do {
          await expect(page.locator('#feature-count')).toHaveText('0 features');
          await expect(page.locator('#selected-name')).toHaveText('No feature selected');
          await expect(output).toHaveText('No measurement yet');
          await page.waitForTimeout(100);
        } while (Date.now() < end);
      }

      await scenarioControl.selectOption(scenario);
      await expect(page.locator('#feature-count')).toHaveText(count);
      await expect(page.locator('#motion')).toBeVisible();
      await expect(output).toHaveText('No measurement yet');
      if (scenario !== 'moving') {
        await expect(page.locator('#selected-name')).toHaveText('Kestrel 01');
        await expect(page.locator('#airborne-demo')).toBeVisible();
      }
      await pause.press('Enter');
      await page.getByRole('button', { name: 'Resume', exact: true }).press('Enter');
      await pause.press('Enter');
      if (terrain === 'ready') {
        await page.getByRole('spinbutton', { name: 'Range m', exact: true }).fill('800');
        releaseTerrain();
        await expect(page.locator('#airborne-demo [data-state]')).toHaveText('airborne · overlay ready', { timeout: 30_000 });
      }
      await scenarioControl.evaluate(select => {
        if (!(select instanceof HTMLSelectElement)) throw new Error('Scenario control is not a native select');
        const readMotion = () => ({
          measurement: document.querySelector('#measurement')?.textContent,
          measureDisabled: document.querySelector<HTMLButtonElement>('#measure')?.disabled,
          pause: document.querySelector('#pause')?.textContent,
          pauseVisible: document.querySelector<HTMLElement>('#pause')?.checkVisibility(),
          motionVisible: document.querySelector<HTMLElement>('#motion')?.hidden === false,
          inspector: document.querySelector('#airborne-demo [data-state]')?.textContent,
          featureCount: document.querySelector('#feature-count')?.textContent,
        });
        const armed = readMotion(), startedAt = performance.now();
        // Capture before the application's change handler retires the previous scenario.
        select.addEventListener('change', () => {
          select.dataset.motionTransition = JSON.stringify({ destination: select.value, armed, atChange: readMotion(),
            elapsedMs: performance.now() - startedAt, visibility: document.visibilityState });
        }, { capture: true, once: true });
      });
      await measure.press('Enter');
      await scenarioControl.selectOption('empty');
      const transition = await scenarioControl.getAttribute('data-motion-transition');
      try {
        const snapshot: unknown = JSON.parse(transition ?? 'null');
        expect(snapshot, 'Measurement must still be pending when the native scenario change reaches the application').toMatchObject({
          destination: 'empty',
          atChange: { measurement: 'Measuring for 10 seconds…', measureDisabled: true, pause: 'Pause', pauseVisible: true, motionVisible: true },
        });
      } catch (error) {
        await testInfo.attach('motion-scenario-transition.json', { body: transition ?? 'null', contentType: 'application/json' });
        throw error;
      }
      await expect(page.locator('#motion')).toBeHidden();
      await expect(page.locator('#airborne-demo')).toBeHidden();
      await expect(page.locator('#measure')).toBeEnabled();
      await expectEmptyFor(500);
      releaseTerrain();
      await expectEmptyFor(10_250);
      await scenarioControl.selectOption('moving');
      await expect(pause).toBeVisible();
      await expect(measure).toBeEnabled();
      await expect(output).toHaveText('No measurement yet');
      await page.goto('about:blank');
      expect(errors).toEqual([]);
    } finally {
      releaseTerrain();
    }
  });
}
