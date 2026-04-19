# QA Plan: RS-013 — Photographer manually tags bib numbers for undetected photos

## Scope

| Component | Coverage |
|---|---|
| `lambdas/tag-photo-bibs` — `PUT /photos/{id}/bibs` | Full handler + store layer |
| `lambdas/list-event-photos` — `GET /events/{id}/photos?status=` | Multi-status filter + pagination cursor |
| `DynamoBibIndexStore.DeleteBibEntriesByPhoto` | BatchWriteItem page boundary at 25 |
| `DynamoBibIndexStore.WriteBibEntries` | BatchWriteItem page boundary at 25 |
| `BibTagInputComponent` | Rapid duplicate chip input |
| `ReviewQueueComponent` | Empty state, cross-tab retag race |

---

## Test cases

### TC-001: Re-tag photo that is already `status=indexed`

**Category**: State machine

**Setup**: DynamoDB contains a photo record with `status=indexed` and `bibNumbers=["101"]`. The event is owned by the calling photographer.

**Action**:
```
PUT /photos/{id}/bibs
Authorization: Bearer <valid JWT, owner>
Content-Type: application/json

{ "bibNumbers": ["202"] }
```

**Expected**: The handler reads the photo, finds `status=indexed`, and — because the AC and tech notes only mention `review_required` or `error` as the use-case — this reveals a gap. The story states "status is updated to `indexed` if bibNumbers is non-empty" with no precondition guard on current status. The handler as implemented will overwrite a legitimately indexed photo's bib assignments without any warning. Expected from a correctness standpoint: either `200` (if retag of indexed is intentional) with the photo's `bibNumbers` replaced, or `422` (if the handler is meant to guard against this). **This test verifies which branch the implementation actually takes and confirms the decision is intentional.**

**Why it matters**: A photographer could accidentally retag a correctly indexed photo (e.g. wrong tab open in browser). If the handler silently accepts the call, previously searchable bibs vanish from the BibIndex with no confirmation prompt to back them up. Domain rule 12 says manual tags are ground truth — but ground truth applied to an already-good photo erases correct data.

---

### TC-002: Concurrent retag of the same photo by the same photographer in two browser tabs

**Category**: Concurrency

**Setup**: Photo exists with `status=review_required`, zero existing BibIndex entries. Two identical PUT requests are fired simultaneously (within the same millisecond window, e.g. via parallel `curl` or two Lambda invocations sharing no lock).

**Action** (both requests, fired in parallel):
```
PUT /photos/{id}/bibs
Authorization: Bearer <valid JWT, owner>

{ "bibNumbers": ["303"] }
```

**Expected**: Both requests complete with `200`. After both settle, exactly one BibIndex entry `{eventId}#303 → photoId` exists (not two). Photo record has `status=indexed` and `bibNumbers=["303"]`.

**Why it matters**: The retag sequence is: (1) query GSI, (2) batch-delete, (3) batch-write, (4) UpdateItem. There is no conditional write or lock. If two invocations interleave at step 2–3, request A may delete the entries just written by request B. The final BibIndex state depends on which `BatchWriteItem` call wins. A duplicate BibIndex entry with the same composite key `{eventId}#{bib}` / `photoId` is idempotent in DynamoDB (same PK = last-writer-wins), so duplication is not the risk — but a **missing entry** is, if one delete races against the other's write.

---

### TC-003: Exactly 25 existing BibIndex entries — single BatchWriteItem page on delete

**Category**: Boundary values

**Setup**: Photo has 25 BibIndex entries already written (`{eventId}#bib-001` through `{eventId}#bib-025`).

**Action**:
```
PUT /photos/{id}/bibs
Authorization: Bearer <valid JWT, owner>

{ "bibNumbers": ["999"] }
```

**Expected**: `200`. After the call, exactly 1 BibIndex entry exists (`{eventId}#999`). The 25 delete operations are batched into exactly one `BatchWriteItem` call (25 == `maxBatchSize`). No second call is made. The photo record has `bibNumbers=["999"]` and `status=indexed`.

**Why it matters**: The batch loop in `DeleteBibEntriesByPhoto` uses `i += maxBatchSize` with `end = min(i+maxBatchSize, len)`. At exactly 25 items, `end = 25`, `i` advances to 25 which equals `len(reqs)` — the loop exits after one iteration. An off-by-one in the slice boundary (`reqs[0:25]` vs `reqs[0:26]`) would panic. This boundary has not been exercised by the unit tests (which mock the store) or the integration test (which writes 2 entries).

---

### TC-004: Exactly 26 existing BibIndex entries — two BatchWriteItem pages on delete

**Category**: Boundary values

**Setup**: Photo has 26 BibIndex entries already written (`{eventId}#bib-001` through `{eventId}#bib-026`).

**Action**:
```
PUT /photos/{id}/bibs
Authorization: Bearer <valid JWT, owner>

{ "bibNumbers": ["999"] }
```

**Expected**: `200`. Delete path issues exactly two `BatchWriteItem` calls (25 + 1). After completion, all 26 old entries are gone and one new entry exists. Photo has `bibNumbers=["999"]`.

**Why it matters**: This is the first multi-page delete. The loop's second iteration starts at `i=25`, computes `end=min(50, 26)=26`, and deletes `reqs[25:26]`. Any fencepost error (e.g. `i < len(reqs)` vs `i <= len(reqs)`) causes the 26th entry to be silently skipped, leaving a stale BibIndex record pointing at the photo. Runners searching for the old bib number would still find the photo in search results.

---

### TC-005: `bibNumbers` list with exactly 25 items — single page write

**Category**: Boundary values

**Setup**: Photo exists with `status=review_required`, no existing BibIndex entries.

**Action**:
```
PUT /photos/{id}/bibs
Authorization: Bearer <valid JWT, owner>

{ "bibNumbers": ["001","002",...,"025"] }   // 25 distinct bib strings
```

**Expected**: `200`. Photo has `status=indexed`, `bibNumbers` has 25 entries. BibIndex has 25 entries. Exactly one `BatchWriteItem` call was made for writes.

**Why it matters**: Mirrors TC-003 on the write path. `WriteBibEntries` uses the same `maxBatchSize=25` loop. The integration test only writes 2 entries. The unit tests mock the store. No test has verified the boundary on the put path.

---

### TC-006: `bibNumbers` list with exactly 26 items — two-page write

**Category**: Boundary values

**Setup**: Photo exists with `status=review_required`, no existing BibIndex entries.

**Action**:
```
PUT /photos/{id}/bibs
Authorization: Bearer <valid JWT, owner>

{ "bibNumbers": ["001","002",...,"026"] }   // 26 distinct bib strings
```

**Expected**: `200`. Photo has `status=indexed` with 26 bibs. BibIndex has 26 entries created via two `BatchWriteItem` calls.

**Why it matters**: Same reasoning as TC-004 but for the write path. A fencepost error would silently drop bib 26 from the BibIndex. Runner searching for that bib number finds no photos.

---

### TC-007: `bibNumbers` list with 100 items

**Category**: Boundary values

**Setup**: Photo exists with `status=review_required`, no existing BibIndex entries.

**Action**:
```
PUT /photos/{id}/bibs
Authorization: Bearer <valid JWT, owner>

{ "bibNumbers": ["001","002",...,"100"] }   // 100 distinct bib strings
```

**Expected**: `200`. All 100 BibIndex entries written across 4 `BatchWriteItem` calls (25 per page). Photo `bibNumbers` has 100 entries and `status=indexed`.

**Why it matters**: The story does not define a maximum number of bibs per photo — a multi-runner finish-line photo could legitimately have many bibs. The handler and store have no upper bound guard. This verifies that the loop correctly handles `ceil(100/25)=4` pages and that DynamoDB's per-call limit is not accidentally exceeded. Also establishes the practical ceiling for later product decisions.

---

### TC-008: `bibNumbers` contains a duplicate bib string

**Category**: Input validation

**Setup**: Photo exists with `status=review_required`.

**Action**:
```
PUT /photos/{id}/bibs
Authorization: Bearer <valid JWT, owner>

{ "bibNumbers": ["101", "101"] }
```

**Expected**: Behavior is ambiguous — the story does not specify. Two possible outcomes: (a) `400` rejecting duplicates, or (b) `200` with the duplicate silently deduplicated or written twice. If (b), two `WriteBibEntries` calls produce two DynamoDB PutRequests with the same PK (`{eventId}#101`, `photoId`), which DynamoDB treats as idempotent — no error, but the photo ends up with `bibNumbers=["101","101"]` in the Photo record, which is misleading. **Confirm which behavior is intended; if (b), verify the Photo record is deduplicated before storage.**

**Why it matters**: A runner searching bib 101 correctly gets results. But the Photo record `bibNumbers` field shows `["101","101"]` in the review queue UI, which confuses the photographer who wonders why the chip appears twice.

---

### TC-009: `bibNumbers` contains a bib string with leading/trailing whitespace (non-empty after trim)

**Category**: Input validation

**Setup**: Photo exists with `status=review_required`.

**Action**:
```
PUT /photos/{id}/bibs
Authorization: Bearer <valid JWT, owner>

{ "bibNumbers": [" 101 "] }
```

**Expected**: The current validation (`strings.TrimSpace(bib) == ""`) only rejects strings that are entirely whitespace. `" 101 "` passes validation. The BibIndex entry is written as `{eventId}# 101 ` (with embedded spaces). A runner searching for `101` does not match ` 101 `. **Expected: either trim before use (returning `bibNumbers=["101"]`) or reject with 400.**

**Why it matters**: Silent data corruption — the bib is indexed under a key that will never match a search query. The runner cannot find their photo. This is a real input path: the Angular `BibTagInputComponent` strips whitespace in the chip input, but a direct API call does not get that protection.

---

### TC-010: `bibNumbers` field missing from JSON body entirely

**Category**: Input validation

**Setup**: Photo exists with `status=review_required`.

**Action**:
```
PUT /photos/{id}/bibs
Authorization: Bearer <valid JWT, owner>

{}
```

**Expected**: `req.BibNumbers` will be `nil` after unmarshal. The nil-check in the handler sets `newStatus = models.PhotoStatusReviewRequired` (same as empty slice path). The delete + write sequence runs: delete returns (no entries to delete), `WriteBibEntries(ctx, [])` no-ops. `UpdatePhotoBibs` sets `bibNumbers=nil` and `status=review_required`. The response returns `bibNumbers: []`. This is arguably correct (same as sending `[]`), but the photo record may store `null` rather than `[]` for the DynamoDB list attribute. **Verify that a subsequent `GetPhoto` still deserializes `bibNumbers` as `[]string{}` (not nil) when the attribute is absent.**

**Why it matters**: If the DynamoDB attribute is omitted rather than set to an empty list, future `ListPhotosByEvent` responses could serialize `bibNumbers` as `null` rather than `[]`, violating the API contract that the story implies (AC6 shows chips populated from `bibNumbers`).

---

### TC-011: `bibNumbers` field is `null` in JSON body

**Category**: Input validation

**Setup**: Photo exists with `status=review_required`.

**Action**:
```
PUT /photos/{id}/bibs
Authorization: Bearer <valid JWT, owner>

{ "bibNumbers": null }
```

**Expected**: `json.Unmarshal` sets `req.BibNumbers` to `nil`. Behavior is identical to TC-010 — treated as empty. **Confirm this is intentional and matches TC-010 outcome.**

**Why it matters**: A frontend bug or API client could send `null` instead of `[]`. Silently treating it as empty is safe only if the downstream state is identical to the explicit empty-array case.

---

### TC-012: Path parameter `id` contains a SQL-injection-style string

**Category**: Input validation

**Setup**: No DynamoDB records needed.

**Action**:
```
PUT /photos/'; DROP TABLE photos; --/bibs
Authorization: Bearer <valid JWT>

{ "bibNumbers": ["101"] }
```

**Expected**: `400` — the UUID regex `(?i)^[0-9a-f]{8}-...$` rejects the string before any DynamoDB call. No store method is invoked.

**Why it matters**: Confirms the UUID allowlist acts as a complete input barrier. Although DynamoDB parameterises its own queries, defence-in-depth validation prevents log injection and unexpected routing behaviour.

---

### TC-013: Path parameter `id` is a valid UUID but uses uppercase hex digits

**Category**: Input validation

**Setup**: Photo exists in DynamoDB with ID `550E8400-E29B-41D4-A716-446655440001` (uppercase).

**Action**:
```
PUT /photos/550E8400-E29B-41D4-A716-446655440001/bibs
Authorization: Bearer <valid JWT, owner>

{ "bibNumbers": ["101"] }
```

**Expected**: `200` — the regex is case-insensitive (`(?i)`) so the UUID is accepted. DynamoDB GetItem uses the exact string as the key, which must match the stored record exactly. **Verify that DynamoDB key lookup succeeds when the case matches the stored record, and that the case is preserved in the response `id` field.**

**Why it matters**: If a presigned upload flow stores photo IDs in lowercase but the Angular component constructs the PUT URL from a mixed-case ID received from a different endpoint, the DynamoDB lookup returns `ErrPhotoNotFound` even though the photo exists.

---

### TC-014: Cursor generated under `status=review_required,error` filter is reused on the next page with the same filter

**Category**: Boundary values / Pagination

**Setup**: Event has 60 photos total: 30 with `status=review_required` and 30 with `status=error`. Default page size is 50.

**Action — page 1**:
```
GET /events/{id}/photos?status=review_required,error
Authorization: Bearer <valid JWT, owner>
```

**Expected**: Returns 50 photos, `nextCursor` is non-empty. The cursor is derived from the last returned photo's `{id, eventId, uploadedAt}` fields.

**Action — page 2**:
```
GET /events/{id}/photos?status=review_required,error&cursor={nextCursor from page 1}
Authorization: Bearer <valid JWT, owner>
```

**Expected**: Returns 10 photos, `nextCursor` is empty string. No photo from page 1 appears in page 2. All 60 photos are returned across both pages with no duplicates and no gaps.

**Why it matters**: The cursor encodes position in the GSI (`eventId-uploadedAt-index`). The FilterExpression (OR of two statuses) is applied after DynamoDB evaluates pages against the GSI. The `filterMultiplier` and `maxFilterIterations` caps interact with the cursor resume point. If the cursor points to DynamoDB's `LastEvaluatedKey` position rather than the last _returned_ item's key, items that were evaluated-but-filtered on page 1 may be duplicated or skipped on page 2. The store code rebuilds the cursor from the last _returned_ photo, which is correct — this test verifies it works end-to-end at page boundary.

---

### TC-015: Cursor from a `status=review_required,error` page reused with a different (or absent) status filter

**Category**: Authorization / Input validation

**Setup**: Same 60-photo event. Obtain a `nextCursor` from a `status=review_required,error` request.

**Action**:
```
GET /events/{id}/photos&cursor={nextCursor from above}
Authorization: Bearer <valid JWT, owner>
```
(no `status` query parameter)

**Expected**: `200` — the cursor contains an embedded `eventId` that is validated against the path `{id}`. The cursor is valid for this event. The absence of a status filter causes DynamoDB to return all photos starting from the cursor position, irrespective of status. The response will include photos of all statuses from that point. **Confirm this is acceptable or whether the handler should reject a cursor obtained under one filter when used with a different filter.**

**Why it matters**: The photographer could bookmark a review queue page, then navigate to the full gallery using the same cursor. The cursor's embedded position in the GSI is correct, but the result set is now unfiltered. There is no cursor-to-filter binding in the current implementation. This is not a security issue (same owner, same event) but could produce confusing pagination results.

---

### TC-016: Cursor belongs to a different event (tampered or copy-pasted)

**Category**: Authorization

**Setup**: Event A and Event B are both owned by the same photographer. Obtain a `nextCursor` from a listing request for Event A.

**Action**:
```
GET /events/{eventB-id}/photos?cursor={cursor from Event A}
Authorization: Bearer <valid JWT, owner of both events>
```

**Expected**: `400` with `{"error":"invalid cursor"}`. The `decodeCursor` function extracts the embedded `eventId` from the cursor and compares it against the path parameter `{eventB-id}`. They differ, so `ErrInvalidCursor` is returned.

**Why it matters**: Confirms that the eventId validation inside `decodeCursor` correctly blocks cross-event cursor injection even when the caller legitimately owns both events. Without this guard, a cursor from Event A positions the DynamoDB GSI scan within Event B's partition, producing incorrect or empty results silently.

---

### TC-017: `status` filter with three comma-separated tokens

**Category**: Input validation

**Setup**: No DynamoDB records needed.

**Action**:
```
GET /events/{id}/photos?status=review_required,error,processing
Authorization: Bearer <valid JWT, owner>
```

**Expected**: `200` — the handler splits on commas, validates each token against `validStatuses`, and passes the joined string `"review_required,error,processing"` to the store. The store builds a three-clause OR FilterExpression (`:s0`, `:s1`, `:s2`). This tests the N>2 case of the multi-token loop which existing tests do not cover (only two tokens are tested).

**Why it matters**: The `clauses` slice is built by iterating `tokens`. A 3-token case verifies the loop is not accidentally hardcoded for exactly two tokens. The generated FilterExpression `#st = :s0 OR #st = :s1 OR #st = :s2` must be valid DynamoDB syntax — DynamoDB does support this, but the placeholder generation (`fmt.Sprintf(":s%d", i)`) must produce distinct names for each token.

---

### TC-018: `status` filter with a trailing comma

**Category**: Input validation

**Setup**: No DynamoDB records needed.

**Action**:
```
GET /events/{id}/photos?status=review_required,
Authorization: Bearer <valid JWT, owner>
```

**Expected**: `400` — `strings.Split("review_required,", ",")` produces `["review_required", ""]`. The empty string `""` is checked against `validStatuses`, which does not contain an empty key. Returns `{"error":"invalid status filter"}`.

**Why it matters**: A trailing comma is the most common accidental URL construction error (e.g. Angular code joining an array with `,`). If the empty token passes validation and is forwarded to the store, it generates a placeholder `:s1` with value `""`, and the FilterExpression becomes `#st = :s0 OR #st = :s1` where `:s1=""` — a string comparison against an empty status value that will never match but silently succeeds.

---

### TC-019: `status` filter is `in_progress` combined with another status using a different separator

**Category**: Input validation

**Setup**: No DynamoDB records needed.

**Action**:
```
GET /events/{id}/photos?status=in_progress%2Cerror
Authorization: Bearer <valid JWT, owner>
```
(Note: `%2C` is the URL-encoded comma `,`. API Gateway decodes query string values before passing them to Lambda.)

**Expected**: `400` — decoded to `in_progress,error`, which is the same as the unencoded form. The handler detects `in_progress` alongside another token and returns `{"error":"in_progress may not be combined with other status values"}`.

**Why it matters**: API Gateway's query string decoding means URL-encoded separators reach the Lambda decoded. If the handler only checked raw bytes without URL decoding, an encoded comma could bypass the `in_progress` combination guard. Confirms the check works after API Gateway's decoding layer.

---

### TC-020: Retag fails mid-sequence — delete succeeds, write fails (partial failure)

**Category**: Failure injection

**Setup**: Photo exists with `status=review_required` and 3 existing BibIndex entries. The `WriteBibEntries` call is configured to return a DynamoDB error (e.g. `ProvisionedThroughputExceededException`) after `DeleteBibEntriesByPhoto` has already succeeded.

**Action**:
```
PUT /photos/{id}/bibs
Authorization: Bearer <valid JWT, owner>

{ "bibNumbers": ["101"] }
```

**Expected**: `500`. The photo is now in a degraded state: BibIndex has zero entries for this photo (all old ones deleted), but the new bib has not been written, and the Photo record still has `status=review_required` with the old `bibNumbers`.

**Retry (idempotency)**:
Immediately retry the same request. The handler re-runs all four steps: delete (no-op — nothing to delete), write the new entry, update the photo. This should succeed with `200` and the photo correctly indexed.

**Why it matters**: The story's tech notes explicitly call out this failure scenario: "if step 3/4 fails after step 2, the photo may temporarily have no BibIndex entries." Verifying that: (a) the first call returns 500 and does not leave the photo in `status=indexed` with empty BibIndex, and (b) a retry fully recovers — is the only way to confirm the idempotency claim in the tech notes is actually implemented correctly.

---

### TC-021: `UpdatePhotoBibs` uses no ConditionExpression — concurrent retag can silently overwrite

**Category**: Concurrency

**Setup**: Photo A starts with `status=review_required`, `bibNumbers=[]`. Two photographers (different JWT subs) each own different events, but this photo belongs to photographer A's event. Photographer A sends `bibNumbers=["101"]`. Simultaneously (in the same 100ms window), a test simulates a second call from the same photographer with `bibNumbers=["202"]`.

**Action**: Fire both requests in parallel from the same JWT sub.

**Expected**: One of the following deterministic outcomes: (a) both complete with `200` but the final `bibNumbers` in the Photo record is exactly one of `["101"]` or `["202"]` (last writer wins on `UpdateItem`); (b) the BibIndex contains both bib entries for the photo (one from each race leg that completed `WriteBibEntries` before the other's `DeleteBibEntriesByPhoto` ran). **Document the actual observed outcome.**

**Why it matters**: `UpdatePhotoBibs` uses `SET bibNumbers = :bibs, status = :status` with no `ConditionExpression`. This is a last-writer-wins update with no conflict detection. The BibIndex and the Photo record can diverge — e.g. Photo record has `bibNumbers=["202"]` but BibIndex contains `{eventId}#101`. A runner searching bib 101 would find the photo; the photo card would show `bibNumbers=["202"]`. This is the most dangerous data-integrity gap in the implementation.

---

### TC-022: `BibTagInputComponent` — same bib entered twice before first debounce fires

**Category**: Concurrency (frontend)

**Setup**: ReviewQueueComponent is mounted with one `review_required` photo. The `BibTagInputComponent` has no existing chips.

**Action**: Type `101` and press Enter twice very rapidly (within the debounce window, if any exists).

**Expected**: Only one chip `101` is added to the component state. The chip list does not contain `["101", "101"]`. If the component does not debounce or deduplicate on chip add, two identical chips appear — and the subsequent `PUT` body becomes `{ "bibNumbers": ["101", "101"] }`.

**Why it matters**: TC-008 shows that the handler does not deduplicate `bibNumbers` before storage. This test covers the frontend input guard that is the only protection against sending duplicate bibs. If both the component and the Lambda allow duplicates through, the photographer ends up with a photo showing two identical bib chips in the UI.

---

### TC-023: Review queue shows photo that was just retagged (optimistic UI vs. server state)

**Category**: State machine (frontend)

**Setup**: ReviewQueueComponent is loaded with two `review_required` photos (P1 and P2). The photographer saves bibs for P1. The NgRx store dispatches a success action.

**Action**: Observe the review queue after the `PUT /photos/P1/bibs` response returns `200` with `status=indexed`.

**Expected**: P1 is removed from the review queue display immediately (optimistic update or on next `GET` refresh), leaving only P2. The queue does not show a stale P1 still tagged as `review_required`.

**Why it matters**: The story's AC7 states "the photo card updates to show `status=indexed` and moves out of the queue on next refresh." If the NgRx store slice for the review queue is not updated after a successful PUT, the photographer sees the photo still in the queue and may attempt to retag it again. The test checks whether the store slice removal happens immediately via the action reducer or only after the next `GET` call.

---

### TC-024: Review queue empty state

**Category**: Boundary values (frontend)

**Setup**: Event exists but all photos have `status=indexed`. The `GET /events/{id}/photos?status=review_required,error` request returns `{ "photos": [], "nextCursor": "" }`.

**Action**: Photographer navigates to `/photographer/dashboard/review`.

**Expected**: The component renders the empty state: "All photos have been processed. Nothing to review." No spinner, no error, no `null`-dereference crash on `photos[0]`.

**Why it matters**: AC9 explicitly requires this empty state. The most common regression in list components is rendering `photos.length` items with an `*ngFor` that crashes when the array is empty or null. This is distinct from the Lambda unit test that already covers the empty-array JSON response — this test covers the Angular template rendering path.

---

### TC-025: `GET /events/{id}/photos` with `limit=0` query parameter

**Category**: Boundary values

**Setup**: Event exists with photos.

**Action**:
```
GET /events/{id}/photos?limit=0
Authorization: Bearer <valid JWT, owner>
```

**Expected**: The handler parses `limit=0` but the condition `l > 0 && l <= 200` evaluates to false for `l=0`, so `limit` remains `defaultPageSize=50`. The request succeeds with up to 50 photos. **Confirm no divide-by-zero occurs in the `filterMultiplier` calculation (`internalLimit = int32(0 * 5) = 0`) when `filter` is also set — this would pass `Limit: 0` to DynamoDB, which rejects it.**

**Why it matters**: The fallback to `defaultPageSize` protects the no-filter path. But if `status=review_required,error` is also supplied, `internalLimit = int32(limit * filterMultiplier) = int32(0 * 5) = 0`. DynamoDB returns an error for `Limit=0`. The handler would return 500. This is a latent bug: `limit=0` from the query string is silently corrected to 50 when the limit-parsing block runs, but the `internalLimit` calculation in the store uses the corrected `limit` value (50) — so the bug actually does not exist _if_ the handler passes the corrected value. **Verify the corrected value (50) is what reaches `ListPhotosByEvent`, not the raw `0`.**

---

### TC-026: `DeleteBibEntriesByPhoto` — GSI query returns `LastEvaluatedKey` (more than one page of existing entries)

**Category**: Boundary values / Failure injection

**Setup**: Photo has more than 1MB of BibIndex entries, or DynamoDB is configured with a small `Limit` that causes the GSI Query in `DeleteBibEntriesByPhoto` to paginate.

**Action**:
```
PUT /photos/{id}/bibs
Authorization: Bearer <valid JWT, owner>

{ "bibNumbers": ["999"] }
```

**Expected**: All BibIndex entries across all pages are deleted.

**Why it matters**: DynamoDB Query results are capped at 1MB per call. `DeleteBibEntriesByPhoto` already implements a `LastEvaluatedKey` pagination loop (handler/store.go lines 149–168), so this case is handled correctly. This test case validates that the loop is exercised under multi-page conditions — confirm via integration test with a seeded photo that has >1MB of BibIndex entries, or by mocking the DynamoDB client to return a non-nil `LastEvaluatedKey` on the first Query response.

---

## Risk areas

1. **No status guard on `PUT /photos/{id}/bibs` (TC-001)**: The handler does not check the photo's current status before proceeding. There is no mechanism to prevent retagging a photo that is already `status=indexed`. This is either an intentional design choice (domain rule 12 says manual tags are always ground truth) or an oversight that could allow accidental overwrite of correctly indexed photos. The story's AC1 does not restrict which statuses can be retagged — clarification from the product owner is needed before closing the story.

2. **BibIndex and Photo record can diverge under concurrent retag (TC-021)**: The four-step retag sequence has no transaction boundary and no conditional write. Two simultaneous PUT requests for the same photo will race across the delete and write steps. The final BibIndex state may not match the final Photo record `bibNumbers`. This is the highest-severity correctness risk in RS-013. A DynamoDB condition expression on `UpdatePhotoBibs` (e.g. `attribute_exists(id)`) does not help here because the divergence occurs between the BibIndex table and the photos table, not within a single item. The only mitigation available without transactions is a per-photo application-level lock (e.g. a DynamoDB conditional put on a lock item) or a DynamoDB TransactWriteItems call that spans both tables. Neither is currently implemented.

3. **Multi-page GSI deletion verified in `DeleteBibEntriesByPhoto` (TC-026)**: The GSI query loops on `LastEvaluatedKey` (handler/store.go lines 149–168), correctly handling photos with more than 1MB of BibIndex entries. TC-026 exercises this path; no latent bug remains. Validate via integration test with a mocked paginated Query response.
