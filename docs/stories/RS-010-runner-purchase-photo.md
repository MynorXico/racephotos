# Story: Runner purchases a photo

**ID**: RS-010
**Epic**: Payment / Frontend
**Status**: ready
**Has UI**: yes

## Context

After finding their photo (RS-009), a runner initiates a purchase by entering their email. The system generates a unique payment reference (`paymentRef`) scoped to that `(photoId, runnerEmail)` pair and displays the photographer's bank transfer details. The runner makes the bank transfer using the `paymentRef` as the description. The purchase claim is created at this point — no second "I transferred" confirmation step (Journey 3, steps 1–4). Per ADR-0003, a photo containing multiple bib numbers can be purchased independently by each runner.

## Acceptance criteria

- [ ] AC1: Given `POST /purchases` is called with `{ photoId, runnerEmail }` (no auth), when the photo exists and has `status=indexed`, then a Purchase record is created with `status="pending"`, a system-generated `paymentRef` (format: `RS-` followed by 8 uppercase alphanumeric characters), and `claimedAt`. Response: `{ purchaseId, paymentRef, pricePerPhoto, currency, bankDetails: { bankName, bankAccountNumber, bankAccountHolder, bankInstructions } }`.
- [ ] AC2: Given `POST /purchases` is called for a `(photoId, runnerEmail)` pair that already has a `pending` or `approved` Purchase, then the existing purchase is returned with no new record created (idempotent).
- [ ] AC3: Given the photo does not have `status=indexed`, then a 422 error is returned: "Photo is not available for purchase."
- [ ] AC4: Given an invalid email format is provided, then a 400 error is returned.
- [ ] AC5: Given the purchase is created, then an SES email is sent to the photographer using template `racephotos-photographer-claim` with masked runner email (`r***@domain.com`), event name, photo reference, and a link to the approvals dashboard (ADR-0001).
- [ ] AC6: Given the purchase is created, then an SES email is sent to the runner using template `racephotos-runner-claim-confirmation` with event name, `paymentRef`, and expected next steps (ADR-0001, ADR-0002).
- [ ] AC7: Given a runner clicks "Purchase this photo" on the photo detail view, then a multi-step purchase flow opens at step 1: an email input form that shows a preview `"We'll send updates to r***@domain.com — is this correct?"` before the runner confirms (ADR-0002).
- [ ] AC8: Given the runner confirms their email and the API call succeeds, then step 2 shows bank transfer instructions: `paymentRef`, price, currency, `bankName`, `bankAccountNumber`, `bankAccountHolder`, `bankInstructions` — formatted clearly for copy-paste.
- [ ] AC9: Given the runner is on step 2 and clicks "I've made the transfer", then a confirmation screen is shown: "Your payment claim has been submitted. The photographer will review it and you'll receive an email once approved."

## Out of scope

- Payment processing / Stripe (v2)
- Automatic payment verification
- Rejection email to runner (v1: no email sent on rejection)

## Tech notes

- New Lambda module: `lambdas/create-purchase/`
  - Route: `POST /purchases`, no auth
- Interfaces:
  ```go
  type PurchaseStore interface {
      CreatePurchase(ctx context.Context, p models.Purchase) error
      GetPurchaseByPhotoAndEmail(ctx context.Context, photoID, runnerEmail string) (*models.Purchase, error)
  }
  type PhotoStore interface {
      GetPhoto(ctx context.Context, id string) (*models.Photo, error)
  }
  type EventStore interface {
      GetEvent(ctx context.Context, id string) (*models.Event, error)
  }
  type PhotographerStore interface {
      GetPhotographer(ctx context.Context, id string) (*models.Photographer, error)
  }
  type EmailSender interface {
      SendTemplatedEmail(ctx context.Context, to, template string, data map[string]string) error
  }
  ```
- New model: `shared/models/purchase.go`
  ```go
  type Purchase struct {
      ID             string `dynamodbav:"id"`
      PhotoID        string `dynamodbav:"photoId"`
      RunnerEmail    string `dynamodbav:"runnerEmail"`
      PaymentRef     string `dynamodbav:"paymentRef"`
      Status         string `dynamodbav:"status"` // "pending"|"approved"|"rejected"
      DownloadToken  string `dynamodbav:"downloadToken"` // UUID v4, set at approval; empty before approval
      PhotographerID string `dynamodbav:"photographerId"` // denormalized from Photo.EventID → Event.PhotographerID at purchase creation; enables single-lookup ownership check in approve/reject
      ClaimedAt      string `dynamodbav:"claimedAt"`
      ApprovedAt     string `dynamodbav:"approvedAt"`
  }
  ```
- `paymentRef` generation: `RS-` + 8 characters from `crypto/rand` (uppercase A-Z0-9)
- Idempotency: query `photoId-runnerEmail-index` GSI (PK: photoId, SK: runnerEmail) on purchases table; if a `pending` or `approved` record exists for the pair, return it without creating a new one (GSI defined in RS-001)
- `photographerId` denormalization: at purchase creation time, load Photo → Event to resolve `photographerId` and store it on the Purchase; this enables approve/reject Lambdas to check ownership with a single Purchase lookup (no join needed)
- New env vars:
  ```
  RACEPHOTOS_ENV                  required
  RACEPHOTOS_PURCHASES_TABLE      required — DynamoDB purchases table name
  RACEPHOTOS_PHOTOS_TABLE         required — DynamoDB photos table name
  RACEPHOTOS_EVENTS_TABLE         required — DynamoDB events table name
  RACEPHOTOS_PHOTOGRAPHERS_TABLE  required — DynamoDB photographers table name
  RACEPHOTOS_SES_FROM_ADDRESS     required — verified SES sender address
  RACEPHOTOS_APPROVALS_URL        required — base URL for photographer dashboard (injected by CDK)
  ```
- CDK: new `PaymentConstruct`; call `SesConstruct.grantSendEmail` for this Lambda; wire `ObservabilityConstruct`
- Angular: purchase flow is a multi-step component (stepper); `store/purchases/` NgRx slice; step components are individually Storybook-testable
- `.env.example`: add `RACEPHOTOS_PURCHASES_TABLE`, `RACEPHOTOS_SES_FROM_ADDRESS`, `RACEPHOTOS_APPROVALS_URL`
- ADR dependencies: ADR-0001 (SES notification design), ADR-0002 (email preview UX, claim confirmation), ADR-0003 (independent purchase per runner — already resolved)

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
