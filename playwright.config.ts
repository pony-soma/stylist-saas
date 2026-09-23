import { defineConfig, devices } from '@playwright/test';
import { assertLocalEnvironment } from './tests/e2e/fixtures';

assertLocalEnvironment();

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node --require ./tests/e2e/line-provider.cjs ./node_modules/next/dist/bin/next start --hostname localhost --port 3000',
    url: 'http://localhost:3000/login',
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
