# Story: Add `in_progress` virtual status filter for pageable in-flight photo queries
**ID**: RS-018
**Epic**: Photo Processing
**Status**: ready
**Has UI**: yes

## Context
Photographers upload photos in bulk (hundreds to thousands per event) and need to see all in-flight photos in a single, pageable list while the processing pipeline runs. The list-event-photos API (RS-008) accepts a `?status=` filter, but `processing` and `watermarking` are two separate DynamoDB values — a client merging two independent paginated streams cannot produce a stable cursor or consistent sort order. This story introduces `in_progress` as a server-side query alias that expands to a DynamoDB `FilterExpression` matching both statuses in one request, keeping the internal status model unchanged while giving the frontend a pagination-safe filter.

## Acceptance criteria
- [ ] AC1: Given the list-event-photos API receives `?status=in_progress`, when the Lambda handles the request, then it returns photos whose DynamoDB `status` is either `processing` or `watermarking` in a single paginated response with a single cursor.
- [ ] AC2: Given `?status=in_progress` is requested, when the response is returned, then photos are ordered by `uploadedAt` descending (consistent with all other status filters) and the `nextCursor` can be passed to the next request to retrieve the following page correctly.
- [ ] AC3: Given `?status=in_progress` is requested with an invalid or missing event ID, when the Lambda handles the request, then it returns the same 400/403/404 responses as all other status filters (no special-casing).
- [ ] AC4: Given `in_progress` is NOT a real DynamoDB status value, when any Lambda writes a photo record, then no photo is ever written with `status = "in_progress"` — the value exists only as a query-time alias in list-event-photos.
- [ ] AC5: Given the photographer's event photos gallery loads, when the filter chip bar renders, then it shows exactly: All / In Progress / Indexed / Review Required / Error — in that order. The chip labeled "In Progress" sends `?status=in_progress`.
- [ ] AC6: Given a photo has `status = "processing"` or `status = "watermarking"`, when the photo card renders, then the status badge shows label "In Progress" (not "Processing" or "Finalizing") so the badge label is consistent with the filter chip label.
- [ ] AC7: Given the list-event-photos API receives an unrecognised `?status=` value, when the Lambda handles the request, then it returns 400 — `in_progress` must be explicitly added to the allowlist; no other unknown values are accepted.

## Out of scope
- Changing the DynamoDB status values stored by photo-processor or watermark Lambda — `processing` and `watermarking` remain the canonical stored values.
- Adding sorting or pagination UI controls (this story makes the API ready for them; the controls are a separate story).
- Exposing `uploading` as a filter option — it remains excluded as per RS-007.
- Server-sent events or polling for live status updates.

## Tech notes
- **Lambda**: `lambdas/list-event-photos/`
- **Interface to update**: `PhotoStore.ListPhotosByEvent(ctx, eventID, filter, cursor string, limit int)` — the `filter` parameter currently maps 1:1 to a DynamoDB `FilterExpression` value. The store implementation must detect `filter == "in_progress"` and build a compound expression: `#st = :processing OR #st = :watermarking` instead of `#st = :s`.
- **DynamoDB access pattern**: Query on `eventId-uploadedAt-index` GSI (defined in RS-001). For `in_progress`, `FilterExpression` becomes `#st = :p OR #st = :w` with `ExpressionAttributeValues` `:p = "processing"`, `:w = "watermarking"`. All other filters use the existing single-value expression. No GSI change required.
- **Handler change**: Add `"in_progress"` to `validStatuses` allowlist. Pass `filter` as-is to the store — the store owns the expansion logic, keeping the handler thin.
- **Frontend — filter chips** (`frontend/angular/src/app/features/photographer/event-photos/`): Replace the current chip list with `All / In Progress / Indexed / Review Required / Error`. The "In Progress" chip value must be `"in_progress"` (matched to the API parameter). Remove any separate "Processing" or "Finalizing" chips if present.
- **Frontend — badge pipe** (`photo-status-badge.pipe.ts`): Both `processing` and `watermarking` should map to `{ cssClass: 'badge--processing', icon: 'hourglass_top', label: 'In Progress' }`. The shimmer animation on `watermarking` photo cards (RS-017) is not affected — it is driven by `photo.status === 'watermarking'` in the template, independent of the badge label.
- **New env vars**: none.
- **Frontend — NgRx** (`frontend/angular/src/app/store/photos/photos.actions.ts`, `photos.reducer.ts`): `PhotoStatus` is currently used for both `Photo.status` (real DynamoDB values) and `PhotosState.activeFilter`. `in_progress` is a filter alias, not a storable status — adding it to `PhotoStatus` would allow `photo.status === 'in_progress'` which must never be true. Introduce a separate `PhotoStatusFilter = PhotoStatus | 'in_progress'` type. Change `FilterByStatus` action prop and `PhotosState.activeFilter` to `PhotoStatusFilter | null`. `Photo.status` remains typed as `PhotoStatus` (real values only).
- **Frontend — Storybook**: update `photo-status-badge.pipe.stories.ts` — add/update stories for `processing` and `watermarking` showing the new "In Progress" label. Update `event-photos.component.stories.ts` — replace the chip set stories to reflect the new All / In Progress / Indexed / Review Required / Error order. `photo-card.component.stories.ts` — update any story whose badge label was "Processing" or "Finalizing".
- **CDK construct**: `ProcessingPipelineConstruct` — no infrastructure change; Lambda code redeployment only.
- **ADR dependency**: none — the virtual filter alias pattern is a straightforward implementation detail, not an architectural decision requiring a new ADR.

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
