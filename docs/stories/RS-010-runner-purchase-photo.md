# Story: Runner purchases a photo

**ID**: RS-010
**Epic**: Payment / Frontend
**Status**: done
**Has UI**: yes

## Context

After finding their photo (RS-009), a runner initiates a purchase by entering their email; the system creates an **Order** grouping one or more photos from the same event under a single `paymentRef` and bank transfer, with each photo becoming a **Purchase** line item carrying its own `downloadToken` for independent download after approval (ADR-0010). The `POST /orders` API accepts `photoIds` as an array from day one — RS-010 UI sends one photo, RS-011 (multi-photo cart) will send many with no API change required. The same photo can be independently ordered by multiple runners per ADR-0003. (Journey 3, steps 1–4.)

## Acceptance criteria

- [ ] AC1: Given `POST /orders` is called with `{ photoIds: ["<id>"], runnerEmail }` (no auth), when all photos exist, belong to the same event and photographer, and have `status=indexed`, then one Order is created with `status="pending"`, a system-generated `paymentRef` (format: `RS-` followed by 8 uppercase alphanumeric characters), `totalAmount` (sum of `pricePerPhoto` across all photos), `claimedAt`, and one Purchase line item per photo each with its own `id` and `orderId`. HTTP 201 response: `{ orderId, paymentRef, totalAmount, currency, bankDetails: { bankName, bankAccountNumber, bankAccountHolder, bankInstructions } }`.
- [ ] AC2: Given `POST /orders` is called where all `(photoId, runnerEmail)` pairs already have a `pending` or `approved` Purchase, then the existing Order is returned with no new records created (idempotent) — HTTP 200. Given any pair has a `rejected` Purchase, a new Order and new Purchase records are created for those photos (runner may re-submit after rejection) — HTTP 201.
- [ ] AC3: Given `photoIds` is empty, then a 400 error is returned: "At least one photo is required."
- [ ] AC4: Given any `photoId` in `photoIds` does not exist in the photos table, then a 404 error is returned: "One or more photos not found."
- [ ] AC5: Given any photo in `photoIds` does not have `status=indexed`, then a 422 error is returned: "One or more photos are not available for purchase."
- [ ] AC6: Given photos in `photoIds` belong to different events or different photographers, then a 422 error is returned: "All photos in an order must belong to the same event."
- [ ] AC7: Given an invalid email format is provided, then a 400 error is returned.
- [ ] AC8: Given the Order is created, then an SES email is sent to the photographer using template `racephotos-photographer-claim` with masked runner email (`r***@domain.com`), event name, photo count, total amount, and a link to the approvals dashboard (ADR-0001).
- [ ] AC9: Given the Order is created, then an SES email is sent to the runner using template `racephotos-runner-claim-confirmation` with event name, `paymentRef`, total amount, and expected next steps (ADR-0001, ADR-0002).
- [ ] AC10: Given a runner clicks "Purchase this photo" on the photo detail view, then a multi-step purchase flow opens at step 1: an email input form that shows a preview `"We'll send updates to r***@domain.com — is this correct?"` before the runner confirms (ADR-0002).
- [ ] AC11: Given the runner confirms their email and the API call succeeds, then step 2 shows bank transfer instructions: `paymentRef`, `totalAmount`, `currency`, `bankName`, `bankAccountNumber`, `bankAccountHolder`, `bankInstructions` — formatted clearly for copy-paste.
- [ ] AC12: Given the runner is on step 2 and clicks "I've made the transfer", then a confirmation screen is shown: "Your payment claim has been submitted. The photographer will review it and you'll receive an email once approved."

## Out of scope

- Multi-photo cart UI — RS-011 (`POST /orders` already accepts `photoIds` array; RS-011 adds the selection UX only)
- Cross-event orders (v1: all photos in one order must share one event and one photographer)
- Payment processing / Stripe (v2)
- Automatic payment verification
- Rejection email to runner (v1: no email sent on rejection)

## Tech notes

- New Lambda module: `lambdas/create-order/`
  - Route: `POST /orders`, no auth
- Interfaces:
  ```go
  type OrderStore interface {
      CreateOrder(ctx context.Context, o models.Order) error
      GetOrderByID(ctx context.Context, id string) (*models.Order, error)
  }
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
- New/updated models in `shared/models/`:
  ```go
  // photographer.go
  type Photographer struct {
      ID                 string `dynamodbav:"id"`
      Email              string `dynamodbav:"email"`
      BankName           string `dynamodbav:"bankName"`
      BankAccountNumber  string `dynamodbav:"bankAccountNumber"`
      BankAccountHolder  string `dynamodbav:"bankAccountHolder"`
      BankInstructions   string `dynamodbav:"bankInstructions"` // optional free-text shown to runner
  }
  ```
  The `Photographer` record is the source of truth for bank details and the photographer's notification email. Both are resolved via `PhotographerStore.GetPhotographer()` at order creation time — never from env vars.

  ```go
  // order.go
  type Order struct {
      ID             string  `dynamodbav:"id"`
      RunnerEmail    string  `dynamodbav:"runnerEmail"`
      PaymentRef     string  `dynamodbav:"paymentRef"`
      TotalAmount    float64 `dynamodbav:"totalAmount"`
      Currency       string  `dynamodbav:"currency"`
      Status         string  `dynamodbav:"status"`         // "pending"|"approved"|"rejected"
      PhotographerID string  `dynamodbav:"photographerId"` // denormalized at creation
      EventID        string  `dynamodbav:"eventId"`        // v1: all photos in one order share one event
      EventName      string  `dynamodbav:"eventName"`      // denormalized at creation
      ClaimedAt      string  `dynamodbav:"claimedAt"`
      ApprovedAt     string  `dynamodbav:"approvedAt"`
  }

  // purchase.go
  type Purchase struct {
      ID            string `dynamodbav:"id"`
      OrderID       string `dynamodbav:"orderId"`       // always set — links back to Order
      PhotoID       string `dynamodbav:"photoId"`
      RunnerEmail   string `dynamodbav:"runnerEmail"`   // denormalized for download history lookup
      DownloadToken string `dynamodbav:"downloadToken"` // UUID v4, set at approval; empty before approval
      Status        string `dynamodbav:"status"`        // mirrors Order.status; set atomically at approval
      ClaimedAt     string `dynamodbav:"claimedAt"`
      ApprovedAt    string `dynamodbav:"approvedAt"`
  }
  ```
- `paymentRef` generation: `RS-` + 8 characters from `crypto/rand` (uppercase A-Z0-9); lives on Order, not Purchase
- Idempotency: before creating a new Order, query `photoId-runnerEmail-index` GSI on `racephotos-purchases` for each `photoId` in the request. If all `(photoId, runnerEmail)` pairs already have a `pending` or `approved` Purchase, return the associated Order via `OrderStore.GetOrderByID`. If the existing Purchase has `status="rejected"`, treat as a new order for that photo.
- New `racephotos-orders` table — add to `DatabaseConstruct` (amends RS-001):
  - PK: `id`
  - GSI `runnerEmail-claimedAt-index` (PK: `runnerEmail`, SK: `claimedAt`) — runner order history
  - GSI `photographerId-claimedAt-index` (PK: `photographerId`, SK: `claimedAt`) — photographer approval queue
  - GSI `paymentRef-index` (PK: `paymentRef`) — lookup by payment reference
  - Note: `photographerId-claimedAt-index` on `racephotos-purchases` (defined in RS-001) is superseded by the same GSI on `racephotos-orders`; the `DatabaseConstruct` should remove it from `racephotos-purchases` in this story
- Denormalization at order creation: load `Photo` → `Event` to resolve `photographerId`, `eventId`, `eventName`, `pricePerPhoto`, `currency`; store on Order. Load `Photographer` to resolve bank details for the API response and photographer email for the SES notification.
- Note: photographer email is fetched dynamically from the `Photographer` record via `PhotographerStore` — `RACEPHOTOS_PHOTOGRAPHER_EMAIL` (referenced in ADR-0001) is not used; this Lambda is multi-photographer by design.
- New env vars:
  ```
  RACEPHOTOS_ENV                  required
  RACEPHOTOS_ORDERS_TABLE         required — DynamoDB orders table name
  RACEPHOTOS_PURCHASES_TABLE      required — DynamoDB purchases table name
  RACEPHOTOS_PHOTOS_TABLE         required — DynamoDB photos table name
  RACEPHOTOS_EVENTS_TABLE         required — DynamoDB events table name
  RACEPHOTOS_PHOTOGRAPHERS_TABLE  required — DynamoDB photographers table name
  RACEPHOTOS_SES_FROM_ADDRESS     required — verified SES sender address
  RACEPHOTOS_APPROVALS_URL        required — base URL for photographer dashboard (injected by CDK)
  ```
- CDK: new `PaymentConstruct`; call `SesConstruct.grantSendEmail` for this Lambda; wire `ObservabilityConstruct`
- Angular:
  - Component path: `frontend/angular/src/app/events/event-search/purchase-stepper/`
    - `purchase-stepper.component.ts/html/scss/spec.ts/stories.ts` — the container; opened as a dialog or routed view from `photo-detail`
    - `email-step/email-step.component.*` — step 1: email input + masked preview
    - `bank-details-step/bank-details-step.component.*` — step 2: payment reference + bank instructions
    - `confirmation-step/confirmation-step.component.*` — step 3: submission confirmation
  - NgRx: `store/purchases/` slice (actions file already exists); add reducer, effects, selectors
  - Each step component has its own `*.stories.ts` and is independently Storybook-testable
  - The stepper sends `{ photoIds: [photoId], runnerEmail }` — no UI change needed when RS-011 expands to multiple photos
- `scripts/seed-local.sh`: add `aws dynamodb create-table` for `racephotos-orders` with all three GSIs (`runnerEmail-claimedAt-index`, `photographerId-claimedAt-index`, `paymentRef-index`), mirroring the `DatabaseConstruct` definition. Follow the existing table creation pattern in `seed-local.sh`.
- `.env.example`: add `RACEPHOTOS_ORDERS_TABLE`, `RACEPHOTOS_PURCHASES_TABLE`, `RACEPHOTOS_SES_FROM_ADDRESS`, `RACEPHOTOS_APPROVALS_URL`
- `PRODUCT_CONTEXT.md` updates required as part of this story:
  - Add `Order` to the data model section (see `models.Order` above)
  - Update domain rule 4: "An Order groups one or more photos from the same event under a single `paymentRef`; each photo becomes a Purchase line item linked by `orderId`"
  - Update the `Purchase` data model entry: remove `paymentRef`, add `orderId`
- ADR dependencies: ADR-0001 (SES notification design), ADR-0002 (email preview UX, claim confirmation), ADR-0003 (independent purchase per runner), ADR-0010 (Order entity as primary purchase grouping unit — covers why `paymentRef` lives on Order, the single-event constraint, and the RS-011 forward-compatibility design)

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
