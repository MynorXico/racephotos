import { test, expect } from '@playwright/test';

/**
 * RS-008 E2E tests — Photographer event photos gallery
 *
 * ACs covered at the E2E layer:
 *   AC1  — Auth redirect: unauthenticated visit to /photographer/events/:id/photos
 *           redirects to /login.
 *   Responsive: 375px and 1280px auth-redirect baseline.
 *
 * Component-level behaviour (photo grid rendering, filter chips, load-more,
 * status badges, error state, empty state, NgRx state transitions) is covered
 * by Angular unit tests (ng test) using MockStore and TestBed — those run
 * reliably without a live API or Cognito session.
 *
 * Full gallery E2E (filter chip interaction, load-more pagination, error tooltip)
 * requires a LocalStack environment with seeded photos and a valid Cognito token.
 * Deferred to the integration test phase once Playwright auth fixtures are set up.
 */

test.describe('RS-008 — Auth guard redirect for photos route (AC1)', () => {
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

test.describe('RS-008 — Responsive redirects', () => {
  test('375px — unauthenticated visit to photos route redirects to /login', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/photographer/events/evt-001/photos');
    await expect(page).toHaveURL(
      '/login?returnUrl=%2Fphotographer%2Fevents%2Fevt-001%2Fphotos',
    );
    await expect(page.getByLabel('Email address')).toBeVisible();
  });

  test('1280px — unauthenticated visit to photos route redirects to /login', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/photographer/events/evt-001/photos');
    await expect(page).toHaveURL(
      '/login?returnUrl=%2Fphotographer%2Fevents%2Fevt-001%2Fphotos',
    );
    await expect(page.getByLabel('Email address')).toBeVisible();
  });
});
