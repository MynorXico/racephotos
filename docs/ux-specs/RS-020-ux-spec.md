# UX Spec — RS-020: Runner adds multiple photos to a cart and purchases them together

**Story**: RS-020
**Route**: Runner-facing event search / photo grid (public, no auth guard)
**Persona**: Runner — casual user, mobile-first, unfamiliar with bank transfer flows
**Written**: 2026-04-15

---

## Overview

This story extends the existing runner-facing photo grid and purchase stepper
(RS-010) to support multi-photo selection. Seven surfaces are specified:

```
RunnerPhotoGridComponent          (extended — adds toolbar row with purchase button)
  └── RunnerPhotoCardComponent    (extended — adds checkbox overlay)

CrossEventConfirmDialogTemplate   (inline ng-template in photo-card — no new file)

PurchaseStepperComponent          (extended — inserts CartReviewStepComponent as step 0)
  ├── CartReviewStepComponent     (new — step 0, cart list + total + edit-cart link)
  ├── EmailStepComponent          (extended — receives photoIds[] input)
  ├── BankDetailsStepComponent    (unchanged)
  └── ConfirmationStepComponent   (unchanged)

PhotoDetailComponent              (extended — purchase button routes through cart)
```

---

## NgRx slice: `store/cart/`

This slice must be built before any component implementation begins.

### State shape

```typescript
interface CartState {
  photoIds: string[];
  eventId: string | null;
  photos: PhotoSummary[];
}

interface PhotoSummary {
  id: string;
  eventId: string;
  eventName: string;
  watermarkedUrl: string;
  pricePerPhoto: number;
  currency: string;
}
```

### Actions

| Action | Payload | When dispatched |
|---|---|---|
| `addToCart` | `{ photo: PhotoSummary }` | Runner checks a photo checkbox (and the photo is from the same event as the current cart, or the cart is empty) |
| `removeFromCart` | `{ photoId: string }` | Runner unchecks a photo checkbox |
| `clearCart` | `emptyProps` | Dispatched by `PurchaseStepperComponent` on `submitEmailSuccess` |
| `replaceCart` | `{ photo: PhotoSummary }` | Runner confirms the cross-event dialog ("Continue") |

### Selectors

| Selector | Returns |
|---|---|
| `selectCartPhotoIds` | `string[]` |
| `selectCartCount` | `number` |
| `selectCartEventId` | `string \| null` |
| `selectCartPhotos` | `PhotoSummary[]` |
| `selectCartTotal` | `number` — sum of `pricePerPhoto` across all cart photos |
| `selectCartCurrency` | `string \| null` — currency of the first photo in the cart, or null |
| `selectIsInCart(photoId: string)` | `boolean` — parameterised selector |
| `selectCartFull` | `boolean` — `count === 20` |

No effects — all cart mutations are synchronous.

---

## `RunnerPhotoCardComponent` (`events/event-search/photo-card/photo-card.component.ts`)

### Purpose

Displays a single watermarked race photo and lets the runner select it for
purchase via a checkbox overlay.

### Layout

The card is a `MatCard` with `appearance="outlined"`. Its structure:

- **Primary content area**: the watermarked photo image fills the card face. The
  image is `aspect-ratio: 4/3`, `object-fit: cover`, `width: 100%`.
- **Checkbox overlay**: a `MatCheckbox` is positioned absolute at the top-left
  corner of the card image area, with `8px` inset on both axes. The checkbox
  control itself sits on a semi-transparent circular background (`24px` radius,
  `rgba(0,0,0,0.45)`) so it is readable against any photo. The `MatCheckbox`
  label text is visually hidden (screen-reader only) — the accessible name is
  provided via `aria-label` (see Accessibility section).
- **Card footer** (inside `mat-card-footer`): a single line showing the photo's
  event name in caption typography, muted colour. This is `16px` tall and
  visible at all times — it is not hidden by the checkbox overlay.
- The card itself remains clickable to open the `PhotoDetailComponent` dialog
  (existing behaviour). Clicking the checkbox must not propagate to the card
  click handler — use `(click)="$event.stopPropagation()"` on the checkbox host.

#### Disabled state (cart full, photo not in cart)

When `selectCartFull` is true and the photo is not already in the cart, the
`MatCheckbox` has `[disabled]="true"`. A `MatTooltip` is applied to the checkbox
host element with `matTooltip="Maximum 20 photos per order"`. The tooltip is
also surfaced as an `aria-describedby` description (see Accessibility).

#### Cross-event dialog

Declared as `<ng-template #crossEventConfirm>` inside `photo-card.component.html`.
Captured with `@ViewChild('crossEventConfirm') crossEventConfirmRef!: TemplateRef<unknown>`.
Opened via `this.dialog.open(this.crossEventConfirmRef, { width: '360px', maxWidth: '95vw' })`
when a runner checks a photo whose `eventId` differs from `selectCartEventId` and
the cart is non-empty.

### States

- **Loading**: N/A — photo data is loaded by the parent grid; the card renders
  immediately once the `photo` input is set.
- **Empty** (image load failure): When `imageError` signal is true, the image
  element is replaced by a placeholder area of equal dimensions containing a
  centred `MatIcon` (`broken_image`, `48px`) and the text "Image unavailable"
  in caption typography. The checkbox and card footer remain visible.
- **Unselected / default**: Checkbox unchecked. Card has standard outlined border.
- **Selected**: Checkbox checked. The card border changes to use the theme primary
  colour token (`--mat-sys-primary`). A thin `2px` primary-colour border replaces
  the default outlined border. This communicates selection without relying on
  colour alone — the checked checkbox state is the primary indicator.
- **Max-reached / disabled**: Checkbox is greyed out and non-interactive. Tooltip
  is shown on hover (desktop) and on long-press (mobile via `matTooltipTouchGestures="on"`).
- **In-cart**: Checkbox checked. Selected border as described above.

### Responsive behaviour

- **375px (mobile)**: Cards are full-width within a single-column grid. Touch
  target for the checkbox overlay is `48px × 48px` minimum — achieved by setting
  `min-width: 48px; min-height: 48px` on the checkbox host wrapper. Tooltip is
  shown on tap-and-hold (`matTooltipTouchGestures="on"`).
- **1280px (desktop)**: Cards are sized by the grid's column template (see
  `RunnerPhotoGridComponent`). Checkbox overlay appears on hover or when already
  checked. On hover, show the checkbox even when unchecked — use a CSS
  `:hover` rule on the card to set `opacity: 1` on the checkbox wrapper (which
  is `opacity: 0` in the default resting state when unchecked). This avoids
  visual clutter while making selection discoverable.

  UX decision (not in ACs): the checkbox is always fully visible on mobile
  (opacity: 1 regardless of hover) because hover state does not exist on
  touch devices. On desktop the opacity-on-hover approach is used only for
  unchecked cards — checked cards always show their checkbox at full opacity.

### Accessibility

- The `MatCheckbox` `aria-label` must include the photo context:
  `"Select photo from {{ photo.eventName }}"`. When the cart is full and the
  checkbox is disabled, the `aria-label` becomes
  `"Select photo from {{ photo.eventName }} — maximum 20 photos per order"`.
- The disabled tooltip is also linked via `[attr.aria-describedby]` on the
  checkbox host to the id of a visually hidden `<span>` containing the tooltip
  text, ensuring screen readers receive the max-limit message without waiting for
  a tooltip to appear.
- The card host element retains `role="listitem"`, `tabindex="0"`, and keyboard
  handlers for `Enter`/`Space` to open the photo detail — this existing behaviour
  is unchanged. The checkbox is a separate focusable element inside the card; its
  tab stop is ordered before the card host via DOM order (checkbox is rendered
  first in the template, before the image). Focus order: checkbox → card image
  area.
- Selected state is communicated to screen readers via the checkbox's native
  `checked` state — do not rely on the border colour change alone.
- `MatCheckbox` change events must call `$event.stopPropagation()` to prevent
  the card's `(click)` handler from also firing.

### Angular Material components to use

- `MatCardModule` (`mat-card`, `appearance="outlined"`, `mat-card-footer`) —
  card shell and footer
- `MatCheckboxModule` — selection control
- `MatIconModule` — `broken_image` fallback icon
- `MatTooltipModule` — max-limit tooltip on disabled checkbox
- `MatDialogModule` — used to open the cross-event confirm template

### NgRx integration

- Subscribes to:
  - `selectIsInCart(photo.id)` — drives `[checked]` binding on the checkbox
  - `selectCartFull` — drives `[disabled]` binding (when photo is not already in cart)
  - `selectCartEventId` — used in the checkbox change handler to detect
    cross-event selection
- Dispatches:
  - `CartActions.addToCart({ photo })` when the checkbox transitions to checked
    and `eventId` matches the current cart event (or the cart is empty)
  - `CartActions.removeFromCart({ photoId: photo.id })` when the checkbox
    transitions to unchecked
  - `CartActions.replaceCart({ photo })` when the runner confirms the cross-event
    dialog
  - No dispatch when the cross-event dialog is cancelled — existing cart is
    preserved and the checkbox is programmatically reset to unchecked

---

## Cross-event confirmation dialog (inline `ng-template` in `photo-card.component.html`)

### Purpose

Warns the runner that selecting a photo from a different event will replace their
current cart, and requires explicit confirmation before doing so.

### Layout

The template is opened as a `MatDialog` at `width: '360px'`, `maxWidth: '95vw'`.
Content (rendered via the `ng-template`):

- **Dialog title** (`mat-dialog-title`): "Start a new cart?"
- **Dialog content** (`mat-dialog-content`):
  - Body text: "Your cart contains photos from another event. Starting a new cart
    will remove **{{ cartCount }} photo(s)**. Continue?"
  - `{{ cartCount }}` is provided to the template via the dialog data or a local
    variable in the component.
- **Dialog actions** (`mat-dialog-actions`, `align="end"`):
  - Secondary button: "Cancel" (`mat-stroked-button`) — closes the dialog without
    changing cart state.
  - Primary button: "Continue" (`mat-flat-button`, `color="primary"`) — dispatches
    `CartActions.replaceCart({ photo })` and closes the dialog.

The dialog does not have a close icon button — the two explicit actions ("Cancel"
and "Continue") are the only exit paths. `disableClose: true` is set on the dialog
config so clicking the backdrop does not dismiss it accidentally. This is a
destructive confirmation; the runner must make an explicit choice.

### States

- **Default**: The only state — always shown with the current `cartCount` value.
- **Loading / Error / Empty**: N/A — this is a synchronous, data-free confirmation.

### Responsive behaviour

- **375px (mobile)**: `maxWidth: '95vw'` causes the dialog to occupy nearly the
  full screen width. Action buttons are full-width and stacked vertically
  ("Cancel" above "Continue") using `flex-direction: column-reverse` on
  `mat-dialog-actions`. "Continue" appears on top (visually primary position
  in a stacked layout) because it is the primary action.
- **1280px (desktop)**: Dialog is `360px` wide. Buttons are side by side,
  right-aligned, "Cancel" left of "Continue".

  UX decision (not in ACs): column-reverse stacking on mobile is used rather than
  side-by-side to keep both buttons at a comfortable touch target width. The
  "Continue" button is placed visually above "Cancel" on mobile, which is the
  conventional position for the primary action in a stacked destructive dialog.

### Accessibility

- `mat-dialog-title` provides the accessible name for the dialog role.
- "Cancel" button has no additional `aria-label` — the text is self-descriptive.
- "Continue" button has no additional `aria-label` — context is provided by the
  dialog title and body text.
- Focus is placed on "Cancel" when the dialog opens, not "Continue" — this
  prevents accidental destructive action via Enter key. Set `cdkFocusInitial` on
  the Cancel button.
- The `cartCount` placeholder in the body text is numeric — screen readers will
  read it correctly as a number.

### Angular Material components to use

- `MatDialogModule` (`mat-dialog-title`, `mat-dialog-content`, `mat-dialog-actions`)
- `MatButtonModule` (`mat-stroked-button`, `mat-flat-button`)

### NgRx integration

- Does not subscribe to store selectors directly — `cartCount` is passed into
  the template context by the photo-card component at the time the dialog is
  opened.
- Dispatches (via the photo-card component's dialog close handler):
  - `CartActions.replaceCart({ photo })` on "Continue"
  - No action on "Cancel"

---

## `RunnerPhotoGridComponent` (`events/event-search/photo-grid/photo-grid.component.ts`)

### Purpose

Displays the photo results grid and a contextual toolbar that appears when the
runner has selected at least one photo for purchase.

### Layout

Two vertical regions:

1. **Toolbar row** — rendered above the photo grid. Hidden when `cartCount === 0`
   (via `@if (cartCount() > 0)`). When visible:
   - Left side: selection summary text — "**N photo(s)** selected" — using
     body-2 typography. The count is rendered in `<strong>`.
   - Right side: "Purchase (N photos)" button (`mat-flat-button`,
     `color="primary"`). The label updates reactively as `cartCount` changes.
   - The toolbar row has a `16px` bottom margin separating it from the photo grid.
   - Background: theme surface-variant token (`--mat-sys-surface-variant`) with
     `8px` vertical padding and `16px` horizontal padding, to visually distinguish
     it from the grid without adding a heavy card shadow.

2. **Photo grid** — existing responsive CSS grid of `RunnerPhotoCardComponent`
   instances. No changes to the grid layout itself.

### States

- **Loading**: N/A — the toolbar renders only from cart state, which is
  synchronous. The grid's loading state is owned by the parent
  `EventSearchComponent` (unchanged from RS-010).
- **Empty (zero photos selected)**: Toolbar row is hidden via `@if`. Grid
  renders normally.
- **Populated (1–19 photos selected)**: Toolbar row is visible. "Purchase (N
  photos)" button is enabled and shows the current count.
- **Max-reached (20 photos selected)**: Toolbar row remains visible. "Purchase
  (20 photos)" button remains enabled — the runner should still be able to
  proceed to checkout. No additional max-reached indicator is needed in the
  toolbar itself; the disabled checkboxes on remaining cards are the signal.
- **Error**: N/A at the grid level — cart errors do not exist (cart is
  synchronous).

### Responsive behaviour

- **375px (mobile)**: Toolbar row stacks the summary text and the purchase button
  vertically. The purchase button is full-width. Summary text is centred.
- **1280px (desktop)**: Toolbar row is a single horizontal row with the summary
  text on the left and the purchase button on the right, using `display: flex;
  justify-content: space-between; align-items: center`.

### Accessibility

- The toolbar row has `role="toolbar"` and `aria-label="Photo selection toolbar"`.
- The "Purchase (N photos)" button's accessible name updates reactively with the
  count — no additional `aria-live` region is needed because the button text
  itself changes and screen readers will read the new label when the button is
  focused.
- The selection summary text ("N photo(s) selected") is wrapped in an
  `aria-live="polite"` region so screen readers announce count changes as the
  runner selects and deselects photos, without stealing focus.

### Angular Material components to use

- `MatButtonModule` (`mat-flat-button`) — "Purchase (N photos)" button
- No additional Material components needed for the toolbar row itself — the
  toolbar is a styled `div` with `role="toolbar"`, not a `MatToolbar`, because
  `MatToolbar` adds header semantics unsuitable for an inline action bar within
  page content.

  UX decision (not in ACs): a plain `div[role="toolbar"]` is used instead of
  `MatToolbar` to avoid implying this is a primary navigation toolbar. `MatToolbar`
  carries `role="toolbar"` natively but is semantically associated with app-level
  navigation in Material's design language, which would be misleading here.

### NgRx integration

- Subscribes to:
  - `selectCartCount` — drives toolbar visibility and button label
- Dispatches:
  - `PurchasesActions.initiatePurchase({ photoIds: cartPhotoIds })` when the
    runner clicks "Purchase (N photos)". `cartPhotoIds` is read from
    `selectCartPhotoIds` at dispatch time.

---

## `CartReviewStepComponent` (`events/event-search/purchase-stepper/cart-review-step/cart-review-step.component.ts`)

### Purpose

Presents the runner with a summary of their selected photos — thumbnails, event
name, per-photo price, and cart total — before they commit to the purchase flow.

### Layout

The step body is a read-only review panel. Top to bottom:

1. **Step heading** (title-2 typography): "Review your cart" — visually present
   to orient the runner at the top of the step content, below the `MatStepper`
   header.

2. **Photo list** — rendered as a `<ul>` with `list-style: none`. Each list item
   (`<li>`) contains:
   - **Thumbnail** — `48px × 48px` `<img>` from `photo.watermarkedUrl`, with
     `object-fit: cover`, rounded corners (`border-radius: 4px`). `alt` attribute:
     `"Photo from {{ photo.eventName }}"`.
   - **Text column** (to the right of the thumbnail, flex `1`):
     - Top line: `photo.eventName` — body-2, medium weight.
     - Bottom line: formatted price — body-2, muted — e.g. `GTQ 75.00`.
   - Each list item has `display: flex; align-items: center; gap: 12px` and a
     `1px` bottom divider (use `MatDivider` between items, not on the last item).

3. **Total row** — rendered below the photo list, separated by a `MatDivider`.
   - Label: "Total" — body-1, left-aligned.
   - Value: formatted total — body-1, bold, right-aligned — e.g. `GTQ 225.00`.
   - The total row uses `display: flex; justify-content: space-between`.
   - Currency and amount are formatted using Angular's `CurrencyPipe` with the
     ISO 4217 code from `selectCartCurrency`.

4. **"Edit cart" link** — below the total row, left-aligned. Rendered as a
   `mat-button` (text button variant) with an `arrow_back` icon prefix.
   Label: "Edit cart". Clicking this closes the `MatDialog` without dispatching
   `CartActions.clearCart()` — the cart is intentionally preserved so the runner
   returns to the grid with their selections intact.

5. **"Continue to checkout" button** — right-aligned, on the same row as the
   edit cart link (or on the next row on mobile — see Responsive behaviour).
   `mat-flat-button`, `color="primary"`. Clicking this advances the stepper to
   step 1 (email entry).

The action row containing "Edit cart" and "Continue to checkout" uses
`display: flex; justify-content: space-between; align-items: center`.

### States

- **Loading**: N/A — the step opens only when `PurchasesActions.initiatePurchase`
  has been dispatched, at which point `selectCartPhotos` is already populated.
- **Empty**: Should never be reached in practice (the "Purchase (N photos)" button
  is only visible when `cartCount > 0`). If it occurs defensively, display the
  message "No photos selected." with an "Edit cart" link below it. No CTA to
  proceed — the "Continue to checkout" button is hidden when the list is empty.
- **Populated / default**: The normal state with 1–20 photos listed.
- **Error**: N/A — no API calls are made in this step.

### Responsive behaviour

- **375px (mobile)**: The photo list items maintain the thumbnail-plus-text-column
  layout. The total row and action row stack vertically:
  - Total row: full-width, with "Total" and the formatted amount on the same line.
  - Action row: "Continue to checkout" is full-width. "Edit cart" link sits
    below it, centred.
  - Maximum list height is `50vh` with `overflow-y: auto` to prevent the step
    content from overflowing the dialog on small screens.
- **1280px (desktop)**: Photo list, total row, and action row are at full dialog
  content width. The list has no maximum height cap — it scrolls within the
  dialog's `90vh` max-height if there are many photos.

### Accessibility

- The photo list is a `<ul>` with `aria-label="Selected photos"`. Each `<li>`
  is self-describing via its text content.
- Thumbnail `<img>` elements have descriptive `alt` text — not empty — because
  they convey which photo is in the cart.
- The total row value has `aria-label="Total: GTQ 225.00"` (including the
  currency prefix) so screen readers do not read only the numeric value.
- "Edit cart" button has `aria-label="Edit cart — return to photo selection"` to
  clarify that clicking it returns to the grid without losing selections.
- "Continue to checkout" button text is self-descriptive; no additional
  `aria-label` needed.
- When this step becomes active (step 0 of the stepper), focus must move to the
  step heading. Apply `cdkFocusInitial` to the "Review your cart" heading element,
  or call `.focus()` on it in `ngAfterViewInit`.

### Angular Material components to use

- `MatDividerModule` — separators between list items and above the total row
- `MatButtonModule` (`mat-button` for "Edit cart", `mat-flat-button` for
  "Continue to checkout")
- `MatIconModule` — `arrow_back` icon in the "Edit cart" button
- `CurrencyPipe` (Angular built-in) — format `pricePerPhoto` and `cartTotal`

### NgRx integration

- Subscribes to:
  - `selectCartPhotos` — drives the photo list
  - `selectCartTotal` — drives the total row
  - `selectCartCurrency` — used to format prices
- Dispatches: none directly. "Edit cart" closes the dialog via `MatDialogRef`
  injected into the parent `PurchaseStepperComponent` and passed down as an
  `@Output() editCart = new EventEmitter<void>()`. The parent handles
  `dialogRef.close()` without dispatching `clearCart()`.
- Does not clear the cart — cart clearing is the parent stepper's responsibility
  on `submitEmailSuccess`.

---

## `PurchaseStepperComponent` (`events/event-search/purchase-stepper/purchase-stepper.component.ts`)

### Purpose

Container dialog that owns the `MatStepper`, inserts `CartReviewStepComponent`
as step 0, coordinates navigation between all four purchase steps, and clears the
cart on successful order submission.

### Layout changes from RS-010

The stepper header now shows four steps:
- Step 0: "Cart" (icon: `shopping_cart`)
- Step 1: "Your email" (icon: `email`)
- Step 2: "Bank transfer" (icon: `account_balance`)
- Step 3: "Done" (icon: `check_circle`)

Step label names and icons are set via `[label]` and `[state]` bindings on each
`MatStep`. The dialog title (`mat-dialog-title`) changes from "Purchase photo" to
"Purchase photos".

All other layout rules from RS-010 apply unchanged.

The `PurchaseStepperDialogData` interface is updated:
```typescript
export interface PurchaseStepperDialogData {
  photoIds: string[];  // replaces photoId: string
}
```

### States

- **Loading, Error**: unchanged from RS-010 — delegated to `EmailStepComponent`.
- **Empty**: N/A — the dialog is only opened when `cartCount > 0`.
- **Default**: Stepper opens on step 0 (cart review). The runner must explicitly
  click "Continue to checkout" before advancing to step 1.

### Responsive behaviour

Unchanged from RS-010 (full-screen on mobile, `560px` on desktop). The stepper
header at `375px` shows icons only for all four steps — labels are hidden at this
breakpoint via the existing CSS rule from RS-010.

  UX decision (not in ACs): with four steps instead of three, the icon-only
  mobile header becomes even more important to avoid horizontal overflow. The
  existing `labelPosition="bottom"` setting from RS-010 is retained; no further
  changes are needed.

### Accessibility

- Dialog title updated to "Purchase photos" (`mat-dialog-title`).
- Close button `aria-label` updated to "Close purchase dialog" (unchanged text,
  as it remains accurate).
- When the stepper advances from step 0 to step 1 programmatically, focus must
  move to the first interactive element in step 1 (the email input) — this is the
  same focus-management requirement as RS-010, now also applies to the 0→1
  transition.

### Angular Material components to use

Unchanged from RS-010 with the addition of `CartReviewStepComponent` import.

### NgRx integration

- Subscribes to: `selectPurchaseLoading`, `selectPurchaseError`,
  `selectCartPhotoIds` (passed as `@Input() photoIds` to `EmailStepComponent`)
- Dispatches:
  - `PurchasesActions.resetPurchase` — close button, backdrop click (unchanged)
  - `CartActions.clearCart()` — on receiving `PurchasesActions.submitEmailSuccess`
    via the `Actions` stream. This keeps the cart slice free of purchases-slice
    knowledge.
- Advances the stepper from step 0 to step 1 when the runner emits `editCart`
  event from `CartReviewStepComponent` (close dialog) or `(continue)` event
  (advance stepper).

### Stepper navigation rules (updated)

| From step | Event | Outcome |
|---|---|---|
| Step 0 (cart review) | Runner clicks "Edit cart" | Dialog closes; cart is NOT cleared |
| Step 0 (cart review) | Runner clicks "Continue to checkout" | Stepper advances to step 1 |
| Step 1 (email) | Form invalid | Button disabled; no advance |
| Step 1 (email) | Form valid, user clicks "Confirm" | `submitEmail` dispatched; button shows spinner |
| Step 1 (email) | `submitEmailSuccess` arrives | `clearCart()` dispatched; stepper advances to step 2 |
| Step 1 (email) | `submitEmailFailure` arrives | Error banner shown; spinner removed; no advance |
| Step 2 (bank) | Runner clicks "I've made the transfer" | `confirmTransfer` dispatched; stepper advances to step 3 |
| Step 3 (done) | Runner clicks "Done" | `resetPurchase` dispatched; dialog closed |
| Any step | Runner clicks close button or backdrop | `resetPurchase` dispatched; dialog closed; cart NOT cleared |

  UX decision (not in ACs): closing the stepper at any step (except after
  `submitEmailSuccess`) does NOT clear the cart. The runner may have closed the
  dialog accidentally or decided to add more photos. The cart persists in NgRx
  state for the duration of the session. Only a successful order submission clears
  the cart (AC6, AC7). This is consistent with the "Cart persistence is
  session-scoped" note in the story's out-of-scope section.

---

## `EmailStepComponent` (`events/event-search/purchase-stepper/email-step/email-step.component.ts`)

### Purpose

Unchanged from RS-010. Collects the runner's email address and submits the order
with the full `photoIds` array.

### Changes from RS-010

- Add `@Input() photoIds: string[]` — required, passed in from the parent stepper.
- Update `onConfirm()` to dispatch
  `PurchasesActions.submitEmail({ photoIds: this.photoIds, runnerEmail })`.
- The instruction text at the top of the step is updated to:
  "Enter your email to receive payment instructions and download links for all
  selected photos."

All other layout, state, responsive behaviour, accessibility, and component
choices are unchanged from the RS-010 spec.

### NgRx integration changes

- Dispatches `PurchasesActions.submitEmail({ photoIds, runnerEmail })` instead of
  `{ photoId, runnerEmail }`.

---

## `PhotoDetailComponent` (`events/event-search/photo-detail/photo-detail.component.ts`)

### Purpose

Unchanged from RS-010. Shows a large watermarked preview and a "Purchase this
photo" button. Updated to route the single-photo purchase through the cart.

### Changes from RS-010

The `onPurchase()` method is updated to:
1. Dispatch `CartActions.addToCart({ photo })` — adds the photo to the cart
   (replacing any existing cart if it is from a different event, via the cart
   reducer's `replaceCart` logic, or adding if the cart is empty or same event).
2. Dispatch `PurchasesActions.initiatePurchase({ photoIds: [photo.id] })` —
   opens the purchase stepper immediately.

The `photo` input used for `addToCart` requires the full `PhotoSummary` shape.
The existing `PhotoDetailDialogData` must supply `eventName`, `watermarkedUrl`,
`pricePerPhoto`, and `currency` alongside the existing fields — these are already
present via the `pricePerPhoto`, `currency`, and `photo` (which carries
`watermarkedUrl` from `RunnerPhoto`) inputs, so no new dialog data fields are
needed. The component constructs the `PhotoSummary` inline:

```typescript
const summary: PhotoSummary = {
  id: this.data.photo.photoId,
  eventId: this.data.photo.eventId,
  eventName: this.data.eventName,        // new field in PhotoDetailDialogData
  watermarkedUrl: this.data.photo.watermarkedUrl,
  pricePerPhoto: this.data.pricePerPhoto,
  currency: this.data.currency,
};
```

`PhotoDetailDialogData` gains one new optional field: `eventName: string`.

  UX decision (not in ACs): when the runner clicks "Purchase this photo" from
  the photo-detail dialog, the cross-event confirmation dialog is NOT shown even
  if the photo is from a different event than the current cart. The single-photo
  purchase entry point implicitly replaces the cart. This simplifies the single-
  photo flow and avoids a two-dialog stack (detail dialog + confirmation dialog).
  The runner who cares about the existing cart will use the grid checkboxes
  directly. This decision should be reviewed by the team.

### Layout

Unchanged from RS-010.

### States, Responsive behaviour, Accessibility

All unchanged from RS-010.

### Angular Material components to use

Unchanged from RS-010. Add `CartActions` dispatch to the existing `Store` inject.

### NgRx integration changes

- Dispatches `CartActions.addToCart({ photo: summary })` before
  `PurchasesActions.initiatePurchase({ photoIds: [photo.id] })`.

---

## Inline error banner in `PurchaseStepperComponent`

AC10 requires an inline error banner inside the stepper on 4xx/5xx responses.
This banner already exists inside `EmailStepComponent` (from RS-010). The
RS-020 change that makes this relevant is that the cart must not be cleared on
error — the stepper stays open and the runner can retry without re-selecting
photos. No new banner component is needed; the existing `EmailStepComponent`
error banner satisfies AC10. The only new behaviour is the guarantee (enforced
in the stepper's NgRx integration) that `CartActions.clearCart()` is dispatched
only on `submitEmailSuccess`, never on `submitEmailFailure`.

---

## `store/purchases/` slice updates

The following changes to the existing RS-010 slice are required to support
RS-020. They are specified here for the build agent and are not a new component,
but the build agent must implement them before updating any component.

| File | Change |
|---|---|
| `purchases.actions.ts` | `initiatePurchase` payload: `{ photoId: string }` → `{ photoIds: string[] }` |
| `purchases.actions.ts` | `submitEmail` payload: `{ photoId: string; runnerEmail: string }` → `{ photoIds: string[]; runnerEmail: string }` |
| `purchases.state.ts` (or reducer) | Replace `activePhotoId: string \| null` with `activePhotoIds: string[] \| null` |
| `purchases.selectors.ts` | Replace `selectActivePhotoId` with `selectActivePhotoIds` returning `string[] \| null` |
| `purchases.effects.ts` | `submitEmail$` spreads `photoIds` directly into `POST /orders` body: `{ photoIds, runnerEmail }` |
| `purchases.reducer.ts` | `initiatePurchase` case sets `activePhotoIds`; `resetPurchase` clears it |

`PurchaseStepperComponent` receives the `photoIds` from `selectCartPhotoIds`
(not from `selectActivePhotoIds`) at the point of dialog open, then passes them
as an input to `EmailStepComponent`. The `purchases` slice's `activePhotoIds` is
a secondary record kept for display purposes (e.g. the confirmation step could
in future show "you purchased N photos"). The primary source of truth for which
photos are in the order is the `cart` slice until `clearCart()` is dispatched.

---

## Storybook stories required

| Component | Stories |
|---|---|
| `RunnerPhotoCardComponent` | `Default` (unselected), `Selected` (checkbox checked, primary border), `MaxReached` (checkbox disabled, tooltip), `ImageError` (broken image fallback) |
| `RunnerPhotoGridComponent` | `NoSelection` (toolbar hidden), `OneSelected` (toolbar visible, count = 1), `MaxReached` (toolbar visible, count = 20) |
| `CartReviewStepComponent` | `SinglePhoto`, `MultiplePhotos` (3 photos, same event), `Empty` (defensive zero-photo state) |
| Cross-event dialog | Covered via a `RunnerPhotoCardComponent` story: `CrossEventDialogOpen` |
| `PurchaseStepperComponent` | `Step0CartReview`, `Step1Email`, `Step2Bank`, `Step3Done` (stepper forced to each step via story args) |

All stories that require NgRx must use `provideMockStore` with the relevant
selectors preset. Cart selectors must be preset alongside purchases selectors.

---

## Summary of UX decisions not explicitly stated in the ACs

The following decisions were made during spec authoring and should be reviewed
by the team before implementation begins:

1. **Checkbox hover opacity (desktop)**: Unchecked card checkboxes are hidden at
   resting state on desktop (opacity 0) and revealed on card hover. This reduces
   visual clutter in large grids. Checked cards always show the checkbox. On
   mobile, all checkboxes are always visible (no hover state exists).

2. **Closing the stepper does not clear the cart**: Clicking the close button or
   backdrop at any step before `submitEmailSuccess` leaves the cart intact. Only
   a successful order clears it. This enables the runner to close and return to
   add or remove photos without losing their selection.

3. **Single-photo purchase from detail view replaces cart without confirmation**:
   `PhotoDetailComponent`'s "Purchase this photo" button implicitly replaces the
   cart if the photo is from a different event, without showing the cross-event
   dialog. The cross-event dialog only appears in the grid checkbox flow.

4. **Cross-event dialog focuses "Cancel" by default**: To prevent accidental
   destructive action, the Cancel button receives `cdkFocusInitial` rather than
   the "Continue" button.

5. **Toolbar uses a plain `div[role="toolbar"]` instead of `MatToolbar`**:
   `MatToolbar` carries semantic associations with primary app navigation in
   Material's design language. An inline selection action bar should not carry
   that meaning.

6. **"Continue to checkout" and "Edit cart" on same row at desktop, stacked on
   mobile**: On mobile, "Continue to checkout" is full-width and primary; "Edit
   cart" sits below it centred. This prioritises the forward path on mobile
   without hiding the back path.

7. **Four-step stepper icon labels**: Icons for the four steps are specified as
   `shopping_cart`, `email`, `account_balance`, `check_circle`. These are not in
   the ACs and can be changed without functional impact.
