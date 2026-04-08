import { test, expect } from '@playwright/test';

/**
 * RS-006 E2E tests — Bulk photo upload
 *
 * ACs covered at the E2E layer:
 *   AC1  — Auth redirect: unauthenticated visit to /photographer/events/:id/upload
 *           redirects to /login with the correct returnUrl.
 *   AC7  — Responsive: 375px mobile visit also redirects to /login.
 *   AC7  — Responsive: 1280px desktop visit also redirects to /login.
 *
 * Component-level behaviour (drop zone, progress panel, retry, presign error banner,
 * NgRx state transitions) is covered by Angular unit tests (ng test) which use
 * MockStore and TestBed — those run reliably without a live Cognito session.
 *
 * Note: E2E tests against the full upload flow require a LocalStack environment with
 * a valid Cognito token and a seeded event — deferred to the integration test phase.
 * Playwright storageState fixtures for Amplify auth tokens are not yet set up.
 */

test.describe('RS-006 — Auth guard redirect for upload route (AC1)', () => {
  test('unauthenticated visit to /photographer/events/:id/upload redirects to /login', async ({
    page,
  }) => {
    await page.goto('/photographer/events/evt-001/upload');
    await expect(page).toHaveURL(
      '/login?returnUrl=%2Fphotographer%2Fevents%2Fevt-001%2Fupload',
    );
    await expect(page.getByLabel('Email address')).toBeVisible();
  });
});

test.describe('RS-006 — Responsive redirects (AC7)', () => {
  test('375px — unauthenticated visit to upload route redirects to /login', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/photographer/events/evt-001/upload');
    await expect(page).toHaveURL(
      '/login?returnUrl=%2Fphotographer%2Fevents%2Fevt-001%2Fupload',
    );
    await expect(page.getByLabel('Email address')).toBeVisible();
  });

  test('1280px — unauthenticated visit to upload route redirects to /login', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/photographer/events/evt-001/upload');
    await expect(page).toHaveURL(
      '/login?returnUrl=%2Fphotographer%2Fevents%2Fevt-001%2Fupload',
    );
    await expect(page.getByLabel('Email address')).toBeVisible();
  });
});
