# QA Plan: RS-011 — Photographer approves or rejects a purchase claim

## Scope

Covers three Lambda handlers and their unit-test suites:

- `lambdas/approve-purchase/handler/` — `PUT /purchases/{id}/approve`
- `lambdas/reject-purchase/handler/` — `PUT /purchases/{id}/reject`
- `lambdas/list-purchases-for-approval/handler/` — `GET /photographer/me/purchases`

The existing 16 tests (6 + 5 + 5) cover the primary ACs. This plan adds the edge
cases those tests did not anticipate.

---

## Test cases

### TC-001: approve with missing path parameter id

**Category**: Input validation
**Setup**: No DynamoDB records needed.
**Action**: `PUT /purchases//approve` — `PathParameters` map present but `"id"` key maps to empty string `""`.
**Expected**: HTTP 400, `{"error":"purchase id is required"}`. No calls to `PurchaseStore` or `OrderStore`.
**Why it matters**: The existing test suite has no test for an empty `purchaseID`. The guard is present in the handler but unverified by a test — a regression could silently skip the guard and attempt a `GetItem` with an empty key, producing a DynamoDB validation error that surfaces as a confusing 500.

---

### TC-002: reject with missing path parameter id

**Category**: Input validation
**Setup**: No DynamoDB records needed.
**Action**: `PUT /purchases//reject` — `PathParameters["id"]` is `""`.
**Expected**: HTTP 400, `{"error":"purchase id is required"}`. No store calls.
**Why it matters**: Same guard exists in reject-purchase but is equally untested.

---

### TC-003: approve with no JWT authorizer context

**Category**: Authorization
**Setup**: No DynamoDB records needed.
**Action**: `PUT /purchases/{id}/approve` — `RequestContext.Authorizer` is `nil` (API Gateway configured without JWT authorizer, or a unit-test misconfiguration).
**Expected**: HTTP 401, `{"error":"unauthorized"}`. No store calls.
**Why it matters**: The `jwtSub` nil-guard is tested implicitly by happy-path tests that always supply a JWT, but a test explicitly exercising `Authorizer == nil` would catch a future nil-pointer panic if the nil check is removed.

---

### TC-004: reject with no JWT authorizer context

**Category**: Authorization
**Setup**: No DynamoDB records needed.
**Action**: `PUT /purchases/{id}/reject` — `RequestContext.Authorizer` is `nil`.
**Expected**: HTTP 401. No store calls.
**Why it matters**: Same as TC-003 for the reject handler.

---

### TC-005: list endpoint called with no JWT authorizer context

**Category**: Authorization
**Setup**: No DynamoDB records needed.
**Action**: `GET /photographer/me/purchases?status=pending` — `RequestContext.Authorizer` is `nil`.
**Expected**: HTTP 401. No store calls.
**Why it matters**: The list handler checks `jwtSub` after checking the `status` param. A test that supplies a valid `status=pending` but no JWT should hit the 401 branch cleanly without panicking.

---

### TC-006: approve — UpdatePurchaseApproved succeeds but updateOrderStatus QueryPurchasesByOrder fails

**Category**: Failure injection
**Setup**: Purchase with `status=pending`, owning Order in store.
**Action**: `PUT /purchases/{id}/approve` — `UpdatePurchaseApproved` returns `nil` (success), but `QueryPurchasesByOrder` returns a transient error (e.g. `ProvisionedThroughputExceededException`).
**Expected**: HTTP 200 with `status=approved` and a valid `downloadToken`. The `updateOrderStatus` failure is logged and swallowed — the purchase remains approved. `UpdateOrderStatus` must NOT be called (no data to derive status from).
**Why it matters**: The handler deliberately swallows `updateOrderStatus` errors (line 114–120 of handler.go), but there is no test verifying that the 200 response is still returned, that the `downloadToken` is present in the body, and that `UpdateOrderStatus` is not called. A future refactor could accidentally promote this to a fatal error.

---

### TC-007: approve — UpdatePurchaseApproved succeeds but UpdateOrderStatus fails

**Category**: Failure injection
**Setup**: Purchase with `status=pending`, owning Order in store, `QueryPurchasesByOrder` returns successfully.
**Action**: `PUT /purchases/{id}/approve` — `UpdateOrderStatus` returns an error.
**Expected**: HTTP 200 with `status=approved` and `downloadToken` present. Error logged. Email still sent (email call happens after `updateOrderStatus`).
**Why it matters**: Confirms the non-fatal contract for the order-rollup step. The Purchase is authoritative; the Order status is a derived cache. Degraded order status must not block the runner from getting their download link.

---

### TC-008: reject — UpdatePurchaseRejected succeeds but QueryPurchasesByOrder fails during order rollup

**Category**: Failure injection
**Setup**: Purchase with `status=pending`, owning Order in store.
**Action**: `PUT /purchases/{id}/reject` — `UpdatePurchaseRejected` returns `nil`, `QueryPurchasesByOrder` returns an error.
**Expected**: HTTP 200 with `status=rejected`. Error logged. `UpdateOrderStatus` must NOT be called.
**Why it matters**: The reject handler swallows `updateOrderStatus` errors (lines 103–109 of reject handler.go), but this is also untested. The test proves the swallow is intentional and the 200 + body are still correct.

---

### TC-009: concurrent approve + reject for the same purchaseId

**Category**: Concurrency
**Setup**: One Purchase in `status=pending`. Two concurrent Lambda invocations: one calls approve, one calls reject. The approve reads `status=pending` first; the reject also reads `status=pending` before approve writes.
**Action**: Approve invocation calls `UpdatePurchaseApproved`; reject invocation calls `UpdatePurchaseRejected` a fraction of a second later (both read the pending state before either write lands).
**Expected**: The DynamoDB `UpdateItem` calls for `UpdatePurchaseApproved` and `UpdatePurchaseRejected` must use a `ConditionExpression: attribute_exists(id) AND #status = :pending`. If the condition fails for one of the writers, DynamoDB returns `ConditionalCheckFailedException`. That error must be mapped to HTTP 409 (conflict), not 500.
**Why it matters**: Neither handler has a documented `ConditionalCheckFailedException` handler in the current unit tests. Without a condition expression, the last writer wins silently — a purchase could end up approved and then immediately overwritten to rejected (or vice versa) with no signal to the caller or the runner. This is a P1 data-integrity risk. The unit tests for `UpdatePurchaseApproved` / `UpdatePurchaseRejected` pass a generic error today; a specific test for `ConditionalCheckFailedException` should be added and the DynamoDB store implementation must include the condition expression.

---

### TC-010: concurrent approve + approve for the same purchaseId

**Category**: Concurrency / Idempotency
**Setup**: One Purchase in `status=pending`. Two concurrent approve Lambda invocations.
**Action**: Both invocations read `status=pending`. Both call `UpdatePurchaseApproved` with different `downloadToken` UUID values (each Lambda generates its own UUID).
**Expected**: The DynamoDB write condition (`status = pending`) ensures only one succeeds. The loser gets `ConditionalCheckFailedException`, which must map to 409, not 500. The winner's `downloadToken` is the authoritative one.
**Why it matters**: Without a conditional write, two `downloadToken` values are generated for the same purchase. The second overwrite silently invalidates the token already emailed to the runner. The runner's download link breaks. P1 bug.

---

### TC-011: deriveOrderStatus — QueryPurchasesByOrder returns empty slice

**Category**: Boundary values
**Setup**: An order exists but all its purchases have been deleted (data inconsistency, or a bug in RS-010 cleanup).
**Action**: `PUT /purchases/{id}/approve` reaches `updateOrderStatus`; `QueryPurchasesByOrder` returns `([]*models.Purchase{}, nil)`.
**Expected**: `deriveOrderStatus` returns `"pending"` (the `len == 0` guard). `UpdateOrderStatus` is called with `"pending"`. The approve response is still HTTP 200. No panic.
**Why it matters**: The `deriveOrderStatus` function has a guard for `len(purchases) == 0` that returns `"pending"`, but there is no unit test exercising this branch. A regression that removes the guard would send an empty slice into the counter loop, arriving at `approved == 0 && rejected == 0 && len == 0`, which the current switch-default returns `"pending"` for anyway — but the test documents the intent explicitly.

---

### TC-012: deriveOrderStatus — mix of approved and rejected, no pending

**Category**: State machine
**Setup**: An order with two purchases: one `approved`, one `rejected`. A third purchase being approved triggers the rollup.
**Action**: `QueryPurchasesByOrder` returns `[approved, rejected, approved]` (all three settled, none pending).
**Expected**: `deriveOrderStatus` returns `"pending"` (the mixed-state default), NOT `"approved"` or `"rejected"`. `UpdateOrderStatus` is called with `"pending"`.
**Why it matters**: The story spec says "If Purchases are a mix of approved/rejected/pending → leave Order.status = pending." The code's `default: return models.OrderStatusPending` handles the `approved+rejected` mix correctly, but this exact branch has no test. A well-intentioned refactor (e.g. adding an `allSettled` case) could incorrectly set the order to approved.

---

### TC-013: list — more than 100 pending purchases across orders (BatchGetItem limit)

**Category**: Boundary values
**Setup**: One photographer with 101 distinct pending orders, each containing one purchase for a distinct photo. That produces 101 unique `photoId` values collected into `photoIDs`.
**Action**: `GET /photographer/me/purchases?status=pending`.
**Expected**: The handler issues a single call to `BatchGetPhotos` with 101 IDs. The `PhotoStore` implementation (DynamoDB `BatchGetItem`) must chunk into batches of 100. The handler currently passes the full slice unconditionally — if the store implementation does NOT chunk, DynamoDB will return a `ValidationException: Too many items requested for the BatchGetItem call` (max 100 items per call). HTTP 200 with all 101 purchase rows correctly populated.
**Why it matters**: The handler has no chunking logic; it delegates to `BatchGetPhotos`. If the concrete DynamoDB store implementation does not chunk at 100, requests with 101+ unique photos silently fail with a 500. This is a production-scale scenario (a photographer at a 5,000-runner race easily accumulates 100+ pending orders). Flag for developer to confirm chunking is implemented in the DynamoDB store. P1 scalability bug.

---

### TC-014: list — photo not found in BatchGetPhotos result (partial BatchGetItem miss)

**Category**: Failure injection / Boundary values
**Setup**: One pending order with one purchase referencing `photo-1`. `BatchGetPhotos` returns an empty slice (the photo record was deleted or never written — data inconsistency).
**Action**: `GET /photographer/me/purchases?status=pending`.
**Expected**: HTTP 200 with one purchase row where `watermarkedUrl` is `""` (empty string). The row is NOT omitted. No 500.
**Why it matters**: The handler already handles this case (`photoByID[p.PhotoID]` returns `""` for a missing key), but there is no test covering it. The UI must handle an empty `watermarkedUrl` gracefully (broken image vs placeholder). This test documents the contract for frontend consumption.

---

### TC-015: list — photo has empty watermarkedS3Key in BatchGetPhotos response

**Category**: Boundary values
**Setup**: Photo record exists in DynamoDB but `watermarkedS3Key` is `""` (photo is still in `status=processing`).
**Action**: `GET /photographer/me/purchases?status=pending`.
**Expected**: HTTP 200, `watermarkedUrl` is `""` (the `if p.WatermarkedS3Key != ""` guard skips the CDN URL construction). No 500.
**Why it matters**: The handler has an explicit guard for this (line 125 of handler.go), but it is untested. Without the guard, the response would contain `"https://cdn.example.com/"` — a valid-looking but broken CDN URL prefix that would silently return a 403/404 from CloudFront.

---

### TC-016: list — status query param is "PENDING" (uppercase)

**Category**: Input validation
**Setup**: No records needed.
**Action**: `GET /photographer/me/purchases?status=PENDING`.
**Expected**: HTTP 400, `{"error":"status query param is required and must be \"pending\""}`.
**Why it matters**: AC12 says "any value other than `pending`" returns 400. The current check is an exact string comparison, so `"PENDING"` is correctly rejected. A test documents this to prevent a future case-insensitive comparison from silently accepting `"PENDING"` and bypassing the guard.

---

### TC-017: approve — SES SendTemplatedEmail fails after purchase is persisted

**Category**: Failure injection
**Setup**: Purchase in `status=pending`, owning Order. `UpdatePurchaseApproved` and order rollup succeed.
**Action**: `PUT /purchases/{id}/approve` — `SendTemplatedEmail` returns an error (e.g. `MessageRejected`).
**Expected**: HTTP 200 with `status=approved` and `downloadToken` present. Error logged without the runner's email address. Purchase is NOT rolled back. The existing test for this path uses `Return(nil)` for email — this test uses `Return(errors.New("ses error"))`.
**Why it matters**: The story explicitly states "email failure is non-fatal — Purchase already persisted." The handler calls `sendApprovalEmail` which swallows the error. However, there is no unit test that passes a failing `EmailSender` mock and asserts the response is still 200. A future refactor that promotes the email error to fatal would break this contract silently.

---

### TC-018: approve — GetOrder returns ErrNotFound (orphaned purchase)

**Category**: Failure injection
**Setup**: Purchase exists but its parent Order record was deleted (data inconsistency).
**Action**: `PUT /purchases/{id}/approve` — `GetPurchase` succeeds; `GetOrder` returns `apperrors.ErrNotFound`.
**Expected**: HTTP 500, `{"error":"internal server error"}`. Error logged with `purchaseID` and `orderID`. No 404 (the purchase itself exists; the missing order is a server-side data integrity failure, not a caller error).
**Why it matters**: The handler maps orphaned-order to 500 (lines 67–73 of handler.go), which is correct. But this branch is untested. A future change could accidentally map it to 404, misleading callers into thinking the purchase ID is invalid.

---

### TC-019: reject — GetOrder returns ErrNotFound (orphaned purchase)

**Category**: Failure injection
**Setup**: Same as TC-018 but for the reject handler.
**Action**: `PUT /purchases/{id}/reject` — `GetOrder` returns `apperrors.ErrNotFound`.
**Expected**: HTTP 500. Error logged.
**Why it matters**: Same reasoning as TC-018. The reject handler has the same branch (lines 58–65 of reject handler.go) with no test coverage.

---

### TC-020: approve — photographerId in JWT is empty string after claims lookup

**Category**: Authorization
**Setup**: No records needed.
**Action**: `PUT /purchases/{id}/approve` — JWT context present, `Claims["sub"]` key exists but value is `""`.
**Expected**: HTTP 401, `{"error":"unauthorized"}`. No store calls.
**Why it matters**: `jwtSub` checks `claims == ""` and returns `false`. This is tested for the `nil` authorizer path in TC-003, but the distinct branch where the key exists with an empty value is not separately tested.

---

### TC-021: list — QueryPurchasesByOrder fails for one of multiple orders

**Category**: Failure injection
**Setup**: Photographer has two pending orders (`order-1`, `order-2`). `QueryPurchasesByOrder("order-1")` succeeds; `QueryPurchasesByOrder("order-2")` returns an error.
**Action**: `GET /photographer/me/purchases?status=pending`.
**Expected**: HTTP 500, `{"error":"internal server error"}`. The partial result for `order-1` is discarded — no partial response is returned.
**Why it matters**: The handler iterates over orders and returns 500 on any purchase query failure. The all-or-nothing behavior is correct (partial lists would mislead the photographer), but it is untested for the multi-order case. A future optimization that returns partial results would be a regression.

---

### TC-022: list — QueryPendingOrdersByPhotographer returns DynamoDB error (not ErrNotFound)

**Category**: Failure injection
**Setup**: DynamoDB is throttling (`ProvisionedThroughputExceededException` mapped to a generic Go error).
**Action**: `GET /photographer/me/purchases?status=pending` — `QueryPendingOrdersByPhotographer` returns a non-nil error.
**Expected**: HTTP 500. No calls to `PurchaseStore` or `PhotoStore`.
**Why it matters**: The error path exists in the handler but is not covered by any test. Confirms the handler does not attempt to process an empty order slice returned alongside an error.

---

### TC-023: approve — response body contains downloadToken only on first approval, not on idempotent re-approval with missing token in stored record

**Category**: Idempotency / Boundary values
**Setup**: Purchase with `status=approved` but `DownloadToken` is `nil` (data inconsistency — token was lost before being written to DynamoDB, or cleared by a bug).
**Action**: `PUT /purchases/{id}/approve` (AC3 idempotent path) — purchase status is `approved`, `DownloadToken` field is `nil`.
**Expected**: HTTP 200. `downloadToken` field is omitted from the JSON response (Go's `omitempty` on `*string`). No new token is generated. No new email is sent.
**Why it matters**: The AC3 idempotent path short-circuits before generating a token, returning the stored purchase as-is. If `DownloadToken` is `nil` in the database, the runner's download link is broken and there is no way to re-trigger the email. The handler should be reviewed: should AC3 check `DownloadToken != nil` before treating the record as truly idempotent? This is a risk-flag for the developer rather than a behavioral assertion.

---

### TC-024: maskEmail — single-character local part

**Category**: Boundary values / Input validation
**Setup**: Purchase record where `RunnerEmail` is `"a@example.com"` (one char before `@`).
**Action**: `GET /photographer/me/purchases?status=pending` returns this purchase.
**Expected**: `runnerEmail` in response is `"a***@example.com"` (first char retained, `***` appended, domain preserved). `maskEmail` with `at == 1` correctly takes `email[:1]`.
**Why it matters**: `maskEmail` uses `email[:1]` unconditionally when `at > 0`. A single-char local part is the minimum valid case (`at == 1`). The function is correct for this input, but no test verifies it. A refactor to `email[:2]` for "better masking" would silently panic on single-char local parts.

---

### TC-025: maskEmail — email with no @ character

**Category**: Input validation / Boundary values
**Setup**: Purchase with `RunnerEmail = "notanemail"` (malformed — should never reach production, but possible via direct DynamoDB write or a bug in RS-010 validation).
**Action**: List endpoint returns this purchase.
**Expected**: `runnerEmail` in response is `"***"`. No panic. `maskEmail` returns `"***"` when `at <= 0`.
**Why it matters**: `maskEmail` handles this via the `at <= 0` guard. Untested. A malformed email in the database must not crash the list Lambda.

---

## Risk areas

### Risk-1: No conditional expression on approve/reject DynamoDB writes (TC-009, TC-010)

The story and the existing unit tests do not address whether `UpdatePurchaseApproved` and `UpdatePurchaseRejected` use a DynamoDB `ConditionExpression` to enforce `status = :pending`. Without it, two concurrent Lambda invocations can both read `pending`, both write, and the second write silently wins. The concrete DynamoDB store implementation must be inspected to confirm a condition expression is present. If it is absent, concurrent approve+reject or approve+approve on the same purchase produces silent data corruption. This is the highest-risk gap in the current test coverage.

### Risk-2: BatchGetItem chunking for 100+ photos (TC-013)

The `list-purchases-for-approval` handler passes the full `photoIDs` slice to `BatchGetPhotos` without any chunk limit. DynamoDB's `BatchGetItem` API hard-caps at 100 items per call. For a photographer with 101+ pending purchases referencing distinct photos — entirely plausible at a large race — the concrete store implementation will receive 101 IDs. If it passes them directly to DynamoDB without chunking, the call fails with a `ValidationException` and the handler returns 500. Neither the unit test suite nor the story tech notes document a chunking requirement. Developer must confirm the store layer chunks at 100.

### Risk-3: Broken download link when email succeeds but approve is retried (TC-023)

AC3 (idempotent approve) short-circuits on `status == approved` and returns the stored `DownloadToken`. If the approve succeeded at the DynamoDB level but the Lambda crashed before returning to the caller (or before sending the email), the caller retries. The retry correctly gets a 200. However, if `DownloadToken` was somehow not persisted (e.g. the `UpdatePurchaseApproved` write partially failed after a timeout), the re-approval returns a 200 with a nil `downloadToken` and no new email is sent — the runner has no way to access their download. This scenario requires the developer to confirm that `UpdatePurchaseApproved` is written as an atomic DynamoDB `UpdateItem` that sets `status`, `downloadToken`, and `approvedAt` in a single operation, not multiple separate writes.
