# QA Plan: RS-009 — Runner Photo Search

## Scope

- Lambda: `lambdas/search/` — `GET /events/{id}/photos/search?bib={bibNumber}`
- Store implementations: `DynamoBibIndexReader`, `DynamoPhotoBatchGetter`, `DynamoEventGetter`
- Angular components: `EventSearchComponent`, `PhotoGridComponent`, `PhotoCardComponent`, `PhotoDetailComponent`
- CDN URL construction: `https://{RACEPHOTOS_PHOTO_CDN_DOMAIN}/{watermarkedS3Key}`

---

## Test cases

### TC-001: Single-digit bib number

**Category**: Boundary  
**Setup**: Event record exists. BibIndex has one entry for bib `"1"` pointing to an indexed photo with a non-empty `watermarkedS3Key`.  
**Action**: `GET /events/{id}/photos/search?bib=1`  
**Expected**: HTTP 200; `photos` array contains exactly one item; `watermarkedUrl` is a valid CloudFront URL.  
**Why it matters**: The bib validation regex in the handler has no lower-bound length check. A single character is valid and must not be rejected or silently dropped.

---

### TC-002: Six-digit bib number (upper realistic bound)

**Category**: Boundary  
**Setup**: Event record exists. BibIndex has an entry for bib `"999999"` (six digits).  
**Action**: `GET /events/{id}/photos/search?bib=999999`  
**Expected**: HTTP 200; matching photo returned.  
**Why it matters**: Large races (ultra-marathons, marathon majors) can assign 5–6 digit bib numbers. No length limit is enforced by the handler; verify the DynamoDB key construction `{eventID}#{bibNumber}` handles this correctly without truncation.

---

### TC-003: Bib number with leading zeros

**Category**: Boundary  
**Setup**: BibIndex written by the photo-processor contains key `{eventID}#007`. BibIndex also contains `{eventID}#7`.  
**Action 1**: `GET /events/{id}/photos/search?bib=007`  
**Action 2**: `GET /events/{id}/photos/search?bib=7`  
**Expected**: Action 1 returns only photos tagged with bib `"007"`. Action 2 returns only photos tagged with bib `"7"`. The two result sets are distinct — no cross-matching.  
**Why it matters**: The bib-index PK is a string concatenation. `"007"` and `"7"` are different strings. If the processor wrote `"007"` (preserving leading zeros from Rekognition output) but the search query strips them, the runner gets zero results. The opposite is also a bug. Neither the handler test nor the integration test covers this case.

---

### TC-004: Bib number exactly 100 characters long

**Category**: Boundary  
**Setup**: None required.  
**Action**: `GET /events/{id}/photos/search?bib=` followed by a 100-character alphanumeric string.  
**Expected**: Handler passes the bib string through to `GetPhotoIDsByBib`; DynamoDB query runs; returns `{ photos: [] }` (no match), HTTP 200.  
**Why it matters**: No upper-length guard exists on the bib parameter. A pathologically long string creates an arbitrarily wide DynamoDB key. Confirm the system does not panic, does not truncate silently, and returns a sane empty result rather than a 500.

---

### TC-005: Bib number longer than 1 KB

**Category**: Boundary  
**Setup**: None required.  
**Action**: `GET /events/{id}/photos/search?bib=` followed by a 2048-character string.  
**Expected**: HTTP 400, error message about invalid or too-long bib parameter.  
**Why it matters**: The handler has no length cap on `bib`. Without a guard the DynamoDB composite key `{eventID}#{bib}` can exceed DynamoDB's 2048-byte partition key limit, causing a DynamoDB `ValidationException` that surfaces as a 500 instead of a 400. This is a missing input-validation guard.

---

### TC-006: Empty string bib after URL decode

**Category**: Boundary  
**Setup**: None required.  
**Action**: `GET /events/{id}/photos/search?bib=%20` (a single URL-encoded space, which decodes to `" "`)  
**Expected**: HTTP 400.  
**Why it matters**: The handler checks `bib == ""` but does not trim whitespace. A space character passes the empty check and reaches DynamoDB, producing a key like `{eventID}# ` that will never match and silently returns an empty result instead of a 400. The existing AC10 only specifies the absent/empty param case.

---

### TC-007: Event ID as UUID with uppercase hex digits

**Category**: Boundary  
**Setup**: Event record exists with a UUID stored in mixed case: `"550E8400-E29B-41D4-A716-446655440001"`.  
**Action**: `GET /events/550E8400-E29B-41D4-A716-446655440001/photos/search?bib=101`  
**Expected**: HTTP 200 with valid response. The `(?i)` flag on `uuidRE` accepts both cases; verify the DynamoDB lookup uses the exact string from the path (not normalized), meaning the event must have been stored with the same case.  
**Why it matters**: A mismatch between stored key case and query case causes a silent 404. This exposes whether the system normalizes event IDs at write time.

---

### TC-008: BatchGetPhotos called with exactly 100 photo IDs

**Category**: Boundary  
**Setup**: BibIndex contains 100 entries for one event+bib pointing to 100 distinct photo IDs, all with `status=indexed` and non-empty `watermarkedS3Key`.  
**Action**: `GET /events/{id}/photos/search?bib=101`  
**Expected**: HTTP 200; `photos` array contains 100 items.  
**Why it matters**: DynamoDB `BatchGetItem` has a hard limit of 100 keys per call. The store implementation does not paginate `BatchGetItem` — it makes one call. A bib number appearing in 100 photos (possible at crowded race sections) hits this limit exactly. This is the boundary that should succeed.

---

### TC-009: BatchGetPhotos called with 101 photo IDs

**Category**: Boundary  
**Setup**: BibIndex contains 101 entries for one event+bib.  
**Action**: `GET /events/{id}/photos/search?bib=101`  
**Expected**: Either HTTP 200 with all 101 results (if the store paginates `BatchGetItem`), or HTTP 400/422 with a clear message — but never HTTP 500 from a raw AWS `ValidationException`.  
**Why it matters**: `DynamoPhotoBatchGetter.BatchGetPhotos` makes a single `BatchGetItem` call with no chunking. AWS rejects calls with more than 100 keys with a `ValidationException`. The comment in `store.go` acknowledges this limit but explicitly does not handle it: "For v1 (typically 5–20 photos per bib per event) this is never exceeded." That assumption will break for popular bibs at large races. This is a high-risk gap.

---

### TC-010: UnprocessedKeys returned by BatchGetItem

**Category**: Failure injection  
**Setup**: Mock `BatchGetItem` to return a subset of requested photos in `Responses` and put the remaining keys in `UnprocessedKeys`.  
**Action**: `GET /events/{id}/photos/search?bib=101`  
**Expected**: The store logs the unprocessed keys and the handler returns a 200 with only the photos that were actually returned — not a 500. The response body must not silently omit photos without any indication to the caller.  
**Why it matters**: The store comment says "Unprocessed keys are logged but not retried." The unit tests never inject a partial `BatchGetItem` response. If DynamoDB is under load, runners will silently see fewer photos than they have without any error signal.

---

### TC-011: DynamoDB Query returns paginated bib results (LastEvaluatedKey set)

**Category**: Failure injection / Boundary  
**Setup**: DynamoDB LocalStack bib-index table has more than the default Query page limit of items for one bib key (simulate by inserting 1 MB+ worth of items, or by mocking `LastEvaluatedKey`).  
**Action**: Call `GetPhotoIDsByBib` directly via integration test with a bib that has paginated results.  
**Expected**: All photo IDs across all pages are returned. The pagination loop in `DynamoBibIndexReader` is covered.  
**Why it matters**: The pagination loop exists in the code but is not exercised by any existing test. A bug in the `ExclusiveStartKey` handling would silently drop photos from page 2 onward.

---

### TC-012: DynamoDB ProvisionedThroughputExceededException on GetPhotoIDsByBib

**Category**: Failure injection  
**Setup**: Mock `BibIndexStore.GetPhotoIDsByBib` to return an error wrapping `ProvisionedThroughputExceededException`.  
**Action**: `GET /events/{id}/photos/search?bib=101`  
**Expected**: HTTP 500; response body `{"error":"internal server error"}`; raw AWS error string not exposed in body; error logged with `slog.ErrorContext`.  
**Why it matters**: The handler already maps this to 500, but the test suite only uses `errors.New("ddb failure")`. Confirm the wrapped AWS error type does not change the error-detection path.

---

### TC-013: GetEvent and GetPhotoIDsByBib both fail simultaneously

**Category**: Failure injection  
**Setup**: Mock both `EventStore.GetEvent` and `BibIndexStore.GetPhotoIDsByBib` to return errors.  
**Action**: `GET /events/{id}/photos/search?bib=101`  
**Expected**: HTTP 500. The handler reads `evCh` first and short-circuits on error, draining `bibCh`. No goroutine leak. The bib error is discarded rather than surfaced.  
**Why it matters**: The handler drains `bibCh` after an event error, but the bib error itself is silently swallowed. Verify the goroutine is always drained and the channel is not blocked. The existing test covers event error but not simultaneous dual error.

---

### TC-014: Lambda context cancelled mid-flight (client disconnects)

**Category**: Failure injection  
**Setup**: Inject a context with a 1 ms deadline before calling `h.Handle`.  
**Action**: Call `h.Handle` with an already-cancelled context.  
**Expected**: Both goroutines (GetEvent, GetPhotoIDsByBib) receive the cancelled context and return a `context.DeadlineExceeded` error promptly. Handler returns HTTP 500. No goroutine left blocked on a channel send.  
**Why it matters**: The goroutines use unbuffered semantics on the context passed in but the channels are buffered at capacity 1. If both goroutines are blocked waiting on DynamoDB when the context is cancelled, they still complete and send to the buffered channels — this is correct. But it should be explicitly verified that no goroutine leaks under cancellation.

---

### TC-015: rawS3Key absent from response when all photos are filtered out

**Category**: Security input / State machine  
**Setup**: BibIndex returns 3 photo IDs. All three photos have `status=processing` (none pass the AC4 filter).  
**Action**: `GET /events/{id}/photos/search?bib=101`  
**Expected**: HTTP 200; `photos: []`; response body contains no `rawS3Key` field anywhere.  
**Why it matters**: The existing unit test checks `rawS3Key` is absent on indexed photos. It does not check the empty-result-after-filter path, where the items loop never executes. While the `photoItem` struct omits `rawS3Key` by design, confirm the outer `searchResponse` struct also never leaks it from the event metadata.

---

### TC-016: WatermarkedUrl uses HTTPS and does not contain the raw bucket path

**Category**: Security input  
**Setup**: Indexed photo with `watermarkedS3Key = "processed/evt-123/photo-abc.jpg"` and `rawS3Key = "raw/evt-123/photo-abc.jpg"`.  
**Action**: `GET /events/{id}/photos/search?bib=101`  
**Expected**: `watermarkedUrl` equals `"https://{cdnDomain}/processed/evt-123/photo-abc.jpg"`. The string `"raw/"` must not appear anywhere in the response body.  
**Why it matters**: The unit test verifies this for the happy path, but does not assert that the constructed URL always uses `https://` (not `http://`) and cannot be influenced by a `watermarkedS3Key` value that starts with `../` or contains a protocol prefix already embedded by a bad write.

---

### TC-017: watermarkedS3Key contains path traversal characters

**Category**: Security input  
**Setup**: Insert a photo record into DynamoDB where `watermarkedS3Key = "../../etc/passwd"`, `status=indexed`.  
**Action**: `GET /events/{id}/photos/search?bib=101`  
**Expected**: The URL returned is `"https://{cdnDomain}/../../etc/passwd"`. This is technically safe (the CDN will 404), but the plan should flag whether path sanitization is needed. Alternatively, if the processor sanitizes keys at write time, that sanitization should be verified.  
**Why it matters**: The Lambda constructs CDN URLs by direct string concatenation. A poisoned `watermarkedS3Key` from a corrupted DynamoDB record would produce a malformed CloudFront URL. No sanitization exists in the handler.

---

### TC-018: SQL injection pattern in bib query parameter

**Category**: Security input  
**Setup**: Event exists.  
**Action**: `GET /events/{id}/photos/search?bib=1' OR '1'='1`  
**Expected**: HTTP 200 with `photos: []`. The bib string is used as a DynamoDB partition key value, not in a query expression string — DynamoDB is not SQL-injectable via attribute values. Verify the raw injection string is passed to the DynamoDB SDK as a typed `AttributeValueMemberS`, not interpolated into a raw expression.  
**Why it matters**: The store builds the composite key as `eventID + "#" + bibNumber` and uses it as a typed DynamoDB attribute value, which is immune to injection. The test validates this assumption explicitly rather than relying on code inspection alone.

---

### TC-019: XSS payload in bib query parameter reflected in Angular UI

**Category**: Security input  
**Setup**: Bib search form in Angular; mock the API to return `{ photos: [], eventName: "<script>alert(1)</script>" }` (simulating a compromised event record).  
**Action**: Runner submits any bib number; Angular renders the empty state and event name.  
**Expected**: The `<script>` tag is rendered as escaped text, not executed. Angular's default template binding (`{{ }}`) HTML-encodes values; verify no use of `[innerHTML]` or `bypassSecurityTrustHtml` in `EventSearchComponent`.  
**Why it matters**: If a photographer account is compromised and sets a malicious event name, the Angular template must not execute it. This is an XSS vector through the API response into the DOM.

---

### TC-020: Bib parameter with Unicode characters

**Category**: Security input  
**Setup**: Event exists.  
**Action**: `GET /events/{id}/photos/search?bib=１０１` (Unicode fullwidth digits, URL-encoded).  
**Expected**: HTTP 200 with `photos: []` — the Unicode string does not match any ASCII bib index entry, so an empty result is returned. The handler does not panic on multi-byte input.  
**Why it matters**: No character-class restriction exists on the `bib` parameter. Unicode digits are different code points from ASCII digits. If a runner copies a bib from a results page that uses Unicode numerals, they get an empty result with no explanation. This is a UX gap and a potential confusion vector.

---

### TC-021: Concurrent identical requests for the same event+bib

**Category**: Concurrency  
**Setup**: Event exists with 5 indexed photos for bib `"101"`.  
**Action**: Fire 50 simultaneous `GET /events/{id}/photos/search?bib=101` requests (goroutines or k6/hey load tool).  
**Expected**: All 50 requests return HTTP 200 with identical response bodies (same 5 photos, same event metadata). No request returns a 500 due to DynamoDB throttling or Lambda cold-start contention. No partial results.  
**Why it matters**: The bib-index query is read-only but DynamoDB on-demand can still throttle burst reads. The Lambda itself spawns two goroutines per request — 50 concurrent invocations means 100 simultaneous DynamoDB goroutines. Verify the Lambda does not exhaust file descriptors or connection pool.

---

### TC-022: Photo transitions from processing to indexed during search window

**Category**: Concurrency / State machine  
**Setup**: Photo exists in DynamoDB with `status=processing`. BibIndex entry for this photo already written (possible if processor writes bib-index before updating photo status).  
**Action**: `GET /events/{id}/photos/search?bib=101` while the photo-processor Lambda is mid-flight updating the same photo to `status=indexed`.  
**Expected**: The search Lambda either returns the photo (if the status update landed before `BatchGetPhotos`) or excludes it (if not yet indexed). Both outcomes are correct. The handler must not return a 500 or a partially-populated photo item.  
**Why it matters**: The processor writes the bib-index entry and then updates the photo status in two separate DynamoDB operations with no transaction. A search landing between these two writes will find the bib-index entry but fetch a photo still in `status=processing`. The AC4 filter correctly excludes it, but this timing window is not tested.

---

### TC-023: Multi-bib photo appears in both runners' search results independently

**Category**: State machine (ADR-0003)  
**Setup**: Photo with `status=indexed`, `watermarkedS3Key` non-empty. BibIndex has two entries: `{eventID}#101 -> photoId` and `{eventID}#102 -> photoId` (same photo ID in both).  
**Action 1**: `GET /events/{id}/photos/search?bib=101`  
**Action 2**: `GET /events/{id}/photos/search?bib=102`  
**Expected**: Both responses contain the same photo with the same `watermarkedUrl`. The photo appears once in each result, not twice.  
**Why it matters**: ADR-0003 requires independent search results per bib. This is not covered by any existing test case. A deduplication bug could incorrectly exclude the photo from one runner's results, or include it twice for the runner whose bib appears first in the index.

---

### TC-024: Event with status=draft or status=archived returned in search

**Category**: State machine  
**Setup**: Event record exists with a non-active status (e.g. `status="draft"` or `status="archived"`). BibIndex has entries for this event.  
**Action**: `GET /events/{id}/photos/search?bib=101`  
**Expected**: Clarification needed — the story does not specify whether draft/archived events should return 404 or the full result set. Currently `GetEvent` returns any event by ID with no status check. A draft event with uploaded photos would be publicly searchable.  
**Why it matters**: A photographer uploading photos to a draft event before publishing it does not expect those photos to be publicly discoverable. The handler has no event-status gate. This is a missing business rule that the ACs did not anticipate.

---

### TC-025: Response Cache-Control header on 200 vs 400/500

**Category**: Boundary  
**Setup**: None.  
**Action 1**: Valid request returning HTTP 200.  
**Action 2**: Request with missing bib, returning HTTP 400.  
**Action 3**: Simulated DynamoDB failure, returning HTTP 500.  
**Expected**: 200 response has `Cache-Control: public, max-age=10, no-transform`. 400 and 500 responses have `Cache-Control: no-store`.  
**Why it matters**: If API Gateway or CloudFront caches a 500 response, all subsequent requests for the same path receive the cached error until TTL expires. The handler correctly sets `no-store` on error responses — but this must be verified end-to-end through API Gateway, not just at the Lambda response struct level, since API Gateway can override headers.

---

### TC-026: CORS headers on public endpoint

**Category**: Authorization / Boundary  
**Setup**: None.  
**Action**: `OPTIONS /events/{id}/photos/search` preflight request from a browser with `Origin: https://example.com`.  
**Expected**: Response includes `Access-Control-Allow-Origin` header. The Angular app running on a different origin (or localhost during development) can make the search request without a CORS error.  
**Why it matters**: The endpoint is public and unauthenticated (no Cognito authorizer). CORS must be configured at the API Gateway level. The story and CDK construct do not explicitly mention CORS configuration. A missing CORS header blocks all browser-originating search requests.

---

### TC-027: Angular empty state message contains exact bib number from input

**Category**: UI edge case  
**Setup**: Angular `EventSearchComponent` with mock API returning `{ photos: [], eventName: "...", ... }`.  
**Action**: Runner types bib `"0042"` and submits.  
**Expected**: Empty state message reads: "No photos found for bib 0042. Photos may still be processing — try again later." (AC8). The bib number displayed is the exact string the runner typed, including leading zeros — not a parsed integer.  
**Why it matters**: If Angular binds the bib to a number input or coerces it to an integer, `"0042"` becomes `42` and the empty state message misleads the runner about what was searched.

---

### TC-028: Angular skeleton loader shown while API request is in flight

**Category**: UI edge case  
**Setup**: Angular component with a delayed mock API (simulate 2 second response time).  
**Action**: Runner submits bib number.  
**Expected**: Skeleton loader is visible immediately after form submission. Photo grid and empty state are not rendered until the API responds. After the response, the skeleton disappears and results appear.  
**Why it matters**: The story mentions a skeleton loader but the Playwright tests only assert on final state. A missing loading indicator or a flash of empty-state before results arrive would be a regression invisible to the current test suite.

---

### TC-029: Angular photo-detail MatDialog closes on backdrop click and ESC key

**Category**: UI edge case  
**Setup**: Angular component with at least one photo in the search results grid.  
**Action 1**: Runner clicks a photo to open the detail dialog, then clicks outside the dialog.  
**Action 2**: Runner opens the dialog, then presses Escape.  
**Expected**: Dialog closes cleanly in both cases. No error in browser console. Page returns to the photo grid with scroll position preserved.  
**Why it matters**: `MatDialog` closes on backdrop click and ESC by default, but custom `disableClose` configurations or missing `afterClosed()` subscriptions can cause memory leaks or broken state. The 34 Angular unit tests do not mention dialog dismissal behavior.

---

### TC-030: Angular photo grid on tablet viewport (768px)

**Category**: UI edge case  
**Setup**: Playwright or Storybook test at 768px width.  
**Action**: Render `PhotoGridComponent` with 6 photos.  
**Expected**: Grid layout is 2-column (between the 375px single-column and 1280px multi-column layouts). Form is not cut off. No horizontal scrollbar.  
**Why it matters**: AC9 only mandates 375px (mobile) and the Playwright baseline covers 1280px (desktop). The 768px tablet breakpoint is a common viewport for runners checking photos at the finish line on an iPad. No test covers it.

---

### TC-031: Angular search form prevents submission with whitespace-only bib

**Category**: UI edge case / Input validation  
**Setup**: Angular `EventSearchComponent`.  
**Action**: Runner types `"   "` (spaces only) into the bib field and clicks Submit.  
**Expected**: Form validation fires before API call. Error message shown. No API request sent. The backend's whitespace-bib gap (TC-006) should be defended against at the UI layer first.  
**Why it matters**: HTML `required` validation passes on a whitespace-only string in some browser configurations. Angular's `Validators.required` also passes on `" "`. A `Validators.pattern` or trim+required validator is needed but is not specified in the story.

---

### TC-032: Photo not yet watermarked (watermarkedS3Key empty, status=indexed)

**Category**: State machine  
**Setup**: Photo record with `status=indexed` but `watermarkedS3Key=""` (written by processor before watermark Lambda ran — a race between processor and watermark Lambda).  
**Action**: `GET /events/{id}/photos/search?bib=101`  
**Expected**: Photo is excluded from results (AC4 filter: non-empty `watermarkedS3Key` required). Result is `photos: []` or excludes this photo. Handler does not construct a CDN URL with an empty path component (`"https://{cdnDomain}/"`).  
**Why it matters**: The AC4 filter covers this case conceptually, but the unit test for "no watermark" uses a photo with `status=indexed` and empty key. Confirm the filter is an AND condition (both checks must pass), not an OR. A bug here would produce a malformed CDN URL in the response.

---

## Risk areas

1. **BatchGetItem 100-key hard limit (TC-009)**: The store makes a single `BatchGetItem` call with no chunking. The comment in the code explicitly defers this: "For v1 (typically 5–20 photos per bib per event) this is never exceeded." At a large race with a popular bib (a pacer, a race director), this assumption breaks. AWS returns a `ValidationException` that the handler maps to a 500. The fix (chunk IDs into batches of 100) is straightforward but is unimplemented and untested. This is the highest-risk gap in the backend.

2. **Bib parameter with no length or character-class cap (TC-005, TC-006, TC-020)**: The handler validates the event ID via UUID regex but applies zero validation to the bib parameter beyond an empty check. A 2 KB bib string violates DynamoDB's key size limit and produces a 500 instead of a 400. A whitespace-only bib silently returns an empty result. Both are missing input guards that the existing tests do not probe.

3. **Draft/archived event visibility gate (TC-024)**: The `GetEvent` implementation returns any event by ID regardless of status. There is no event-status guard in the handler. A photographer uploading to a draft event has those photos publicly searchable immediately. This is an unspecified business rule that the ACs do not address — it requires a product decision before a fix can be specified.
