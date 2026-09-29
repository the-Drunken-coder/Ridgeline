import { defineConfig } from 'playwright/test';

export default defineConfig({
  // Both consumer suites share this root when reports from different runners merge.
  testDir: '..',
  reporter: [['html', { outputFolder: '.artifacts/browser-report', open: 'never' }]],
});
