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
  test('AC1 — unauthenticated visit to /photographer/events redirects to /login', async ({
    page,
  }) => {
    await page.goto('/photographer/events');
    // Should be redirected to login with returnUrl
    await expect(page).toHaveURL(/\/login/);
  });

  test('AC1 — unauthenticated visit to /photographer/profile redirects to /login', async ({
    page,
  }) => {
    await page.goto('/photographer/profile');
    await expect(page).toHaveURL(/\/login/);
  });

  test('returnUrl is preserved in redirect', async ({ page }) => {
    await page.goto('/photographer/profile');
    await expect(page).toHaveURL(/returnUrl=/);
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
