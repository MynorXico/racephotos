# Story: Runner adds multiple photos to a cart and purchases them together

**ID**: RS-020
**Epic**: Payment / Frontend
**Status**: done
**Has UI**: yes

## Context

A runner browsing search results or an event's photo gallery often wants several
photos from the same race. RS-010 wired the purchase flow and the backend to
accept multiple `photoIds` in one order, but the UI only sends a single photo.
This story adds the selection and cart UX so a runner can pick several photos,
review the cart, and check out in one order — one bank transfer, one payment
reference. (Journey 3, multi-photo variant.)

## Acceptance criteria

- [ ] AC1: Given a runner is viewing a photo grid (search results or event gallery),
      then each photo card shows a checkbox. When checked the photo is added to the
      selection; unchecked it is removed. The checkbox reflects the current selection
      state on re-render.

- [ ] AC2: Given at least one photo is selected, then a "Purchase (N photos)" button
      is visible in the grid toolbar above the photo grid, showing the current count.
      When no photos are selected the button is hidden.

- [ ] AC3: Given the runner adds a photo from a **different event** than the photos
      already in the cart, then a confirmation dialog appears: "Your cart contains
      photos from another event. Starting a new cart will remove X photo(s). Continue?"
      If confirmed, the cart is replaced with the new photo. If cancelled, the photo
      is not added and the existing cart is preserved.

- [ ] AC4: Given the runner clicks "Purchase (N photos)", then the purchase stepper opens with
      a new first step — a cart review screen listing thumbnail, event name, and
      unit price for each selected photo, plus the calculated total. An "Edit cart"
      link returns to the grid.

- [ ] AC5: Given the runner proceeds past the cart review step, then the existing
      email-entry → bank-details → confirmation flow runs unchanged, with
      `{ photoIds: [...cartPhotoIds], runnerEmail }` sent to `POST /orders`.

- [ ] AC6: Given the `POST /orders` response returns HTTP 201, then the cart is
      cleared and the runner lands on the confirmation screen.

- [ ] AC7: Given the `POST /orders` response returns HTTP 200 (idempotent — all
      photos already have an active purchase), then the cart is cleared and the
      confirmation screen is shown with the existing order's bank details.

- [ ] AC8: Given the cart contains 20 photos (the backend maximum), then the
      checkbox is disabled on all remaining photos and a tooltip reads
      "Maximum 20 photos per order".

- [ ] AC9: Given a runner clicks "Purchase this photo" on a single photo detail
      view (the RS-010 single-photo entry point), then that photo is added to the
      cart and the cart review step is shown immediately — consistent with the new
      multi-photo checkout flow.

- [ ] AC10: Given the runner submits the checkout flow and `POST /orders` returns
      a 4xx or 5xx response, then an inline error banner is shown inside the
      purchase stepper ("Something went wrong — please try again"), the stepper
      remains open, and the cart is not cleared so the runner can retry without
      re-selecting photos.

## Out of scope

- Cart persistence across page refreshes or browser sessions (v1: session-scoped only)
- Cross-event orders (v1: backend enforces single-event per order)
- Quantity > 1 per photo
- Saved carts or wishlists

## Tech notes

- **No backend changes required.** `POST /orders` (RS-010) already accepts
  `photoIds` as an array and handles 1–20 photos. This story is frontend-only.

- **Lambda / service**: N/A — frontend-only story
- **Interface(s) to implement**: N/A
- **DynamoDB access pattern**: N/A
- **CDK construct to update**: N/A

- **Required changes to `store/purchases/` slice** (established in RS-010):
  - `purchases.actions.ts`: update `Initiate Purchase` from `{ photoId: string }` to
    `{ photoIds: string[] }` — this action opens the purchase stepper and is dispatched
    by both the "Purchase (N photos)" button in the grid toolbar and the photo-detail "Purchase this photo"
    button (AC9).
  - `purchases.actions.ts`: update `Submit Email` from `{ photoId: string; runnerEmail: string }`
    to `{ photoIds: string[]; runnerEmail: string }`
  - `purchases.effects.ts`: update `submitEmail$` effect to spread `photoIds` directly
    into the POST body instead of wrapping a single `photoId` as `[photoId]`
  - `purchases.reducer.ts` / `purchases.selectors.ts`: update any state that holds a
    single `photoId` to hold `photoIds: string[]`

- **New NgRx slice**: `store/cart/`
  - `cart.actions.ts`: `addToCart({ photo: PhotoSummary })`, `removeFromCart({ photoId: string })`,
    `clearCart()`, `replaceCart({ photo: PhotoSummary })`
  - `cart.reducer.ts`: state shape `{ photoIds: string[], eventId: string | null, photos: PhotoSummary[] }`
  - `cart.selectors.ts`: `selectCartPhotoIds`, `selectCartCount`, `selectCartEventId`,
    `selectCartPhotos`, `selectCartTotal`, `selectIsInCart(photoId)`, `selectCartFull` (count === 20)
  - No effects — cart mutations are synchronous. Register with `provideState(cartFeature)`
    in the events feature module (same module that hosts the photo grid and photo-detail).

- **Updated Angular components**:
  - `frontend/angular/src/app/events/event-search/photo-card/photo-card.component.*`
    — add a `MatCheckbox` bound to `selectIsInCart(photo.id)`; disabled when
    `selectCartFull` is true and the photo is not already selected; dispatch
    `addToCart`/`removeFromCart` on change
  - `frontend/angular/src/app/events/event-search/photo-grid/photo-grid.component.*`
    — add a toolbar row above the grid; render a "Purchase (N photos)" button
    using `selectCartCount`; button is hidden when count is 0; clicking it
    dispatches `PurchasesActions.initiatePurchase({ photoIds: cartPhotoIds })`
  - New `frontend/angular/src/app/events/event-search/purchase-stepper/cart-review-step/cart-review-step.component.*`
    — renders `selectCartPhotos` as a list with
    thumbnail, event name, unit price; shows `selectCartTotal`; "Edit cart" closes
    the stepper without clearing the cart
  - `frontend/angular/src/app/events/event-search/purchase-stepper/purchase-stepper.component.*`
    — insert cart-review-step as step 0 before the existing email-step; pass
    `cartPhotoIds` (from `selectCartPhotoIds`) as an input to `email-step` so it
    can dispatch `PurchasesActions.submitEmail({ photoIds: cartPhotoIds, runnerEmail })`.
    Subscribe to `PurchasesActions.submitEmailSuccess` in the stepper and dispatch
    `CartActions.clearCart()` there — keeps the purchases effect free of cart slice
    knowledge.
  - `frontend/angular/src/app/events/event-search/purchase-stepper/email-step/email-step.component.*`
    — add `@Input() photoIds: string[]`; update `submitEmail` dispatch from
    `{ photoId, runnerEmail }` to `{ photoIds, runnerEmail }`
  - `frontend/angular/src/app/events/event-search/photo-detail/photo-detail.component.*`
    — update "Purchase this photo" button to dispatch `addToCart({ photo })` then
    `PurchasesActions.initiatePurchase({ photoIds: [photo.id] })`; remove any
    direct stepper-open logic that bypasses the cart

- **Cross-event dialog**: use Angular Material `MatDialog` (already in the design
  system per ADR-0006). Declare a `<ng-template #crossEventConfirm>` inside
  `photo-card.component.html` and capture it with `@ViewChild('crossEventConfirm') crossEventConfirmRef!: TemplateRef<unknown>`.
  Open it with `this.dialog.open(this.crossEventConfirmRef, { width: '360px' })`.
  No separate dialog component file is needed.

- **`PhotoSummary`** model (frontend only, not a shared Go model):
  ```typescript
  interface PhotoSummary {
    id: string;
    eventId: string;
    eventName: string;
    watermarkedUrl: string;
    pricePerPhoto: number;
    currency: string;
  }
  ```
  Sourced from the existing photos NgRx slice (populated during search/browse).

- No new env vars, no CDK changes, no Lambda changes.

- ADR dependencies: ADR-0005 (NgRx), ADR-0006 (Angular Material), ADR-0010
  (Order entity — confirms this is frontend-only, backend already supports N photos)

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
