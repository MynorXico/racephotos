# Story: Event photos gallery — per-status photo counts on filter chips

**ID**: RS-016
**Epic**: Photo Upload
**Status**: draft
**Has UI**: yes

## Context

The photographer event photos gallery (RS-008) shows filter chips for All / Indexed / Review Required / Error / Processing but displays no photo counts on each chip. Showing counts (e.g. "Error (3)") gives photographers an at-a-glance view of how many photos need attention without having to select each filter. This is an incremental improvement to Journey 1, step 6 (photographer spots photos needing attention).

## Acceptance criteria

- [ ] AC1: Given `GET /events/{id}/photos` is called with a valid Cognito JWT, when the caller owns the event, then the response includes a `statusCounts` object: `{ all: number, indexed: number, review_required: number, error: number, processing: number }`.
- [ ] AC2: Given the event photos page loads, when `statusCounts` is returned by the API, then each filter chip displays its count in parentheses (e.g. "Error (3)"); the "All" chip shows the total photo count.
- [ ] AC3: Given a filter is active and photos are re-fetched, when the response returns, then `statusCounts` reflects the totals across all photos for the event (not just the current page).

## Out of scope

- Per-page status counts
- Real-time count updates via WebSocket or polling

## Tech notes

- Extend `GET /events/{id}/photos` Lambda (`lambdas/list-event-photos/`) to return `statusCounts` alongside the paginated photo list
- DynamoDB: run a parallel `Query` per status on `eventId-uploadedAt-index` GSI with `Select: COUNT`, or use a single scan with count aggregation — choose the cheaper pattern and document the decision
- Angular: update `PhotosState` to include `statusCounts: StatusCounts | null`; update filter chip template in `EventPhotosComponent` to render counts from state
- No new env vars required

## Definition of Done

### All stories

- [ ] Interface written before implementation
- [ ] Table-driven unit tests written before implementation
- [ ] Unit tests pass (`make test-unit`)
- [ ] Integration test written with `//go:build integration` tag
- [ ] Integration test passes against LocalStack (`make test-integration`)
- [ ] CDK construct updated and `cdk synth` passes
- [ ] `environments.example.ts` updated if new config key added
- [ ] `.env.example` updated if new env var added
- [ ] ADR written for any non-obvious architectural decision
- [ ] Story status set to `done`

### UI stories only

- [ ] Angular component compiles with `ng build --aot` (zero errors, zero warnings)
- [ ] Angular unit tests pass (`ng test --watch=false --code-coverage`)
  - Component logic: >80% line coverage
- [ ] Storybook story written for every new component (`*.stories.ts`)
- [ ] `npx storybook build` passes (no broken renders)
- [ ] Playwright E2E test written covering all acceptance criteria
- [ ] Playwright test passes against local dev server (`npx playwright test`)
- [ ] Playwright screenshot snapshot committed (visual baseline)
- [ ] Responsive layout verified at 375px (mobile) and 1280px (desktop) via Playwright
