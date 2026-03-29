# Story: Photographer views event photos gallery

**ID**: RS-008
**Epic**: Photo Upload / Frontend
**Status**: ready
**Has UI**: yes

## Context

After photos are uploaded and processed (RS-006, RS-007), the photographer needs to see all photos for a specific event grouped by status, so they can verify processing worked and spot photos needing attention. This gallery is the photographer's primary operational view per event (Journey 1, steps 5–6).

## Acceptance criteria

- [ ] AC1: Given `GET /events/{id}/photos` is called with a valid Cognito JWT, when the caller owns the event, then paginated photo records are returned sorted by `uploadedAt` DESC: `{ photos: [{id, status, watermarkedS3Key, bibNumbers, uploadedAt}], nextCursor }`. Returns 403 if not the owner.
- [ ] AC2: Given an optional `?status=` query parameter is provided, when the Lambda processes the request, then only photos matching that status are returned.
- [ ] AC3: Given a photographer visits `/photographer/events/{id}/photos`, when the page loads, then a photo grid is shown with watermarked thumbnails (using CloudFront processed bucket URL) or a placeholder icon for photos not yet watermarked.
- [ ] AC4: Given photos are shown in the grid, then each photo displays a colour-coded status badge: green=indexed, amber=review_required, red=error, grey=uploading/processing.
- [ ] AC5: Given filter chips are shown (All / Indexed / Review Required / Error / Processing), when a chip is selected, then the grid re-fetches with the corresponding `?status=` filter.
- [ ] AC6: Given more photos exist beyond the current page, then a "Load more" button triggers the next page fetch using the `nextCursor` value.
- [ ] AC7: Given a photo has `status=error`, then its card shows an "Error" badge and a tooltip or description with the failure reason (if available in the Photo record).

## Out of scope

- Manual bib tagging from this page (RS-013 — review queue tab)
- Purchase status per photo (RS-011)

## Tech notes

- New Lambda module: `lambdas/list-event-photos/`
  - Route: `GET /events/{id}/photos`, Cognito JWT required
  - Query params: `?status=&cursor=&limit=` (default limit: 50)
- Interface:
  ```go
  type PhotoStore interface {
      ListPhotosByEvent(ctx context.Context, eventID string, status string, cursor string, limit int) ([]models.Photo, string, error)
  }
  ```
- DynamoDB access pattern: Query `eventId-uploadedAt-index` GSI (PK=`eventId`, SK=`uploadedAt` DESC), filter by `status` if provided, cursor-based pagination using base64-encoded `LastEvaluatedKey`
- API response must never include `rawS3Key` — that field is internal only (domain rule 7)
- CloudFront URL construction: `https://{photoCdnDomain}/{watermarkedS3Key}` — `photoCdnDomain` injected via env var from `PhotoStorageConstruct` output; Angular constructs the full thumbnail URL client-side
- New env vars:
  ```
  RACEPHOTOS_ENV              required — "local"|"dev"|"qa"|"staging"|"prod"
  RACEPHOTOS_PHOTOS_TABLE     required — DynamoDB photos table name
  RACEPHOTOS_EVENTS_TABLE     required — DynamoDB events table name (ownership check)
  RACEPHOTOS_PHOTO_CDN_DOMAIN required — CloudFront domain for processed bucket
  ```
- CDK: add Lambda + route to `PhotoUploadConstruct` or new construct; `ObservabilityConstruct` wired; grant `dynamodb:Query` on photos table (GSI), `dynamodb:GetItem` on events table
- Angular:
  - `src/app/features/photographer/event-photos/event-photos.component.ts` — photo grid with Angular Material cards
  - Status badge colours driven by a pure pipe `PhotoStatusBadgePipe` mapping status string to CSS class
  - Filter chips use Angular Material `MatChipsModule`; selecting a chip dispatches `PhotosActions.filterByStatus({ status })`
  - "Load more" button dispatches `PhotosActions.loadNextPage({ cursor })` — appends to existing photos array in store rather than replacing it
  - NgRx slice: `store/photos/` — state shape: `{ photos: Photo[], nextCursor: string | null, activeFilter: string | null, loading: boolean, error: string | null }`
  - `AppConfigService` provides `photoCdnDomain` (injected from Angular environment at build time)
- `.env.example`: add `RACEPHOTOS_PHOTO_CDN_DOMAIN`

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
