# QA Plan: RS-007 — Photo processing pipeline (Rekognition + watermark)

## Scope

- `lambdas/photo-processor/handler/handler.go` — `ProcessBatch`, `processMessage`, `extractBibs`
- `lambdas/photo-processor/handler/store.go` — `DynamoPhotoStore`, `DynamoBibIndexStore`, `SqsWatermarkQueue`
- `lambdas/watermark/handler/handler.go` — `ProcessBatch`, `processMessage`
- `lambdas/watermark/handler/store.go` — `DynamoEventStore`, `DynamoPhotoStore`, `S3PhotoReader`, `S3PhotoWriter`
- `lambdas/watermark/handler/watermarker.go` — `GgWatermarker.ApplyTextWatermark`

---

## Test cases

### TC-001: S3 key with extra path segments

**Category**: Boundary
**Setup**: No DynamoDB records required.
**Action**: Deliver an SQS message whose S3 key has more than 4 segments, e.g. `prod/evt-001/photo-abc/subdir/nested/race.jpg`. The handler splits on `/` and takes `parts[2]` as photoId.
**Expected**: `photoId` is still correctly parsed as `photo-abc`. No batchItemFailure. `GetPhotoById` is called with `photo-abc`.
**Why it matters**: The tech note says "split on `/` to extract photoId at index 2". If a photographer uploads into a sub-folder the key gains extra segments. The current code does `len(parts) < 4` guard only — it does not validate that parts beyond index 3 are absent. A key like `prod/evt/photo/subdir/file.jpg` will silently extract the correct photoId, but a key like `prod/evt/photo` (3 parts, no filename) would panic on `parts[2]` after the `< 4` guard lets it through — this case is covered by TC-002.

---

### TC-002: S3 key with exactly 3 segments (no filename)

**Category**: Boundary
**Setup**: No DynamoDB records required.
**Action**: Deliver an SQS message with S3 key `prod/evt-001/photo-abc` (3 parts). The `len(parts) < 4` guard triggers.
**Expected**: Message is added to `batchItemFailures`. `GetPhotoById` is never called. Error logged with the malformed key.
**Why it matters**: A misconfigured S3 notification or a test upload without a filename component would produce a 3-part key. The guard catches it, but the test confirms no panic and correct routing to DLQ path.

---

### TC-003: S3 event body contains multiple Records (batch notification)

**Category**: Boundary
**Setup**: No DynamoDB records required.
**Action**: Deliver a single SQS message whose body has `Records` with 2 S3 objects (e.g. AWS can batch S3 notifications). The handler currently processes only `ev.Records[0]`.
**Expected**: Currently only the first record is processed; the second is silently dropped. This is a defect-detection test — expected result should be that both records are processed, OR that the handler documents that S3 notifications are always single-record.
**Why it matters**: AWS S3 notification batching is documented as "one record per SQS message" in the S3 docs for standard S3 event notifications, but SNS fanout or EventBridge relay may deliver batched payloads. If a second S3 object is silently skipped, it will never be processed and no error surfaces. The handler should either assert `len == 1` and fail loudly, or iterate all records.

---

### TC-004: S3 key contains URL-encoded characters

**Category**: Boundary / Input validation
**Setup**: No DynamoDB records required.
**Action**: Deliver an SQS message whose S3 key is URL-encoded as delivered by S3 notifications, e.g. `prod/evt-001/photo-abc/race+photo%202024.jpg`. The raw key string (with `+` and `%20`) is passed as-is to `GetPhotoById` via `parts[2]` — but `parts[2]` is the photoId segment, not the filename, so this is fine unless the eventId or photoId itself contains encoded characters.
**Expected**: If the photoId segment itself contains a `%`-encoded character (e.g. `photo%2Dabc`), `GetPhotoById` is called with the encoded string, which will not match the DynamoDB record stored with the decoded value `photo-abc`. Result: `ErrNotFound`, message added to batchItemFailures.
**Why it matters**: S3 event notifications URL-encode keys containing spaces or special characters. The photoId should be a UUID/slug (no encoding needed), but if any client uploads with a non-ASCII photoId, the lookup silently fails.

---

### TC-005: Empty SQS batch (zero records)

**Category**: Boundary
**Setup**: No DynamoDB records required.
**Action**: Call `ProcessBatch` with `events.SQSEvent{Records: []events.SQSMessage{}}`.
**Expected**: Returns `events.SQSEventResponse{}` with empty `BatchItemFailures`. No error. No calls to any dependency.
**Why it matters**: Lambda event source mapping can theoretically deliver empty batches during scale-in. A nil-pointer dereference in the loop would crash the function.

---

### TC-006: Confidence threshold boundary — exactly at threshold

**Category**: Boundary
**Setup**: `Handler.ConfidenceMin = 0.80`; Rekognition returns a detection with `Confidence = 80.0` (exactly 80.0, which is `0.80 * 100`).
**Action**: Call `ProcessBatch` with a valid SQS message containing the above detection.
**Expected**: The detection at exactly 80.0 should be included (threshold is `< h.ConfidenceMin*100`, i.e. strictly less-than). A detection at 79.99 should be excluded.
**Why it matters**: The filter uses `float64(*d.Confidence) < h.ConfidenceMin*100`. "Strictly less than" means 80.0 passes. The ACs say "above threshold" which is ambiguous. A unit test for exactly-at-threshold confirms whether the boundary is inclusive or exclusive and matches the product intent.

---

### TC-007: Confidence threshold boundary — floating-point precision

**Category**: Boundary
**Setup**: `Handler.ConfidenceMin = 0.80`; Rekognition returns `Confidence = float32(80.0)` cast to `float64`.
**Action**: Verify `float64(float32(80.0))` evaluates to exactly `80.0` vs potential float32 precision drift.
**Expected**: No false exclusion due to float32→float64 cast. Detection at `Confidence=80.0` is included.
**Why it matters**: `d.Confidence` is `*float32`. The comparison casts it: `float64(*d.Confidence) < h.ConfidenceMin*100`. If `float32(0.8)` when cast to float64 becomes `0.800000011920929`, then `0.800000011920929 * 100 = 80.0000011920929`, and `float64(float32(80.0)) = 80.0`, so `80.0 < 80.0000011920929` would be true, incorrectly excluding the detection. This is a real edge case.

---

### TC-008: Bib number that parses as integer but is implausibly large

**Category**: Boundary / Input validation
**Setup**: Rekognition returns a LINE detection with text `"9999999"` and confidence 95.0.
**Action**: Call `ProcessBatch` with this detection above threshold.
**Expected**: Current code accepts any string that `strconv.Atoi` parses as int. `9999999` is returned as a bib number, `status=indexed`, and written to the bib-index table.
**Why it matters**: A license plate, street number, or stadium seat number could parse as a 7-digit integer and be stored as a valid bib. There is no upper-bound validation on bib number range. This may be acceptable in v1, but should be a deliberate decision documented in the plan.

---

### TC-009: Bib number with leading zeros

**Category**: Boundary / Input validation
**Setup**: Rekognition returns text `"007"` and `"7"` as two separate LINE detections above threshold.
**Action**: Call `ProcessBatch` with both detections.
**Expected**: `strconv.Atoi("007")` returns `7`, no error. `strconv.Atoi("7")` also returns `7`. After deduplication (seen map on raw text), `"007"` and `"7"` are stored as two distinct bibs because the deduplication key is the raw text string, not the parsed integer.
**Why it matters**: Bib `007` and bib `7` may be the same person if the race uses zero-padded numbers. The bib-index would have two separate entries pointing to the same photo — runner searching for `7` would find it, runner searching for `007` would also find it. This creates duplicate purchase opportunities for the same photo and same runner. The product team should decide whether to normalise bib strings.

---

### TC-010: Rekognition returns WORD-type detection only (no LINE detections)

**Category**: Boundary
**Setup**: Rekognition returns detections of type `WORD` only, no `LINE` detections.
**Action**: Call `ProcessBatch` with detections all typed as `types.TextTypesWord`.
**Expected**: `extractBibs` filters to `LINE` type only. All WORD detections are skipped. `status=review_required`, watermark message sent.
**Why it matters**: Rekognition returns both WORD and LINE results for the same text. The filter correctly keeps only LINE (to avoid double-counting). This test confirms that a photo where Rekognition identifies individual words but not lines (unusual but possible for partial image crops) does not cause a false `indexed` status.

---

### TC-011: Photo record does not exist in DynamoDB when processing queue message

**Category**: State machine
**Setup**: Photo record is NOT seeded in DynamoDB before the SQS message is delivered (e.g. race condition where S3 notification fires before the presign Lambda writes the photo record, or the photo record was deleted).
**Action**: Deliver a valid SQS message referencing a `photoId` that has no DynamoDB record.
**Expected**: `GetPhotoById` returns `apperrors.ErrNotFound`. The message is added to `batchItemFailures`. After 3 attempts it moves to DLQ. The photo is never processed.
**Why it matters**: Domain rule 8 says processing is always async. There is a time window between the S3 upload completing and the processing Lambda running. If the photo record write to DynamoDB is delayed or fails, the processor will hit `ErrNotFound`. The current code treats this as a retryable infrastructure error (correct), but the test verifies the error path rather than a crash. There is no test case for this in the existing test suite.

---

### TC-012: Photo already has status=indexed when processor runs (duplicate delivery)

**Category**: State machine / Idempotency
**Setup**: Photo record exists in DynamoDB with `status=indexed`. SQS delivers the same message twice (visibility timeout expired and re-delivered before the first invocation's watermark queue message was processed).
**Action**: Call `ProcessBatch` with the same S3 key twice (simulating redelivery).
**Expected**: Both calls succeed. `UpdatePhotoStatus` is called twice with `status=indexed`. BibIndex entries are written again (idempotent upsert if DynamoDB PutRequest is used). Watermark queue receives a second message.
**Why it matters**: Domain rule 10 says Rekognition is called exactly once. But SQS has at-least-once delivery. If the first invocation succeeded but the SQS message was not acknowledged (Lambda crash after DynamoDB write but before returning), the message is redelivered. The current code has no conditional check before calling Rekognition a second time — it will call `DetectText` again, violating domain rule 10 and incurring additional Rekognition cost. There is no idempotency guard (e.g. check current photo status before calling Rekognition).

---

### TC-013: Rekognition error path — UpdatePhotoStatus (error) itself fails

**Category**: Failure injection
**Setup**: Rekognition mock returns an error. `UpdatePhotoStatus` mock also returns an error.
**Action**: Call `ProcessBatch`. Rekognition fails, then the attempt to write `status=error` to DynamoDB also fails.
**Expected**: `processMessage` returns a non-nil error. The message is added to `batchItemFailures` and will be retried.
**Why it matters**: AC3 says "Rekognition errors write status=error and ack". But if the DynamoDB write for the error status itself fails, the handler correctly escalates to a batchItemFailure (retryable). The existing test for AC3 only mocks the happy path where `UpdatePhotoStatus` succeeds. The test for the double-failure path is absent.

---

### TC-014: WriteBibEntries fails after UpdatePhotoStatus succeeds (partial write)

**Category**: Failure injection
**Setup**: `UpdatePhotoStatus` mock returns nil (success). `WriteBibEntries` mock returns an error.
**Action**: Call `ProcessBatch` with a photo that has bibs detected.
**Expected**: The message is added to `batchItemFailures`. On retry, `UpdatePhotoStatus` is called again (setting status=indexed again — idempotent). `WriteBibEntries` is retried.
**Why it matters**: If `UpdatePhotoStatus` writes `status=indexed` but `WriteBibEntries` fails, the photo appears indexed in DynamoDB but has no bib-index entries. Runners searching by bib number would never find this photo. On SQS retry, the processor re-runs Rekognition (domain rule 10 violation) and re-writes the bib index. The current code has no test for this sequence. The missing bib-index entries between retries are a data-consistency gap.

---

### TC-015: SendWatermarkMessage fails after bib index is written

**Category**: Failure injection
**Setup**: `UpdatePhotoStatus` returns nil, `WriteBibEntries` returns nil, `SendWatermarkMessage` returns an error.
**Action**: Call `ProcessBatch`.
**Expected**: Message added to `batchItemFailures`. On retry: `UpdatePhotoStatus` re-called, `WriteBibEntries` re-called (duplicate bib entries written via `PutRequest`, which is idempotent), `SendWatermarkMessage` retried.
**Why it matters**: SQS `SendMessage` can fail transiently. The retry is correct. But `WriteBibEntries` uses `BatchWriteItem` PutRequests, which will overwrite existing items (idempotent). The test should verify that a second `WriteBibEntries` for the same photo does not create duplicate bib entries in the table.

---

### TC-016: BatchWriteItem returns non-empty UnprocessedItems on both attempts

**Category**: Failure injection
**Setup**: `DynamoBibIndexStore.writeChunk` — first `BatchWriteItem` call returns `UnprocessedItems` with 1 item. Second (retry) call also returns `UnprocessedItems` with 1 item.
**Action**: Call `WriteBibEntries` with the above mock.
**Expected**: Returns a non-nil error: `"WriteBibEntries: items still unprocessed after retry"`. The caller adds the message to `batchItemFailures`.
**Why it matters**: The retry logic retries exactly once. If DynamoDB is still throttling on the second attempt, the error is returned correctly. However, it leaves orphaned bib index entries — the first batch (before the unprocessed item) is committed but the unprocessed item is lost. Callers should be aware that `WriteBibEntries` is not atomic.

---

### TC-017: Large multi-bib photo — 26+ detected bibs (exceeds batch size boundary)

**Category**: Boundary
**Setup**: Rekognition returns 26 unique integer-parseable LINE detections above threshold for a single photo.
**Action**: Call `extractBibs` with 26 detections, then call `WriteBibEntries` with 26 entries.
**Expected**: `WriteBibEntries` correctly splits into two chunks: first chunk of 25, second chunk of 1 (const `dynamoBatchSize = 25`). Both chunks are written successfully.
**Why it matters**: `dynamoBatchSize` is 25, matching DynamoDB's `BatchWriteItem` limit. The chunking code exists but there is no unit test exercising the 26-entry path. A boundary test confirms the split logic works.

---

### TC-018: Watermark handler receives message with empty photoId

**Category**: Input validation
**Setup**: No DynamoDB records required.
**Action**: Deliver an SQS message with body `{"photoId":"","eventId":"evt-001","rawS3Key":"local/evt-001/photo-abc/race.jpg"}`.
**Expected**: `processMessage` returns an error (the `wm.PhotoID == ""` guard triggers). Message added to `batchItemFailures`.
**Why it matters**: The guard on line 57 of watermark `handler.go` checks for empty required fields. This is the correct path. The test confirms it is reached before any S3 or DynamoDB calls.

---

### TC-019: Watermark handler — event has no watermarkText set (empty string)

**Category**: Boundary
**Setup**: Event record exists in DynamoDB with `watermarkText = ""` (photographer saved event without setting custom text).
**Action**: Deliver a valid watermark SQS message for this event.
**Expected**: `GetWatermarkText` returns `""` (no error — the item exists, the field is just empty). `ApplyTextWatermark` is called with an empty string. The watermark bar is rendered with no visible text. Photo is watermarked and stored.
**Why it matters**: The story says "The default when no custom text is set: `{event_name} · racephotos.example.com`". The current `GetWatermarkText` implementation reads the `watermarkText` attribute and returns whatever is stored, including empty string. There is no fallback default logic. If `watermarkText` is absent from the DynamoDB item (the field was never set, not set to empty string), the unmarshalled struct field will be the zero value `""`. The photographer would get a watermark with an invisible empty text — no event name, no URL. This is a missing feature vs. the stated default.

---

### TC-020: Watermark handler — event does not exist (eventId not in DynamoDB)

**Category**: State machine
**Setup**: No event record for the given eventId.
**Action**: Deliver a watermark SQS message with a valid photoId but an eventId that has no DynamoDB record.
**Expected**: `GetWatermarkText` returns `apperrors.ErrNotFound`. Message added to `batchItemFailures`. Photo remains without a watermarked copy.
**Why it matters**: The photo-processor queues the watermark message immediately after processing. If the event record was deleted between photo upload and watermark processing, the watermark Lambda fails. After 3 DLQ retries the photo is stuck with no watermarked copy, blocking runner preview. There is no dead-letter handling documented for this scenario.

---

### TC-021: Watermark S3 GetObject — file does not exist (NoSuchKey)

**Category**: Failure injection
**Setup**: Event record exists. Photo record exists. S3 raw bucket does not contain the object.
**Action**: Deliver a watermark SQS message. `GetObject` returns an S3 `NoSuchKey` error.
**Expected**: `processMessage` returns a non-nil error. Message added to `batchItemFailures`. After 3 retries it moves to DLQ.
**Why it matters**: If the raw S3 object was deleted before the watermark Lambda ran (e.g. lifecycle rule misconfiguration, or manual deletion), the Lambda should fail gracefully rather than panic. There is no test for this path. The error should log the key and eventId/photoId for operator debugging.

---

### TC-022: Watermark applied to a non-JPEG image (PNG uploaded by photographer)

**Category**: Boundary / Input validation
**Setup**: Photographer uploads a PNG. S3 raw bucket contains a PNG. Watermark Lambda receives the message.
**Action**: `GetObject` returns a valid PNG byte stream. `GgWatermarker.ApplyTextWatermark` calls `image.Decode` which returns the PNG (since `_ "image/png"` is imported in `watermarker.go`). The watermarked copy is encoded with `jpeg.Encode`.
**Expected**: PNG is decoded successfully, watermark is applied, and the output is stored as JPEG regardless of the input format. `watermarkedS3Key` ends in `/watermarked.jpg` and content type is `image/jpeg`.
**Why it matters**: The presign Lambda (RS-006) accepts any content type for upload. If a photographer uploads a PNG, the watermark Lambda silently converts it to JPEG. This is arguably correct behaviour, but there is no test verifying PNG input → JPEG output. Additionally, the `image.Decode` call could return a format not registered (e.g. HEIC/HEIF from iPhone cameras), which would return `image: unknown format` — causing a batchItemFailure and the photo never getting watermarked.

---

### TC-023: Watermark applied to a zero-byte / corrupt image

**Category**: Failure injection
**Setup**: S3 raw bucket contains a zero-byte object (partial upload that passed the presign step).
**Action**: `GetObject` returns an empty `io.ReadCloser`. `image.Decode` is called on an empty reader.
**Expected**: `image.Decode` returns an error (`unexpected EOF` or `image: unknown format`). `ApplyTextWatermark` returns a non-nil error. Message added to `batchItemFailures`. After 3 retries, moves to DLQ.
**Why it matters**: A photographer's upload may be interrupted. The raw bucket could hold a zero-byte object. The watermark Lambda should fail gracefully and let the DLQ alert the operator rather than looping infinitely. This scenario is not tested.

---

### TC-024: PutObject to processed bucket — S3 write fails

**Category**: Failure injection
**Setup**: All steps before `PutObject` succeed. `PutObject` mock returns an S3 `AccessDenied` or throttling error.
**Action**: Call `ProcessBatch` on the watermark handler.
**Expected**: `processMessage` returns a non-nil error. Message added to `batchItemFailures`. `UpdateWatermarkedKey` is NOT called.
**Why it matters**: The watermarked image is uploaded to S3 before `UpdateWatermarkedKey` is called in DynamoDB. If PutObject fails, the DynamoDB record is not updated — consistent state. On retry, PutObject is re-attempted. This test verifies no partial writes: DynamoDB is not updated unless S3 write succeeds.

---

### TC-025: UpdateWatermarkedKey fails after PutObject succeeds

**Category**: Failure injection
**Setup**: `PutObject` mock returns nil. `UpdateWatermarkedKey` mock returns an error.
**Action**: Call `ProcessBatch` on the watermark handler.
**Expected**: Message added to `batchItemFailures`. On retry, `PutObject` is called again (S3 object is overwritten with identical content — idempotent). `UpdateWatermarkedKey` is retried.
**Why it matters**: This is the watermark Lambda's own "partial write" scenario. The S3 object exists but DynamoDB does not know about it. Runners cannot see the watermarked photo even though it is in S3. The retry will fix this eventually, but the test documents the expected retry behaviour and confirms no crash.

---

### TC-026: Concurrent duplicate watermark messages for the same photo

**Category**: Concurrency
**Setup**: Photo record and event record exist in DynamoDB. Two identical watermark SQS messages are in-flight simultaneously (SQS visibility timeout edge case, or message duplication).
**Action**: Two watermark Lambda invocations run concurrently for the same `photoId`.
**Expected**: Both invocations succeed independently. Both call `PutObject` with the same key — the second write overwrites the first (last-writer-wins, idempotent). Both call `UpdateWatermarkedKey` with the same value — both DynamoDB writes succeed (no conditional expression, so both overwrite). Final state is correct.
**Why it matters**: There is no deduplication or locking in the watermark Lambda. Concurrent processing of the same photo produces a double S3 write and double DynamoDB write, both idempotent. This is safe but wasteful. The test documents that this is a deliberate design choice and not a latent bug.

---

### TC-027: Concurrent duplicate processing messages for the same photo (Rekognition called twice)

**Category**: Concurrency / State machine
**Setup**: Photo record exists with `status=processing`. Two SQS messages for the same photo are delivered to two concurrent Lambda invocations.
**Action**: Both invocations call `GetPhotoById`, `DetectText`, `UpdatePhotoStatus`, `WriteBibEntries`, and `SendWatermarkMessage`.
**Expected**: Rekognition is called twice (domain rule 10 violation). Two watermark queue messages are sent. Two sets of bib index entries are written (idempotent BatchWriteItem PutRequests). The DynamoDB photo record ends in a consistent state (last writer wins on status and bibs, which are the same values anyway).
**Why it matters**: Domain rule 10 is "Rekognition is called exactly once per photo". The current implementation has no guard (no conditional update before calling Rekognition, no status check). SQS at-least-once delivery can trigger this. This is a real risk for Rekognition billing and a rule violation. Developer attention required: should check `photo.Status != "processing"` before calling DetectText.

---

### TC-028: Photo-processor writes `review_required` but does NOT write bib entries — watermark still queued

**Category**: State machine
**Setup**: Rekognition returns no detections above threshold.
**Action**: Call `ProcessBatch`. No bibs extracted.
**Expected**: `status=review_required`. `WriteBibEntries` is NOT called. `SendWatermarkMessage` IS called with the photoId, eventId, and rawS3Key.
**Why it matters**: The AC says "a message is published to the watermark queue" regardless of bib detection outcome (comment in `handler.go` line 148 confirms this). The existing unit test for this case mocks `SendWatermarkMessage` with `gomock.Any()` rather than asserting the exact message shape. A test should verify the exact watermark message fields to catch future regressions where, e.g., an empty eventId is sent.

---

### TC-029: Local Rekognition mock — photoId file not present in testdata

**Category**: Boundary (AC6)
**Setup**: `RACEPHOTOS_ENV=local`. `testdata/rekognition-responses/{photoId}.json` does not exist.
**Action**: Process a photo whose ID has no corresponding mock file.
**Expected**: The file-backed mock returns an empty `DetectTextOutput` (zero detections). Photo gets `status=review_required`. Watermark message is queued.
**Why it matters**: AC6 explicitly states "returning zero detections" when no file is present. If the mock instead errors on a missing file, photos in local dev would always error rather than going to `review_required`. This is a developer-experience test.

---

### TC-030: Local Rekognition mock — photoId file contains malformed JSON

**Category**: Failure injection (AC6)
**Setup**: `RACEPHOTOS_ENV=local`. `testdata/rekognition-responses/{photoId}.json` exists but contains invalid JSON.
**Action**: Process a photo whose mock file is corrupt.
**Expected**: The mock should return an error (or fallback to zero detections — policy must be defined). If the mock errors, the handler writes `status=error` and acks the message (AC3 path).
**Why it matters**: A developer creating a test fixture with a syntax error in the JSON should see a clear failure, not a silent zero-detection result that masks the problem.

---

### TC-031: GgWatermarker — very long watermark text (exceeds image width)

**Category**: Boundary
**Setup**: Event has `watermarkText` that is 500 characters long (e.g. a URL-heavy string).
**Action**: Deliver a watermark SQS message for a standard 800×600 image with this event.
**Expected**: `DrawStringAnchored` renders the text centred — if the text exceeds image width, it will overflow or be clipped. The current implementation uses a fixed font size (32pt) and does not wrap or scale text. Result: text overflow, visible clipping, or invisible text.
**Why it matters**: The `gg` library draws text without wrapping. A photographer who sets a very long event name or URL will get a broken watermark silently — no error returned, photo stored as watermarked. The `ApplyTextWatermark` function should validate or truncate the text, or the EventStore should enforce a max length at event creation time.

---

### TC-032: GgWatermarker — image height is less than the bar height calculation

**Category**: Boundary
**Setup**: Photo is an extremely small image, e.g. 10×10 pixels.
**Action**: Deliver a watermark SQS message for this image.
**Expected**: `barH = watermarkFontSize*1.8 + watermarkPaddingFrac*height = 32*1.8 + 0.05*10 = 57.6 + 0.5 = 58.1`. The bar height (58.1px) exceeds the image height (10px). `DrawRectangle(0, height-barH, ...)` draws at `y = 10 - 58.1 = -48.1`. The `gg` library may clip or draw outside bounds. The watermark bar may cover the entire image or draw nothing.
**Why it matters**: While rare for a real race photo, a test image or a thumbnail could be tiny. The watermark renderer should guard against `barH >= height` and skip or scale the overlay rather than producing a fully-covered or corrupted output.

---

### TC-033: DynamoDB returns ProvisionedThroughputExceededException on GetPhotoById

**Category**: Failure injection
**Setup**: `GetPhotoById` mock returns a `ProvisionedThroughputExceededException`.
**Action**: Call `ProcessBatch`.
**Expected**: `processMessage` returns a non-nil error wrapping the DynamoDB error. Message is added to `batchItemFailures`. SQS will retry up to `maxReceiveCount` (3) before moving to DLQ. CloudWatch DLQ alarm fires.
**Why it matters**: DynamoDB on-demand capacity absorbs burst but can still throttle during very large event uploads (5,000 photos). The retry path must be correctly wired. This scenario is not explicitly tested.

---

### TC-034: SQS message has a duplicate MessageId across two records in the same batch

**Category**: Boundary / Concurrency
**Setup**: Two SQS messages with the same `MessageId` but different bodies appear in a single batch (this should not happen in practice but tests defensive coding).
**Action**: Call `ProcessBatch` with two records where both have `MessageId = "msg-1"` but different S3 keys.
**Expected**: Both messages are processed. If both fail, `BatchItemFailures` contains two entries with `ItemIdentifier = "msg-1"`. SQS deduplication behaviour with duplicate identifiers in a response is undefined — the behaviour should be documented.
**Why it matters**: The partial batch failure response uses `ItemIdentifier = msg.MessageId`. If the SQS batch contains duplicate IDs, the failure list may have duplicate entries, and SQS may not correctly retry only the failed messages.

---

## Risk areas

1. **Domain rule 10 — no Rekognition deduplication guard** (TC-027): The handler calls `DetectText` unconditionally without first checking whether `photo.Status` has already moved beyond `processing`. SQS at-least-once delivery will cause duplicate Rekognition calls for any photo whose SQS message is redelivered (which happens whenever the Lambda crashes or times out after DynamoDB writes but before acking). This is the highest-risk gap because it silently violates a stated domain rule, incurs unintended AWS billing, and the existing tests do not cover it. A fix requires a status check before `DetectText`: if `photo.Status != "processing"`, skip Rekognition and re-queue watermark directly.

2. **S3 multi-record notification body silently drops records** (TC-003): `processMessage` processes only `ev.Records[0]` and ignores any additional records in the S3 event notification body. AWS typically sends one S3 record per SQS message, but EventBridge or SNS relays can batch them. A second record being silently dropped means a photo is permanently unprocessed with no error signal — it would not appear in the photographer's review queue, violating domain rule 9 (errors must surface, never be silently dropped). The fix is either an assertion that `len(ev.Records) == 1` (fail loudly if >1) or a loop over all records.

3. **Missing watermarkText default fallback** (TC-019): When an event's `watermarkText` attribute is absent or empty in DynamoDB, the watermark Lambda applies a blank watermark (no visible text). The product spec states a default of `{event_name} · racephotos.example.com`. The `GetWatermarkText` store does not return the event name — only the `watermarkText` attribute via a projection. If the watermark Lambda needs to construct the default, it also needs the event `name` field, which requires either a broader projection or a separate query. This is a feature gap that would result in photographer photos being watermarked with invisible text.
