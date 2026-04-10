# Story: Add `watermarking` status so `indexed` always means fully ready to view

**ID**: RS-017
**Epic**: Photo Processing
**Status**: done
**Has UI**: yes

## Context

After Rekognition completes, photo-processor sets a photo's status to `indexed` and
enqueues a watermark job. The watermark Lambda then applies the overlay, uploads the
processed copy, and writes `watermarkedS3Key` to DynamoDB — but this second step takes
additional time. During that window, the photographer's gallery (RS-008) shows photos
as `indexed` with no `thumbnailUrl`, which looks like a failure to the photographer.
Introducing a `watermarking` intermediate status removes the ambiguity: `indexed` will
always mean the watermarked preview is available and the photo is ready for runners to
discover (Journey 1, PRODUCT_CONTEXT.md §Core user journeys).

## Acceptance criteria

- [ ] AC1: Given a photo has been processed by Rekognition (whether bib numbers were
  detected or not), when the photo-processor Lambda sends it to the watermark queue, then
  the photo's status is set to `watermarking` and `watermarkedS3Key` is absent from the
  record — this applies to both the `indexed` path (bibs detected) and the `review_required`
  path (no confident bibs), since the watermark Lambda processes every photo regardless of
  detection outcome.

- [ ] AC2: Given a photo has status `watermarking`, when the watermark Lambda successfully
  uploads the processed copy and updates DynamoDB in a single atomic write, then
  `watermarkedS3Key` is populated and status is set to either `indexed` (bibs were detected)
  or `review_required` (no confident bibs) — the final status is determined by the
  `WatermarkMessage` payload, not re-derived. Every `indexed` or `review_required` photo is
  guaranteed to have a non-empty `watermarkedS3Key`.

- [ ] AC3: Given a photo has status `watermarking`, when the photographer views the event
  gallery, then the photo card shows a processing shimmer (not a "thumbnail unavailable"
  placeholder) so the photographer understands the photo is still being finalized.

- [ ] AC4: Given the photographer opens the status filter chip bar, then `watermarking` is
  not offered as a selectable filter option — it is a transient internal state not intended
  for manual filtering.

- [ ] AC5: Given a watermark job fails all three SQS delivery attempts, when the message
  lands in the DLQ, then the photo's status remains `watermarking` and the photo appears
  in the unfiltered gallery view (no status chip selected) — the CloudWatch alarm on the
  watermark DLQ alerts the operator, and the photographer sees the photo card in its
  "Finalizing watermark…" shimmer state indicating it has not yet completed processing.

- [ ] AC6: Given a photo has status `watermarking`, when the `GET /events/{id}/photos`
  API is called, then the response includes the photo with `status: "watermarking"` and
  `thumbnailUrl: null`.

## Out of scope

- Changing the watermark rendering logic or font (covered by ADR-0009)
- Auto-retry of failed watermark jobs beyond the existing DLQ + maxReceiveCount: 3 pattern
- Exposing `watermarking` as a filter option in the runner-facing search (runners never
  see unprocessed photos — search only returns `indexed` photos with a `watermarkedS3Key`)
- Migrating existing `indexed` records that currently lack `watermarkedS3Key` (those are
  orphan DLQ cases; handle separately via a backfill script if needed)

## Tech notes

- **Lambdas**:
  - `lambdas/photo-processor/` — change the DynamoDB write that currently sets
    `status = "indexed"` or `status = "review_required"` to `status = "watermarking"` before
    enqueuing the watermark message (both bib-detected and no-bib-detected paths send to the
    watermark queue — see `driveDownstream`, line ~216: *"regardless of bib detection outcome"*).
    The final status (`indexed` or `review_required`) is written by the watermark Lambda after
    the watermarked copy is uploaded; it must include the detected bib numbers and confidence
    from the photo-processor output (passed via the WatermarkMessage or read from DynamoDB).
    **Idempotency:** the existing redelivery switch must add `"watermarking"` so that an SQS
    retry after a crash between the DynamoDB write and the queue send does not re-invoke
    Rekognition (domain rule 10):
    ```go
    case "indexed", "review_required", "watermarking":
        // skip Rekognition, re-drive downstream
    ```
  - `lambdas/watermark/` — after a successful `PutObject`, replace the separate
    `UpdateWatermarkedKey` call with a single atomic `UpdateItem` that sets both
    `watermarkedS3Key` and `status` in one expression:
    `SET watermarkedS3Key = :key, #st = :finalStatus`. This prevents a partial state
    (key written, status still `watermarking`) if the Lambda crashes between two writes.
    The final status value (`indexed` or `review_required`) must be included in the
    `WatermarkMessage` struct so the watermark Lambda does not need to re-query DynamoDB
    to determine it.

- **Shared model** (`lambdas/shared/models/photo.go`):
  - Add `"watermarking"` to the status comment block. No struct field change needed — status
    is a plain `string`.

- **Interface(s) to implement**:
  - `lambdas/shared/models/watermark_message.go` (or `photo.go`) — add `FinalStatus string`
    field to `WatermarkMessage` so the watermark Lambda knows whether to write `indexed` or
    `review_required` without a second DynamoDB read.
  - `lambdas/watermark/handler/PhotoStore` — replace `UpdateWatermarkedKey(ctx, photoId, key string) error`
    with `CompleteWatermark(ctx, photoId, watermarkedS3Key, finalStatus string) error` that
    issues the single atomic `UpdateItem` described above.
  - `lambdas/photo-processor/handler/PhotoStore` — `UpdatePhotoStatus` already accepts
    a `models.PhotoStatusUpdate` struct; `watermarking` is a new valid status value it
    must be able to write (no interface change, just a new string constant).

- **DynamoDB access pattern**:
  - watermark Lambda: single atomic `UpdateItem` on `racephotos-photos` PK=`id`,
    expression `SET watermarkedS3Key = :key, #st = :finalStatus` with
    `ConditionExpression: attribute_exists(id)`. Both fields written together — no
    intermediate partial state possible.
  - No GSI change needed — `eventId-uploadedAt-index` already projects `status` and
    `watermarkedS3Key` (INCLUDE projection, `database-construct.ts` line ~107).

- **Frontend** (`frontend/angular/`):
  - `photos.actions.ts` — add `"watermarking"` to the `PhotoStatus` union type.
  - `list-event-photos` handler (`handler.go`) — add `"watermarking"` to `validStatuses`
    so that `?status=watermarking` returns 200 (not 400). This lets operators query stuck
    photos via the API. The Angular chip bar does not expose this filter (AC4).
  - `photo-card` component — when `photo.status === 'watermarking'` (thumbnailUrl is
    always null in this state), render the existing shimmer skeleton with an accessible
    label such as `"Finalizing watermark…"` instead of the "Thumbnail not available"
    placeholder.
  - `event-photos` component — do not render a `watermarking` filter chip.
  - Update Storybook stories and Playwright E2E tests for the new card state.

- **New env vars**: none

- **CDK construct to update**: none — no infrastructure change required; this is a
  code-only status transition change.

- **ADR dependency**: none — all open decisions in PRODUCT_CONTEXT.md are unrelated to
  this story. ADR-0009 (watermark library) is relevant background but requires no
  revision.

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
