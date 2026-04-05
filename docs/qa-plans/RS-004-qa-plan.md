# QA Plan: RS-004 — Photographer account — auth shell + profile setup

## Scope

**Lambda functions**

- `lambdas/get-photographer/` — `GET /photographer/me`
- `lambdas/update-photographer/` — `PUT /photographer/me`

**Angular**

- `AuthEffects` / `authReducer` — sign-in, sign-out, session load
- `PhotographerEffects` / `photographerReducer` — profile load and save
- `AuthGuard` — protected route enforcement
- `LoginComponent` — form dispatch, password toggle
- `ProfileComponent` — form pre-fill, save dispatch, currency list

**Not in scope for this plan**: CDK construct IAM bindings (separate infra review), Cognito User Pool configuration, CloudFront.

---

## Test cases

### TC-001: empty body on PUT returns 400, not 500

**Category**: Input validation
**Setup**: Photographer record exists in DynamoDB for `sub=user-empty`.
**Action**: `PUT /photographer/me` with `Authorization: Bearer <valid-jwt>` and body `""` (zero-length string).
**Expected**: HTTP 400, `{"error":"invalid request body"}`.
**Why it matters**: `json.Unmarshal([]byte(""), &req)` returns `unexpected end of JSON input` — the handler's current unmarshal path should catch it, but the unit tests only cover `{bad json}` (non-empty malformed JSON). An empty body is a distinct code path on some Go JSON parsers and is the most common client mistake.

---

### TC-002: null JSON body on PUT returns 400

**Category**: Input validation
**Setup**: None required.
**Action**: `PUT /photographer/me` with valid JWT and body `null`.
**Expected**: HTTP 400, `{"error":"invalid request body"}`.
**Why it matters**: `json.Unmarshal([]byte("null"), &req)` succeeds in Go and leaves `req` as its zero value. The handler would then proceed to `validate()` with an empty `DefaultCurrency`, which passes validation (the currency check is guarded by `req.DefaultCurrency != ""`). This silently creates a profile with no currency code — a functional bug that the existing tests do not cover.

---

### TC-003: PUT with empty string DefaultCurrency is accepted and stored

**Category**: Input validation
**Setup**: None required.
**Action**: `PUT /photographer/me` with valid JWT and body `{"displayName":"Test","defaultCurrency":""}`.
**Expected**: HTTP 200; response body contains `"defaultCurrency":""`.
**Why it matters**: The `validate()` function only rejects a non-empty, unrecognised currency (`req.DefaultCurrency != "" && !validCurrencies[...]`). An empty string bypasses validation entirely. Downstream, a runner purchasing from this photographer would see a blank currency symbol. Verify whether empty currency should be rejected (story says ISO 4217 required) or intentionally allowed as "not yet set".

---

### TC-004: PUT with lowercase currency code returns 400

**Category**: Input validation
**Setup**: None required.
**Action**: `PUT /photographer/me` with valid JWT and body `{"defaultCurrency":"usd"}`.
**Expected**: HTTP 400, message includes unsupported currency.
**Why it matters**: `validCurrencies["usd"]` is `false` because the map is keyed with uppercase codes. The existing test only covers `"XYZ"`. A photographer copy-pasting from a browser form that lowercases the value should receive a clear error, not a silent passthrough if the map were ever expanded to include lowercase aliases.

---

### TC-005: PUT with 2-character currency code returns 400

**Category**: Input validation
**Setup**: None required.
**Action**: `PUT /photographer/me` with valid JWT and body `{"defaultCurrency":"US"}`.
**Expected**: HTTP 400.
**Why it matters**: ISO 4217 codes are exactly 3 characters. The implementation uses a whitelist map so `"US"` would be rejected, but this is worth asserting explicitly to guard against future map expansion with typos.

---

### TC-006: PUT with 4-character currency code returns 400

**Category**: Input validation
**Setup**: None required.
**Action**: `PUT /photographer/me` with valid JWT and body `{"defaultCurrency":"USDD"}`.
**Expected**: HTTP 400.
**Why it matters**: Same as TC-005 — length validation is implicit in the whitelist, not explicit. An explicit test documents the intent.

---

### TC-007: PUT with wrong type for displayName returns 400

**Category**: Input validation
**Setup**: None required.
**Action**: `PUT /photographer/me` with valid JWT and body `{"displayName":12345,"defaultCurrency":"USD"}`.
**Expected**: HTTP 400, `{"error":"invalid request body"}`.
**Why it matters**: Go's `json.Unmarshal` returns an error when a number is decoded into a string field. The existing tests do not exercise type mismatch — only syntactically invalid JSON.

---

### TC-008: PUT with extra/unknown fields is accepted (permissive parsing)

**Category**: Input validation
**Setup**: None required.
**Action**: `PUT /photographer/me` with valid JWT and body `{"displayName":"Alice","defaultCurrency":"USD","unknownField":"ignored"}`.
**Expected**: HTTP 200; unknown field silently ignored; response contains only known fields.
**Why it matters**: Go's `json.Unmarshal` ignores unknown fields by default. This test documents that the API is intentionally permissive. If a future change adds `DisallowUnknownFields`, this test would catch a breaking change for clients sending older payloads.

---

### TC-009: PUT with displayName at 256 characters

**Category**: Boundary values
**Setup**: None required.
**Action**: `PUT /photographer/me` with valid JWT and body where `displayName` is a 256-character string, `defaultCurrency` is `"USD"`.
**Expected**: HTTP 200 (no length cap currently defined); response body contains the full 256-character name.
**Why it matters**: The story and CLAUDE.md define no max length for `displayName`. This test establishes the current behaviour as a baseline. If a DynamoDB item size limit (400 KB) is ever a concern or a UI truncation bug appears, this test surfaces the boundary. Developer should confirm whether a max length constraint is intentional.

---

### TC-010: PUT with all bank fields at maximum plausible length stored correctly

**Category**: Boundary values
**Setup**: None required.
**Action**: `PUT /photographer/me` with valid JWT; set each of `bankName`, `bankAccountHolder`, `bankAccountNumber`, `bankInstructions` to a 500-character string.
**Expected**: HTTP 200; all fields persisted verbatim (no truncation).
**Why it matters**: No length constraints exist in the model or validation logic. This test confirms DynamoDB round-trips long strings correctly and that no silent truncation occurs before the PutItem call.

---

### TC-011: GET returns 404 for a sub that has never called PUT

**Category**: Boundary values
**Setup**: DynamoDB table exists; no item with `id = "brand-new-user"`.
**Action**: `GET /photographer/me` with valid JWT where `sub = "brand-new-user"`.
**Expected**: HTTP 404, `{"error":"photographer not found"}`.
**Why it matters**: The happy-path unit test covers this (existing test "not found — returns 404") but the integration test does not verify the response body shape — only that `apperrors.ErrNotFound` is returned from the store. The integration test should assert the HTTP response body.

---

### TC-012: PUT called twice with identical payload is idempotent (no duplicate record)

**Category**: Idempotency
**Setup**: Photographer record does not yet exist.
**Action**: Call `PUT /photographer/me` with identical payload twice in sequence. After both calls, call `GET /photographer/me`.
**Expected**: Both PUT calls return HTTP 200 with the same `id` and `defaultCurrency`. GET returns one record. `CreatedAt` is identical in both PUT responses. `UpdatedAt` may differ (second call sets a later timestamp).
**Why it matters**: `UpsertPhotographer` uses DynamoDB `PutItem` (full replace). A second PUT must not create a second record. The test also verifies `CreatedAt` preservation across the two writes — the existing `TestHandler_Handle_PreservesCreatedAt` unit test covers the logic path but only when `GetPhotographer` returns an existing record with a known timestamp, not when two real HTTP calls arrive in sequence.

---

### TC-013: concurrent PUT requests from the same photographer — CreatedAt consistency

**Category**: Concurrency
**Setup**: Photographer record does not exist. Two concurrent PUT requests are issued for `sub = "concurrent-user"` simultaneously.
**Action**: Fire two goroutines each sending `PUT /photographer/me` with identical body at the same instant.
**Expected**: Both return HTTP 200. Exactly one record exists in DynamoDB. `CreatedAt` values in both responses are identical (whichever write "won" sets the canonical `CreatedAt`).
**Why it matters**: The current implementation does a `GetItem` to fetch `createdAt`, then a `PutItem` — there is no DynamoDB conditional expression guarding the write. Under concurrent load, both goroutines may read "not found", both set `createdAt = now()` (potentially different timestamps), and both write. The one that writes last wins, but `createdAt` will differ between the two responses. This is a race condition: the `createdAt` returned to one caller will not match what ends up in DynamoDB. A conditional `attribute_not_exists(id)` on the first PutItem (create path) would prevent this.

---

### TC-014: JWT with Authorizer present but JWT sub claim missing returns 401

**Category**: Authorization edge cases
**Setup**: None required.
**Action**: `GET /photographer/me` and `PUT /photographer/me` with a request where `RequestContext.Authorizer.JWT.Claims` exists but does not contain the `"sub"` key.
**Expected**: HTTP 401, `{"error":"unauthorized"}`.
**Why it matters**: The existing unit test `makeEvent("")` creates an event with an empty Authorizer struct (no JWT context at all). The edge case of an Authorizer that is present but lacks `sub` in the claims map is subtly different — `extractSub` checks `Claims["sub"]` which returns the zero string, then checks `ok && sub != ""`. This should still return 401, but it is not explicitly tested.

---

### TC-015: JWT with sub claim present but empty string returns 401

**Category**: Authorization edge cases
**Setup**: None required.
**Action**: `GET /photographer/me` with a crafted request where `JWT.Claims["sub"] = ""`.
**Expected**: HTTP 401.
**Why it matters**: `extractSub` guards `ok && sub != ""`. An empty string `sub` must not be passed to `GetPhotographer` as it would be a DynamoDB GetItem against a blank partition key. The unit test `makeEvent("")` achieves this because `makeEvent` returns an empty `APIGatewayV2HTTPRequest{}` when `sub == ""`, so the Authorizer is nil — not the same as `sub` being explicitly set to empty string in a real Claims map.

---

### TC-016: GET without Authorization header returns 401 (enforced by API Gateway, not Lambda)

**Category**: Authorization edge cases
**Setup**: None required.
**Action**: `GET /photographer/me` with no `Authorization` header.
**Expected**: HTTP 401 returned by API Gateway JWT authorizer before Lambda fires.
**Why it matters**: The Lambda unit tests do not cover this path because the Lambda never receives the call. This must be verified in the integration/E2E test against a deployed API Gateway with the JWT authorizer configured. It is currently absent from the integration tests.

---

### TC-017: GET with expired JWT returns 401

**Category**: Authorization edge cases
**Setup**: A valid Cognito JWT that has since expired (or a locally crafted token with `exp` in the past).
**Action**: `GET /photographer/me` with `Authorization: Bearer <expired-jwt>`.
**Expected**: HTTP 401 from API Gateway before Lambda fires.
**Why it matters**: Amplify's `fetchAuthSession` in the Angular interceptor is supposed to refresh the token automatically. If the interceptor fails silently and attaches an expired token, the API must still reject it. No integration or E2E test currently validates this path.

---

### TC-018: DynamoDB ProvisionedThroughputExceededException maps to 500

**Category**: Failure injection
**Setup**: Mock or simulate `ProvisionedThroughputExceededException` from the DynamoDB client.
**Action**: `GET /photographer/me` with a valid JWT when the store returns a `ProvisionedThroughputExceededException`.
**Expected**: HTTP 500, `{"error":"internal server error"}`; the raw SDK error string is NOT present in the response body.
**Why it matters**: The handler correctly wraps DDB errors as 500 for generic errors, but the existing unit test only passes `errors.New("ddb failure")`. The AWS SDK wraps `ProvisionedThroughputExceededException` in a specific error type; `errors.Is(err, apperrors.ErrNotFound)` must still evaluate to false for this error type so the handler does not accidentally return 404. This is a regression guard.

---

### TC-019: DynamoDB returns error during GET inside PUT handler — 500 not 404

**Category**: Failure injection
**Setup**: Mock `GetPhotographer` to return a non-`ErrNotFound` error during a PUT.
**Action**: `PUT /photographer/me` with valid JWT and valid body.
**Expected**: HTTP 500, `{"error":"internal server error"}`; `UpsertPhotographer` is NOT called.
**Why it matters**: The existing unit test "store GetPhotographer fails (non-404) — returns 500" covers this, but the test does not assert that `UpsertPhotographer` is never called. The gomock controller will catch an unexpected call, so this is implicitly tested — but it is worth making the assertion explicit so future refactors don't introduce a write after a failed read.

---

### TC-020: BankAccountNumber not logged on PUT

**Category**: Failure injection / Security
**Setup**: Configure a log capture. Photographer record does not exist.
**Action**: `PUT /photographer/me` with a valid JWT and body containing `"bankAccountNumber":"1234567890"`.
**Expected**: HTTP 200; log output contains no occurrence of `"1234567890"` or the string `bankAccountNumber` followed by the account value.
**Why it matters**: The story and CLAUDE.md both mandate that `BankAccountNumber`, `BankAccountHolder`, and `BankInstructions` must never appear in logs. The handler logs `photographerID` (the Cognito sub) on error paths. If a future error branch is added that dumps the full `models.Photographer` struct or the `updateRequest` struct, PII will leak to CloudWatch. This test should be part of the unit suite using a `slog.Handler` that captures output.

---

### TC-021: GET response body does not include bankAccountNumber for a different photographer (cross-photographer isolation)

**Category**: Authorization edge cases
**Setup**: Two DynamoDB records: `sub=photographer-A` with `bankAccountNumber="AAA"` and `sub=photographer-B` with `bankAccountNumber="BBB"`.
**Action**: `GET /photographer/me` with a JWT where `sub=photographer-A`.
**Expected**: HTTP 200, response contains `"bankAccountNumber":"AAA"` and does NOT contain `"BBB"`.
**Why it matters**: The DynamoDB key is the Cognito `sub` extracted from the JWT. API Gateway + the JWT authorizer together prevent one photographer from calling the endpoint with another's `sub`. But at the Lambda layer, the only defense is that `photographerID` comes from the JWT claims, not from a path or query parameter. This test validates that the data isolation property holds end-to-end when two records exist simultaneously.

---

### TC-022: Angular — loadProfile dispatched on profile page init triggers PUT with empty defaults on 404 (AC4)

**Category**: State machine
**Setup**: NgRx store in initial state; mock HTTP `GET /photographer/me` to return 404.
**Action**: Component initialises, `ngOnInit` dispatches `loadProfile`.
**Expected**: `PhotographerEffects.loadProfile$` catches the 404, dispatches `updateProfile({ profile: emptyPhotographerDefaults })`; the store transitions to `saving: true`; HTTP `PUT /photographer/me` is fired with `emptyPhotographerDefaults` as the body.
**Why it matters**: AC4 is the critical auto-initialisation behaviour. The current unit test for `ProfileComponent` only asserts that `loadProfile` is dispatched on init — it does not test that the effect chain correctly converts a 404 into a PUT. This requires an `AuthEffects`-style test with `provideMockActions` and an `HttpClientTestingModule`.

---

### TC-023: Angular — updateProfile failure (400 invalid currency) surfaces error in NgRx state

**Category**: State machine
**Setup**: NgRx store in initial state; mock HTTP `PUT /photographer/me` to return 400 with body `{"error":"unsupported currency code \"XYZ\""}`.
**Action**: Dispatch `updateProfile({ profile: { ...validProfile, defaultCurrency: 'XYZ' } })`.
**Expected**: `updateProfileFailure` is dispatched with `error = 'unsupported currency code "XYZ"'`; store state `saving = false`, `error` contains the server message.
**Why it matters**: The `PhotographerEffects.updateProfile$` effect extracts the error from `err.error?.error`. If the server returns a different shape (e.g., `{"message":"..."}` instead of `{"error":"..."}`), the error falls back to `'Failed to save profile'` and the AC9 requirement (descriptive message) is silently broken. This test pins the error-extraction logic.

---

### TC-024: Angular — sign-out while a saveProfile request is in-flight

**Category**: State machine
**Setup**: `updateProfile` action dispatched; HTTP PUT is pending; `signOut` action also dispatched before the PUT resolves.
**Action**: Dispatch `signOut` while `saving = true`.
**Expected**: Auth state transitions to `unauthenticated`; router navigates to `/login`; if the PUT eventually resolves it dispatches `updateProfileSuccess` but the UI has already navigated away, so no toast is shown. No unhandled error or console exception.
**Why it matters**: `PhotographerEffects` uses `switchMap` for `loadProfile$` but also `switchMap` for `updateProfile$`. If the component is destroyed and the effect emits after navigation, Angular may throw an `EmitterService` teardown error. The `switchMap` will not cancel the in-flight HTTP request automatically on sign-out — the effect is not bound to the component lifecycle.

---

### TC-025: Angular — auth guard preserves returnUrl for deeply nested path

**Category**: Authorization edge cases
**Setup**: Browser is unauthenticated.
**Action**: Navigate to `/photographer/events/abc123/photos`.
**Expected**: Router redirects to `/login?returnUrl=%2Fphotographer%2Fevents%2Fabc123%2Fphotos`; after successful login, the app navigates to `/photographer/events/abc123/photos`.
**Why it matters**: The E2E test only checks that `returnUrl=` appears in the URL, but does not verify that the full path (including nested segments) is encoded. If the guard only captures the first path segment, the post-login redirect would land on `/photographer/events` instead of the original deep link.

---

### TC-026: Angular — login with correct credentials followed by returnUrl redirect (AC7 full path)

**Category**: Authorization edge cases
**Setup**: Amplify mock configured to resolve `signIn` successfully; store dispatches `signInSuccess`.
**Action**: Navigate to `/photographer/profile`, get redirected to `/login?returnUrl=%2Fphotographer%2Fprofile`, fill in valid credentials, submit.
**Expected**: Auth state becomes `authenticated`; router navigates to `/photographer/profile` (the `returnUrl` value), not to `/photographer/events` (the default).
**Why it matters**: AC7 states "redirected to `returnUrl` or `/photographer/events`". The current E2E test does not test the full login → redirect flow. The `AuthEffects.signIn$` dispatches `signInSuccess` but there is no effect in the PR that listens to `signInSuccess` and performs the `returnUrl` redirect. This is a potential gap — the redirect may be handled entirely in `LoginComponent`, which is not tested in the E2E spec.

---

### TC-027: Angular — successive loadProfile calls do not stack (switchMap cancellation)

**Category**: Concurrency
**Setup**: `PhotographerEffects` wired with a slow HTTP mock.
**Action**: Dispatch `loadProfile` twice in rapid succession before the first HTTP call resolves.
**Expected**: Only one HTTP GET is in-flight at any time; the first is cancelled by `switchMap`; the second resolves and dispatches `loadProfileSuccess`.
**Why it matters**: If the user navigates away and back to the profile page quickly, two `loadProfile` actions fire. `switchMap` cancels the first — this is the correct behaviour. The test confirms the effect uses `switchMap` and not `mergeMap` or `concatMap`, which would allow stale responses to overwrite newer state.

---

### TC-028: integration — GET immediately after PUT returns the written values

**Category**: Idempotency
**Setup**: LocalStack DynamoDB table `racephotos-photographers` is empty.
**Action**: Call `UpsertPhotographer` with a full `models.Photographer` including all bank fields. Immediately call `GetPhotographer` with the same ID.
**Expected**: All fields returned by `GetPhotographer` exactly match what was written by `UpsertPhotographer`, including `BankAccountNumber` and `BankInstructions`.
**Why it matters**: The current integration test (`TestIntegration_UpsertPhotographer_Create`) only asserts `DefaultCurrency` — it does not assert that `BankAccountNumber`, `BankAccountHolder`, and `BankInstructions` survive the DynamoDB round-trip. These fields use the `dynamodbav` tag; a future model refactor could accidentally break the tag and the test would still pass.

---

### TC-029: integration — UpdatedAt advances on second PUT; CreatedAt does not change

**Category**: Idempotency
**Setup**: LocalStack; `UpsertPhotographer` called with `CreatedAt = "2024-01-01T00:00:00Z"`, `UpdatedAt = "2024-01-01T00:00:00Z"`.
**Action**: Wait 1 second; call the handler's `PUT /photographer/me` a second time (not just `UpsertPhotographer` directly) with a different `displayName`.
**Expected**: Response body has `CreatedAt = "2024-01-01T00:00:00Z"` (original), `UpdatedAt` is a timestamp after the original.
**Why it matters**: `TestIntegration_UpsertPhotographer_Update` calls `UpsertPhotographer` directly with a hardcoded `UpdatedAt` string — it bypasses the handler's `time.Now()` call. The integration test should invoke the full handler (or at least the store + handler together) to confirm the timestamp assignment logic works end-to-end.

---

### TC-030: response body shape — GET returns all model fields including empty strings

**Category**: Boundary values
**Setup**: A `Photographer` record exists with all optional fields set to empty strings (`bankName=""`, etc.).
**Action**: `GET /photographer/me` with valid JWT.
**Expected**: HTTP 200; response body is valid JSON containing all 9 fields from `models.Photographer`; empty string fields are serialised as `""` (not omitted).
**Why it matters**: The Go model uses `json:"fieldName"` without `omitempty`. This is correct — omitting empty fields would cause the Angular app to crash or leave form fields undefined. The test explicitly validates that no field is dropped on the wire. The current unit test only checks `id` in the response.

---

## Risk areas

1. **Concurrent first-write race on `CreatedAt` (TC-013)**: The `update-photographer` handler does `GetItem` → `PutItem` with no DynamoDB conditional expression. Two simultaneous first-time PUTs for the same photographer will both read "not found", both call `time.Now()` independently, and both write with potentially different `createdAt` values. Whichever write lands last in DynamoDB wins, but the caller that "won" the PutItem will have returned a `createdAt` that is now stale. This is a correctness bug for photographers who trigger the profile initialisation race. Developer should add a `ConditionExpression: attribute_not_exists(id)` on the create path and handle the resulting `ConditionalCheckFailedException` as a benign "already created" case.

2. **Empty-string `DefaultCurrency` bypasses ISO 4217 validation (TC-003)**: The `validate()` function explicitly skips validation when `DefaultCurrency == ""`. The story's intent (AC9, tech note "ISO 4217") implies the field should be required or validated on every PUT. An empty currency code persisted to DynamoDB will surface as a blank or broken currency display anywhere bank transfer details are shown to runners (Journey 3, step 2). Developer should decide whether to require the field or accept empty-as-unset and document the decision.

3. **Missing post-login returnUrl redirect in AuthEffects (TC-026)**: `AuthEffects.signIn$` dispatches `signInSuccess` but there is no effect in the submitted files that reads `returnUrl` from the router snapshot and navigates to it. The AC7 requirement ("redirected to returnUrl or /photographer/events") requires this navigation to happen somewhere. If it lives only inside `LoginComponent` (outside NgRx), it is not covered by any existing test and will be invisible to the store-level specs. Developer should confirm the redirect is implemented and add a targeted test.
