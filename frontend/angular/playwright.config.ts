import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for RaceShots Angular frontend.
 *
 * Tests live in e2e/**\/*.spec.ts
 * Run: npx playwright test
 * Update snapshots: npx playwright test --update-snapshots
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? 'github' : 'html',

  expect: {
    // Allow up to 2% pixel difference to account for font rendering across OS/CI environments.
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },

  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  // Start the Angular dev server before running tests.
  // Playwright waits until localhost:4200 is ready before running any test.
  webServer: {
    command: 'npx ng serve --configuration=development',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env['CI'],
    timeout: 120000,
  },
});
