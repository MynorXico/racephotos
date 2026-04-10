import { test, expect } from '@playwright/test';

/**
 * RS-018 E2E tests — in_progress virtual status filter
 *
 * ACs covered at the E2E layer (no live API required):
 *   AC5 — Auth-guard redirect verifies the photos route is still protected after
 *          the filter chip bar changes (no regression to the route guard).
 *
 * Chip bar content, badge label, and API call assertions (AC1, AC2, AC5, AC6, AC7)
 * require a live Cognito session with seeded photos. Following the RS-008 precedent,
 * those are covered by Angular unit tests (ng test with MockStore) and deferred
 * to the integration phase once Playwright auth fixtures are in place.
 *
 * Responsive auth-redirect baselines at 375px and 1280px are included as visual
 * regression anchors for the route.
 */

test.describe('RS-018 — Auth guard regression (photos route still protected)', () => {
  test('unauthenticated visit to /photographer/events/:id/photos redirects to /login', async ({
    page,
  }) => {
    await page.goto('/photographer/events/evt-001/photos');
    await expect(page).toHaveURL(
      '/login?returnUrl=%2Fphotographer%2Fevents%2Fevt-001%2Fphotos',
    );
    await expect(page.getByLabel('Email address')).toBeVisible();
  });
});

test.describe('RS-018 — Responsive auth-redirect baselines', () => {
  test('375px — photos route redirects to /login', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/photographer/events/evt-001/photos');
    await expect(page).toHaveURL(
      '/login?returnUrl=%2Fphotographer%2Fevents%2Fevt-001%2Fphotos',
    );
    await page.screenshot({ path: 'e2e/snapshots/rs018-375px-auth-redirect.png' });
  });

  test('1280px — photos route redirects to /login', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/photographer/events/evt-001/photos');
    await expect(page).toHaveURL(
      '/login?returnUrl=%2Fphotographer%2Fevents%2Fevt-001%2Fphotos',
    );
    await page.screenshot({ path: 'e2e/snapshots/rs018-1280px-auth-redirect.png' });
  });
});
