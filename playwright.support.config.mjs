import { defineConfig } from 'playwright/test';
import packaged from './playwright.packaged.config.mjs';

// Focused public workflows across engines; the full rendering/regression suite remains Chromium.
export default defineConfig({
  ...packaged,
  testMatch: ['browser.spec.ts', 'starter.spec.ts'],
  grep: /Workflow controls|Basemap selector|Native geolocation|Native fullscreen|Drawing upgrades (holes|edge)|Inspector label editing|Optional selection|Rectangle interruptions|Feature presentation|Adoption starter|Queued features render|Keyboard picker activation|Style replacement preserves data/,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox', headless: process.platform !== 'linux', launchOptions: { args: [], firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.enable-webgl2': true } } } },
    { name: 'webkit', use: { browserName: 'webkit', launchOptions: { args: [] } } },
  ],
});
