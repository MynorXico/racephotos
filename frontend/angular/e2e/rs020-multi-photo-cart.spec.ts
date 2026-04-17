import { test, expect } from '@playwright/test';

/**
 * RS-020 E2E tests — Multi-photo cart
 *
 * These tests cover what can be verified without a live API (no seeded data):
 *   AC1  — Checkbox UI renders on photo cards (requires seeded photos; verified
 *           structurally via RS-009 bib search flow)
 *   AC9  — Purchase toolbar is absent before any photos are selected
 *   AC10 — The event search page is accessible without authentication
 *
 * ACs that require a live API + seeded bib search results (integration phase):
 *   AC2  — Checkbox adds photo to cart; checked state persists
 *   AC3  — Unchecking removes photo from cart
 *   AC4  — "Purchase (N photos)" toolbar button appears after selection
 *   AC5  — Cross-event confirmation dialog on selecting from second event
 *   AC6  — Cart-review step shows all selected photos and total
 *   AC7  — "Edit cart" in cart-review step closes dialog without clearing cart
 *   AC8  — Cart is cleared after email submission (submitEmailSuccess)
 *   AC10 — photoIds array is sent to POST /orders (API-level assertion)
 *
 * The full cart flow (checkbox toggling, cart-review step, cross-event dialog,
 * stepper advancement) is covered by Angular unit tests (ng test) using
 * MockStore and TestBed.
 */

test.describe('RS-020 — Multi-photo cart: public route (AC10)', () => {
  test('event search page is accessible without authentication', async ({ page }) => {
    await page.goto('/events/evt-test-001');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByLabel('Bib number')).toBeVisible();
  });
});

test.describe('RS-020 — Multi-photo cart: initial state (AC9)', () => {
  test('purchase toolbar is not visible before any photos are selected', async ({ page }) => {
    await page.goto('/events/evt-test-001');
    const toolbar = page.locator('.selection-toolbar');
    await expect(toolbar).not.toBeVisible();
  });

  test('purchase stepper dialog is not open on initial load', async ({ page }) => {
    await page.goto('/events/evt-test-001');
    const stepper = page.locator('app-purchase-stepper');
    await expect(stepper).not.toBeVisible();
  });
});

test.describe('RS-020 — Multi-photo cart: responsive baseline', () => {
  test('375px — bib search page renders without purchase UI', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/events/evt-test-001');
    await expect(page.getByLabel('Bib number')).toBeVisible();
    await expect(page.locator('.selection-toolbar')).not.toBeVisible();
    await expect(page).toHaveScreenshot('rs020-375px-initial.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('1280px — bib search page renders without purchase UI', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/events/evt-test-001');
    await expect(page.getByLabel('Bib number')).toBeVisible();
    await expect(page.locator('.selection-toolbar')).not.toBeVisible();
    await expect(page).toHaveScreenshot('rs020-1280px-initial.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
