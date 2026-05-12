# QA Plan: RS-008 — Photographer views event photos gallery

## Scope

**Lambda**: `lambdas/list-event-photos/` — `GET /events/{id}/photos`  
**Store slice**: `frontend/angular/src/app/store/photos/`  
**Components**: `EventPhotosComponent`, `PhotoCardComponent`, `PhotoStatusBadgePipe`  
**Integration**: DynamoDB `eventId-uploadedAt-index` GSI, cursor-based pagination, CloudFront URL construction

---

## Test cases

### TC-001: Event with exactly zero photos returns empty array, not null or 404

**Category**: Boundary  
**Setup**: Event record exists in events table owned by `photographer-1`. No photos seeded for this event.  
**Action**: `GET /events/{event-id}/photos` with valid JWT for `photographer-1`  
**Expected**: HTTP 200, body `{"photos":[],"nextCursor":""}`. The `photos` field must be a JSON array `[]`, never `null`. `nextCursor` must be empty string, not absent from the response.  
**Why it matters**: The handler uses `make([]photoItem, 0, len(photos))` which guards against a nil slice, but the integration test and the existing unit test case "empty results" cover only a nil return from the store. A nil `photos` slice returned from a real DynamoDB Query when no items match would go through the unmarshal loop unchanged. Verifies the JSON serialisation path for zero-length allocations end-to-end.

---

### TC-002: Event with exactly one photo — no pagination cursor returned

**Category**: Boundary  
**Setup**: Event with one `indexed` photo, limit=50 (default).  
**Action**: `GET /events/{event-id}/photos`  
**Expected**: HTTP 200, `photos` array length 1, `nextCursor` is empty string.  
**Why it matters**: Ensures `LastEvaluatedKey` is not set by DynamoDB when the result set is smaller than `Limit` and that `nextCursor` is not spuriously populated.

---

### TC-003: Exactly `limit` photos exist — cursor behaviour at the boundary

**Category**: Boundary  
**Setup**: Event with exactly 50 photos (equal to the default page size).  
**Action**: `GET /events/{event-id}/photos` (no explicit limit)  
**Expected**: HTTP 200, `photos` length 50. DynamoDB may or may not return a `LastEvaluatedKey` when the result count equals `Limit` exactly (it can). If `nextCursor` is non-empty, fetching page 2 must return an empty `photos` array and no cursor.  
**Why it matters**: DynamoDB does not guarantee that `LastEvaluatedKey` is absent when exactly `Limit` items are returned. If the frontend calls "Load more" on a phantom cursor and receives an empty page, the UI must handle that gracefully (no infinite spinner, no error).

---

### TC-004: `limit` query parameter at the allowed maximum (200)

**Category**: Boundary  
**Setup**: Event with 5 photos.  
**Action**: `GET /events/{event-id}/photos?limit=200`  
**Expected**: HTTP 200, `photos` array length 5.  
**Why it matters**: The handler code caps the limit at `l <= 200`. Verifies the upper boundary is inclusive and not off-by-one (`< 200` would reject 200).

---

### TC-005: `limit=201` is silently ignored and default (50) is used

**Category**: Boundary  
**Setup**: Event with 60 photos.  
**Action**: `GET /events/{event-id}/photos?limit=201`  
**Expected**: HTTP 200, `photos` length 50 (default used), `nextCursor` non-empty.  
**Why it matters**: The handler silently falls back to `defaultPageSize` for out-of-range limit values rather than returning a 400. Callers sending a slightly oversized limit should not accidentally receive more data than expected or get an error — but they should not silently receive fewer results than they believe they requested without any indication.

---

### TC-006: `limit=0` is rejected and default is applied

**Category**: Boundary  
**Setup**: Event with 5 photos.  
**Action**: `GET /events/{event-id}/photos?limit=0`  
**Expected**: HTTP 200 using default limit of 50. (The condition is `l > 0 && l <= 200`; `limit=0` falls through to the default.)  
**Why it matters**: Confirms the guard `l > 0` is working and zero does not produce a DynamoDB Query with `Limit=0`, which would return no results and look like an empty event.

---

### TC-007: `limit=-1` (negative) uses default

**Category**: Boundary  
**Setup**: Event with 5 photos.  
**Action**: `GET /events/{event-id}/photos?limit=-1`  
**Expected**: HTTP 200 with 5 photos.  
**Why it matters**: `strconv.Atoi` parses negative integers successfully. Without the `l > 0` guard this would pass a negative limit to DynamoDB, which would error or behave unexpectedly.

---

### TC-008: Pagination — cursor from page 1 retrieves correct page 2 without overlap or gaps

**Category**: Boundary  
**Setup**: 21 photos for one event, all `indexed`, with distinct `uploadedAt` timestamps spaced 1 second apart.  
**Action**: 1) `GET /events/{event-id}/photos?limit=20` — capture `nextCursor`. 2) `GET /events/{event-id}/photos?limit=20&cursor={nextCursor}`.  
**Expected**: Page 1 returns 20 photos (most recent). Page 2 returns exactly 1 photo (the oldest). Combined photo IDs across both pages equal the full set of 21 with no duplicates and no gaps.  
**Why it matters**: Validates the cursor encode/decode round-trip and the `ScanIndexForward=false` ordering under real DynamoDB pagination. The integration test only covers limit=2 with 3 items.

---

### TC-009: Cursor encoded with standard base64 (uses `+` or `/`) is rejected as invalid

**Category**: Boundary / Input validation  
**Setup**: Valid event owned by requester.  
**Action**: `GET /events/{event-id}/photos?cursor=eyJhIjoiYisv"}` (valid standard base64 but NOT `RawURLEncoding` — contains `+` or `/` and may include `=` padding)  
**Expected**: HTTP 400, body `{"error":"invalid cursor"}`.  
**Why it matters**: The store uses `base64.RawURLEncoding`. A cursor copied from a URL that URL-decoded a standard-encoded value would fail `DecodeString` silently or return garbage JSON. Confirms the error propagates as a 400, not a 500.

---

### TC-010: Cursor that is valid base64 but invalid JSON returns 400

**Category**: Input validation  
**Setup**: Valid event owned by requester.  
**Action**: `GET /events/{event-id}/photos?cursor=aGVsbG8=` (decodes to `hello`, not JSON)  
**Expected**: HTTP 400, `{"error":"invalid cursor"}`.  
**Why it matters**: `decodeCursor` runs `json.Unmarshal` after base64 decode. If unmarshal fails it returns `ErrInvalidCursor`. The handler must map this to 400, not 500.

---

### TC-011: Cursor that is valid base64 + valid JSON but has unrecognised DynamoDB type key

**Category**: Input validation  
**Setup**: Valid event owned by requester.  
**Action**: Construct a cursor where the JSON contains `{"pk": {"BOOL": "true"}}` (unsupported type), base64-encode it, send as `cursor=`.  
**Expected**: HTTP 400, `{"error":"invalid cursor"}`.  
**Why it matters**: `decodeCursor` returns an error for any key whose value map is neither `{"S":...}` nor `{"N":...}`. This tests the third branch in the cursor decoder.

---

### TC-012: Status filter with a value not in the enum is forwarded to DynamoDB (no 400)

**Category**: Input validation  
**Setup**: Event with photos of known statuses.  
**Action**: `GET /events/{event-id}/photos?status=archived`  
**Expected**: HTTP 200, `photos: []`, `nextCursor: ""`. The handler passes unknown filter values straight to DynamoDB as a FilterExpression. DynamoDB returns zero items because no records have that status value.  
**Why it matters**: The handler performs no server-side enum validation on `?status=`. A typo or a future status value introduced in a later story would silently return zero results rather than a 422. This should be flagged as a potential source of subtle bugs — the developer may wish to add validation.

---

### TC-013: Status filter with empty string `?status=` is treated as "no filter"

**Category**: Input validation  
**Setup**: Event with 3 photos of mixed statuses.  
**Action**: `GET /events/{event-id}/photos?status=`  
**Expected**: HTTP 200, all 3 photos returned (no filter applied).  
**Why it matters**: `event.QueryStringParameters["status"]` returns `""` when the parameter is present but empty. The condition `if filter != ""` guards this correctly — but must be verified because some API Gateway configurations send `"status": ""` vs. omitting the key entirely.

---

### TC-014: `eventId` path parameter containing URL-encoded special characters

**Category**: Input validation  
**Setup**: No event exists with the given ID.  
**Action**: `GET /events/../../admin/photos` (path traversal attempt)  
**Expected**: API Gateway routes this to a different path entirely (no match) and returns 404 before Lambda fires. If it somehow reaches Lambda with `eventID = "../../admin"`, the DynamoDB GetItem will return no item → 404.  
**Why it matters**: Verifies API Gateway path parameter routing does not allow path traversal. Lambda's ownership check acts as a secondary safety net.

---

### TC-015: `eventId` path parameter that is a valid UUID but belongs to no event

**Category**: Input validation  
**Setup**: No DynamoDB record with the given event ID.  
**Action**: `GET /events/00000000-0000-0000-0000-000000000000/photos` with valid JWT.  
**Expected**: HTTP 404, `{"error":"event not found"}`.  
**Why it matters**: Confirms `ErrEventNotFound` path works for a well-formed ID that simply does not exist, as opposed to a malformed ID.

---

### TC-016: Valid JWT but the `sub` claim is present and empty string

**Category**: Authorization  
**Setup**: Construct a request where `RequestContext.Authorizer.JWT.Claims["sub"] = ""`.  
**Action**: Call `Handle` directly with a crafted event.  
**Expected**: HTTP 401, `{"error":"unauthorized"}`.  
**Why it matters**: `extractSub` checks `ok && sub != ""`. An empty `sub` must be treated as missing, not as a photographer with an empty ID who could accidentally match no event owner and get a 403 rather than 401.

---

### TC-017: JWT authorizer context is present but `JWT` field is nil

**Category**: Authorization  
**Setup**: `event.RequestContext.Authorizer` is non-nil but `event.RequestContext.Authorizer.JWT` is nil (e.g., a Lambda authorizer rather than a JWT authorizer is configured).  
**Action**: Call `Handle` with the crafted event.  
**Expected**: HTTP 401, `{"error":"unauthorized"}`.  
**Why it matters**: `extractSub` has a nil guard for `JWT`. This tests the guard does not panic.

---

### TC-018: Valid JWT, event exists, but `photographerId` field is missing from the event record in DynamoDB

**Category**: Authorization  
**Setup**: Insert an event record with no `photographerId` attribute (simulates a corrupted or legacy record).  
**Action**: `GET /events/{event-id}/photos` with any valid JWT.  
**Expected**: `GetEventPhotographerID` returns an empty string `""` (from `UnmarshalMap`). The handler compares `"" != photographerID` → HTTP 403.  
**Why it matters**: A missing attribute unmarshals to zero value `""`. The handler's ownership check `ownerID != photographerID` will always be `true` when `ownerID` is empty, so the photographer is locked out of their own event. This is a data integrity edge case that should be documented or guarded with a distinct error.

---

### TC-019: `rawS3Key` must never appear in the API response

**Category**: Authorization  
**Setup**: Event with one photo that has both `rawS3Key` and `watermarkedS3Key` set.  
**Action**: `GET /events/{event-id}/photos` with the owning photographer's JWT.  
**Expected**: HTTP 200. Response body must not contain the string `rawS3Key` anywhere. The `thumbnailUrl` must use `watermarkedS3Key` via CloudFront, never the raw key.  
**Why it matters**: Domain rule 7 — the private bucket key is never exposed in API responses. This must be tested explicitly since `models.Photo` contains `RawS3Key` and a naive serialisation change could accidentally expose it.

---

### TC-020: `thumbnailUrl` is null when `watermarkedS3Key` is empty string

**Category**: State machine  
**Setup**: Photo record has `status=processing` and `watermarkedS3Key=""`.  
**Action**: `GET /events/{event-id}/photos`  
**Expected**: HTTP 200, photo item has `"thumbnailUrl": null` (JSON null, not absent key).  
**Why it matters**: The `photoItem` struct uses `*string` for `ThumbnailURL`. When `watermarkedS3Key` is `""` the pointer is never set so the JSON serialiser emits `null`. Angular's `PhotoCardComponent` renders the placeholder when `photo.thumbnailUrl` is null. Must verify `null` vs. absent vs. empty string are all handled correctly by the template's `@if (photo.thumbnailUrl && !imageError())` guard.

---

### TC-021: Photo with `status=error` and empty `errorReason` — response omits the field

**Category**: State machine  
**Setup**: Photo record has `status=error`, `errorReason=""`.  
**Action**: `GET /events/{event-id}/photos`  
**Expected**: HTTP 200, `errorReason` key is absent from the JSON item (not `""`). The struct uses `omitempty`, so an empty string is omitted.  
**Why it matters**: Angular's `PhotoCardComponent.errorTooltip` getter returns `this.photo.errorReason ?? 'No error details available.'`. If the field is absent from JSON the type is `null` and the fallback fires. If it is `""` (empty string), `?? ` won't trigger (empty string is falsy in the nullish coalescing sense only for `null`/`undefined` — `""` would display as a blank tooltip). The backend `omitempty` ensures the field is absent, but this must be end-to-end verified.

---

### TC-022: All photos in the event have `status=error` — no photos fall through to a different state

**Category**: State machine  
**Setup**: 5 photos, all with `status=error`.  
**Action**: `GET /events/{event-id}/photos`  
**Expected**: HTTP 200, all 5 returned. `GET /events/{event-id}/photos?status=indexed` returns `photos:[]`.  
**Why it matters**: The filter is applied as a DynamoDB `FilterExpression` which runs after the `Limit` fetch. When all results are `error`, filtering for `indexed` must return zero results — not an error.

---

### TC-023: Mixed statuses — filter for each status individually and confirm exclusive sets

**Category**: State machine  
**Setup**: 4 photos: one each of `indexed`, `review_required`, `error`, `processing`.  
**Action**: Four requests, each with `?status=<value>`.  
**Expected**: Each response returns exactly 1 photo with the matching status. Combined photo counts equal 4 with no overlap.  
**Why it matters**: The FilterExpression uses a reserved-word alias `#st` for `status`. Validates the `ExpressionAttributeNames` substitution works for all four status strings.

---

### TC-024: DynamoDB `ProvisionedThroughputExceededException` on the events table GetItem

**Category**: Failure injection  
**Setup**: Mock `EventStore.GetEventPhotographerID` to return an AWS SDK throttling error (not `ErrEventNotFound`).  
**Action**: Call `Handle`.  
**Expected**: HTTP 500, `{"error":"internal server error"}`. The error is logged with context. The raw AWS error string is not exposed in the response body.  
**Why it matters**: The handler's `errors.Is(err, ErrEventNotFound)` check only catches the sentinel. Any other DynamoDB error must fall through to the 500 path rather than returning 404.

---

### TC-025: DynamoDB `ProvisionedThroughputExceededException` on the photos table Query

**Category**: Failure injection  
**Setup**: `EventStore` returns a valid owner ID. Mock `PhotoStore.ListPhotosByEvent` to return an AWS SDK throttling error (not `ErrInvalidCursor`).  
**Action**: Call `Handle`.  
**Expected**: HTTP 500, `{"error":"internal server error"}`.  
**Why it matters**: The handler's `errors.Is(err, ErrInvalidCursor)` check on the photos error path only catches the cursor sentinel. Throttling and transient errors must map to 500, not 400.

---

### TC-026: DynamoDB `encodeCursor` encountering an unsupported attribute type in `LastEvaluatedKey`

**Category**: Failure injection  
**Setup**: Inject a `DynamoQuerier` mock that returns a `QueryOutput` where `LastEvaluatedKey` contains a `*types.AttributeValueMemberBOOL` value.  
**Action**: Call `ListPhotosByEvent`.  
**Expected**: Returns an error wrapping `"encodeCursor: unsupported attribute type"`. The handler maps this to HTTP 500.  
**Why it matters**: The `encodeCursor` function handles only `S` and `N` attribute types. If DynamoDB returns a composite key with a boolean or binary attribute (e.g., if the GSI key schema ever changes), the encoder will return an error. This path is not covered by any existing test.

---

### TC-027: Network timeout mid-pagination — second page request times out

**Category**: Failure injection  
**Setup**: NgRx effects test. `loadNextPage$` effect dispatches; HTTP mock delays beyond the observable timeout or returns a network error.  
**Action**: Dispatch `PhotosActions.loadNextPage({ eventId, cursor })`.  
**Expected**: `PhotosActions.loadNextPageFailure` is dispatched. State: `loading=false`, `error` is non-null string, existing `photos` array is preserved (not reset). The UI shows an error message without losing the already-loaded photos.  
**Why it matters**: The reducer for `loadNextPageFailure` sets `loading=false` and `error` but does NOT clear `photos` (unlike `loadPhotosFailure` which could also clear photos). The existing photos must remain visible. The template currently only shows the error state when `error()` is truthy AND `photos().length === 0` is false — a mid-pagination error may go silently unrendered because the `@else if (error())` block only fires when there are no photos.

---

### TC-028: `loadPhotos` dispatched while a previous `loadNextPage` HTTP request is still in-flight

**Category**: Concurrency  
**Setup**: NgRx effects test. Trigger `loadNextPage$` effect but do not let the HTTP request complete. Then dispatch `PhotosActions.loadPhotos`.  
**Action**: Both actions processed by their respective effects.  
**Expected**: `loadPhotos$` uses `switchMap`, cancelling any prior `loadPhotos` in-flight. However, `loadNextPage$` also uses `switchMap` — a new `loadNextPage` would cancel an in-flight `loadNextPage`. A `loadPhotos` action does NOT cancel an in-flight `loadNextPage`. If the stale `loadNextPage` response arrives after `loadPhotos` succeeds, `loadNextPageSuccess` is dispatched and appends stale photos to the freshly-loaded list.  
**Why it matters**: This is a race condition: filter change (which dispatches `loadPhotos`) while a "load more" is in-flight could result in photos from the previous filter being appended to the new filter's results. The effects use separate `switchMap` streams, so there is no cross-cancellation. Consider using a single flattening strategy or cancellation token.

---

### TC-029: Two simultaneous `loadNextPage` dispatches (user double-clicks "Load more")

**Category**: Concurrency  
**Setup**: NgRx effects test. Dispatch `PhotosActions.loadNextPage` twice in rapid succession with the same cursor.  
**Action**: Both actions reach `loadNextPage$`.  
**Expected**: `switchMap` cancels the first in-flight HTTP request and only processes the second. Only one `loadNextPageSuccess` is dispatched. Photos are not duplicated in state.  
**Why it matters**: `switchMap` in `loadNextPage$` provides cancellation, but the reducer appends without deduplication (`[...state.photos, ...photos]`). If both requests somehow complete (e.g., using `mergeMap` instead of `switchMap`), photos would be duplicated. Confirms `switchMap` semantics are correctly applied.

---

### TC-030: `filterByStatus$` effect dispatches `loadPhotos` which uses `withLatestFrom(selectActiveFilter)` — timing of state update

**Category**: Concurrency  
**Setup**: NgRx effects test. Dispatch `PhotosActions.filterByStatus({ eventId, status: 'error' })`.  
**Action**: Reducer updates `activeFilter` to `'error'` synchronously. `filterByStatus$` effect maps to `loadPhotos`. `loadPhotos$` effect fires and reads `selectActiveFilter` via `withLatestFrom`.  
**Expected**: `withLatestFrom` captures `activeFilter = 'error'` (the updated value). The HTTP request includes `?status=error`.  
**Why it matters**: `withLatestFrom` reads the store at the moment `loadPhotos` action arrives in the `loadPhotos$` effect. Since the reducer runs synchronously before effects, the filter should already be set to `'error'`. However if the `filterByStatus$` and `loadPhotos$` effects are in the same microtask and store state has not flushed, the old filter value (`null`) could be used instead, sending a request with no status filter.

---

### TC-031: Angular `EventPhotosComponent` — route `id` param is empty string

**Category**: Input validation  
**Setup**: Navigate to `/photographer/events//photos` (empty segment).  
**Action**: Component `ngOnInit` reads `paramMap.get('id')` → `null`, falls back to `''`.  
**Expected**: The `if (this.eventId)` guard prevents dispatching any actions. The component renders in an indeterminate state (no skeleton, no photos, no error). The empty-state text should appear.  
**Why it matters**: The guard `if (this.eventId)` prevents API calls but leaves the component in `initialPhotosState` with `loading=false, photos=[], error=null`, which renders the "No photos yet" empty state. This is confusing — the user sees "No photos yet" before any load was even attempted. No existing test covers this path.

---

### TC-032: `PhotoCardComponent` — `bibNumbers` array with more than 3 items triggers tooltip

**Category**: Boundary / UI  
**Setup**: Photo with `bibNumbers: ['101', '102', '103', '104']`.  
**Action**: Render `PhotoCardComponent` with this photo input.  
**Expected**: The bib row renders at most 3 bibs inline, truncated. The `[matTooltipDisabled]="photo.bibNumbers.length <= 3"` condition enables the tooltip. Hovering shows all bib numbers via `bibLabel` (comma-joined).  
**Why it matters**: The template renders ALL bibs in the loop regardless of count — it does not truncate the display. Only the tooltip is conditionally enabled. With 100+ bib numbers (a photo of a crowd at a finish line with many partial bib captures) the card could overflow its layout.

---

### TC-033: `PhotoCardComponent` — very long single bib number string

**Category**: Boundary / UI  
**Setup**: Photo with `bibNumbers: ['12345678901234567890']` (20-character bib string — unusual but possible if Rekognition misreads text as a long number).  
**Action**: Render the component.  
**Expected**: The bib row handles overflow gracefully (CSS text-overflow or wrapping). The layout does not break the card width.  
**Why it matters**: No max-length validation is applied to `bibNumbers` values from DynamoDB. A long misdetected string would overflow without CSS `overflow: hidden` or `word-break`.

---

### TC-034: `PhotoCardComponent` — `thumbnailUrl` returns HTTP 403 (CloudFront signed URL expired or misconfigured)

**Category**: Failure injection / UI  
**Setup**: Photo has a non-null `thumbnailUrl`. Configure the test HTTP mock to return 403 for that URL.  
**Action**: Render `PhotoCardComponent`. The `<img>` fires the `(error)` event.  
**Expected**: `imageError` signal becomes `true`. The broken-image placeholder renders ("Unavailable" with `broken_image` icon). No console error escapes unhandled.  
**Why it matters**: The `onImageError()` handler sets `imageError.set(true)` and the template switches to the broken-image branch. But if `thumbnailUrl` is an empty string (not null) from a misconfigured CloudFront domain construction, the `@if (photo.thumbnailUrl && ...)` condition would evaluate the empty string as falsy, skipping the `<img>` tag and showing the "Processing" placeholder instead of the "Unavailable" one — potentially misleading the photographer.

---

### TC-035: `PhotoStatusBadgePipe` — unknown status string falls back to processing badge

**Category**: Input validation / UI  
**Setup**: Pass `status = 'uploading'` (a hypothetical future status not in the enum) to the pipe.  
**Action**: `pipe.transform('uploading')`  
**Expected**: Returns `FALLBACK` which is the `processing` badge config (`badge--processing`, `hourglass_top`, `'Processing'`).  
**Why it matters**: The pipe uses `BADGE_MAP[status as PhotoStatus] ?? FALLBACK`. If a future story adds a new status value to the data model before the frontend enum is updated, the badge silently shows "Processing" (amber/grey). This is a silent failure mode and should be caught before production.

---

### TC-036: `PhotoStatusBadgePipe` — null or undefined input does not throw

**Category**: Input validation / UI  
**Setup**: Call `pipe.transform(null as any)` and `pipe.transform(undefined as any)`.  
**Expected**: Returns `FALLBACK` without throwing. `BADGE_MAP[null]` is `undefined`, so `?? FALLBACK` fires.  
**Why it matters**: Angular pipes can receive null/undefined when used with the async pipe or when data is not yet loaded. A thrown error inside a pipe causes the component to render a blank template rather than showing a fallback, and the error may not surface visibly in production.

---

### TC-037: `loadNextPage$` effect — `filter` from `withLatestFrom` is null but cursor is set

**Category**: Boundary  
**Setup**: NgRx effects test. `activeFilter` is `null` in state. Dispatch `PhotosActions.loadNextPage({ eventId, cursor: 'abc' })`.  
**Action**: Effect fires, `withLatestFrom` yields `filter = null`.  
**Expected**: The URL params are built as `new URLSearchParams({ cursor: 'abc' })` with no `status` param appended. Request URL is `GET /events/{id}/photos?cursor=abc`.  
**Why it matters**: The `loadNextPage$` effect checks `if (filter) params.set('status', filter)`. A null filter must not add `?status=null` to the URL. Confirms the falsy check works for null (not just undefined).

---

### TC-038: `loadPhotos$` effect — race between `loadPhotos` dispatched from `ngOnInit` and from `filterByStatus$` effect

**Category**: Concurrency  
**Setup**: Component initialises and dispatches `loadPhotos`. Before the HTTP request completes, the user clicks a filter chip which dispatches `filterByStatus`, which dispatches another `loadPhotos`.  
**Action**: Two `loadPhotos` actions in rapid succession in `loadPhotos$`.  
**Expected**: `switchMap` cancels the first HTTP request. Only one `loadPhotosSuccess` fires with the filtered results. State shows filter-specific photos.  
**Why it matters**: `switchMap` provides this guarantee. Test confirms the operator is correctly applied and no `mergeMap` was accidentally used, which would cause both responses to overwrite state in unpredictable order.

---

### TC-039: Retry after `loadPhotosFailure` — dispatches `loadPhotos` with the active filter preserved

**Category**: State machine  
**Setup**: Initial load fails. `error` state is set. `activeFilter` is null.  
**Action**: User clicks "Retry" → `onRetry()` dispatches `PhotosActions.loadPhotos({ eventId })`.  
**Expected**: The effect reads `activeFilter = null` via `withLatestFrom`. Request goes out without `?status=`. If filter was active before the failure (e.g., user selected "Error" filter and then network dropped), the retry should use the same filter.  
**Why it matters**: `loadPhotos` is dispatched from `onRetry()` without explicitly passing the active filter. The effect relies on `withLatestFrom(selectActiveFilter)`. If the reducer's `on(PhotosActions.loadPhotos)` clears `activeFilter` (it does not — it only clears `photos` and `nextCursor`), the retry would lose the filter. Confirm the reducer does NOT reset `activeFilter` on `loadPhotos`.

---

### TC-040: CloudFront domain construction — trailing slash in `RACEPHOTOS_PHOTO_CDN_DOMAIN`

**Category**: Input validation  
**Setup**: Set `CdnDomain = "d1234.cloudfront.net/"` (with trailing slash).  
**Action**: Call `Handle` with a photo where `WatermarkedS3Key = "processed/photo-1.jpg"`.  
**Expected**: The constructed `thumbnailUrl` will be `"https://d1234.cloudfront.net//processed/photo-1.jpg"` (double slash). CloudFront may or may not normalise this. The Lambda does not validate or trim the CDN domain.  
**Why it matters**: The URL construction is `"https://" + h.CdnDomain + "/" + p.WatermarkedS3Key` with no trimming. A misconfigured env var with a trailing slash produces a double-slash URL. This should either be documented as "must not include trailing slash" or the code should trim it.

---

### TC-041: Photos from a different event are not returned when querying by eventId

**Category**: Input validation  
**Setup**: Two events. Event A has 3 photos. Event B has 2 photos. Both owned by the same photographer.  
**Action**: `GET /events/{event-A-id}/photos`  
**Expected**: HTTP 200, exactly 3 photos returned, all with `eventId = event-A-id`. No photos from event B appear.  
**Why it matters**: The GSI PK is `eventId`. Validates the KeyConditionExpression `eventId = :eid` correctly scopes the query.

---

### TC-042: Stale `loadNextPageSuccess` arrives after `filterByStatus` resets the list

**Category**: Concurrency  
**Setup**: Photos loaded (page 1). User clicks "Load more" — `loadNextPage` HTTP request is in-flight. User immediately clicks a filter chip — `filterByStatus` dispatches `loadPhotos`, which resets `photos: []` in the reducer. The stale `loadNextPage` HTTP response arrives.  
**Action**: `loadNextPageSuccess` is dispatched with stale photos from the old filter.  
**Expected**: The reducer appends the stale photos to the post-reset empty array: `[...[], ...stalePhotos]`. The UI now shows stale wrong-filter photos with the new filter active.  
**Why it matters**: This is a confirmed race condition in the current implementation. `switchMap` in `loadNextPage$` only cancels subsequent `loadNextPage` actions — it does not cancel on `loadPhotos` actions. A cancellation token or takeUntil tied to `filterByStatus` / `clearPhotos` / `loadPhotos` is needed.

---

## Risk areas

### Risk 1 — Stale `loadNextPage` response after filter change (TC-042, TC-028)

This is the highest-risk scenario because it is a silent data correctness bug with no error message. The user sees photos from the wrong filter category without any indication that a stale response was applied. The fix requires an explicit cancellation strategy in `loadNextPage$` (e.g., `takeUntil` on `filterByStatus` or `loadPhotos` actions, or switching to a single flattening effect). The current tests do not cover this interleaving at all.

### Risk 2 — DynamoDB `FilterExpression` consuming capacity units without filling pages (TC-003, TC-022)

When a `?status=` filter is active, DynamoDB applies the `FilterExpression` AFTER fetching `Limit` items from the GSI. If the event has 1000 `indexed` photos and 5 `error` photos, querying `?status=error&limit=50` will consume up to 50 read capacity units per page scan and may return 0 results per page until it reaches the error photos. The API caller (the Angular effect) will receive `photos:[]` with a `nextCursor` and cannot distinguish "no photos at all" from "keep paginating". The frontend has no auto-advance logic — the user would need to click "Load more" many times on an empty-looking page. This is an unspecified UX behaviour that could also time-out under Lambda's 29-second API Gateway limit for very large events.

### Risk 3 — `photographerId` missing from event record produces 403 instead of a diagnostic error (TC-018)

A corrupted event record (missing `photographerId` attribute) will cause every photographer — including the actual owner — to receive a 403 Forbidden. There is no way for the photographer to recover from this through the UI. The error is also logged only as a 403 with no indication that the data is malformed. This should be flagged for a defensive check: if `ownerID == ""`, return a 500 or a specific error rather than a silent 403.
