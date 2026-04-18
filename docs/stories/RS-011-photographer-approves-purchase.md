# Story: Photographer approves or rejects a purchase claim

**ID**: RS-011
**Epic**: Payment / Frontend
**Status**: ready
**Has UI**: yes

## Context

After a runner submits a payment claim (RS-010), the photographer receives an email notification (ADR-0001) and reviews pending claims in their dashboard approvals tab. When approved, a permanent `downloadToken` (UUID v4) is generated and emailed to the runner as a permanent download link (ADR-0002, Journey 3 steps 6–8). Per ADR-0003, each Purchase record is scoped to a `(photoId, runnerEmail)` pair — approving one runner's claim does not unlock the photo for any other runner.

## Acceptance criteria

- [ ] AC1: Given `GET /photographer/me/purchases?status=pending` is called with a valid Cognito JWT, then HTTP 200 and all pending purchases for events owned by that photographer are returned: `[{ purchaseId, photoId, eventId, eventName, runnerEmail (masked: r***@domain.com), paymentRef, claimedAt, watermarkedUrl }]`.
- [ ] AC2: Given `PUT /purchases/{id}/approve` is called with a valid Cognito JWT, when the caller owns the purchase and the purchase has `status=pending`, then: a `downloadToken` (UUID v4) is generated; the Purchase is updated to `status=approved`, `downloadToken`, `approvedAt`; SES template `racephotos-runner-purchase-approved` is sent to the runner with the permanent download link `{RACEPHOTOS_APP_BASE_URL}/download/{downloadToken}`. HTTP 200 and the updated Purchase are returned (ADR-0002).
- [ ] AC3: Given `PUT /purchases/{id}/approve` is called on a purchase that already has `status=approved`, then the call is a no-op and the existing Purchase is returned with HTTP 200 (idempotent).
- [ ] AC4: Given `PUT /purchases/{id}/reject` is called with a valid Cognito JWT, when the caller owns the photo's event and the purchase has `status=pending`, then the Purchase is updated to `status=rejected`. No email is sent to the runner in v1. HTTP 200 and the updated Purchase are returned.
- [ ] AC5: Given `PUT /purchases/{id}/reject` is called on a purchase that already has `status=rejected`, then the call is a no-op and the existing Purchase is returned with HTTP 200 (idempotent).
- [ ] AC6: Given the caller's Cognito JWT sub does not match the `photographerId` on the photo's event, then HTTP 403 is returned for both approve and reject.
- [ ] AC7: Given `PUT /purchases/{id}/approve` or `PUT /purchases/{id}/reject` is called with a `purchaseId` that does not exist, then HTTP 404 is returned.
- [ ] AC8: Given `PUT /purchases/{id}/approve` is called on a purchase with `status=rejected`, or `PUT /purchases/{id}/reject` is called on a purchase with `status=approved`, then HTTP 409 is returned. (Terminal-state transitions are not allowed; the photographer must contact the runner to resubmit if needed.)
- [ ] AC9: Given a photographer visits `/photographer/dashboard/approvals`, then pending purchases are listed with: watermarked photo thumbnail, event name, masked runner email, `paymentRef`, claimed date, an Approve button (green), and a Reject button (outlined red). Per ADR-0003, it is expected that the same photo may appear multiple times with different runners.
- [ ] AC10: Given a photographer clicks Approve or Reject, then a confirmation dialog is shown before the request is sent to the API.
- [ ] AC11: Given the API action succeeds, then the purchase row is removed from the pending list and a toast notification confirms the action.
- [ ] AC12: Given `GET /photographer/me/purchases` is called with a valid Cognito JWT and the `status` query param is omitted or is any value other than `"pending"`, then HTTP 400 is returned.
- [ ] AC13: Given a valid Cognito JWT is provided and the photographer has no pending purchases, then `GET /photographer/me/purchases?status=pending` returns HTTP 200 and an empty array `[]`.

## Out of scope

- Rejection email to runner (v2)
- Bulk approve/reject
- One-click approve/reject links directly in the notification email (ADR-0001: in-app approval only)

## Tech notes

- New Lambda modules (one per HTTP method per CLAUDE.md convention):
  - `lambdas/list-purchases-for-approval/` — `GET /photographer/me/purchases`, Cognito JWT required
  - `lambdas/approve-purchase/` — `PUT /purchases/{id}/approve`, Cognito JWT required
  - `lambdas/reject-purchase/` — `PUT /purchases/{id}/reject`, Cognito JWT required
- Ownership check pattern (apply in approve and reject Lambdas):
  1. Load Purchase by `purchaseId`
  2. Load Order by `Purchase.orderId`
  3. Assert `Order.photographerId == JWT sub`; return 403 if mismatch
  - `photographerId` is denormalized onto the Order at creation time (RS-010); no Photo or Event lookups are needed beyond the Order fetch
- Order.status lifecycle after approve/reject:
  - After updating the Purchase, reload all Purchases for the Order (via `orderId-index` GSI on `racephotos-purchases`)
  - If all Purchases are `approved` → set `Order.status = "approved"`, `Order.approvedAt = now`
  - If all Purchases are `rejected` → set `Order.status = "rejected"`
  - If Purchases are a mix of `approved`/`rejected`/`pending` → leave `Order.status = "pending"`
  - This keeps `Order.status` consistent for any future order-level queries; RS-012 (download) checks `Purchase.status` directly and is unaffected
- `runnerEmail` is PII — never include it in structured log entries in any of the three Lambdas (mask or omit entirely)
- `downloadToken` generation: `uuid.New().String()` from `github.com/google/uuid`
- Interfaces per Lambda:
  - `list-purchases-for-approval`: `PurchaseStore`, `OrderStore`, `PhotoStore`
  - `approve-purchase`: `PurchaseStore`, `OrderStore`, `EmailSender`
  - `reject-purchase`: `PurchaseStore`, `OrderStore`

  ```go
  // shared by all three Lambdas
  type PurchaseStore interface {
      GetPurchase(ctx context.Context, id string) (*models.Purchase, error)
      QueryPurchasesByOrder(ctx context.Context, orderID string) ([]*models.Purchase, error)
      UpdatePurchaseApproved(ctx context.Context, id, downloadToken, approvedAt string) error
      UpdatePurchaseRejected(ctx context.Context, id string) error
  }
  type OrderStore interface {
      GetOrder(ctx context.Context, id string) (*models.Order, error)
      QueryPendingOrdersByPhotographer(ctx context.Context, photographerID string) ([]*models.Order, error)
      UpdateOrderStatus(ctx context.Context, id, status, updatedAt string) error
  }

  // list-purchases-for-approval only
  type PhotoStore interface {
      BatchGetPhotos(ctx context.Context, photoIDs []string) ([]*models.Photo, error)
  }

  // approve-purchase only
  type EmailSender interface {
      SendTemplatedEmail(ctx context.Context, to, template string, data map[string]string) error
  }
  ```

  - `EventStore` is not needed in any of the three Lambdas
  - `list-purchases-for-approval` access pattern (1 + N + 1 round-trips where N = number of pending orders; no fan-out against Photos):
    1. Query `racephotos-orders` via `photographerId-claimedAt-index` (PK: `photographerId` = JWT sub, SK: `claimedAt`, filter: `status = "pending"`) — returns pending Orders; `paymentRef`, `eventId`, and `eventName` are read directly from each Order record
    2. For each Order, query `racephotos-purchases` via new `orderId-index` GSI (PK: `orderId`) — returns the Purchase line items for that Order (`purchaseId`, `photoId`, `runnerEmail`, `claimedAt`)
    3. Collect all `photoId`s across all Purchases; issue a single `BatchGetItem` against `racephotos-photos` to fetch `watermarkedS3Key` per photo; construct `watermarkedUrl = RACEPHOTOS_CDN_BASE_URL + "/" + photo.watermarkedS3Key`
  - `PhotoStore` is needed by `list-purchases-for-approval` only (batch get); `approve-purchase` and `reject-purchase` do not need it
  - `racephotos-orders` table and its `photographerId-claimedAt-index` GSI are defined in RS-010's `DatabaseConstruct` — no new table creation needed in this story
  - `orderId-index` GSI (PK: `orderId`) is new and must be added to `racephotos-purchases` in `DatabaseConstruct` and mirrored in `scripts/seed-local.sh`
- New env vars:
  ```
  RACEPHOTOS_ENV                  required — all three Lambdas
  RACEPHOTOS_PURCHASES_TABLE      required — all three Lambdas
  RACEPHOTOS_ORDERS_TABLE         required — all three Lambdas (list queries orders; approve/reject loads order for ownership check)
  RACEPHOTOS_PHOTOS_TABLE         required — list-purchases-for-approval only (BatchGetItem for watermarkedS3Key)
  RACEPHOTOS_CDN_BASE_URL         required — list-purchases-for-approval only (constructs watermarkedUrl)
  RACEPHOTOS_SES_FROM_ADDRESS     required — approve-purchase only
  RACEPHOTOS_APP_BASE_URL         required — approve-purchase only (download link in email)
  ```
- CDK: add all three Lambda functions to `PaymentConstruct`; call `SesConstruct.grantSendEmail` for `approve-purchase` only; wire `ObservabilityConstruct` per Lambda; all three routes require Cognito authorizer; inject `RACEPHOTOS_CDN_BASE_URL` from the CloudFront distribution domain name output of `PhotoStorageConstruct`
- Angular: `/photographer/dashboard/approvals` tab within the existing photographer dashboard layout; `store/purchases/` NgRx slice; confirmation dialog is a new shared component — Storybook story required for it (covering open/confirm/cancel states)
- `.env.example`: add `RACEPHOTOS_APP_BASE_URL` and `RACEPHOTOS_CDN_BASE_URL`
- ADR dependencies: ADR-0001 (notification design — email only, no one-click approve link), ADR-0002 (`downloadToken` generation and storage), ADR-0003 (independent purchases per runner — dashboard must show multiple rows for the same photo)

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
