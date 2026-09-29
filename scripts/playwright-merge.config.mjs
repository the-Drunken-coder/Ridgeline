import { resolve } from 'node:path';
import { defineConfig } from 'playwright/test';

export default defineConfig({
  // Both consumer suites share this root when reports from different runners merge.
  testDir: '..',
  reporter: [['html', { outputFolder: resolve(import.meta.dirname, '../.artifacts/browser-report'), open: 'never' }]],
});
