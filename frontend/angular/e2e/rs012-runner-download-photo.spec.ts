import { test, expect } from '@playwright/test';

/**
 * RS-012 E2E tests — Runner downloads a photo
 *
 * ACs covered at the E2E layer (no live API required):
 *   AC5 — /download/:token is publicly accessible (no login redirect).
 *   AC6 — Error state renders when the API returns 404: link_off icon,
 *          heading, error body, and "Request a new link" button are present.
 *   AC7 — /redownload is publicly accessible; email form is rendered with
 *          label, hint text, and "Send links" button.
 *
 * ACs that require a live API + seeded data (deferred to integration phase):
 *   AC1 — GET /download/{token} returns 200 { url } and browser redirects.
 *   AC2 — GET /download/{token} returns 404 for unknown tokens.
 *   AC3 — POST /purchases/redownload-resend returns 200 for known email.
 *   AC4 — POST /purchases/redownload-resend returns 429 after 3 attempts in 1 hour.
 *
 * The full redirect flow (API call → window.location.href) and rate-limit
 * logic are covered by Angular unit tests (ng test) using DownloadService spy.
 *
 * Route interception pattern: match requests where the path starts with
 * /download/ or /purchases/redownload-resend AND the port is NOT 4200
 * (the Angular dev server). This avoids intercepting the SPA navigation itself.
 */

/** Returns true for API calls — excludes the Angular dev server at port 4200. */
const isApiDownloadRequest = (url: URL) =>
  url.pathname.match(/^\/download\//) !== null && url.port !== '4200';

const isApiRedownloadRequest = (url: URL) =>
  url.pathname === '/purchases/redownload-resend' && url.port !== '4200';

test.describe('RS-012 — Download redirect route (AC5)', () => {
  test('download route is accessible without authentication', async ({ page }) => {
    await page.route(isApiDownloadRequest, (route) =>
      route.fulfill({ status: 404, body: JSON.stringify({ message: 'Not found' }) }),
    );
    await page.goto('/download/fake-token-for-route-test');
    await expect(page).not.toHaveURL(/\/login/);
  });
});

test.describe('RS-012 — Download error state (AC6)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(isApiDownloadRequest, (route) =>
      route.fulfill({ status: 404, body: JSON.stringify({ message: 'Not found' }) }),
    );
    await page.goto('/download/invalid-token');
  });

  test('shows error heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Download link not found' })).toBeVisible();
  });

  test('shows error body text', async ({ page }) => {
    await expect(page.getByText(/invalid or has already been used/)).toBeVisible();
  });

  test('"Request a new link" button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Request a new link' })).toBeVisible();
  });

  test('"Request a new link" button navigates to /redownload', async ({ page }) => {
    await page.getByRole('button', { name: 'Request a new link' }).click();
    await expect(page).toHaveURL(/\/redownload/);
  });
});

test.describe('RS-012 — Redownload request route (AC7)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/redownload');
    // Wait for the lazy-loaded component to render before each test.
    // Angular Material floating labels can race on mobile viewports without this gate.
    await expect(page.getByRole('heading', { name: 'Resend download links' })).toBeVisible();
  });

  test('redownload route is accessible without authentication', async ({ page }) => {
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('shows email input with label', async ({ page }) => {
    await expect(page.getByRole('textbox', { name: 'Email address' })).toBeVisible();
  });

  test('shows "Send links" submit button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Send links' })).toBeVisible();
  });

  test('shows hint text about purchases', async ({ page }) => {
    await expect(page.getByText(/approved purchases for this address/)).toBeVisible();
  });

  test('shows required validation error on empty submit', async ({ page }) => {
    await page.getByRole('button', { name: 'Send links' }).click();
    await expect(page.getByText('Email is required.')).toBeVisible();
  });

  test('shows success message on 200 response', async ({ page }) => {
    await page.route(isApiRedownloadRequest, (route) =>
      route.fulfill({ status: 200, body: '{}' }),
    );
    await page.getByRole('textbox', { name: 'Email address' }).fill('runner@example.com');
    await page.getByRole('button', { name: 'Send links' }).click();
    await expect(page.getByText(/receive a link shortly/)).toBeVisible();
  });

  test('shows rate-limit message on 429 response', async ({ page }) => {
    await page.route(isApiRedownloadRequest, (route) =>
      route.fulfill({ status: 429, body: '{}' }),
    );
    await page.getByRole('textbox', { name: 'Email address' }).fill('runner@example.com');
    await page.getByRole('button', { name: 'Send links' }).click();
    await expect(page.getByText(/Too many attempts/)).toBeVisible();
  });
});

test.describe('RS-012 — Responsive layout (375px mobile)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('redownload card renders without overflow on mobile', async ({ page }) => {
    await page.goto('/redownload');
    const card = page.locator('mat-card');
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(375);
  });
});
