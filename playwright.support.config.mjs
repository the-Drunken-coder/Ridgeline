import { defineConfig } from 'playwright/test';
import packaged from './playwright.packaged.config.mjs';
import { supportCases, starterCases } from './tests/browser/catalog.ts';

const names = [...supportCases, ...Object.values(starterCases)];
const escaped = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));


// Focused public workflows across engines; the full rendering/regression suite remains Chromium.
export default defineConfig({
  ...packaged,
  testMatch: ['browser.spec.ts', 'starter.spec.ts'],
  grep: new RegExp(escaped.map(name => `(?:^|\\s)${name}$`).join('|')),
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox', headless: process.platform !== 'linux', launchOptions: { args: [], firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.enable-webgl2': true } } } },
    { name: 'webkit', use: { browserName: 'webkit', launchOptions: { args: [] } } },
  ],
});
