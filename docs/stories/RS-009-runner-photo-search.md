# Story: Runner searches for photos by bib number

**ID**: RS-009
**Epic**: Search / Frontend
**Status**: ready
**Has UI**: yes

## Context

Runners discover their photos by entering their bib number on the event search page — no account required (Journey 2). The search queries the BibIndex table (created in RS-007) to find photos tagged with that bib number, then returns the watermarked preview URLs via CloudFront. A photo may appear in multiple runners' search results if it contains multiple bib numbers (ADR-0003).

## Acceptance criteria

- [ ] AC1: Given `GET /events/{id}/photos/search?bib={bibNumber}` is called (no auth), when matching BibIndex entries exist for that event+bib, then watermarked photo URLs (CloudFront) are returned along with event metadata: `{ photos: [{photoId, watermarkedUrl, capturedAt}], eventName, pricePerPhoto, currency }`. `rawS3Key` is never included in the response.
- [ ] AC2: Given no photos match the bib number, then `{ photos: [] }` is returned (not a 404).
- [ ] AC3: Given the event does not exist, then 404 is returned.
- [ ] AC4: Given only photos with `status=indexed` and a non-empty `watermarkedS3Key` are included in results, then processing/uploading/error photos are excluded from search results.
- [ ] AC5: Given a runner visits `/events/{id}`, when the page loads, then the event name, date, and location are shown along with a bib number search form.
- [ ] AC6: Given a runner enters a bib number and submits, when results are returned, then a photo grid shows watermarked thumbnails. Each photo shows the event price and a "Purchase" button.
- [ ] AC7: Given a runner clicks a photo, then a photo detail view shows a large watermarked preview, the price, and a prominent "Purchase this photo" button leading to the purchase flow (RS-010).
- [ ] AC8: Given no photos are found for the bib number, then an empty state message is shown: "No photos found for bib {bib}. Photos may still be processing — try again later."
- [ ] AC9: Given the page is viewed on mobile (375px), then the photo grid is single-column and the bib search form is full-width.

## Out of scope

- Pagination of search results (v1: return all matching photos — typically 5–20 per bib per event)
- Runner account / purchase history (purchase is by email only)

## Tech notes

- New Lambda module: `lambdas/search-photos/`
  - Route: `GET /events/{id}/photos/search`, no auth
  - Query params: `?bib=` (required)
- Interfaces:
  ```go
  type BibIndexStore interface {
      GetPhotoIDsByBib(ctx context.Context, eventID, bibNumber string) ([]string, error)
  }
  type PhotoStore interface {
      BatchGetPhotos(ctx context.Context, ids []string) ([]models.Photo, error)
  }
  type EventStore interface {
      GetEvent(ctx context.Context, id string) (*models.Event, error)
  }
  ```
- DynamoDB access: Query bib-index table PK=`{eventId}#{bibNumber}` → collect photoIds → `BatchGetItem` photos table → filter `status=indexed` + non-empty `watermarkedS3Key` in-memory
- CloudFront URL construction: `https://{RACEPHOTOS_PHOTO_CDN_DOMAIN}/{watermarkedS3Key}` — `rawS3Key` must never appear in any response body
- New env vars:
  ```
  RACEPHOTOS_ENV                required
  RACEPHOTOS_BIB_INDEX_TABLE    required — DynamoDB bib-index table name
  RACEPHOTOS_PHOTOS_TABLE       required — DynamoDB photos table name
  RACEPHOTOS_EVENTS_TABLE       required — DynamoDB events table name
  RACEPHOTOS_PHOTO_CDN_DOMAIN   required — CloudFront domain for watermarked photos
  ```
- CDK: attach to existing `SearchConstruct` (or create if not yet present); wire `ObservabilityConstruct`; no Cognito authorizer on this route
- Angular: public route `/events/:id` — no auth guard; `store/photos/` NgRx slice for search results; photo grid is a reusable read-only component (reused from RS-008 where applicable)
- ADR dependency: ADR-0003 (multi-bib photos show in multiple runners' results — already resolved)

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
