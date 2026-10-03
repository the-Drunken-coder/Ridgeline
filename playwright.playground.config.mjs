import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests/playground',
  timeout: 60_000,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  failOnFlakyTests: true,
  reporter: 'list',
  outputDir: '.artifacts/playground-tests',
  use: {
    baseURL: 'http://127.0.0.1:5175',
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm build:playground && pnpm exec vite preview --config vite.playground.config.ts --host 127.0.0.1 --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
