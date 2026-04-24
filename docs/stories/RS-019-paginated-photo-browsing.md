# Story: Paginated photo browsing for runners — load more with photo counter
**ID**: RS-019
**Epic**: Search
**Status**: done
**Has UI**: yes

## Context
Journey 2 in PRODUCT_CONTEXT.md describes runners landing on the event search page via a
shared link or QR code. Currently the page shows nothing until a bib is entered, which
makes it feel empty and prevents photographers from sharing a link that showcases the full
event gallery. This story adds two complementary behaviours: (1) on page load — and
whenever the bib field is cleared — show all watermarked photos for the event using
cursor-based "Load more" pagination; (2) when a bib is searched, apply the same "Load
more" pattern to the bib results. Both modes display a "Showing X of Y photos" counter
so runners always know how many photos remain.

## Acceptance criteria

- [ ] **AC1 — All-event browse on page load**: Given a runner opens the event search page
  with no bib entered, when the page finishes loading, then the first page of watermarked
  photos (up to 24) is displayed in the grid, a "Showing X of Y photos" counter is visible,
  and a "Load more" button is shown if more photos exist beyond the first page.

- [ ] **AC2 — Load more appends photos**: Given the all-event grid is showing page 1,
  when the runner clicks "Load more", then the next 24 photos are appended below the
  existing photos (previously loaded photos remain visible), the counter updates to reflect
  the new total loaded, and the "Load more" button is hidden once all photos have been
  loaded.

- [ ] **AC3 — Bib search uses same load-more pattern**: Given a runner enters a bib
  number and submits, when the API returns results, then the grid is replaced with the
  bib results, a "Showing X of Y photos" counter reflects the total for that bib, and
  a "Load more" button is shown if the bib has more than 24 photos.

- [ ] **AC4 — Clear bib returns to all-event browse**: Given the bib search has returned
  results, when the runner clears the bib field (empties it and blurs, or clicks a clear
  button), then the grid resets and shows the all-event browse view from page 1 again.

- [ ] **AC5 — Only indexed watermarked photos are shown**: Given photos in various
  processing states exist for an event, when either browse mode fetches photos, then only
  photos with `status = "indexed"` and a valid `watermarkedS3Key` are included in results.
  Photos in `processing`, `watermarking`, `review_required`, or `error` states are never
  returned.

- [ ] **AC6 — Y reflects processed-so-far count**: Given processing is still running for
  an event, when photos are loading, then Y in "Showing X of Y photos" reflects only the
  count of fully indexed photos, not the total uploaded. The counter may grow as processing
  completes — this is expected and acceptable.

- [ ] **AC7 — Empty event state**: Given an event exists but has no indexed photos yet,
  when the runner opens the page, then an appropriate empty state is shown ("Photos are
  still processing — check back soon") rather than a blank grid.

- [ ] **AC8 — Latency target**: Given valid requests, when the all-event or bib browse
  endpoint is called, then the Lambda must respond within 500ms p99, consistent with the
  existing bib search latency target in PRODUCT_CONTEXT.md.

- [ ] **AC9 — Invalid cursor returns 400**: Given `GET /events/{id}/public-photos` is called
  with a `cursor` value that cannot be base64-decoded or has an unrecognised structure, when
  the Lambda handles the request, then it returns HTTP 400 with `{"error": "invalid cursor"}`
  and does not call DynamoDB.

- [ ] **AC10 — Event not found returns 404**: Given `GET /events/{id}/public-photos` is called
  with an event ID that does not exist in DynamoDB, when the Lambda handles the request, then
  it returns HTTP 404 with `{"error": "event not found"}`.

- [ ] **AC11 — DynamoDB error returns 500, raw error not exposed**: Given the DynamoDB
  `Query` fails with an internal error, when the Lambda handles the request, then it returns
  HTTP 500 with `{"error": "internal error"}` — the raw AWS error message is logged but never
  included in the response body.

## Out of scope
- Infinite scroll (scroll-triggered load) — "Load more" button only in this story
- Filtering or sorting photos (by time, bib, etc.)
- Photographer-side pagination (RS-008 covers that separately)
- Changing the existing bib search response shape for small result sets — if a bib has
  ≤ 24 photos, all are returned in the first response with no cursor, same as today
- Backfilling `photoCount` for events created before this story ships — counter starts
  from the deploy date; historical counts will be off until a backfill script is run
  (out of scope here, tracked separately)

## Tech notes

### New API route
- **Route**: `GET /events/{id}/public-photos?cursor=<token>&limit=24`
- **Auth**: none — public, unauthenticated (distinct from the authenticated `GET /events/{id}/photos` photographer endpoint)
- **Response**:
  ```json
  {
    "photos": [{ "photoId": "...", "watermarkedUrl": "...", "capturedAt": "..." }],
    "nextCursor": "<base64-opaque-token or null>",
    "totalCount": 312,
    "eventName": "...",
    "pricePerPhoto": 5.00,
    "currency": "GTQ"
  }
  ```
- `nextCursor` is a base64-encoded DynamoDB `LastEvaluatedKey`; null when no more pages
- `totalCount` is read from the `photoCount` field on the Event record (see below)
- `limit` query param: accepted 1–50; default 24; values outside range clamped/rejected

### Bib search response extension
- Extend the existing `GET /events/{id}/photos/search?bib=N` response to add:
  ```json
  { "nextCursor": null, "totalCount": 7, ... }
  ```
- For bib search, all photo IDs are fetched from the bib-index upfront (existing
  behaviour, capped at 500). `totalCount` = total IDs found. Pagination cursor
  is a base64-encoded integer offset into the sorted photo ID list.
- If total bib photos ≤ 24, `nextCursor` is null and no frontend "Load more" is shown.

### Lambda: `lambdas/list-public-event-photos/` (new module)
New self-contained Lambda module following the one-module-per-route convention. Handles
`GET /events/{id}/public-photos` only. Do not add this handler to `lambdas/search/`.

**New interface** (`handler/store.go`):
```go
type EventPhotoLister interface {
    ListEventPhotos(ctx context.Context, eventID, cursor string, limit int) ([]models.Photo, string, error)
    // returns (photos, nextCursor, error)
}
```

**DynamoDB access pattern**:
- Table: `racephotos-photos`
- GSI: `eventId-uploadedAt-index` (PK: `eventId`, SK: `uploadedAt`, ALL projection —
  already exists from RS-001)
- Operation: `Query` with `KeyConditionExpression: eventId = :eid`
- `FilterExpression: #status = :indexed` (items in other statuses are discarded after
  the query page is evaluated — DynamoDB `Limit` counts items before filter)
- `Limit`: set to `limit * 3` as a buffer to compensate for filtered-out items; loop
  until `limit` indexed items are collected or `LastEvaluatedKey` is exhausted
- `ExclusiveStartKey`: decoded from cursor param when present
- Returns next `LastEvaluatedKey` base64-encoded as `nextCursor`

**New env vars** (`RACEPHOTOS_` prefix, declared in `main.go`):
- `RACEPHOTOS_PHOTOS_TABLE` — required, DynamoDB photos table name
- `RACEPHOTOS_EVENTS_TABLE` — required, DynamoDB events table name (for `photoCount` read)
- `RACEPHOTOS_PHOTO_CDN_DOMAIN` — required, CloudFront domain for constructing `watermarkedUrl`

**CDK construct**: new `ListPublicEventPhotosConstruct` (or add to `photo-upload-construct.ts`
alongside `list-event-photos`) — register route `GET /events/{id}/public-photos` with no authorizer.
Grant `dynamodb:Query` on `racephotos-photos` and `dynamodb:GetItem` on `racephotos-events`.

### `photoCount` counter on Event record

**Model change** (`lambdas/shared/models/event.go`):
```go
PhotoCount int `dynamodbav:"photoCount,omitempty" json:"photoCount,omitempty"`
```

**Watermark Lambda** (`lambdas/watermark/`):
When a photo is transitioned to `status = "indexed"`, perform an atomic counter
increment on the events table:
```
UpdateItem(
  Key: { id: eventID },
  UpdateExpression: "ADD photoCount :one",
  ExpressionAttributeValues: { ":one": 1 }
)
```
- Watermark Lambda needs `dynamodb:UpdateItem` on `racephotos-events`
- Watermark Lambda needs `RACEPHOTOS_EVENTS_TABLE` env var injected (verify it exists
  in `WatermarkConstruct`; add it if missing)
- New interface in watermark Lambda:
```go
type EventCountUpdater interface {
    IncrementPhotoCount(ctx context.Context, eventID string) error
}
```

**CDK grant addition** (`infra/cdk/constructs/watermark-construct.ts`):
```typescript
eventsTable.grant(this.watermarkFn, 'dynamodb:UpdateItem');
```

**Idempotency guard**: The watermark Lambda is SQS-triggered with `maxReceiveCount: 3`.
A retry after `CompleteWatermark` succeeds but before `IncrementPhotoCount` completes would
double-increment the counter. Guard against this by reading the photo's current `status`
before calling `IncrementPhotoCount`: if `status != "watermarking"` (i.e. a prior attempt
already transitioned it to `indexed`/`review_required`), skip the increment and return
success. This check uses the `photo` value already fetched earlier in the handler — no extra
DynamoDB read required.

### Frontend: `frontend/angular/src/app/`

**NgRx state extension** (`store/runner-photos/`):
New actions:
- `loadEventPhotos({ eventId })` — triggered on page load and bib clear
- `loadEventPhotosSuccess({ photos, nextCursor, totalCount })` — replaces grid
- `loadEventPhotosFailure({ error })`
- `loadMoreEventPhotos({ eventId, cursor })` — "Load more" button click (all-event mode)
- `loadMoreEventPhotosSuccess({ photos, nextCursor })` — appends to grid
- `loadMoreBibPhotos({ eventId, bibNumber, cursor })` — "Load more" in bib mode
- `loadMoreBibPhotosSuccess({ photos, nextCursor })` — appends to grid

New state fields:
```typescript
nextCursor: string | null;
totalCount: number;
mode: 'all' | 'bib';  // drives which empty state / counter label to show
```

**Component changes** (`events/event-search/event-search.component.ts`):
- On init: dispatch `loadEventPhotos` (in addition to existing `loadEvent`)
- On bib clear (field empty + blur): dispatch `loadEventPhotos` + reset bib state
- On bib submit: dispatch `searchByBib` as today (mode switches to `'bib'`)
- "Load more" button wired to `loadMoreEventPhotos` or `loadMoreBibPhotos` depending
  on `mode`

**"Showing X of Y" label** (template):
```html
<p class="results-count">
  Showing {{ photos().length }} of {{ totalCount() }} photos
  @if (mode() === 'bib') { for bib <strong>{{ searchedBib() }}</strong> }
</p>
```

**Storybook stories to add/update**:
- `event-search.component.stories.ts` — add stories for: all-event browse (loaded state
  with photos + counter), empty state (no indexed photos yet, AC7 message), load-more
  visible state, bib results with counter, loading skeleton
- No new components are introduced — all changes are to the existing `event-search`
  component and NgRx state

### ADR dependency
- ADR-0003 (bib fan-out table) — resolved, already built in RS-009; referenced for
  the bib-pagination cursor design
- ADR-0012 (public photo browsing — `photoCount` counter and fill-to-limit pagination
  loop) — documents the denormalized counter design and why the fill-to-limit loop is
  appropriate here but was declined for RS-014
- No open decisions from PRODUCT_CONTEXT.md block this story

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

### UI stories only (skip if Has UI: no)
- [ ] Angular component compiles with `ng build --aot` (zero errors, zero warnings)
- [ ] Angular unit tests pass (`ng test --watch=false --code-coverage`)
  - Component logic: >80% line coverage
- [ ] Storybook story written for every new component (`*.stories.ts`)
- [ ] `npx storybook build` passes (no broken renders)
- [ ] Playwright E2E test written covering all acceptance criteria
- [ ] Playwright test passes against local dev server (`npx playwright test`)
- [ ] Playwright screenshot snapshot committed (visual baseline)
- [ ] Responsive layout verified at 375px (mobile) and 1280px (desktop) via Playwright
