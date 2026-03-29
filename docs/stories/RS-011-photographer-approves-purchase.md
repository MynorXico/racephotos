# Story: Photographer approves or rejects a purchase claim

**ID**: RS-011
**Epic**: Payment / Frontend
**Status**: ready
**Has UI**: yes

## Context

After a runner submits a payment claim (RS-010), the photographer receives an email notification (ADR-0001) and reviews pending claims in their dashboard approvals tab. When approved, a permanent `downloadToken` (UUID v4) is generated and emailed to the runner as a permanent download link (ADR-0002, Journey 3 steps 6–8). Per ADR-0003, each Purchase record is scoped to a `(photoId, runnerEmail)` pair — approving one runner's claim does not unlock the photo for any other runner.

## Acceptance criteria

- [ ] AC1: Given `GET /photographer/me/purchases?status=pending` is called with a valid Cognito JWT, then all pending purchases for events owned by that photographer are returned: `[{ purchaseId, photoId, eventId, eventName, runnerEmail (masked: r***@domain.com), paymentRef, claimedAt, watermarkedUrl }]`.
- [ ] AC2: Given `PUT /purchases/{id}/approve` is called with a valid Cognito JWT, when the caller owns the purchase and the purchase has `status=pending`, then: a `downloadToken` (UUID v4) is generated; the Purchase is updated to `status=approved`, `downloadToken`, `approvedAt`; SES template `racephotos-runner-purchase-approved` is sent to the runner with the permanent download link `{RACEPHOTOS_APP_BASE_URL}/download/{downloadToken}`. The updated Purchase is returned (ADR-0002).
- [ ] AC3: Given `PUT /purchases/{id}/approve` is called on a purchase that already has `status=approved`, then the call is a no-op and the existing Purchase is returned (idempotent).
- [ ] AC4: Given `PUT /purchases/{id}/reject` is called with a valid Cognito JWT, when the caller owns the photo's event and the purchase has `status=pending`, then the Purchase is updated to `status=rejected`. No email is sent to the runner in v1. The updated Purchase is returned.
- [ ] AC5: Given the caller's Cognito JWT sub does not match the `photographerId` on the photo's event, then 403 is returned for both approve and reject.
- [ ] AC6: Given a photographer visits `/photographer/dashboard/approvals`, then pending purchases are listed with: watermarked photo thumbnail, event name, masked runner email, `paymentRef`, claimed date, an Approve button (green), and a Reject button (outlined red). Per ADR-0003, it is expected that the same photo may appear multiple times with different runners.
- [ ] AC7: Given a photographer clicks Approve or Reject, then a confirmation dialog is shown before the request is sent to the API.
- [ ] AC8: Given the API action succeeds, then the purchase row is removed from the pending list and a toast notification confirms the action.

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
  2. Assert `Purchase.photographerId == JWT sub`; return 403 if mismatch
  - `photographerId` is denormalized onto the Purchase at creation time (RS-010); no additional Photo or Event lookups are needed
- `downloadToken` generation: `uuid.New().String()` from `github.com/google/uuid`
- Interfaces (approve-purchase — others follow same pattern):
  ```go
  type PurchaseStore interface {
      GetPurchase(ctx context.Context, id string) (*models.Purchase, error)
      UpdatePurchaseApproved(ctx context.Context, id, downloadToken, approvedAt string) error
      UpdatePurchaseRejected(ctx context.Context, id string) error
  }
  type EmailSender interface {
      SendTemplatedEmail(ctx context.Context, to, template string, data map[string]string) error
  }
  ```

  - `PhotoStore` and `EventStore` are not needed in approve/reject Lambdas — ownership check uses `Purchase.photographerId` (denormalized in RS-010)
  - `list-purchases-for-approval` still needs an `EventStore` to filter events by photographer and join event names
- New env vars:
  ```
  RACEPHOTOS_ENV                  required — all three Lambdas
  RACEPHOTOS_PURCHASES_TABLE      required — all three Lambdas
  RACEPHOTOS_EVENTS_TABLE         required — list-purchases-for-approval only
  RACEPHOTOS_SES_FROM_ADDRESS     required — approve-purchase only
  RACEPHOTOS_APP_BASE_URL         required — approve-purchase only (download link in email)
  ```
- CDK: add all three Lambda functions to `PaymentConstruct`; call `SesConstruct.grantSendEmail` for `approve-purchase` only; wire `ObservabilityConstruct` per Lambda; all three routes require Cognito authorizer
- Angular: `/photographer/dashboard/approvals` tab within the existing photographer dashboard layout; `store/purchases/` NgRx slice; confirmation dialog is a shared component
- `.env.example`: add `RACEPHOTOS_APP_BASE_URL`
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
