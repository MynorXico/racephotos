# QA Plan: RS-017 — Add `watermarking` intermediate status

## Scope

- `lambdas/photo-processor/handler/handler.go` — `processS3Record`, `driveDownstream`, redelivery switch
- `lambdas/photo-processor/handler/store.go` — `UpdatePhotoStatus`
- `lambdas/watermark/handler/handler.go` — `processMessage`
- `lambdas/watermark/handler/store.go` — `CompleteWatermark`
- `lambdas/shared/models/watermark_message.go` — `FinalStatus` field
- `lambdas/shared/models/photo.go` — `watermarking` status comment
- `frontend/angular/src/app/store/photos/photos.actions.ts` — `PhotoStatus` union
- `frontend/angular/src/app/features/photographer/event-photos/event-photos.component.ts` — filter chips
- `frontend/angular/src/app/features/photographer/event-photos/photo-card/photo-card.component.*` — shimmer
- `frontend/angular/src/app/features/photographer/event-photos/photo-status-badge.pipe.ts` — badge config
- Integration test: `lambdas/watermark/test/integration/integration_test.go`

---

## Test cases

### TC-001: FinalStatus set to an unexpected value ("error") propagates verbatim to DynamoDB

**Category**: Input validation
**Setup**: DynamoDB `racephotos-photos` has photo `photo-xxx` with `status=watermarking`. DynamoDB `racephotos-events` has the corresponding event.
**Action**: Deliver SQS message to watermark Lambda with body `{"photoId":"photo-xxx","eventId":"evt-yyy","rawS3Key":"local/evt-yyy/photo-xxx/img.jpg","finalStatus":"error"}`. S3 raw object exists. Watermark apply succeeds. DynamoDB `CompleteWatermark` receives `finalStatus="error"`.
**Expected**: `CompleteWatermark` writes `status="error"` and a non-empty `watermarkedS3Key` to DynamoDB. No Lambda error is returned. Photo ends up in a contradictory state: watermarked copy exists but status is "error", which makes it surface in the error queue and also have a thumbnail.
**Why it matters**: The `CompleteWatermark` interface comment says `finalStatus must be "indexed" or "review_required"` but neither the store implementation nor the handler validates this constraint. An upstream bug in photo-processor that serialises the wrong `FinalStatus` would silently corrupt a photo record with no observable failure in the watermark Lambda — the corrupted photo appears in the error review queue while also having a `watermarkedS3Key`.

---

### TC-002: FinalStatus set to empty string after SQS redelivery re-derives wrong value

**Category**: Input validation / Idempotency
**Setup**: Photo in DynamoDB has `status=watermarking`, `bibNumbers=["101"]`. S3 raw object exists.
**Action**: Deliver SQS message to watermark Lambda with `finalStatus=""` (empty string, not absent — passes JSON unmarshal without error). The validation check `wm.FinalStatus == ""` fires and the message is placed in `batchItemFailures`.
**Expected**: Message placed in `batchItemFailures` immediately. `GetWatermarkText` is never called. No DynamoDB or S3 I/O occurs.
**Why it matters**: The handler validates `FinalStatus == ""` correctly, but the question is whether it validates _before_ or _after_ the DynamoDB event-store call. Looking at the code, the nil-check on `wm.FinalStatus` happens at line 71 _after_ JSON unmarshal but _before_ `GetWatermarkText`. This is correct, but the test documents the exact expected short-circuit order so a future refactor does not accidentally introduce a DynamoDB call before the validation.

---

### TC-003: Watermark Lambda delivers S3 NoSuchKey for raw photo — message acked without retry

**Category**: Failure injection
**Setup**: DynamoDB has photo `photo-zzz` with `status=watermarking`. The corresponding raw S3 object has been deleted (lifecycle expiry, manual purge, or wrong key). Event record exists.
**Action**: Deliver SQS message to watermark Lambda with correct `photoId`, `eventId`, `rawS3Key`, `finalStatus="indexed"`. `GetWatermarkText` succeeds. `GetObject` returns `s3types.NoSuchKey`.
**Expected**: `processMessage` returns `nil` (ack). Message is NOT added to `batchItemFailures`. `CompleteWatermark` is never called. Photo remains `status=watermarking` in DynamoDB permanently (DLQ alarm fires after three delivery attempts but the first attempt acks).
**Why it matters**: The code correctly handles `NoSuchKey` on line 98 by returning `nil`. But this means the photo is silently stuck as `watermarking` — the operator alarm never fires because the message was acked, not failed. This is the correct trade-off (retrying a missing raw file forever is worse), but the test ensures the no-retry ack path is not accidentally changed to a retry path in a future refactor. Also confirms that `status=watermarking` photos with permanently missing raw files cannot be self-healed by SQS alone.

---

### TC-004: CompleteWatermark receives ConditionalCheckFailedException when photoId absent from DynamoDB

**Category**: Failure injection
**Setup**: DynamoDB `racephotos-photos` has no record for `photo-ghost`. Event record exists in `racephotos-events`. S3 raw photo exists.
**Action**: Deliver watermark SQS message `{"photoId":"photo-ghost","eventId":"evt-yyy","rawS3Key":"...","finalStatus":"indexed"}`. Watermark apply and S3 PutObject succeed. `CompleteWatermark` issues `UpdateItem` with `ConditionExpression: attribute_exists(id)` — DynamoDB returns `ConditionalCheckFailedException`.
**Expected**: `CompleteWatermark` returns an error wrapping `ConditionalCheckFailedException`. `processMessage` returns an error. Message is added to `batchItemFailures`. After three retries, the message lands in the DLQ. The processed (watermarked) S3 object was already written and remains as an orphan in the processed bucket.
**Why it matters**: The condition expression is the correct guard to prevent ghost record creation, but when it fires it produces a non-obvious failure: the watermarked S3 file is written, then the DynamoDB update fails, so the processed bucket accumulates orphaned files that are never referenced by any photo record. Tests must confirm that (a) the error is returned (not silently swallowed), (b) the message goes to `batchItemFailures`, and (c) the error message is distinguishable from a general DynamoDB error for operator diagnosis.

---

### TC-005: photo-processor crashes between UpdatePhotoStatus("watermarking") and SendWatermarkMessage — SQS redelivery recovers correctly

**Category**: Idempotency / Failure injection
**Setup**: DynamoDB has photo with `status=watermarking`, `bibNumbers=["202"]`, `rawS3Key` set. This simulates the crash: photo-processor wrote the status update but did not send the SQS watermark message before the Lambda timed out or was killed.
**Action**: Deliver the original S3 ObjectCreated SQS message to photo-processor again (at-least-once redelivery). The redelivery switch hits `case "watermarking"` at handler.go line 142.
**Expected**: Rekognition is NOT called. `UpdatePhotoStatus` is NOT called. `driveDownstream` is called with `finalStatus="indexed"` (derived from `photo.BibNumbers=["202"]`). `WriteBibEntries` is called idempotently. `SendWatermarkMessage` is called with `FinalStatus="indexed"`. Message acked with 0 `batchItemFailures`.
**Why it matters**: This is the exact crash scenario RS-017 was designed to handle. The redelivery switch now includes `"watermarking"`. If a future change accidentally removes `"watermarking"` from the switch, photo-processor would re-call Rekognition (violating domain rule 10) and overwrite `bibNumbers` with potentially different results.

---

### TC-006: photo-processor redelivery with status="watermarking" and empty BibNumbers — finalStatus is "review_required"

**Category**: Idempotency
**Setup**: DynamoDB has photo with `status=watermarking`, `bibNumbers=[]` (nil or empty slice), `rawS3Key` set.
**Action**: Deliver the original S3 SQS message to photo-processor again.
**Expected**: Rekognition NOT called. `driveDownstream` called with `finalStatus="review_required"`. No `WriteBibEntries` call (no bibs). `SendWatermarkMessage` called with `FinalStatus="review_required"`.
**Why it matters**: The redelivery path derives `finalStatus` from stored `BibNumbers`. If `BibNumbers` is stored as a DynamoDB null or missing attribute (because `omitempty` suppresses empty slices), `photo.BibNumbers` unmarshals as a nil slice. `len(nil) == 0` so the Go code correctly returns `"review_required"` — but this needs explicit verification at the DynamoDB level since `omitempty` on a slice suppresses the attribute entirely on write, meaning the read back gives nil, not `[]string{}`. Confirm that `len(photo.BibNumbers) > 0` evaluates to false for both nil and empty slice.

---

### TC-007: Concurrent delivery of identical watermark SQS messages — second CompleteWatermark is idempotent

**Category**: Concurrency
**Setup**: DynamoDB has photo `photo-con` with `status=watermarking`. Raw S3 photo exists.
**Action**: Two Lambda invocations receive the same SQS message body simultaneously (SQS at-least-once delivery). Both fetch event watermark text. Both download the raw S3 photo. Both run `ApplyTextWatermark`. Both call `PutObject` to the same processed S3 key `{eventId}/{photoId}/watermarked.jpg`. Both call `CompleteWatermark` for the same `photoId`.
**Expected**: S3 `PutObject` with the same key is idempotent (last writer wins, both writes produce the same content). Both `CompleteWatermark` calls use `SET` expression (no condition on current status), so both succeed. Final DynamoDB state: `status=indexed` (or `review_required`), `watermarkedS3Key` set. No partial state or `ConditionalCheckFailedException`. Both messages acked (0 `batchItemFailures` each).
**Why it matters**: `CompleteWatermark` uses `ConditionExpression: attribute_exists(id)` — this only guards against non-existent records, not concurrent writes. Two concurrent executions both succeed, which is the correct behaviour (both write the same values). However, if the two concurrent messages carry _different_ `FinalStatus` values (e.g. one has `"indexed"` and one has `"review_required"` due to a photo-processor bug sending two messages), the last writer silently wins with no conflict error. This scenario cannot be caught by the condition expression.

---

### TC-008: Two photo-processor SQS deliveries for the same photo at the same instant — only one Rekognition call

**Category**: Concurrency / Idempotency
**Setup**: DynamoDB has photo with `status=processing`. Two photo-processor Lambda instances receive two copies of the same S3 ObjectCreated SQS message at the same time.
**Action**: Both instances call `GetPhotoById` concurrently — both see `status=processing`. Both proceed to call `DetectText`. Both write `UpdatePhotoStatus` with `status=watermarking`. Both call `driveDownstream` and send two watermark messages.
**Expected**: Rekognition is called twice (domain rule 10 is violated — this is a known gap with the current design). Two watermark SQS messages are enqueued for the same photo. The watermark Lambda processes both, writing `CompleteWatermark` twice (idempotent). No data corruption, but Rekognition is billed twice.
**Why it matters**: The story and tech notes acknowledge this via the SQS-level concurrency cap (`fix/sqs-max-concurrency-stopgap` branch). This test documents the failure mode so the team understands that the concurrency cap is a prerequisite for domain rule 10 correctness. A future optimistic-lock (`ConditionExpression: #st = :processing`) on `UpdatePhotoStatus` would prevent the second write — this test case flags the gap for developer attention.

---

### TC-009: WatermarkMessage with FinalStatus="indexed" but photoId not in DynamoDB at all

**Category**: Input validation / Failure injection
**Setup**: DynamoDB `racephotos-photos` has no record for `photo-orphan`. Event record exists. Raw S3 object exists. (Simulates a message enqueued after the photo record was manually deleted.)
**Action**: Deliver watermark SQS message for `photo-orphan` with `finalStatus="indexed"`. `GetWatermarkText` succeeds. `GetObject` succeeds. `ApplyTextWatermark` succeeds. `PutObject` succeeds. `CompleteWatermark` issues `UpdateItem` with `attribute_exists(id)`.
**Expected**: DynamoDB returns `ConditionalCheckFailedException`. `CompleteWatermark` returns an error. Message added to `batchItemFailures`. After maxReceiveCount=3, lands in watermark DLQ. CloudWatch alarm fires. Processed S3 object is an orphan in the processed bucket. Photo record never created.
**Why it matters**: Validates that the condition expression correctly prevents ghost record creation. Also documents the orphan S3 artifact side effect that operators need to be aware of when investigating DLQ messages.

---

### TC-010: watermark Lambda processes batch of mixed-result messages — partial batch failure correct

**Category**: Failure injection
**Setup**: Three photos: `photo-ok` (`status=watermarking`, raw S3 exists, event exists), `photo-no-event` (`status=watermarking`, raw S3 exists, event NOT in DynamoDB), `photo-ok2` (`status=watermarking`, raw S3 exists, event exists).
**Action**: Deliver SQS batch with three messages in order: ok, no-event, ok2.
**Expected**: Message 1 succeeds. Message 2 fails (`GetWatermarkText` returns not-found error) — added to `batchItemFailures`. Message 3 succeeds. `resp.BatchItemFailures` contains exactly the message ID for message 2. Messages 1 and 3 are acked.
**Why it matters**: Confirms that a single-message failure in a batch does not poison the rest of the batch (partial batch failure contract). Also verifies that `ErrNotFound` from `GetWatermarkText` is propagated as a non-nil error by `processMessage` (not silently acked like `NoSuchKey`).

---

### TC-011: watermark Lambda receives SQS message with extra unknown fields in JSON body

**Category**: Input validation
**Setup**: No specific DynamoDB precondition needed (validation fires before any I/O).
**Action**: Deliver SQS message body: `{"photoId":"photo-xxx","eventId":"evt-yyy","rawS3Key":"local/...","finalStatus":"indexed","unknownField":"surprise","injected":true}`.
**Expected**: `json.Unmarshal` succeeds (Go ignores unknown fields by default). Validation check `wm.PhotoID == "" || wm.EventID == "" || wm.RawS3Key == "" || wm.FinalStatus == ""` passes. Processing continues normally. Message is NOT added to `batchItemFailures` due to unknown fields.
**Why it matters**: Confirms forward-compatibility — future additions to `WatermarkMessage` in photo-processor will not break an older watermark Lambda deployment that hasn't been updated yet. Also ensures no accidental use of a strict JSON decoder (`json.Decoder.DisallowUnknownFields`) that would break rolling deployments.

---

### TC-012: photo-processor UpdatePhotoStatus("watermarking") succeeds but SendWatermarkMessage fails — message retried by SQS

**Category**: Failure injection
**Setup**: DynamoDB has photo with `status=processing`. Rekognition succeeds and returns bib "303". `UpdatePhotoStatus` to `watermarking` succeeds. `WriteBibEntries` succeeds. `SendWatermarkMessage` returns an SQS error.
**Action**: Process the S3 ObjectCreated SQS message through photo-processor.
**Expected**: `driveDownstream` returns an error. `processMessage` returns an error. Message added to `batchItemFailures`. SQS retries the message. On retry, `GetPhotoById` returns `status=watermarking`. Redelivery switch hits `case "watermarking"`. Rekognition NOT re-called. `SendWatermarkMessage` retried. Eventually succeeds.
**Why it matters**: This is the primary crash-recovery scenario RS-017 introduces the `watermarking` status to handle. The test verifies the full retry loop without calling Rekognition a second time. Also confirms that `UpdatePhotoStatus` writing `watermarking` _before_ enqueueing the SQS message (not after) is the correct ordering — if the write were after the enqueue, a crash between enqueue and write would cause the redelivery to re-call Rekognition.

---

### TC-013: GetPhotoById returns ErrNotFound — message added to batchItemFailures, not acked

**Category**: Failure injection
**Setup**: DynamoDB has no record for the photo ID parsed from the S3 key.
**Action**: Deliver S3 ObjectCreated SQS message to photo-processor where the photo record does not exist.
**Expected**: `GetPhotoById` returns `apperrors.ErrNotFound`. `processS3Record` returns an error wrapping ErrNotFound. Message added to `batchItemFailures`. Retried by SQS up to maxReceiveCount=3, then DLQ.
**Why it matters**: `ErrNotFound` from `GetPhotoById` is an infrastructure-class error in this context — the photo record should always exist before the S3 ObjectCreated event fires (created by the presign Lambda). Acking it would silently drop the photo. The test verifies it is treated as retriable, not as a permanent ack like `NoSuchKey` or Rekognition errors.

---

### TC-014: Integration test calls UpdateWatermarkedKey instead of CompleteWatermark

**Category**: Input validation (integration test correctness)
**Setup**: The existing integration test at `lambdas/watermark/test/integration/integration_test.go` line 98 calls `store.UpdateWatermarkedKey(ctx, photoID, wmKey)`.
**Action**: Run `make test-integration` against LocalStack.
**Expected**: Compilation fails — `DynamoPhotoStore` no longer has an `UpdateWatermarkedKey` method; it was replaced by `CompleteWatermark` in RS-017. The integration test has not been updated.
**Why it matters**: This is a confirmed stale integration test. `UpdateWatermarkedKey` appears in the integration test but the production implementation only has `CompleteWatermark`. The integration test will not compile. The developer must update `TestIntegration_UpdateWatermarkedKey` to use `CompleteWatermark(ctx, photoID, wmKey, "indexed")` and assert that both `watermarkedS3Key` and `status` are written atomically.

---

### TC-015: Integration test GetWatermarkText signature mismatch

**Category**: Input validation (integration test correctness)
**Setup**: The integration test at line 66 calls `store.GetWatermarkText(ctx, eventID)` and assigns the result to a single string variable `text`.
**Action**: Run `make test-integration`.
**Expected**: Compilation fails — `GetWatermarkText` now returns `(string, string, error)` (watermarkText, eventName, error), but the integration test captures only one return value.
**Why it matters**: A second stale integration test. The integration test was not updated to reflect the three-return-value signature introduced in RS-017 (or earlier). The developer must update the call to capture `watermarkText, eventName, err` and assert the appropriate value.

---

### TC-016: filterChips in EventPhotosComponent still includes "watermarking" chip — violates AC4

**Category**: State machine / Input validation (frontend)
**Setup**: Angular `EventPhotosComponent` renders with at least one photo in the store.
**Action**: Inspect the `filterChips` array in `event-photos.component.ts` and the rendered chip bar.
**Expected**: The `filterChips` array contains `null, "indexed", "review_required", "error", "processing"` — it must NOT contain `"watermarking"`. No chip labelled "Watermarking" or "Finalizing" appears in the DOM.
**Why it matters**: The current `filterChips` array in the component (lines 70-76) does NOT include `"watermarking"`, which is correct. This test documents and enforces that constraint so a future contributor adding chips doesn't accidentally add `watermarking`. Note that `PhotoStatus` union type does include `"watermarking"` (line 3 of `photos.actions.ts`) — the exclusion must remain intentional at the component level.

---

### TC-017: FilterByStatus dispatched with status="watermarking" — API accepts it (operator path)

**Category**: State machine (backend API)
**Setup**: `list-event-photos` handler has `"watermarking"` in `validStatuses`.
**Action**: `GET /events/{eventId}/photos?status=watermarking` with a valid photographer JWT owning the event.
**Expected**: HTTP 200 with JSON array of photos where `status="watermarking"`. Response body includes `"thumbnailUrl": null` for all returned photos.
**Why it matters**: The story tech notes say `?status=watermarking` must return 200 (not 400) for operator debugging. This is distinct from AC4 (no Angular chip). The Angular component's `onFilterChip` would only dispatch this if called programmatically — it should not be reachable via the chip bar. This test verifies the API-level whitelist is updated, separate from the UI constraint.

---

### TC-018: photo card with status="watermarking" and thumbnailUrl unexpectedly non-null

**Category**: Boundary values (frontend)
**Setup**: NgRx store emits a `Photo` object with `status="watermarking"` and `thumbnailUrl="https://cdn.example.com/unexpected.jpg"` (a backend bug returning a non-null URL for a watermarking photo).
**Action**: Render `PhotoCardComponent` with this photo object.
**Expected**: The component must show either the shimmer (if `status === "watermarking"` takes priority over `thumbnailUrl`) or the image (if `thumbnailUrl !== null` takes priority). The test should assert which branch wins, and that the result is intentional. Currently the template logic is not visible — this must be verified against the actual HTML template.
**Why it matters**: The story states `thumbnailUrl` is "always null" when `status=watermarking`, but the frontend should not _assume_ that invariant — defensive rendering avoids a confusing broken state if the API ever returns an inconsistent response. The correct behaviour (shimmer takes priority) should be asserted.

---

### TC-019: photo transitions from watermarking to indexed while the gallery is open

**Category**: Boundary values / Concurrency (frontend)
**Setup**: NgRx store initially emits a photo with `status="watermarking"` and `thumbnailUrl=null`. After 2 seconds, a store update emits the same photo ID with `status="indexed"` and `thumbnailUrl="https://cdn.example.com/photo.jpg"`.
**Action**: Render `EventPhotosComponent`. Confirm initial shimmer. Trigger store update. Confirm card transitions to show the thumbnail image.
**Expected**: Shimmer div `.thumbnail-watermarking` is removed from DOM. `<img>` element appears with correct `src`. No console errors. `aria-label="Finalizing watermark…"` is gone. The `OnPush` change detection strategy fires correctly because the `Photo` object reference changes (NgRx emits a new object).
**Why it matters**: `ChangeDetectionStrategy.OnPush` only fires when `@Input` reference changes, not when a mutated object's property changes. If the reducer returns the same object reference with a mutated `status` property, the shimmer will not disappear — photo remains stuck in shimmer state forever in the browser session. The test verifies the reducer emits a new object reference.

---

### TC-020: WatermarkedS3Key format with eventId or photoId containing slashes

**Category**: Boundary values
**Setup**: No DynamoDB precondition. The `WatermarkedS3Key(eventId, photoId)` function is called directly.
**Action**: Call `handler.WatermarkedS3Key("evt/sub", "photo/123")`.
**Expected**: Result is `"evt/sub/photo/123/watermarked.jpg"`. The S3 key has more path segments than expected. Verify that `GetWatermarkText` and `CompleteWatermark` still work correctly when the key has extra slashes, and that the S3 PutObject succeeds with this key.
**Why it matters**: Event IDs and photo IDs are UUIDs generated by the system and should never contain slashes — but if the format assumption is wrong, the watermarked S3 key would create an unintended path hierarchy. This is a low-probability but high-impact bug to document.

---

### TC-021: watermarkText exactly at watermarkMaxChars (60 runes) — not truncated

**Category**: Boundary values
**Setup**: Event record has `watermarkText` that is exactly 60 Unicode runes (not bytes).
**Action**: Deliver watermark SQS message. `GetWatermarkText` returns 60-rune string. `truncateWatermark` is called.
**Expected**: String is returned unchanged (no "…" appended). `len([]rune(text)) == 60` satisfies `<= maxChars`.
**Why it matters**: `truncateWatermark` uses `len(runes) <= maxChars` — the boundary case is 60 runes (pass-through) vs 61 runes (truncated to 59 + "…"). Emoji or multi-byte characters must be counted by rune, not byte. A watermarkText of 60 ASCII characters passes; 60 emoji (each 4 bytes) also passes because rune count is 60.

---

### TC-022: watermarkText at exactly watermarkMaxChars+1 (61 runes) — truncated to 59+ellipsis

**Category**: Boundary values
**Setup**: Event record has `watermarkText` that is exactly 61 runes.
**Action**: Deliver watermark SQS message.
**Expected**: `truncateWatermark` returns first 59 runes + "…" (60 characters total when including the ellipsis). `ApplyTextWatermark` receives a 60-rune string.
**Why it matters**: Off-by-one in `truncateWatermark` at line 152: `runes[:maxChars-1]` = `runes[:59]` which is 59 runes + "…" = 60. This is correct. The test confirms the exact boundary arithmetic.

---

### TC-023: photo-processor writes empty BibNumbers slice vs nil — omitempty DynamoDB behaviour

**Category**: Boundary values
**Setup**: Photo-processor Rekognition returns zero LINE-type detections above threshold. `extractBibs` returns `([]string{}, 0)` (empty non-nil slice). `UpdatePhotoStatus` is called with `update.BibNumbers = []string{}`.
**Action**: Observe what `UpdatePhotoStatus` stores in DynamoDB. The code at store.go line 84 checks `len(update.BibNumbers) > 0` — if false, `bibNumbers` attribute is NOT written to DynamoDB.
**Expected**: DynamoDB photo record after `UpdatePhotoStatus`: `bibNumbers` attribute is absent (not an empty list) because the condition `len(update.BibNumbers) > 0` is false and the SET expression is not extended. On redelivery, `GetPhotoById` unmarshals the record — `photo.BibNumbers` is nil (not `[]string{}`). `len(nil) > 0` is false, so `finalStatus` correctly derives as `"review_required"`.
**Why it matters**: This confirms the redelivery path in TC-006 works correctly even when `bibNumbers` is absent from the DynamoDB item rather than stored as an empty list. If the code checked `photo.BibNumbers != nil` instead of `len(photo.BibNumbers) > 0`, it would behave differently.

---

### TC-024: Rekognition returns only WORD-type detections, no LINE-type — extractBibs returns empty

**Category**: Boundary values
**Setup**: Photo-processor receives S3 notification. `DetectText` returns TextDetections containing a bib-shaped numeric string (e.g. "404") but with `Type=WORD` (not `LINE`).
**Action**: Process through `extractBibs`.
**Expected**: `extractBibs` filters out WORD-type detections (line 260: `d.Type != types.TextTypesLine`). Result: empty bibs, `finalStatus="review_required"`, `status=watermarking` written with no `bibNumbers`.
**Why it matters**: Rekognition returns both LINE and WORD detections for the same text. Only LINE detections are used as bib numbers. If a photo contains bib "404" detected only as WORD-type (edge case with low-contrast images), the photo goes to `review_required`. This is intentional per the existing filtering logic.

---

### TC-025: `?status=watermarking` API filter returns photos with thumbnailUrl always null

**Category**: State machine (backend API)
**Setup**: DynamoDB has 3 photos with `status=watermarking` and `watermarkedS3Key` absent (correctly absent — they haven't completed yet).
**Action**: `GET /events/{eventId}/photos?status=watermarking` with valid photographer JWT.
**Expected**: HTTP 200. Response array has 3 items. Each item has `"status":"watermarking"` and `"thumbnailUrl":null` (or absent). No item has a non-null `thumbnailUrl`. Consistent with AC6.
**Why it matters**: If the list-event-photos handler constructs `thumbnailUrl` from `watermarkedS3Key` and that field is absent, the handler must explicitly return `null` rather than an empty string or omit the field. An empty `thumbnailUrl` in the JSON response could cause the Angular component to attempt an `<img src="">` fetch.

---

## Risk areas

**RISK-1 (HIGH): Integration tests do not compile after RS-017.** `TestIntegration_UpdateWatermarkedKey` calls `store.UpdateWatermarkedKey` which no longer exists (TC-014). `TestIntegration_GetWatermarkText` assigns a three-return-value function to a single variable (TC-015). Both tests were written against the pre-RS-017 interface and have not been updated. `make test-integration` will fail at the compile step. The developer must update both tests before marking the story done. The new `TestIntegration_CompleteWatermark` test must assert that both `watermarkedS3Key` and `status` fields are written in the same DynamoDB item.

**RISK-2 (HIGH): FinalStatus is not validated against an allowlist anywhere in the pipeline.** TC-001 shows that an arbitrary `finalStatus` value (e.g. `"error"`, `"processing"`, `"uploading"`) passed through the WatermarkMessage would be written verbatim to DynamoDB by `CompleteWatermark`. There is no validation in the watermark handler, the store, or the WatermarkMessage struct. A photo-processor bug that serialises the wrong `FinalStatus` silently corrupts the photo record with no error returned. Recommendation: add an allowlist check in `processMessage` after the nil check — `if wm.FinalStatus != "indexed" && wm.FinalStatus != "review_required" { return fmt.Errorf(...) }`.

**RISK-3 (MEDIUM): Concurrent photo-processor invocations can call Rekognition twice for the same photo, violating domain rule 10.** TC-008 documents this gap. The current concurrency cap (`fix/sqs-max-concurrency-stopgap`) mitigates it at the infrastructure level, but does not eliminate it — a Lambda timeout and redelivery before the DynamoDB write completes is still possible. The fix acknowledged in the branch is a known stopgap. Until an optimistic lock (`ConditionExpression: #st = :processing` on `UpdatePhotoStatus`) is added, domain rule 10 is not fully guaranteed. This gap should be flagged in the story's Definition of Done.
