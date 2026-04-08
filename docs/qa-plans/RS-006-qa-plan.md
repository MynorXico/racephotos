# QA Plan: RS-006 — Bulk photo upload (batch presign + upload UI)

## Scope

**Lambda**: `lambdas/presign-photos/` — `POST /events/{eventId}/photos/presign`
**Store implementation**: `DynamoPhotoStore.BatchCreatePhotos`, `DynamoEventReader.GetEvent`
**Frontend**: `EventUploadComponent`, NgRx `photo-upload` slice (actions, reducer, effects)
**E2E**: Playwright auth-guard redirect tests

The existing 10 unit tests cover the happy path (3 photos, 1 PNG), AC2 (101 items),
AC3 (ownership), AC9 (event not found), AC10 (bad content type), missing JWT, invalid
JSON, and the two 500-error injection paths. The cases below are exclusively outside
that existing coverage.

---

## Test cases

### TC-001: Exactly 100 photos — boundary maximum is accepted

**Priority**: P0
**Category**: Boundary
**Setup**: Event `evt-1` owned by `user-1` exists in DynamoDB.
**Action**:
```
POST /events/evt-1/photos/presign
Authorization: Bearer <valid JWT sub=user-1>
Content-Type: application/json
Body: { "photos": [ <100 items, each image/jpeg> ] }
```
**Expected**: HTTP 200; response body contains exactly 100 `{ photoId, presignedUrl }` objects; all `photoId` values are distinct UUIDs; `BatchCreatePhotos` is called exactly once with 100 items; the DynamoDB store chunks that into four `BatchWriteItem` calls of 25.
**Why it matters**: The handler's `> maxPresignBatch` guard uses strictly-greater-than. If it were `>=` the legitimate maximum would be rejected. Confirms the fence-post is correct and that 100 items triggers four chunked DynamoDB writes without off-by-one errors.

---

### TC-002: Exactly 0 photos — empty array

**Priority**: P1
**Category**: Boundary
**Setup**: Event `evt-1` owned by `user-1` exists.
**Action**:
```
POST /events/evt-1/photos/presign
Body: { "photos": [] }
```
**Expected**: HTTP 400 with a descriptive error. The handler currently returns 200 with an empty array for a zero-item payload — there is no guard for `len(body.Photos) == 0`. If the product intent is that callers must provide at least one photo, this is a missing validation. If 200 with `{ "photos": [] }` is acceptable, `BatchCreatePhotos` must not be called at all (a no-op write to DynamoDB wastes a round-trip).
**Why it matters**: Calling `BatchCreatePhotos` with an empty slice is harmless today but could mask bugs if the store implementation is changed; a 0-item presign request has no business value and should be rejected with a clear error message. The current handler has no `len < 1` guard.

---

### TC-003: Single photo — minimum non-zero batch

**Priority**: P1
**Category**: Boundary
**Setup**: Event `evt-1` owned by `user-1` exists.
**Action**:
```
POST /events/evt-1/photos/presign
Body: { "photos": [{"filename":"a.jpg","contentType":"image/jpeg","size":1}] }
```
**Expected**: HTTP 200; exactly one `{ photoId, presignedUrl }` in response; `BatchCreatePhotos` called once with a one-item slice; exactly one `BatchWriteItem` call to DynamoDB.
**Why it matters**: The chunking loop in `BatchCreatePhotos` uses `i += 25` — verify it terminates correctly when `len(photos) == 1` and does not produce an out-of-bounds panic.

---

### TC-004: Filename with path traversal characters

**Priority**: P1
**Category**: Input validation
**Setup**: Event `evt-1` owned by `user-1` exists.
**Action**:
```
Body: { "photos": [{"filename":"../../etc/passwd","contentType":"image/jpeg","size":100}] }
```
**Expected**: HTTP 400; request rejected before any DynamoDB or S3 call. Alternatively, if the filename is embedded literally in the S3 key (`{env}/{eventId}/{photoId}/../../etc/passwd`), that must not be allowed to escape the intended key prefix.
**Why it matters**: `handler.go` line 130 builds `RawS3Key` by string-concatenating `h.Env`, `eventID`, `id`, and `p.Filename` without sanitising `p.Filename`. A path-traversal filename like `../../etc/passwd` or `../` would produce an S3 key outside the expected prefix, potentially overwriting a different object or leaking data. There is currently no validation on `Filename` at all.

---

### TC-005: Empty filename

**Priority**: P1
**Category**: Input validation
**Setup**: Event `evt-1` owned by `user-1` exists.
**Action**:
```
Body: { "photos": [{"filename":"","contentType":"image/jpeg","size":100}] }
```
**Expected**: HTTP 400. An empty filename would produce an S3 key of `{env}/{eventId}/{photoId}/`, which has a trailing slash — a zero-length key component that is valid S3 syntax but produces a confusing prefix-style key rather than an object key.
**Why it matters**: No filename validation exists in the handler. The downstream `photo-processor` Lambda would receive an S3 `ObjectCreated` event with a malformed key and could fail silently or write bad DynamoDB records.

---

### TC-006: Filename exceeding reasonable length (1025+ characters)

**Priority**: P2
**Category**: Boundary
**Setup**: Event `evt-1` owned by `user-1` exists.
**Action**:
```
Body: { "photos": [{"filename":"<1025-char string>.jpg","contentType":"image/jpeg","size":100}] }
```
**Expected**: HTTP 400. S3 key max length is 1024 bytes; the constructed key `{env}/{eventId}/{photoId}/{filename}` would exceed that limit for very long filenames, causing `PresignPutObject` to either silently produce an unusable URL or fail at actual PUT time.
**Why it matters**: No maximum filename length check exists. A long filename could silently produce a presigned URL that fails with a 400 when the frontend actually attempts the PUT, leaving the `status=uploading` record permanently stuck with no error surfacing.

---

### TC-007: Content type with uppercase — `image/JPEG`

**Priority**: P1
**Category**: Input validation
**Setup**: Event `evt-1` owned by `user-1` exists.
**Action**:
```
Body: { "photos": [{"filename":"a.jpg","contentType":"image/JPEG","size":100}] }
```
**Expected**: HTTP 400 (the allowlist uses exact lowercase key lookup; `image/JPEG` is not in `allowedContentTypes`). Verify this is intentional and the error message is meaningful. If the intent is case-insensitive matching, the handler must normalise to lowercase first.
**Why it matters**: Browsers and HTTP libraries sometimes capitalise or title-case MIME types. If the client sends `image/JPEG` and the frontend does not normalise it, every upload from such a client will fail with 400 even though the file is valid. The frontend `onDrop` filter and the backend allowlist must agree on casing.

---

### TC-008: Content type `image/jpg` (non-standard alias)

**Priority**: P2
**Category**: Input validation
**Setup**: Event `evt-1` owned by `user-1` exists.
**Action**:
```
Body: { "photos": [{"filename":"a.jpg","contentType":"image/jpg","size":100}] }
```
**Expected**: HTTP 400 with clear messaging (`image/jpg` is not a registered IANA MIME type; the correct type is `image/jpeg`). Verify the error message tells the client what is accepted rather than giving a generic 400.
**Why it matters**: `image/jpg` is commonly misused. Without a clear rejection message, photographers will be confused when their upload tool reports `image/jpg` files as unsupported.

---

### TC-009: Missing `photos` key entirely

**Priority**: P1
**Category**: Input validation
**Setup**: Event `evt-1` owned by `user-1` exists.
**Action**:
```
Body: { }
```
**Expected**: HTTP 400. `json.Unmarshal` into `presignRequest` with no `photos` key will leave `body.Photos` as `nil` (zero-length). With `nil`, `len(body.Photos) > 100` is false, the content-type loop is skipped (zero iterations), `GetEvent` is called, and then `BatchCreatePhotos` is called with an empty slice — potentially returning 200 with `{ "photos": [] }`. This is incorrect behaviour for a missing required field.
**Why it matters**: A client that accidentally omits the `photos` key gets a misleading 200 response rather than a 400. The handler should explicitly check `body.Photos == nil || len(body.Photos) == 0` as a distinct validation step.

---

### TC-010: `size` field zero or negative

**Priority**: P2
**Category**: Boundary
**Setup**: Event `evt-1` owned by `user-1` exists.
**Action**:
```
Body: { "photos": [{"filename":"a.jpg","contentType":"image/jpeg","size":0}] }
Body: { "photos": [{"filename":"a.jpg","contentType":"image/jpeg","size":-1}] }
```
**Expected**: HTTP 400 for `size <= 0`. The `size` field is declared as `int64` but never validated. A presigned URL would be generated for a 0-byte object; when the frontend actually PUTs 0 bytes to S3, the photo-processor will receive an ObjectCreated event for an empty file, Rekognition will reject it with `InvalidImageException`, and the photo will land permanently in `status=error`.
**Why it matters**: Catching invalid sizes at presign time produces a fast, clear error. Letting them through silently wastes a DynamoDB write, an S3 presign, and later a Rekognition call before eventually surfacing as `status=error` in the review queue.

---

### TC-011: `size` field extremely large (> practical S3 single PUT limit of 5 GiB)

**Priority**: P2
**Category**: Boundary
**Setup**: Event `evt-1` owned by `user-1` exists.
**Action**:
```
Body: { "photos": [{"filename":"a.jpg","contentType":"image/jpeg","size":6000000000}] }
```
**Expected**: HTTP 400 or HTTP 413. S3 presigned PUT URLs are limited to 5 GiB per object. The handler does not encode the file size in the presigned URL (the `PresignPutObject` call in `presigner.go` does not set `ContentLength`), so the limit is not enforced at presign time — it would only fail at actual PUT time.
**Why it matters**: Without a size cap, the presigned URL is generated and the DynamoDB record is written for a file that cannot actually be uploaded successfully. The same stuck-in-`uploading` problem as TC-010.

---

### TC-012: Mixed valid and invalid content types in same batch

**Priority**: P1
**Category**: Input validation
**Setup**: Event `evt-1` owned by `user-1` exists.
**Action**:
```
Body: { "photos": [
  {"filename":"a.jpg","contentType":"image/jpeg","size":100},
  {"filename":"b.gif","contentType":"image/gif","size":100},
  {"filename":"c.png","contentType":"image/png","size":100}
] }
```
**Expected**: HTTP 400 referencing `photos[1]` (index 1, the GIF). Confirm the error message includes the index and the offending type. No DynamoDB write and no S3 presign should have occurred.
**Why it matters**: The handler iterates content types before any I/O — verify the short-circuit is index-accurate and that partial batch rejection does not produce phantom `status=uploading` records for the valid items.

---

### TC-013: Presign fails midway through a 100-item batch — orphan DynamoDB records

**Priority**: P0
**Category**: Failure injection
**Setup**: Event `evt-1` exists; `BatchCreatePhotos` succeeds for all 100 items; `PresignPutObject` fails on item 50 (first 49 succeed).
**Action**: Inject error on the 50th `PresignPutObject` call.
**Expected**: Handler returns HTTP 500. Verify there are now 100 `status=uploading` Photo records in DynamoDB with no corresponding presigned URL returned to the caller. The caller receives a 500 with no partial result, so they cannot upload any of the photos — all 100 records are permanently orphaned in `status=uploading`.
**Why it matters**: This is a critical data consistency bug. The handler writes all DynamoDB records first, then generates presign URLs one by one (lines 136–159 in `handler.go`). There is no rollback. If presign fails on item N, items 0–N-1 already have DynamoDB records but no URL was delivered. The photo-processor will never receive an S3 ObjectCreated event for these; they sit forever in `status=uploading`. This should be flagged for developer attention — either the presign loop should run before the DynamoDB write, or the caller must be able to resume from the first failure.

---

### TC-014: `BatchWriteItem` returns unprocessed items on retry attempt

**Priority**: P1
**Category**: Failure injection
**Setup**: Mock `DynamoAPI.BatchWriteItem`. First call returns 5 unprocessed items. Second call (retry) also returns unprocessed items (persistent throttle).
**Action**: Call `BatchCreatePhotos` with 25 items.
**Expected**: `BatchCreatePhotos` returns an error; the error wraps `"retry unprocessed items"`. The caller (handler) returns HTTP 500. Confirm the second retry `BatchWriteItem` result's own `UnprocessedItems` is checked — currently `store.go` line 65 discards `_` from the retry output, meaning silently unprocessed items on the second attempt are ignored and the function returns nil (success) even though some items were never written.
**Why it matters**: The retry in `BatchCreatePhotos` ignores the return value of the second `BatchWriteItem` call (`if _, err := ...`). If the retry also has `UnprocessedItems`, the function returns `nil` (success) with missing records. Photos would appear to be written but are absent from DynamoDB — downstream processing never fires for them.

---

### TC-015: `BatchWriteItem` returns `ProvisionedThroughputExceededException`

**Priority**: P1
**Category**: Failure injection
**Setup**: DynamoDB mock returns `ProvisionedThroughputExceededException` on `BatchWriteItem`.
**Action**: Call `POST /events/{eventId}/photos/presign` with a valid 1-item body.
**Expected**: Handler returns HTTP 500; error is logged with `requestId` and `eventId`; no presign URL is generated.
**Why it matters**: On-demand DynamoDB can still return throttling errors during bursts. The Lambda must propagate these as 500 (not 200) so the frontend can surface an error and prompt retry.

---

### TC-016: S3 key structure — verify `envName` prefix

**Priority**: P1
**Category**: Boundary
**Setup**: Handler configured with `Env = ""` (empty string, e.g. `RACEPHOTOS_ENV` not set at runtime).
**Action**: Valid 1-photo presign request.
**Expected**: `RawS3Key` stored in DynamoDB is `/{eventId}/{photoId}/{filename}` — an empty env prefix produces a leading slash, creating an S3 key of the form `//eventId/...` which is syntactically unusual and may confuse the photo-processor prefix filter. The handler should guard against `Env == ""`.
**Why it matters**: `main.go` reads `RACEPHOTOS_ENV` via `os.Getenv` (not `mustGetenv`), so it can be empty without crashing. An empty env produces a malformed S3 key silently.

---

### TC-017: Concurrent identical requests — same `eventId`, same `filename`, same caller

**Priority**: P1
**Category**: Concurrency
**Setup**: Event `evt-1` owned by `user-1` exists.
**Action**: Fire two identical `POST /events/evt-1/photos/presign` requests with the same 3-photo payload simultaneously (two Lambda invocations in parallel).
**Expected**: Both requests succeed with HTTP 200; each response contains 3 distinct `photoId` UUIDs (UUIDs are generated per-invocation via `uuid.New()`). Total of 6 Photo records written to DynamoDB — no collision. Verify no duplicate photo IDs are returned across the two responses.
**Why it matters**: The handler generates UUIDs locally with `uuid.New()`, which is cryptographically random — collision probability is negligible. However, there is no idempotency key in the request, so two identical requests from a double-submit or network retry always create duplicate records. This is a known gap (no idempotency mechanism) that should be flagged as a risk.

---

### TC-018: Two photographers uploading to the same event simultaneously

**Priority**: P1
**Category**: Concurrency
**Setup**: Event `evt-1` owned by `user-1`. A second photographer `user-2` is not the owner.
**Action**: `user-2` sends a concurrent request targeting the same `eventId`.
**Expected**: `user-2` gets HTTP 403 (ownership check). Confirm the ownership check and the DynamoDB write are not interleaved such that `user-2`'s photos could be inserted before the 403 is returned.
**Why it matters**: The ownership check happens on `GetEvent` (line 105); `BatchCreatePhotos` is called only after the ownership assertion passes (line 136). However, in the concurrent case both invocations call `GetEvent` simultaneously — verify the ordering is correct and there is no TOCTOU window where a race can cause `user-2`'s photos to be persisted.

---

### TC-019: `eventId` path parameter containing SQL injection / DynamoDB expression injection

**Priority**: P1
**Category**: Input validation
**Setup**: No event with the injection string exists.
**Action**:
```
POST /events/'; DROP TABLE photos;--/photos/presign
POST /events/<script>alert(1)</script>/photos/presign
POST /events/../../admin/photos/presign
```
**Expected**: HTTP 404 (`apperrors.ErrNotFound`). DynamoDB uses parameterised attribute values via `attributevalue.MarshalMap` — injection is not possible at the DynamoDB layer. Confirm the eventId is never interpolated into an expression string directly.
**Why it matters**: Confirms parameterised marshalling is in use throughout `GetEvent` and that no raw string interpolation into DynamoDB filter expressions exists. Also validates the 404 is returned cleanly rather than a 500 that leaks internal details.

---

### TC-020: `eventId` path parameter as a valid UUID vs arbitrary string

**Priority**: P2
**Category**: Input validation
**Setup**: No event exists for either ID.
**Action**: Send requests with `eventId` = `"not-a-uuid"`, `""` (empty — API Gateway should catch this but verify), and a 300-character string.
**Expected**: Empty `eventId` returns HTTP 400 (caught by the existing guard at line 83); non-UUID strings that don't exist in DynamoDB return HTTP 404. A 300-character string should either be rejected early (if max length validation is added) or fail with a 404 from DynamoDB (GetItem with a 300-char key is valid for DynamoDB but wastes a read).
**Why it matters**: API Gateway path parameters accept arbitrary strings. Clarifying whether `eventId` must be UUID-format is a missing validation — without it, callers receive a 404 rather than a 400 for structurally invalid IDs.

---

### TC-021: Request body with extra unknown fields (forward-compatibility)

**Priority**: P2
**Category**: Input validation
**Setup**: Event `evt-1` owned by `user-1` exists.
**Action**:
```
Body: { "photos": [{"filename":"a.jpg","contentType":"image/jpeg","size":100}], "unknownField": "value" }
```
**Expected**: HTTP 200 (Go's `json.Unmarshal` silently ignores unknown fields by default). Confirm this is intentional — if strict mode is desired, a `decoder.DisallowUnknownFields()` decoder should be used instead.
**Why it matters**: Silent acceptance of unknown fields means a misconfigured client that sends `{"files": [...]}` instead of `{"photos": [...]}` will get 200 with an empty-or-nil `Photos` (see TC-009) rather than a helpful 400.

---

### TC-022: Wrong type for `size` — string instead of number

**Priority**: P2
**Category**: Input validation
**Setup**: Event `evt-1` owned by `user-1` exists.
**Action**:
```
Body: { "photos": [{"filename":"a.jpg","contentType":"image/jpeg","size":"big"}] }
```
**Expected**: HTTP 400 with `"invalid request body"`. The existing `json.Unmarshal` path should catch a type mismatch on `size int64` and return 400.
**Why it matters**: Confirms type coercion errors are caught before business logic runs.

---

### TC-023: Integration test — 26-item batch crosses the 25-item DynamoDB chunk boundary

**Priority**: P1
**Category**: Boundary (integration)
**Setup**: LocalStack running with `racephotos-photos` and `racephotos-events` tables seeded; event record exists.
**Action**: Call `DynamoPhotoStore.BatchCreatePhotos` with exactly 26 photos.
**Expected**: Two `BatchWriteItem` calls are made (25 + 1). All 26 items appear in DynamoDB after the call. No off-by-one error in the chunking loop (`i += dynamoBatchSize` with `end = min(i+25, len)`).
**Why it matters**: The current integration test only exercises 2 items. The chunk-boundary at 26 is the first case where the loop iterates twice and where the `end = len(photos)` guard fires. This is not covered by any existing test.

---

### TC-024: Integration test — 100-item batch requires exactly 4 chunks

**Priority**: P1
**Category**: Boundary (integration)
**Setup**: LocalStack running; event record exists.
**Action**: Call `DynamoPhotoStore.BatchCreatePhotos` with exactly 100 photos.
**Expected**: Four `BatchWriteItem` calls of 25 each. All 100 items appear in DynamoDB. Verifies the full-batch integration path end-to-end.
**Why it matters**: The maximum presign batch (100 items) is the most important integration scenario and is completely absent from the integration test suite.

---

### TC-025: Frontend — drop zone rejects mixed valid/invalid file types, dispatches only valid files

**Priority**: P1
**Category**: Input validation (frontend)
**Setup**: Component rendered in idle state.
**Action**: Drop a DataTransfer containing `photo.jpg` (image/jpeg), `video.mp4` (video/mp4), and `image.png` (image/png).
**Expected**: `PhotoUploadActions.uploadFiles` is dispatched with only `[photo.jpg, image.png]`; `video.mp4` is silently excluded. The existing test (line 173 in spec) only tests all-invalid drop (no dispatch at all) — mixed-type drop is not covered.
**Why it matters**: Without this test, a regression could let invalid files through the frontend filter and hit the Lambda's AC10 validation instead of being caught client-side, resulting in confusing 400 errors mid-batch after DynamoDB records have already been written.

---

### TC-026: Frontend — progress counter updates correctly when `uploaded` increments

**Priority**: P1
**Category**: Boundary (frontend)
**Setup**: Store state: `total=10, uploaded=0, inProgress=true`.
**Action**: Update store to `uploaded=5`, then `uploaded=10, inProgress=false, failed=[]`.
**Expected**: Progress panel shows "5 of 10 photos uploaded" at the intermediate state; then transitions to the success panel with "10 of 10" — not to the partial-failure panel. Verify the "X of N" text is bound to the store values, not a local component counter that could drift.
**Why it matters**: The existing Angular test only checks that `.progress-panel` appears when `inProgress=true`. It does not verify the counter text or the state transition to success when `inProgress` flips to false.

---

### TC-027: Frontend — network drop during S3 PUT triggers individual file failure, not full abort

**Priority**: P0
**Category**: Failure injection (frontend)
**Setup**: Presign API call succeeds; 3 photos are uploading; XHR for photo 2 fires an `error` event (network drop).
**Action**: Simulate XHR `error` event on the second of three concurrent uploads in the NgRx Effect.
**Expected**: `PhotoUploadActions.fileUploadFailed` is dispatched for photo 2 only; photos 1 and 3 continue uploading and succeed. Final state: `uploaded=2, failed=[photo2], inProgress=false`. The `.partial-failure-panel` is shown; "Retry" button appears for photo 2 only.
**Why it matters**: AC8 requires per-file retry. If the Effect cancels all in-progress uploads when one fails (a common misimplementation), the photographer loses all progress and must restart the entire batch. No existing test exercises this path with a mid-batch XHR error.

---

### TC-028: Frontend — retry after partial failure sends only failed files, not the full original batch

**Priority**: P1
**Category**: State machine (frontend)
**Setup**: Upload of 5 files completes with 2 failures. User clicks "Retry" on all failed files.
**Action**: `onRetryAll()` is called.
**Expected**: `PhotoUploadActions.uploadFiles` is dispatched with the 2 failed files only (not all 5). A new presign API call is made for those 2 files only. The NgRx state resets `failed=[]` before the retry dispatches new `fileUploadFailed` entries.
**Why it matters**: If retry re-dispatches the full original batch, the photographer pays for duplicate DynamoDB writes and generates duplicate `status=uploading` records for the 3 already-uploaded photos, causing them to appear in the review queue unnecessarily.

---

### TC-029: Frontend — browser tab closed mid-upload, then photographer returns to page

**Priority**: P1
**Category**: Failure injection (frontend)
**Setup**: Upload of 10 photos is in progress (presigned URLs obtained, 3 of 10 PUTs completed). Browser tab is closed (component `ngOnDestroy` fires, `resetUpload` is dispatched).
**Action**: Photographer navigates back to `/photographer/events/evt-1/upload`.
**Expected**: Component initialises in idle state (store is reset on destroy per `TC-019` in existing tests). Drop zone is shown with no residual progress. The 3 already-uploaded photos are in S3 and will be processed normally by RS-007 — the incomplete state from the previous session is not surfaced as an error.
**Why it matters**: Confirms that `resetUpload` on destroy truly clears `inProgress`, `total`, `uploaded`, and `failed`. If any of those are not reset, the component could show a stale progress bar or a misleading "3 of 10 uploaded" panel on return.

---

### TC-030: Frontend — presign API returns 403 (event ownership) — error banner is shown

**Priority**: P1
**Category**: Authorization (frontend)
**Setup**: Store state: `presignError: 'You do not own this event.'` — simulates the NgRx Effect receiving a 403 from the presign API.
**Action**: Component renders with the error state.
**Expected**: `.error-banner` is visible and contains the error message. Existing test TC (line 293 in spec) covers this. Extend coverage: verify the drop zone is still rendered alongside the error banner so the photographer can attempt to correct the situation (navigate away), and that no `inProgress` spinner is shown.
**Why it matters**: Existing test only checks that the banner element exists and has text. It does not verify that the component is not stuck in a loading state after a 403.

---

### TC-031: E2E — authenticated photographer can access upload route without redirect

**Priority**: P0
**Category**: Authorization (E2E)
**Setup**: Playwright `storageState` fixture with a valid Cognito session for `user-1`; event `evt-1` seeded in LocalStack.
**Action**: Navigate to `/photographer/events/evt-1/upload` with auth cookies/tokens set.
**Expected**: Page renders the drop zone (`[data-testid="drop-zone"]`); no redirect to `/login`.
**Why it matters**: The entire E2E test suite currently only covers the unauthenticated redirect path. There is no E2E test that verifies the authenticated happy path even renders. ACs 4, 5, 6, 7, and 8 have zero E2E coverage.

---

### TC-032: E2E — full upload flow (authenticated) — files dropped, progress shown, success panel

**Priority**: P0
**Category**: Boundary (E2E / integration)
**Setup**: Playwright `storageState` with valid Cognito session; LocalStack with seeded event; presign Lambda running locally; valid JPEG file available.
**Action**: Navigate to upload page, drag-and-drop a JPEG file, observe progress, observe success panel.
**Expected**: Progress panel shows "1 of 1 photos uploaded"; success panel appears with "View photos" link pointing to `/photographer/events/evt-1/photos`. DynamoDB contains 1 Photo record with `status=uploading`.
**Why it matters**: No end-to-end test exercises the actual upload pipeline. AC1, AC5, AC6, AC7 are only covered by unit tests against mocks.

---

### TC-033: S3 key format validation — correct prefix structure

**Priority**: P1
**Category**: Boundary
**Setup**: Handler with `Env="dev"`, `eventID="evt-abc"`.
**Action**: Valid 1-photo presign request with `filename="race_finish_001.jpg"`.
**Expected**: The `RawS3Key` written to DynamoDB is exactly `dev/evt-abc/{uuid}/race_finish_001.jpg`. Confirm via unit test asserting on the `Photo` slice passed to `BatchCreatePhotos` (using `gomock.Matcher` on the struct fields). No existing test asserts the S3 key format.
**Why it matters**: The photo-processor Lambda (RS-007) will parse the S3 key to extract `eventId` from position 1 of the split. If the key format drifts from `{env}/{eventId}/{photoId}/{filename}`, RS-007 will extract the wrong event ID and index photos under the wrong event.

---

## Risk areas

**Risk 1 — Orphan DynamoDB records on mid-batch presign failure — MITIGATED**
The handler generates all presigned URLs first (pure local crypto, lines 172–186) and only writes to DynamoDB after all URLs are successfully generated (lines 189–195). If `PresignPutObject` fails on item N, no DynamoDB records have been written yet, so no orphan records can be created. TC-013 verifies this order: a `PresignPutObject` error must not trigger a `BatchCreatePhotos` call.

**Risk 2 — Unprocessed items on DynamoDB retry are silently ignored (TC-014) — HIGH**
`store.go` line 63–67: the second `BatchWriteItem` call (the retry for unprocessed items) ignores its own `UnprocessedItems` return value (`if _, err := ...`). If DynamoDB is persistently throttled, the retry also produces unprocessed items, the function returns `nil`, and some photos are never written. The handler then generates presigned URLs for those photo IDs and returns 200 to the client. The photographer uploads successfully, but some photos have no DynamoDB record, so they will never appear in search results. This is a silent data loss path.

**Risk 3 — No filename validation enables malformed S3 keys (TC-004, TC-005, TC-006) — MEDIUM**
The `p.Filename` value is embedded directly into the S3 key string without any sanitisation. An empty filename, a path-traversal filename, or an extremely long filename all produce invalid or dangerous S3 keys. Since the presign Lambda is the first point where user-controlled input enters the S3 key namespace, this is the correct place to enforce a filename policy. Recommended: reject empty filenames, reject filenames containing `/` or `..`, enforce a maximum length of 255 characters (matching common filesystem limits), and optionally strip or percent-encode non-ASCII characters.
