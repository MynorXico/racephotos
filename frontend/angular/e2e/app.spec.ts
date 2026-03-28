import { test, expect } from '@playwright/test';

/**
 * Smoke test — verifies the app shell loads at all.
 * Replace with real feature tests as pages are built.
 */
test('app shell loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/racephotos/i);
});
