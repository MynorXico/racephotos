# QA Plan: RS-018 — Add `in_progress` virtual status filter

## Scope

**Lambda**: `lambdas/list-event-photos/` — `handler.go`, `store.go`
**Frontend**: `photo-status-badge.pipe.ts`, `event-photos.component.ts`, `photos.actions.ts`, `photos.reducer.ts`, `photos.effects.ts`
**Endpoint**: `GET /events/{id}/photos?status=in_progress[&cursor=...][&limit=...]`

---

## Test cases

### TC-001: `in_progress` filter — store receives raw alias string, not expanded values

**Category**: Input validation
**Setup**: Event owned by photographer-1 exists. Two photos: one with `status=processing`, one with `status=watermarking`.
**Action**: `GET /events/{id}/photos?status=in_progress` with valid Cognito JWT for photographer-1.
**Expected**: Handler passes the literal string `"in_progress"` to `ListPhotosByEvent` (store owns expansion). Handler does NOT build the compound expression itself. Response is 200 with both photos, each carrying their real `status` value (`"processing"` or `"watermarking"`) — not the string `"in_progress"`.
**Why it matters**: If the handler ever leaks `"in_progress"` into `Photo.status` in the response, the frontend `PhotoStatus` type contract is violated and the badge pipe falls back to the default instead of resolving properly.

---

### TC-002: `in_progress` must NOT appear in any photo's `status` field in the API response

**Category**: State machine / Input validation
**Setup**: Call `GET /events/{id}/photos?status=in_progress` against an event with multiple in-flight photos.
**Action**: Inspect every item in the `photos` array of the response.
**Expected**: No item has `status === "in_progress"`. Each item has `status` equal to either `"processing"` or `"watermarking"`.
**Why it matters**: AC4 — `in_progress` is a query-time alias only. If it leaked into response bodies, any downstream code comparing `photo.status === 'processing'` for shimmer animation (RS-017) would silently break.

---

### TC-003: `in_progress` combined with pagination — cursor crosses a processing/watermarking boundary

**Category**: Boundary values / Pagination
**Setup**: Event with 6 photos: 3 `processing` (oldest uploadedAt), 3 `watermarking` (newest uploadedAt), all seeded in DynamoDB with distinct `uploadedAt` timestamps.
**Action**: `GET /events/{id}/photos?status=in_progress&limit=4`. Then use the returned `nextCursor` in a second call: `GET /events/{id}/photos?status=in_progress&limit=4&cursor={nextCursor}`.
**Expected**: Page 1 returns 4 photos (mix of statuses, sorted `uploadedAt` DESC). Page 2 returns the remaining 2 photos, `nextCursor` is empty. No photo appears on both pages. Total unique IDs = 6.
**Why it matters**: The core motivation of RS-018 is a stable single-cursor paginated stream across both statuses. A bug in cursor re-encoding (store always uses `lastKey` position rather than position of last returned item when `len(photos) == limit`) could skip or duplicate items at page boundaries.

---

### TC-004: `in_progress` with `limit=1` — single-item page from compound filter

**Category**: Boundary values
**Setup**: Event with at least 2 in-progress photos (one `processing`, one `watermarking`).
**Action**: `GET /events/{id}/photos?status=in_progress&limit=1`.
**Expected**: 200, exactly 1 photo in `photos` array, `nextCursor` is non-empty. Fetching the second page with that cursor returns 1 photo, `nextCursor` empty. Both photos together match the full in-progress set.
**Why it matters**: The store's filter loop recalculates `remaining * filterMultiplier` each iteration. With `limit=1` and `filterMultiplier=5`, the internal DynamoDB `Limit` is 5 per round. If the first evaluated page yields 0 matching items the loop iterates again correctly — but the cursor must point to the last *returned* item, not the last *evaluated* item, or page 2 may re-return the first item.

---

### TC-005: `in_progress` with `limit=200` (maximum allowed) — no crash, no truncation below available count

**Category**: Boundary values
**Setup**: Event with 150 photos split between `processing` and `watermarking`.
**Action**: `GET /events/{id}/photos?status=in_progress&limit=200`.
**Expected**: 200, all 150 photos returned (fewer than the requested limit), `nextCursor` empty.
**Why it matters**: `internalLimit = limit * filterMultiplier` = `200 * 5 = 1000`. This is an int32 value passed to DynamoDB. Verify it does not overflow or trip a DynamoDB validation limit on `Limit`.

---

### TC-006: `in_progress` with `limit=201` — rejected at handler level

**Category**: Input validation / Boundary values
**Setup**: Any valid event.
**Action**: `GET /events/{id}/photos?status=in_progress&limit=201` with valid JWT.
**Expected**: The handler's limit guard `l > 0 && l <= 200` rejects 201 silently by falling back to `defaultPageSize=50`, not by returning 400. Confirm the effective page size is 50 (not 201 or 0).
**Why it matters**: This is not a validation error — the handler silently clamps. A developer may expect 400. Confirm the documented behavior is intentional, and that the fallback of 50 is applied (not 0, which would cause `limit*filterMultiplier = 0` and a DynamoDB `ValidationException`).

---

### TC-007: `in_progress` filter when ALL photos in event are `processing` or `watermarking` — no mixed-status contamination

**Category**: State machine
**Setup**: Event with 10 photos, all `processing`. No `indexed`, `error`, or `review_required` photos.
**Action**: `GET /events/{id}/photos?status=in_progress`.
**Expected**: 200, all 10 photos returned, each with `status=processing`.
**Why it matters**: The compound FilterExpression `#st = :sp OR #st = :sw` must not accidentally match other status values due to expression attribute value collision with any previous single-status `:status` key.

---

### TC-008: `in_progress` filter when NO photos match — empty result, not 404

**Category**: Boundary values / Pagination
**Setup**: Event exists and is owned by the caller. All photos have `status=indexed`.
**Action**: `GET /events/{id}/photos?status=in_progress`.
**Expected**: 200 with `{"photos": [], "nextCursor": ""}`. Not 404. `photos` is an array (not `null`).
**Why it matters**: The store's loop exits after `maxFilterIterations=10` rounds if no items match. `lastKey` from the last DynamoDB response is non-empty (DynamoDB continued scanning), yet `photos` is empty. The cursor encoding branch `if len(lastKey) > 0` is entered but `len(photos) == 0`, so it falls through to `cursorKey = lastKey` — the caller gets a non-empty cursor pointing to the DynamoDB scan position, but with zero results on this page. This may surprise callers who assume an empty page implies no more data.

---

### TC-009: cursor generated from an `in_progress` request used on a non-`in_progress` request

**Category**: State machine / Input validation
**Setup**: Obtain a valid `nextCursor` from `GET /events/{id}/photos?status=in_progress&limit=1`.
**Action**: `GET /events/{id}/photos?status=indexed&cursor={cursor_from_in_progress}`.
**Expected**: 200 or 400 (cursor validation only checks `eventId` match, not filter match). Verify no 500 and no data from a different event leaks. Document the actual behavior — the cursor is structurally valid, so DynamoDB will resume scanning from that position, but it is semantically mismatched.
**Why it matters**: There is no filter encoded in the cursor. A cursor from one filter context is structurally accepted on a different filter. This is not a bug per the current design, but it means a frontend bug (reusing the wrong cursor) would not surface as an error — instead, silently returning incorrect results.

---

### TC-010: cursor with tampered `eventId` — returns 400, not data from another event

**Category**: Authorization
**Setup**: Two events owned by the same photographer. Obtain a valid cursor from event A.
**Action**: Decode the cursor, replace `eventId` with event B's ID, re-encode (valid base64), supply as `cursor` in a request for event B.
**Expected**: 400, `{"error": "invalid cursor"}`. The `decodeCursor` eventId validation catches the mismatch before DynamoDB is called.
**Why it matters**: This path existed before RS-018 but is especially important now that `in_progress` generates cursors that combine two internal status values. A tampered cursor must never cause cross-event data exposure.

---

### TC-011: cursor with missing `uploadedAt` field — returns 400

**Category**: Input validation
**Setup**: Manually construct a base64 JSON cursor containing only `id` and `eventId`, omitting `uploadedAt`.
**Action**: `GET /events/{id}/photos?cursor={malformed_cursor}`.
**Expected**: DynamoDB rejects the `ExclusiveStartKey` because it is missing the GSI sort key; the store wraps this as a DynamoDB error (not `ErrInvalidCursor`), and the handler returns 500. Or the store catches it as an invalid cursor and returns 400.
**Why it matters**: `decodeCursor` validates the `eventId` field but does NOT validate the presence of `uploadedAt` or `id`. A partial cursor will pass handler validation and reach DynamoDB, which will return a `ValidationException`. Confirm the 500 vs 400 behavior is intentional and logged.

---

### TC-012: `status=IN_PROGRESS` (uppercase) — rejected with 400

**Category**: Input validation
**Setup**: Valid event, valid JWT.
**Action**: `GET /events/{id}/photos?status=IN_PROGRESS`.
**Expected**: 400, `{"error": "invalid status filter"}`. The `validStatuses` map is case-sensitive; `"IN_PROGRESS"` is not in it.
**Why it matters**: Confirms the allowlist is not case-folded. AC7 explicitly states only `in_progress` (exact string) is accepted.

---

### TC-013: `status=in_progress%20` (trailing space, URL-encoded) — rejected with 400

**Category**: Input validation
**Setup**: Valid event, valid JWT.
**Action**: `GET /events/{id}/photos?status=in_progress%20`.
**Expected**: 400. API Gateway decodes the query string before Lambda receives it; `"in_progress "` (with trailing space) is not in `validStatuses`.
**Why it matters**: Catch clients that accidentally append whitespace to the filter value.

---

### TC-014: `status=processing` and `status=watermarking` still accepted individually (not removed from allowlist)

**Category**: Input validation / State machine
**Setup**: Valid event with one `processing` photo and one `watermarking` photo.
**Action (a)**: `GET /events/{id}/photos?status=processing` — expect 200 with only the `processing` photo.
**Action (b)**: `GET /events/{id}/photos?status=watermarking` — expect 200 with only the `watermarking` photo.
**Expected**: Both return 200 with the correctly filtered single photo. The comment in the handler source says these remain valid "for operator/debugging use."
**Why it matters**: AC5 describes removing "Processing" as a *frontend chip*, not as an API parameter. Confirm the handler allowlist was not over-aggressively trimmed.

---

### TC-015: `status=uploading` — rejected with 400

**Category**: Input validation
**Setup**: Valid event, valid JWT.
**Action**: `GET /events/{id}/photos?status=uploading`.
**Expected**: 400. `uploading` is intentionally excluded per the story (RS-007 scope boundary).
**Why it matters**: Confirm `uploading` was not accidentally included when `in_progress` was added to `validStatuses`.

---

### TC-016: `maxFilterIterations` cap — partial page plus cursor when no items match across 10 rounds

**Category**: Failure injection / Boundary values
**Setup**: Event with 1000 photos all `indexed`. Caller requests `?status=in_progress`.
**Action**: `GET /events/{id}/photos?status=in_progress`.
**Expected**: After 10 DynamoDB Query rounds (consuming up to `50*5*10 = 2500` RCUs), the store returns `photos=[]` and a non-empty `nextCursor` derived from `lastKey` (since `len(photos)==0`, the `else` branch sets `cursorKey = lastKey`). The handler returns 200 with an empty `photos` array and a non-empty cursor.
**Why it matters**: A caller who checks `nextCursor != ""` to decide whether to paginate would enter an infinite loop, fetching empty pages forever. This is a design-level risk the developer should evaluate and document.

---

### TC-017: `maxFilterIterations` cap at exactly 10 iterations — verify the loop breaks on `iter == 10`, not `iter > 10`

**Category**: Boundary values
**Setup**: Unit-level — mock DynamoDB to always return 0 matching items but a non-empty `LastEvaluatedKey`.
**Action**: Call `store.ListPhotosByEvent(ctx, eventID, "in_progress", "", 50)` against the mock.
**Expected**: DynamoDB `Query` is called exactly 10 times (iterations 0–9). On iteration 10, the `if filter != "" && iter >= maxFilterIterations { break }` guard fires before the query.
**Why it matters**: An off-by-one (`iter > maxFilterIterations`) would allow 11 rounds, burning extra RCUs silently. Verify with a mock that counts calls.

---

### TC-018: `filterByStatus` dispatched with `status=null` (All chip) — no `?status=` parameter sent to API

**Category**: Input validation / Frontend
**Setup**: Component mounted with event-1, `activeFilter = 'in_progress'`.
**Action**: User clicks the "All" chip, which calls `onFilterChip(null)`.
**Expected**: `FilterByStatus` action dispatched with `status: null`. Reducer sets `activeFilter: null`. Effect dispatches `LoadPhotos`. HTTP GET is issued WITHOUT a `?status=` query parameter (not with `?status=null` or `?status=`).
**Why it matters**: The `loadPhotos$` effect uses `if (filter)` to gate appending the param, but `filter` comes from `selectActiveFilter` state. If `activeFilter` is ever set to the string `"null"` instead of the TypeScript `null`, the API receives `?status=null`, which the Lambda rejects with 400.

---

### TC-019: rapid filter chip switching — stale `loadNextPage` response does not corrupt fresh filter results

**Category**: Concurrency / Frontend
**Setup**: Active filter is `in_progress`. A `loadNextPage` HTTP request is in flight (slow network).
**Action**: User clicks the "Error" chip before the in-flight request completes.
**Expected**: The `takeUntil(actions$.pipe(ofType(loadPhotos, filterByStatus)))` operator cancels the in-flight `loadNextPage` Observable. When the new `error`-filtered response arrives, the `photos` array contains only `error` photos — no `processing` or `watermarking` items from the cancelled page.
**Why it matters**: Without `takeUntil`, the stale `loadNextPageSuccess` could be dispatched after `filterByStatus` resets the list, appending wrong-filter items. The operator is present in the code but not covered by the existing unit tests — a timing-sensitive scenario.

---

### TC-020: `filterByStatus` effect dispatches `loadPhotos` — not `loadNextPage`

**Category**: State machine / Frontend
**Setup**: Component with photos loaded, `nextCursor` non-null, `activeFilter=null`.
**Action**: Dispatch `PhotosActions.filterByStatus({ eventId: 'event-1', status: 'in_progress' })`.
**Expected**: The `filterByStatus$` effect emits exactly `PhotosActions.loadPhotos({ eventId: 'event-1' })`. The reducer (which handles `filterByStatus` synchronously) resets `photos=[]` and `nextCursor=null` before `loadPhotos` fires. The HTTP GET does NOT carry the old cursor.
**Why it matters**: If the effect mistakenly mapped to `loadNextPage` (using the stale cursor in state), the first page of `in_progress` results would be skipped, and the response would be appended rather than replacing the list.

---

### TC-021: `in_progress` chip sends exact string `"in_progress"` to the API, not `"in progress"` or `"inProgress"`

**Category**: Input validation / Frontend
**Setup**: Capture HTTP traffic (e.g. Angular `HttpTestingController`).
**Action**: Click the "In Progress" chip.
**Expected**: HTTP request URL contains `status=in_progress` (underscore, lowercase). The chip definition in `filterChips` is `value: 'in_progress'`.
**Why it matters**: A copy-paste error changing underscore to space or using camelCase would reach the Lambda and be rejected with 400. The chip value and the API allowlist must match exactly.

---

### TC-022: badge pipe — `status='in_progress'` passed as input returns fallback, not a crash

**Category**: Input validation / Frontend
**Setup**: Instantiate `PhotoStatusBadgePipe`.
**Action**: `pipe.transform('in_progress')`.
**Expected**: Returns `FALLBACK` (the `processing` badge config). Does NOT throw. `in_progress` is not in `BADGE_MAP`, which is typed as `Record<PhotoStatus, BadgeConfig>` (not `PhotoStatusFilter`).
**Why it matters**: Although `Photo.status` is typed as `PhotoStatus` (never `in_progress`) at compile time, the pipe's signature is `transform(status: string)`. Any future JSON deserialization bug or API contract violation that sets `photo.status = 'in_progress'` must not crash the template. Confirm the fallback fires silently and does not produce an `undefined` access.

---

### TC-023: badge pipe — both `processing` and `watermarking` use `badge--processing` CSS class, not a new `badge--watermarking` class

**Category**: Input validation / Frontend
**Setup**: Inspect `BADGE_MAP` in `photo-status-badge.pipe.ts`.
**Action**: `pipe.transform('watermarking')`.
**Expected**: `cssClass === 'badge--processing'`. If a `badge--watermarking` CSS class was accidentally introduced in the stylesheet but not the pipe (or vice versa), the badge would render without its styling.
**Why it matters**: Pre-RS-018, `watermarking` may have had a distinct CSS class (`badge--watermarking` or `badge--finalizing`). Confirm the old class was removed from the stylesheet and no orphan rule exists.

---

### TC-024: shimmer animation is NOT controlled by the badge label — remains driven by `photo.status === 'watermarking'`

**Category**: State machine / Frontend
**Setup**: Render a photo card with `status='watermarking'` and a separate card with `status='processing'`.
**Action**: Inspect the rendered DOM for the shimmer CSS class.
**Expected**: The `watermarking` card has the shimmer class; the `processing` card does not. The shimmer is applied by the card template/component comparing `photo.status === 'watermarking'` directly, not the badge label or CSS class.
**Why it matters**: RS-017 introduced the shimmer. RS-018 changed the badge label to "In Progress" for both statuses. If the shimmer check was accidentally changed to compare the badge label instead of `photo.status`, both cards would get the shimmer (or neither would).

---

### TC-025: `Photo.status` TypeScript type does not include `'in_progress'`

**Category**: State machine / Frontend
**Setup**: Static type analysis / build verification.
**Action**: Attempt to assign `photo.status = 'in_progress'` in TypeScript code. Run `ng build --aot`.
**Expected**: TypeScript compile error — `'in_progress'` is not assignable to `PhotoStatus`. `PhotoStatusFilter` is used only for `activeFilter` and action payloads, never for `Photo.status`.
**Why it matters**: The type split between `PhotoStatus` and `PhotoStatusFilter` is the key AC4 enforcement mechanism at the TypeScript level. A compile error proves the guard is real and not just a comment.

---

### TC-026: `loadPhotos` effect reads `activeFilter` from store at dispatch time — filter already updated by reducer before HTTP call

**Category**: State machine / Frontend
**Setup**: `activeFilter` is `null` (All). Dispatch `filterByStatus({ status: 'in_progress', eventId })`.
**Action**: The `filterByStatus$` effect re-dispatches `loadPhotos`. The `loadPhotos$` effect then reads `activeFilter` via `withLatestFrom(store.select(selectActiveFilter))`.
**Expected**: By the time `loadPhotos$` subscribes, the `filterByStatus` reducer has already set `activeFilter = 'in_progress'` in the store. `withLatestFrom` returns `'in_progress'`. The HTTP GET includes `?status=in_progress`.
**Why it matters**: `withLatestFrom` captures store state at the moment the action arrives at the `loadPhotos$` effect. There is a subtle ordering dependency: `filterByStatus$` must emit `loadPhotos` *after* the `filterByStatus` reducer runs. Because NgRx processes reducers synchronously before effects, this should hold — but verifying it explicitly prevents a regression where the filter param is missing from the first page request.

---

### TC-027: `?limit=0` — silently falls back to `defaultPageSize`, not a zero-item page

**Category**: Boundary values
**Setup**: Valid event, valid JWT.
**Action**: `GET /events/{id}/photos?limit=0`.
**Expected**: The guard `l > 0 && l <= 200` rejects `l=0`, so `limit` stays at `defaultPageSize=50`. Response is 200 with up to 50 photos.
**Why it matters**: If `limit=0` were passed through, `internalLimit = 0 * filterMultiplier = 0`, and `aws.Int32(0)` as the DynamoDB `Limit` would cause a `ValidationException` (DynamoDB requires Limit >= 1).

---

### TC-028: `?limit=-1` — silently falls back, not a 400

**Category**: Boundary values
**Setup**: Valid event, valid JWT.
**Action**: `GET /events/{id}/photos?limit=-1`.
**Expected**: Same as TC-027 — falls back to 50. Confirm a negative number does not slip past `l > 0`.
**Why it matters**: `strconv.Atoi("-1")` succeeds and returns `-1`. The guard checks `l > 0`, so `-1` fails and `limit` stays at 50. Verify the guard is `l > 0` and not `l >= 0`.

---

### TC-029: concurrent `in_progress` requests for the same event — no goroutine leak under cancellation

**Category**: Concurrency / Failure injection
**Setup**: Mock `Events.GetEventPhotographerID` to sleep 50ms then return a 403 (different photographer). Mock `Photos.ListPhotosByEvent` to block until its context is cancelled.
**Action**: Call `Handle` once.
**Expected**: When ownership check returns 403, `cancelList()` is called, the photo store goroutine's context is cancelled, it unblocks, sends its (nil) result on `listCh`, and the handler drains `listCh` before returning. No goroutine leak. Response is 403.
**Why it matters**: The concurrent goroutine pattern existed before RS-018 but is exercised more heavily under `in_progress` because the store may run multiple DynamoDB Query rounds. If a slow `in_progress` multi-round query is mid-flight when ownership fails, all rounds must terminate promptly on context cancellation.

---

### TC-030: `in_progress` response — `nextCursor` is empty string `""`, not `null`, when no more pages

**Category**: Boundary values / Frontend contract
**Setup**: Event with 2 in-progress photos, `limit=50` (more than available).
**Action**: `GET /events/{id}/photos?status=in_progress`.
**Expected**: Response body: `{"photos": [...], "nextCursor": ""}`. The `nextCursor` field is a JSON string, not `null`. The Go `listPhotosResponse` struct has `NextCursor string` (not `*string`), so `omitempty` is not set — it always serializes.
**Why it matters**: The frontend effect maps `res.nextCursor ?? null` to store state, so an empty string becomes `null` in the store. Confirm the frontend's `selectHasMorePages` selector (`!!cursor`) correctly returns `false` for empty string. Mismatched null vs empty-string handling could cause "Load More" to appear when there is nothing to load.

---

## Risk areas

1. **Empty-page cursor on filter miss (TC-008, TC-016)**: When `in_progress` matches zero photos but the GSI partition is not exhausted (more items exist with other statuses), the store returns `photos=[]` with a non-empty `nextCursor`. This is a latent infinite-pagination risk. The behavior is not documented and no integration test covers it. The developer should decide whether an empty result page should always return `nextCursor=""` to terminate pagination, or whether the current behavior (return cursor so caller can resume scanning) is intentional and document it explicitly.

2. **Cursor filter-context mismatch (TC-009)**: A cursor obtained from an `in_progress` request is structurally valid and accepted by any other status filter request for the same event. There is no filter identity stored in the cursor. A frontend bug reusing the wrong cursor would silently return results from the wrong position within a differently-filtered view. Consider whether the cursor should encode the active filter value and reject mismatches.

3. **`limit=200` with `filterMultiplier=5` generates internal DynamoDB `Limit=1000` (TC-005)**: DynamoDB's `Limit` parameter is documented as having no hard cap in the SDK, but single-request evaluated item counts above the 1 MB page limit cause DynamoDB to auto-paginate internally. Verify that passing `Limit: 1000` on an event with 150 photos does not return a `ValidationException` or silently truncate. Load-test this path with a 5,000-photo event — the store's inner loop may consume significant RCUs before satisfying the limit for a sparse filter.
