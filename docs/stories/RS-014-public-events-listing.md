# Story: Public events listing homepage

**ID**: RS-014
**Epic**: Search / Frontend
**Status**: done
**Has UI**: yes

## Context

Events are publicly listed on the homepage sorted by creation date (ADR-0004). Any visitor can browse all active events without an account, then click through to search for their photos. Archived events are excluded from the listing but remain accessible via direct link (P4 — see `docs/development-plan.md`). This is the primary discovery channel for runners who do not have a direct link from the photographer.

## Acceptance criteria

- [ ] AC1: Given `GET /events` is called (no auth), when active events exist, then paginated events are returned sorted by `createdAt` DESC: `{ events: [{id, name, date, location, createdAt}], nextCursor }`. Default page size: 20.
- [ ] AC2: Given `?cursor={cursor}` is provided, then the next page of results is returned from that cursor position.
- [ ] AC3: Given an event has `status` set to `"archived"`, then it is excluded from results. (The `archive-event` Lambda sets both `status="archived"` and `archivedAt` atomically; this Lambda filters only on `status` via the GSI.)
- [ ] AC4: Given no events exist, then `{ events: [], nextCursor: null }` is returned.
- [ ] AC5: Given a visitor opens the Angular app at `/`, when the page loads, then a list of event cards is shown, each displaying: event name, date, and location. Cards are sorted most recent first.
- [ ] AC6: Given more events exist beyond the current page, then a "Load more" button fetches the next page and appends cards to the existing list.
- [ ] AC7: Given no events are available, then an empty state message is shown: "No events listed yet. Check back soon."
- [ ] AC8: Given a visitor clicks an event card, then they are navigated to `/events/{id}` (the runner search page from RS-009).
- [ ] AC9: Given `?cursor=` contains a malformed or non-base64 value, then `400 Bad Request` is returned with `{ error: "invalid cursor" }`.
- [ ] AC10: Given a DynamoDB error occurs, then `500 Internal Server Error` is returned with `{ error: "internal error" }` — the raw error is never exposed.

## Out of scope

- Search/filter by date or location (v2 — ADR-0004 lists this in consequences but explicitly defers to v2)
- Event visibility toggle (v2 — ADR-0004 `visibility` field)
- Photographer name on event cards (photographer displayName not exposed publicly in v1)

## Tech notes

- New Lambda module: `lambdas/list-events/`
  - Route: `GET /events`, no auth
  - Query params: `?cursor=&limit=` (default 20, max 50)
- DynamoDB access: Query `status-createdAt-index` GSI on events table, PK=`"active"`, ScanIndexForward=false (most recent first), cursor-based pagination via base64 `LastEvaluatedKey`
- Note: "active" vs "archived" is tracked via the `status` field (set to `"archived"` by `archive-event` Lambda) — the GSI partition key is `status`, so archived events are simply not in the `status="active"` partition
- Interface:
  ```go
  type EventStore interface {
      ListActiveEvents(ctx context.Context, cursor string, limit int) ([]models.Event, string, error)
  }
  ```
- New env vars:
  ```
  RACEPHOTOS_ENV           required
  RACEPHOTOS_EVENTS_TABLE  required
  ```
- CDK: add to `EventConstruct` (from RS-005); no auth on this route; `ObservabilityConstruct` wired
- Angular: public route `/` — no auth guard; `store/events/` NgRx slice (reuse from RS-005, add `listPublicEvents` action); `EventCardComponent` (reusable, Storybook story required)
- No new `.env.example` keys (`RACEPHOTOS_EVENTS_TABLE` already added in RS-005)

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
