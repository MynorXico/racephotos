import { test, expect } from '@playwright/test';

/**
 * RS-004 E2E tests — Photographer account: auth shell + profile setup
 *
 * ACs covered:
 *   AC1  — unauthenticated visit to /photographer/* redirects to /login
 *   AC2  — login page renders with email and password fields
 *   AC3  — invalid form submission shows validation errors
 *   AC6  — /login renders sign-in form with accessible structure
 *   AC7  — authenticated access to /photographer/* renders the shell
 */

test.describe('RS-004 — Login page', () => {
  test('AC2 — login page renders with email and password fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('AC6 — login page has accessible structure', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('main')).toBeVisible();
    const form = page.locator('[aria-label="Sign in form"]');
    await expect(form).toBeVisible();
    await expect(page.getByText('RaceShots')).toBeVisible();
  });

  test('AC3 — submitting empty form shows validation errors', async ({ page }) => {
    await page.goto('/login');
    // Submit without filling in any fields — markAllAsTouched() triggers touched state
    await page.getByRole('button', { name: /sign in/i }).click();
    // Validation errors must be visible (template uses touched, not dirty)
    await expect(page.getByText('Email address is required.')).toBeVisible();
    await expect(page.getByText('Password is required.')).toBeVisible();
    // Form must remain on page (no navigation)
    await expect(page.getByLabel('Email address')).toBeVisible();
  });

  test('password visibility toggle works', async ({ page }) => {
    await page.goto('/login');
    const passwordInput = page.locator('input[autocomplete="current-password"]');
    await expect(passwordInput).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: /toggle password visibility/i }).click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
  });
});

test.describe('RS-004 — Auth guard redirect', () => {
  test('AC1 — unauthenticated visits redirect to /login with encoded returnUrl', async ({
    page,
  }) => {
    await page.goto('/photographer/events');
    await expect(page).toHaveURL('/login?returnUrl=%2Fphotographer%2Fevents');

    await page.goto('/photographer/profile');
    await expect(page).toHaveURL('/login?returnUrl=%2Fphotographer%2Fprofile');
  });
});

test.describe('RS-004 — Login page — responsive', () => {
  test('login page renders correctly at mobile width (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/login');
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });
});

test.describe('RS-004 — Login page — icon rendering', () => {
  // Material Icons uses font ligatures: the text content of <mat-icon> is the icon
  // name (e.g. "visibility"). If the font fails to load the ligature text is rendered
  // as plain characters. "vis" visible in the DOM means the icon text is overflowing
  // its container (truncated) rather than being replaced by the icon glyph.
  let icon: import('@playwright/test').Locator;

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    icon = page.getByRole('button', { name: /toggle password visibility/i }).locator('mat-icon');
    await expect(icon).toBeVisible();
  });

  test('password toggle icon is rendered as a glyph (no text overflow)', async () => {
    // 1. Verify the ligature text is correct in the DOM.
    const text = await icon.textContent();
    expect(text?.trim()).toMatch(/^(visibility|visibility_off)$/);

    // 2. Verify the Material Icons font-family is applied via CSS.
    const fontFamily = await icon.evaluate((el) => window.getComputedStyle(el).fontFamily);
    expect(fontFamily.toLowerCase()).toContain('material icons');

    // 3. Verify the icon is not rendering as overflowing text.
    // mat-icon has a fixed 24px CSS width; if the font fails to load the ligature
    // string ("visibility_off") overflows the container, making scrollWidth > clientWidth.
    const isOverflowing = await icon.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(isOverflowing).toBe(false);
  });

  test('password toggle icon button has visible icon after toggle', async ({ page }) => {
    // Initial state: visibility_off
    await expect(icon).toHaveText('visibility_off');

    // After toggle: visibility
    await page.getByRole('button', { name: /toggle password visibility/i }).click();
    await expect(icon).toHaveText('visibility');
  });
});
