# Story: Photographer manually tags bib numbers for undetected photos

**ID**: RS-013
**Epic**: Photo Processing / Frontend
**Status**: ready
**Has UI**: yes

## Context

When Rekognition fails to detect a bib number (photo has `status=review_required`) or processing fails entirely (`status=error`), the photographer manually tags the correct bib numbers from the review queue tab in their dashboard (Journey 1, steps 6–7). Manual tags are ground truth and override Rekognition output (domain rule 12). Rekognition is never re-called (domain rule 10).

## Acceptance criteria

- [ ] AC1: Given `PUT /photos/{id}/bibs` is called with a valid Cognito JWT and `{ bibNumbers: ["101", "102"] }`, when the caller owns the photo's event, then: the Photo record's `bibNumbers` is overwritten; `status` is updated to `"indexed"` if `bibNumbers` is non-empty, otherwise remains `"review_required"`; all existing BibIndex entries for this `photoId` are deleted (query `photoId-index` GSI, batch delete); new BibIndex entries are written for each bib (`PK={eventId}#{bib}`, `SK=photoId`). Returns the updated Photo.
- [ ] AC2: Given the caller does not own the photo's event, then 403 is returned.
- [ ] AC3: Given `bibNumbers` contains empty strings or whitespace-only strings, then a 400 error is returned.
- [ ] AC4: Given a photographer visits `/photographer/dashboard/review`, then a grid of photos with `status=review_required` or `status=error` is shown, fetched via the existing `GET /events/{id}/photos?status=` endpoint (RS-008 Lambda, filtered client-side by event or via a combined query).
- [ ] AC5: Given a `review_required` photo is shown, then: the watermarked thumbnail is displayed; current `bibNumbers` are shown as chips; a tag input field allows entering one or more bib numbers (comma-separated or Enter-to-add); a "Save" button calls `PUT /photos/{id}/bibs`.
- [ ] AC6: Given a photographer saves bib numbers successfully, then the photo card updates to show `status=indexed` and moves out of the queue on next refresh.
- [ ] AC7: Given an `error` photo is shown, then it displays an "Error" badge and the message "Processing failed — assign bibs manually or leave for review."
- [ ] AC8: Given the review queue is empty, then a success state is shown: "All photos have been processed. Nothing to review."

## Out of scope

- Re-running Rekognition (domain rule 10 — called exactly once)
- Bulk tagging via CSV import (v2)
- Tagging from the event photos gallery (RS-008) — that page is read-only

## Tech notes

- New Lambda module: `lambdas/tag-photo-bibs/`
  - Route: `PUT /photos/{id}/bibs`, Cognito JWT required
- Ownership check: GetItem Photo → GetItem Event → verify `event.photographerId = JWT sub`
- BibIndex retag sequence (must be atomic in intent; DynamoDB has no multi-table transactions across tables but order matters):
  1. Query `photoId-index` GSI on bib-index table → get all existing BibKeys for this photoId
  2. BatchWriteItem: delete all old entries
  3. BatchWriteItem: write new entries
  4. UpdateItem: Photo record (bibNumbers, status)
  - Note: if step 3/4 fails after step 2, the photo may temporarily have no BibIndex entries. The Lambda must be idempotent — a retry re-runs all four steps.
- Interface:
  ```go
  type PhotoStore interface {
      GetPhoto(ctx context.Context, id string) (*models.Photo, error)
      UpdatePhotoBibs(ctx context.Context, id string, bibNumbers []string, status string) error
  }
  type BibIndexStore interface {
      DeleteBibEntriesByPhoto(ctx context.Context, photoID string) error
      WriteBibEntries(ctx context.Context, entries []models.BibEntry) error
  }
  type EventStore interface {
      GetEvent(ctx context.Context, id string) (*models.Event, error)
  }
  ```
- New env vars:
  ```
  RACEPHOTOS_ENV              required
  RACEPHOTOS_PHOTOS_TABLE     required
  RACEPHOTOS_BIB_INDEX_TABLE  required
  RACEPHOTOS_EVENTS_TABLE     required
  ```
- CDK: add to existing construct; `ObservabilityConstruct` wired; IAM: photos table (GetItem + UpdateItem), bib-index table (Query + BatchWriteItem), events table (GetItem)
- Angular: `/photographer/dashboard/review` tab within photographer dashboard; review queue fetches photos using RS-008 Lambda filtered by `status=review_required,error`; `store/photos/` NgRx updates on save

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
