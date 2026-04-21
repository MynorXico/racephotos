import { test, expect } from '@playwright/test';

/**
 * RS-014 E2E tests — Public events listing homepage
 *
 * ACs covered at E2E layer (no live API required):
 *   AC5  — Visiting / renders the events listing page (not a login redirect)
 *   AC7  — Empty state message shown when no events are available
 *   AC8  — Clicking an event card navigates to /events/{id}
 *   Responsive layout at 375px (mobile) and 1280px (desktop)
 *
 * ACs requiring a live API + seeded DynamoDB (integration phase):
 *   AC1  — GET /events returns paginated results sorted by createdAt DESC
 *   AC2  — Cursor pagination returns correct next page
 *   AC3  — Archived events (status="archived") are excluded from results
 *   AC4  — Empty DynamoDB returns { events: [], nextCursor: null }
 *   AC6  — "Load more" button appends next page of cards
 *   AC9  — Malformed cursor returns 400
 *   AC10 — DynamoDB error returns 500 with "internal error"
 *
 * Component-level behaviour (skeleton loader, load-more spinner, error retry,
 * snackbar on load-more failure, cursor forwarding, action dispatch) is covered
 * by Angular unit tests (ng test) using MockStore.
 */

test.describe('RS-014 — Homepage public route (AC5)', () => {
  test('/ is accessible without authentication and is not redirected to /login', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).not.toHaveURL(/\/login/);
    // The page title must be set.
    await expect(page).toHaveTitle('RaceShots — Find your race photos');
  });

  test('hero headline "Find your race photos" is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Find your race photos' })).toBeVisible();
  });

  test('Photographer login link is present in the header (UX-D8)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /photographer login/i })).toBeVisible();
  });
});

test.describe('RS-014 — Empty state (AC7)', () => {
  test('shows empty state message when no events are returned by the API', async ({ page }) => {
    // Intercept GET /events and return an empty list.
    await page.route('**/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ events: [], nextCursor: null }),
      }),
    );

    await page.goto('/');
    await expect(page.getByText('No events listed yet.')).toBeVisible();
    await expect(page.getByText('Check back soon.')).toBeVisible();
  });
});

test.describe('RS-014 — Card navigation (AC8)', () => {
  test('clicking an event card navigates to /events/{id}', async ({ page }) => {
    await page.route('**/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [
            {
              id: 'evt-test-001',
              name: 'Test Marathon',
              date: '2026-06-01',
              location: 'Test City',
              createdAt: '2026-06-01T00:00:00Z',
            },
          ],
          nextCursor: null,
        }),
      }),
    );

    await page.goto('/');
    await expect(page.getByText('Test Marathon')).toBeVisible();

    const searchBtn = page.getByRole('button', { name: /search photos for test marathon/i });
    await searchBtn.click();

    await expect(page).toHaveURL(/\/events\/evt-test-001/);
  });
});

test.describe('RS-014 — Load more (AC6)', () => {
  test('Load more button appears when nextCursor is non-null', async ({ page }) => {
    let callCount = 0;
    await page.route('**/events*', (route) => {
      callCount++;
      if (callCount === 1) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            events: [
              { id: 'e1', name: 'Event 1', date: '2026-06-01', location: 'City A', createdAt: '2026-06-01T00:00:00Z' },
            ],
            nextCursor: 'cursor-abc',
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [
            { id: 'e2', name: 'Event 2', date: '2026-05-01', location: 'City B', createdAt: '2026-05-01T00:00:00Z' },
          ],
          nextCursor: null,
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByText('Event 1')).toBeVisible();

    const loadMoreBtn = page.getByRole('button', { name: /load more events/i });
    await expect(loadMoreBtn).toBeVisible();
    await loadMoreBtn.click();

    await expect(page.getByText('Event 2')).toBeVisible();
    await expect(loadMoreBtn).not.toBeVisible();
  });
});

test.describe('RS-014 — Responsive layout', () => {
  test('375px mobile — single column card grid', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.route('**/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [
            { id: 'e1', name: 'Run A', date: '2026-06-01', location: 'City A', createdAt: '2026-06-01T00:00:00Z' },
            { id: 'e2', name: 'Run B', date: '2026-05-01', location: 'City B', createdAt: '2026-05-01T00:00:00Z' },
          ],
          nextCursor: null,
        }),
      }),
    );

    await page.goto('/');
    await expect(page.getByText('Run A')).toBeVisible();
    await expect(page).toHaveScreenshot('homepage-mobile-375.png');
  });

  test('1280px desktop — three column card grid', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.route('**/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [
            { id: 'e1', name: 'Run A', date: '2026-06-01', location: 'City A', createdAt: '2026-06-01T00:00:00Z' },
            { id: 'e2', name: 'Run B', date: '2026-05-01', location: 'City B', createdAt: '2026-05-01T00:00:00Z' },
            { id: 'e3', name: 'Run C', date: '2026-04-01', location: 'City C', createdAt: '2026-04-01T00:00:00Z' },
          ],
          nextCursor: null,
        }),
      }),
    );

    await page.goto('/');
    await expect(page.getByText('Run A')).toBeVisible();
    await expect(page).toHaveScreenshot('homepage-desktop-1280.png');
  });
});
