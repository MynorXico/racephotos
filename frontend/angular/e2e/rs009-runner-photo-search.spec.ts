import { test, expect } from '@playwright/test';

/**
 * RS-009 E2E tests — Runner photo search page
 *
 * ACs covered at the E2E layer (no live API required):
 *   AC1 — Public route: /events/:id is accessible without authentication.
 *   AC3 — Bib input validation: non-numeric and >6 digit bibs are rejected by
 *          the form (client-side, no API call needed).
 *   Responsive baselines at 375px and 1280px for the search page layout.
 *
 * ACs that require a live API + seeded DynamoDB (deferred to integration phase):
 *   AC2 — GET /events/{id}/photos/search?bib= returns 200 with photo list.
 *   AC4 — Empty result state renders when bib has no photos.
 *   AC5 — Photo detail dialog opens and shows price on card click.
 *   AC6 — Purchase button dispatches initiatePurchase.
 *   AC7 — 404 response (unknown event) shows an error state.
 *   AC8 — Missing/empty bib returns 400 (server-side — covered by Go unit tests).
 *   AC9 — Results contain only watermarked photos with CDN URLs.
 *   AC10 — Event name appears in the page header once event metadata loads.
 *
 * Component-level behaviour (NgRx state transitions, skeleton loader, error retry,
 * dialog open/close, bib pattern validation, page title updates) is covered by
 * Angular unit tests (ng test) using MockStore and TestBed.
 */

test.describe('RS-009 — Public route access (AC1)', () => {
  test('event search page is accessible without authentication', async ({ page }) => {
    await page.goto('/events/evt-test-001');
    // Should NOT be redirected to /login — the route is public.
    await expect(page).not.toHaveURL(/\/login/);
    // The bib input should be present on the page.
    await expect(page.getByLabel('Bib number')).toBeVisible();
  });
});

test.describe('RS-009 — Bib input validation (AC3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/events/evt-test-001');
    await expect(page.getByLabel('Bib number')).toBeVisible();
  });

  test('search button is initially enabled', async ({ page }) => {
    const searchBtn = page.getByRole('button', { name: /search/i });
    await expect(searchBtn).toBeEnabled();
  });

  test('empty bib shows required error after touching the field', async ({ page }) => {
    const input = page.getByLabel('Bib number');
    // Fill with a space then clear — makes the field dirty+touched so required error shows.
    await input.fill(' ');
    await input.clear();
    await input.press('Tab');
    await expect(page.getByText('Bib number is required')).toBeVisible();
  });

  test('non-numeric bib shows validation error', async ({ page }) => {
    const input = page.getByLabel('Bib number');
    await input.fill('abc');
    await input.press('Tab');
    await expect(page.getByText(/bib must be 1–6 digits/i)).toBeVisible();
  });

  test('bib longer than 6 digits shows validation error', async ({ page }) => {
    const input = page.getByLabel('Bib number');
    await input.fill('1234567');
    await input.press('Tab');
    await expect(page.getByText(/bib must be 1–6 digits/i)).toBeVisible();
  });

  test('valid 1–6 digit bib clears validation error', async ({ page }) => {
    const input = page.getByLabel('Bib number');
    await input.fill('abc');
    await input.press('Tab');
    await expect(page.getByText(/bib must be 1–6 digits/i)).toBeVisible();

    await input.clear();
    await input.fill('101');
    await input.press('Tab');
    await expect(page.getByText(/bib must be 1–6 digits/i)).not.toBeVisible();
  });
});

test.describe('RS-009 — Responsive baselines', () => {
  test('375px — search page renders with bib input visible', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/events/evt-test-001');
    await expect(page.getByLabel('Bib number')).toBeVisible();
    await page.screenshot({ path: 'e2e/snapshots/rs009-375px-search-page.png' });
  });

  test('1280px — search page renders with bib input visible', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/events/evt-test-001');
    await expect(page.getByLabel('Bib number')).toBeVisible();
    await page.screenshot({ path: 'e2e/snapshots/rs009-1280px-search-page.png' });
  });
});
