# UX Spec — RS-010: Runner purchases a photo

**Story**: RS-010
**Route**: Opened as a `MatDialog` over `/events/:id` (public, no auth guard)
**Persona**: Runner — casual user, mobile-first, unfamiliar with bank transfer flows
**Written**: 2026-04-12

---

## Overview

The purchase flow is a three-step dialog opened when a runner clicks "Purchase
this photo" inside `PhotoDetailComponent`. It is implemented as a `MatStepper`
wrapped in a `MatDialog`. The stepper is linear — the runner cannot jump ahead.

The dialog hosts four components in a parent-child relationship:

```
PurchaseStepperComponent          (dialog container, owns NgRx, drives the stepper)
  ├── EmailStepComponent          (step 1 — email input + masked preview)
  ├── BankDetailsStepComponent    (step 2 — bank transfer instructions)
  └── ConfirmationStepComponent   (step 3 — success confirmation)
```

The stepper replaces the `photo-detail` dialog; both are never visible
simultaneously. When `PurchasesActions.initiatePurchase` is dispatched by
`PhotoDetailComponent`, the parent `EventSearchComponent` is responsible for
closing the photo-detail dialog and opening the purchase stepper dialog.

---

## NgRx slice: `store/purchases/`

The stub actions file at `store/purchases/purchases.actions.ts` must be expanded
into a full slice before any component implementation begins.

### State shape

```typescript
interface PurchasesState {
  activePhotoId: string | null;       // set by initiatePurchase
  runnerEmail: string | null;         // captured in step 1, held for masking
  orderId: string | null;             // returned by POST /orders on success
  paymentRef: string | null;
  totalAmount: number | null;
  currency: string | null;
  bankDetails: BankDetails | null;
  loading: boolean;                   // true while POST /orders is in-flight
  error: string | null;               // human-readable API error or null
}

interface BankDetails {
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  bankInstructions: string;           // free-text from Photographer record; may be empty
}
```

### Actions (replace the existing stub entirely)

| Action | Payload | When dispatched |
|---|---|---|
| `Initiate Purchase` | `{ photoId: string }` | Runner clicks "Purchase this photo" in PhotoDetailComponent |
| `Submit Email` | `{ photoId: string; runnerEmail: string }` | Runner confirms email in step 1 |
| `Submit Email Success` | `{ orderId, paymentRef, totalAmount, currency, bankDetails }` | Effect receives 201/200 from POST /orders |
| `Submit Email Failure` | `{ error: string }` | Effect receives 4xx/5xx from POST /orders |
| `Confirm Transfer` | `emptyProps` | Runner clicks "I've made the transfer" in step 2 |
| `Reset Purchase` | `emptyProps` | Dialog is closed (any step) |

### Selectors

| Selector | Returns |
|---|---|
| `selectActivePhotoId` | `string \| null` |
| `selectRunnerEmail` | `string \| null` |
| `selectMaskedEmail` | `string \| null` — derived: `r***@domain.com` format |
| `selectOrderId` | `string \| null` |
| `selectPaymentRef` | `string \| null` |
| `selectTotalAmount` | `number \| null` |
| `selectCurrency` | `string \| null` |
| `selectBankDetails` | `BankDetails \| null` |
| `selectPurchaseLoading` | `boolean` |
| `selectPurchaseError` | `string \| null` |

### Email masking logic (selector, not component)

The `selectMaskedEmail` selector must derive the masked string from `runnerEmail`
in the store. Masking rule: keep the first character of the local part, replace
the rest of the local part with `***`, keep the `@` and full domain unchanged.
Examples: `runner@gmail.com` → `r***@gmail.com`; `ab@example.com` → `a***@example.com`.
This logic lives in the selector so all three components get a consistent value
without duplicating the transformation.

### Effect

One effect handles `submitEmail`. It calls `POST /orders` with
`{ photoIds: [photoId], runnerEmail }`. On success it dispatches
`submitEmailSuccess`; on failure it dispatches `submitEmailFailure` with the
API error message. The effect must handle HTTP 200 (idempotent — existing pending
order) and HTTP 201 (new order) identically from the UI perspective.

---

## `PurchaseStepperComponent` (`purchase-stepper/purchase-stepper.component.ts`)

### Purpose

Container dialog that owns the `MatStepper`, receives NgRx state, and coordinates
navigation between the three purchase steps.

### Layout

The component is the `MatDialog` panel body. It renders:

- A dialog title bar: "Purchase photo" as an `h2` (`mat-dialog-title`), with a
  close icon button (`mat-icon-button`) anchored to the top-right corner.
- A `MatStepper` with `linear="true"` and `orientation="horizontal"`. The stepper
  header shows three labelled steps: "Your email", "Bank transfer", "Done". The
  stepper header is always visible so the runner knows where they are in the flow.
- The step body area occupies the remaining vertical space inside the dialog.
- No `mat-dialog-actions` bar at the container level — each child step component
  owns its own action buttons via `matStepperNext` or explicit dispatch.
- The dialog has a fixed width on desktop and fills the viewport on mobile (see
  Responsive behaviour).

### States

- **Loading**: `PurchaseStepperComponent` does not show a spinner itself. The
  loading state is delegated to `EmailStepComponent` where the API call originates.
- **Empty**: N/A — the dialog is only opened when a photo is already selected.
- **Error**: N/A at the container level — errors surface inside `EmailStepComponent`.
- **Success / default**: Stepper advances automatically when `submitEmailSuccess`
  is dispatched by the effect. The component subscribes to `selectPurchaseError`
  and `selectPurchaseLoading`; on success it calls `stepper.next()` to move to
  step 2.

### Responsive behaviour

- **375px (mobile)**: Dialog fills 100 vw × 100 vh (`maxWidth: 100vw`,
  `height: 100%`). Stepper header shows step icons only (no labels) to save
  horizontal space — set `[labelPosition]="'bottom'"` and rely on icon-only
  display at this width via CSS. Close button remains at top-right.
- **1280px (desktop)**: Dialog is `560px` wide, height is `auto` with a max of
  `90vh`. Stepper header shows icon + label for all three steps side by side.

### Accessibility

- `mat-dialog-title` is the accessible name for the dialog (`aria-labelledby`
  wired by `MatDialogModule` automatically).
- Close button has `aria-label="Close purchase dialog"`.
- `MatStepper` with `linear="true"` prevents keyboard jumping to incomplete steps.
- When the dialog opens, focus must land on the first interactive element inside
  step 1 (the email input). `MatDialog` handles initial focus trap; no additional
  `cdkFocusInitial` is needed if the input is the first focusable element.
- When the stepper advances programmatically, focus must be moved to the first
  interactive element in the new step. Call `stepper.next()` and then
  `document.querySelector` on the new step's primary element, or use
  `MatStepper`'s `selectionChange` output to set focus after the animation.

### Angular Material components to use

- `MatDialogModule` — panel, title, content
- `MatStepperModule` (`MatStepper`, `MatStep`) — linear horizontal stepper
- `MatButtonModule` (`mat-icon-button`) — close button
- `MatIconModule` — close icon

### NgRx integration

- Subscribes to: `selectPurchaseLoading`, `selectPurchaseError`
- Dispatches:
  - `PurchasesActions.resetPurchase` when the close button is clicked or the
    dialog backdrop is clicked (wire to `MatDialogRef.backdropClick()` and the
    close button `(click)` handler)
- Advances the stepper by calling `stepper.next()` in response to
  `selectPurchaseLoading` transitioning from `true` to `false` with no error
  (use a derived signal or `distinctUntilChanged` pipe on the combined state).
- Does NOT dispatch `submitEmail` — that is delegated to `EmailStepComponent`.

---

## `EmailStepComponent` (`purchase-stepper/email-step/email-step.component.ts`)

### Purpose

Collects the runner's email address, shows a masked preview for confirmation,
and submits the purchase order via NgRx when the runner confirms.

### Layout

The step body is a single-column form. Top to bottom:

1. **Instruction text** (body-2 typography): "Enter your email to receive
   payment instructions and download links."
2. **Email field** (`MatFormField`, `appearance="outline"`):
   - Label: "Email address"
   - Type: `email`
   - Placeholder: `you@example.com`
   - Error states (see below)
3. **Masked preview block** — shown only after the runner has typed a valid
   email (the field is `valid` and `dirty`). Rendered as a `MatCard` with
   `appearance="outlined"`:
   - Icon: `mail_outline` (mat-icon, left-aligned)
   - Text: "We'll send updates to **r\*\*\*@domain.com** — is this correct?"
     The masked portion is rendered in `<strong>` for visual emphasis.
4. **Action row** — right-aligned, below the preview:
   - Primary button: "Confirm and continue" (`mat-flat-button color="primary"`)
     — disabled while the form is invalid or `selectPurchaseLoading` is `true`.
5. **Inline error banner** (`MatCard appearance="outlined"` with error colour
   token) — shown only when `selectPurchaseError` is non-null. Contains the
   API error message and a "Try again" link that clears the error and re-enables
   the form. This error replaces (not supplements) the masked preview block.

The form uses `ReactiveFormsModule` with a single `FormControl` named `email`
and the built-in Angular `Validators.email` + `Validators.required`.

### States

- **Loading**: The "Confirm and continue" button is replaced by a
  `MatProgressSpinner` (`diameter="20"`, `mode="indeterminate"`) inline inside
  the button, and the button text becomes "Submitting…". The email field is
  `[disabled]="true"`. The masked preview block remains visible during loading.
- **Empty / initial**: Form shows the email field with no preview. The "Confirm
  and continue" button is disabled.
- **Preview shown**: Email field is valid and dirty. Masked preview block appears.
  "Confirm and continue" button is enabled.
- **Error**: API call failed. The error banner appears below the preview block.
  The email field and button are re-enabled so the runner can correct their email
  or retry.
- **Success**: Parent (`PurchaseStepperComponent`) advances the stepper; this
  step is no longer visible.

### Responsive behaviour

- **375px (mobile)**: Full-width form field and button (no side margins other
  than the dialog's own padding of `16px`). Masked preview card stacks below
  the field. "Confirm and continue" button is full-width.
- **1280px (desktop)**: Form field is full-width within the dialog (the dialog
  itself is constrained to `560px`). "Confirm and continue" button is
  right-aligned, `auto` width.

### Accessibility

- `MatFormField` label is the visible label — no separate `aria-label` needed.
- Email input `type="email"` — mobile keyboards show `@` key automatically.
- Validation error messages rendered inside `<mat-error>` are automatically
  linked to the input via Angular Material's internal `aria-describedby`
  assignment.
- The masked preview card is `role="status"` so screen readers announce it when
  it appears without stealing focus.
- The error banner is `role="alert"` so screen readers announce the API error
  immediately when it appears.
- The "Try again" link inside the error banner has `aria-label="Clear error and
  try again"`.
- "Confirm and continue" button has `[attr.aria-busy]="loading"` while the
  spinner is shown.

### Validation error messages

| Condition | `<mat-error>` text |
|---|---|
| `required` and touched | "Email address is required." |
| `email` pattern invalid | "Enter a valid email address." |

### Angular Material components to use

- `MatFormFieldModule` + `MatInputModule` — email field
- `MatButtonModule` (`mat-flat-button`) — primary action
- `MatProgressSpinnerModule` — inline loading spinner inside the button
- `MatCardModule` (`mat-card`, `appearance="outlined"`) — masked preview block
  and error banner
- `MatIconModule` — `mail_outline` icon in preview, `error_outline` in error
  banner

### NgRx integration

- Subscribes to: `selectMaskedEmail`, `selectPurchaseLoading`,
  `selectPurchaseError`
- Dispatches:
  - `PurchasesActions.submitEmail({ photoId, runnerEmail })` when the runner
    clicks "Confirm and continue" and the form is valid. `photoId` is read from
    `selectActivePhotoId`.
- Does not dispatch `resetPurchase` — that is the container's responsibility.

---

## `BankDetailsStepComponent` (`purchase-stepper/bank-details-step/bank-details-step.component.ts`)

### Purpose

Displays the photographer's bank transfer details and payment reference so the
runner can open their banking app, make the transfer, and return to confirm.

### Layout

The step body is a read-only information display — no form fields. Top to bottom:

1. **Instruction text** (body-1 typography): "Transfer the amount below to the
   bank account shown. Use the payment reference exactly as shown so the
   photographer can identify your payment."
2. **Amount block** — large, prominent display:
   - Currency + amount in headline-4 typography: e.g. "GTQ 75.00"
3. **Payment reference block** (`MatCard appearance="outlined"`):
   - Section label (caption typography, muted): "Payment reference"
   - Reference value in monospace (body-1, `font-family: monospace`): e.g.
     "RS-AB12CD34"
   - Copy button (`mat-icon-button`, `aria-label="Copy payment reference"`) with
     `content_copy` icon, right-aligned within the card row. On click, writes
     the reference to the clipboard via the `Clipboard` CDK service and shows a
     brief `MatSnackBar` message: "Reference copied".
4. **Bank details block** (`MatCard appearance="outlined"`, below the reference
   block):
   - Section label: "Bank account"
   - `bankName` — body-2, bold
   - `bankAccountHolder` — body-2
   - `bankAccountNumber` — body-2, monospace
   - Copy button for `bankAccountNumber` only (`aria-label="Copy account number"`)
     — same clipboard behaviour as the reference copy button.
   - `bankInstructions` — shown only when non-empty; rendered as a `MatCard`
     with a `info_outline` icon and the instruction text in body-2. Label:
     "Additional instructions".
5. **Action row** — right-aligned:
   - Primary button: "I've made the transfer" (`mat-flat-button color="primary"`)

### States

- **Loading**: N/A — this step is only reached after a successful API response.
  All data is in the store before this step becomes active.
- **Empty**: N/A — same as loading rationale.
- **Error**: N/A — no API calls are made in this step.
- **Success / default**: Populated state is the only state. All fields are
  populated from the store.

### Responsive behaviour

- **375px (mobile)**: Amount block, reference card, and bank details card stack
  vertically with `8px` gap. Copy buttons are touch targets of at minimum
  `48px × 48px`. "I've made the transfer" button is full-width.
- **1280px (desktop)**: Cards fill the dialog content width (`528px` — dialog
  `560px` minus `32px` horizontal padding). "I've made the transfer" button is
  right-aligned, `auto` width.

### Accessibility

- The payment reference value and account number are inside `<span>` elements
  with `aria-label` that prefixes the value with its label, e.g.
  `aria-label="Payment reference: RS-AB12CD34"`, so screen readers announce the
  full context when the element is focused.
- Copy buttons have distinct `aria-label` values per field: "Copy payment
  reference" and "Copy account number".
- `MatSnackBar` confirmation messages are announced by screen readers
  automatically via the snack bar's `role="status"` attribute.
- The `bankInstructions` card is `role="note"` to indicate supplementary
  information.

### Angular Material components to use

- `MatCardModule` (`mat-card`, `appearance="outlined"`) — payment reference
  block, bank details block, bank instructions block
- `MatButtonModule` (`mat-icon-button`, `mat-flat-button`) — copy buttons and
  primary action
- `MatIconModule` — `content_copy`, `info_outline`
- `MatSnackBarModule` — clipboard confirmation message
- `ClipboardModule` (from `@angular/cdk/clipboard`) — programmatic copy

### NgRx integration

- Subscribes to: `selectPaymentRef`, `selectTotalAmount`, `selectCurrency`,
  `selectBankDetails`
- Dispatches:
  - `PurchasesActions.confirmTransfer()` when the runner clicks "I've made the
    transfer". This action signals the parent to advance the stepper to step 3.
- Does not call any API endpoint.

---

## `ConfirmationStepComponent` (`purchase-stepper/confirmation-step/confirmation-step.component.ts`)

### Purpose

Gives the runner a clear, reassuring end-state that their payment claim has been
submitted and explains what happens next.

### Layout

The step body is centred, text-only. Top to bottom:

1. **Success icon** — `check_circle_outline` (mat-icon, `96px`, using the theme
   success/primary colour token). Centred horizontally.
2. **Headline** (headline-6 typography, centred): "Payment claim submitted"
3. **Body text** (body-1, centred):
   "Your payment claim has been submitted. The photographer will review it and
   you'll receive an email once approved."
4. **Email reminder** (body-2, muted, centred):
   "A confirmation has been sent to **r\*\*\*@domain.com**."
   — uses `selectMaskedEmail` from the store.
5. **Action row** — centred:
   - Primary button: "Done" (`mat-flat-button color="primary"`) — closes the
     dialog and dispatches `resetPurchase`.

There is intentionally no "Back" button — the purchase has already been
submitted; going back could confuse the runner into thinking they can cancel it.

### States

- **Loading**: N/A — this step is only reached after the API call has succeeded
  and the runner has clicked "I've made the transfer".
- **Empty**: N/A
- **Error**: N/A
- **Success / default**: Only state. Static display with stored masked email.

### Responsive behaviour

- **375px (mobile)**: All content is centred, stacked vertically. The "Done"
  button is full-width.
- **1280px (desktop)**: Content is centred within the dialog. "Done" button is
  centred, `auto` width with a minimum of `120px`.

### Accessibility

- The success icon is decorative (`aria-hidden="true"`).
- The headline is the primary content — it should receive focus when this step
  becomes active. Apply `cdkFocusInitial` or call `.focus()` on the headline
  element in `ngAfterViewInit` after the stepper animation completes.
- No interactive elements other than "Done" — focus path is trivial.
- "Done" button has no additional `aria-label` needed (button text is descriptive
  in context).

### Angular Material components to use

- `MatButtonModule` (`mat-flat-button`) — "Done" button
- `MatIconModule` — `check_circle_outline`

### NgRx integration

- Subscribes to: `selectMaskedEmail`
- Dispatches:
  - `PurchasesActions.resetPurchase()` when the runner clicks "Done"

---

## `PhotoDetailComponent` changes (`photo-detail/photo-detail.component.ts`)

The existing `onPurchase()` method already dispatches
`PurchasesActions.initiatePurchase({ photoId })`. No change is needed inside
`PhotoDetailComponent` itself.

The **parent** `EventSearchComponent` must be updated to listen for
`PurchasesActions.initiatePurchase` and respond by:

1. Closing the photo-detail `MatDialogRef`.
2. Opening `PurchaseStepperComponent` in a new `MatDialog` call, passing
   `{ data: { photoId } }` as `MatDialogConfig.data`.
3. Subscribing to the stepper dialog's `afterClosed()` to dispatch
   `PurchasesActions.resetPurchase()` if it was not already dispatched by the
   "Done" button (guard with a store check on `selectActivePhotoId`).

This coordination is best implemented in `EventSearchComponent` as an effect
over the `Actions` stream (using `ofType(PurchasesActions.initiatePurchase)`)
rather than wiring dialog logic inside `PhotoDetailComponent`, to keep dialog
lifecycle management in one place.

---

## Dialog configuration reference

```typescript
// Open the purchase stepper from EventSearchComponent
this.dialog.open(PurchaseStepperComponent, {
  data: { photoId },
  width: '560px',         // desktop; overridden by panelClass on mobile
  maxWidth: '100vw',
  height: 'auto',
  maxHeight: '90vh',
  panelClass: 'purchase-stepper-dialog',
  disableClose: true,     // runner must use the close button; prevents accidental dismissal
});
```

The `purchase-stepper-dialog` panel class is defined in `styles.scss` (global)
and adds `width: 100%; height: 100%;` at the `375px` breakpoint to make the
dialog full-screen on mobile. Component-level SCSS cannot pierce the CDK overlay
panel without `::ng-deep`, so this rule belongs in the global stylesheet.

---

## Copy-to-clipboard interaction detail

Both the payment reference and the bank account number have a copy button. The
interaction:

1. Runner clicks the copy icon button.
2. `ClipboardModule.copy(value)` writes the plain string to the clipboard.
3. `MatSnackBar.open('Copied', undefined, { duration: 2000 })` is called.
4. The icon button briefly shows a `check` icon for `1500ms` before reverting to
   `content_copy`. This is a local component signal (`copiedRef = signal(false)`
   and `copiedAccountNumber = signal(false)`) — no NgRx action needed for a
   transient UI effect.

---

## Stepper navigation rules

| From step | Event | Outcome |
|---|---|---|
| Step 1 (email) | Form invalid | Button disabled; no advance |
| Step 1 (email) | Form valid, user clicks "Confirm" | `submitEmail` dispatched; button shows spinner |
| Step 1 (email) | `submitEmailSuccess` arrives | Stepper advances to step 2 programmatically |
| Step 1 (email) | `submitEmailFailure` arrives | Error banner shown; spinner removed; no advance |
| Step 2 (bank) | User clicks "I've made the transfer" | `confirmTransfer` dispatched; stepper advances to step 3 |
| Step 3 (done) | User clicks "Done" | `resetPurchase` dispatched; dialog closed |
| Any step | User clicks close button or backdrop | `resetPurchase` dispatched; dialog closed |

Backward navigation (MatStepper's default back button) must be hidden for all
steps. Set `[completed]="false"` and `[editable]="false"` on all `MatStep`
instances to prevent the runner from navigating back and re-submitting.

---

## Storybook stories required

Each step component must have a standalone `*.stories.ts` file covering:

| Component | Stories |
|---|---|
| `EmailStepComponent` | `Default` (empty form), `WithPreview` (valid email entered), `Loading` (spinner in button), `ApiError` (error banner shown) |
| `BankDetailsStepComponent` | `Default` (all fields populated), `NoInstructions` (`bankInstructions` empty — instructions card hidden) |
| `ConfirmationStepComponent` | `Default` |
| `PurchaseStepperComponent` | `Step1`, `Step2`, `Step3` (stepper forced to each step via story args) |

Stories must not depend on a real NgRx store — use `provideMockStore` with the
relevant selectors preset to match each story's state.
