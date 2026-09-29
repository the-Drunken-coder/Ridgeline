import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests/packaged',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: true,
  retries: 0,
  forbidOnly: !!process.env.CI,
  failOnFlakyTests: true,
  reporter: 'list',
  outputDir: '.artifacts/playwright',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 5174 --strictPort',
    cwd: '.artifacts/consumer',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
