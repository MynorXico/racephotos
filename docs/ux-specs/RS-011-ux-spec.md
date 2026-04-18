# UX Spec — RS-011: Photographer approves or rejects a purchase claim

**Story**: RS-011
**Route**: `/photographer/dashboard/approvals` (tab within the Dashboard child route)
**Persona**: Photographer — power user, desktop-first, expects efficiency
**Written**: 2026-04-17

---

## Overview

This spec covers the UI delivered by RS-011. A photographer arrives at their
Dashboard, navigates to the Approvals tab, sees a list of pending purchase claims,
and approves or rejects each one after confirming through a dialog.

Three components are introduced:

```
DashboardComponent                  (/photographer/dashboard — tab host)
  └── ApprovalsTabComponent         (approvals tab content — the purchase review list)

ConfirmationDialogComponent         (new shared component — reusable beyond this story)
```

The `ConfirmationDialogComponent` is placed in the shared component library so
future stories can open it for any destructive or irreversible action. It has
no knowledge of purchases — it receives all copy and callbacks via `MatDialogData`.

---

## NgRx slice: `store/approvals/` (new feature slice)

The existing `store/purchases/` slice belongs to the runner-side purchase flow
and must not be extended with photographer-side approval state. A new
`store/approvals/` slice is introduced for this story.

### State shape

```typescript
interface ApprovalsState {
  pendingPurchases: PendingPurchase[];   // loaded from GET /photographer/me/purchases?status=pending
  loading: boolean;                      // true while the list is being fetched
  error: string | null;                  // API error on list fetch, or null

  // Per-row action state — keyed by purchaseId
  actionLoading: Record<string, boolean>;   // true while approve/reject is in-flight for that row
  actionError: Record<string, string | null>; // error per row if approve/reject fails
}

interface PendingPurchase {
  purchaseId: string;
  photoId: string;
  eventId: string;
  eventName: string;
  runnerEmail: string;      // masked form: r***@domain.com — returned by the API already masked
  paymentRef: string;
  claimedAt: string;        // ISO 8601
  watermarkedUrl: string;   // CloudFront URL of the watermarked thumbnail
}
```

### Actions

| Action | Payload | When dispatched |
|---|---|---|
| `Load Pending Purchases` | `emptyProps` | `ApprovalsTabComponent.ngOnInit()` |
| `Load Pending Purchases Success` | `{ purchases: PendingPurchase[] }` | Effect receives 200 from `GET /photographer/me/purchases?status=pending` |
| `Load Pending Purchases Failure` | `{ error: string }` | Effect receives any non-200 from the list endpoint |
| `Approve Purchase` | `{ purchaseId: string }` | User confirms Approve in the dialog |
| `Approve Purchase Success` | `{ purchaseId: string }` | Effect receives 200 from `PUT /purchases/{id}/approve` |
| `Approve Purchase Failure` | `{ purchaseId: string; error: string }` | Effect receives non-200 from the approve endpoint |
| `Reject Purchase` | `{ purchaseId: string }` | User confirms Reject in the dialog |
| `Reject Purchase Success` | `{ purchaseId: string }` | Effect receives 200 from `PUT /purchases/{id}/reject` |
| `Reject Purchase Failure` | `{ purchaseId: string; error: string }` | Effect receives non-200 from the reject endpoint |

### Selectors

| Selector | Returns |
|---|---|
| `selectPendingPurchases` | `PendingPurchase[]` |
| `selectApprovalsLoading` | `boolean` |
| `selectApprovalsError` | `string \| null` |
| `selectActionLoading` | `(purchaseId: string) => boolean` — memoised per-row selector |
| `selectActionError` | `(purchaseId: string) => string \| null` — memoised per-row selector |

### Reducer behaviour

- `approvePurchaseSuccess` and `rejectPurchaseSuccess` both remove the matching
  `purchaseId` from `pendingPurchases` in the reducer. The row disappears from
  the list the moment the action fires — no second fetch is needed.
- `actionLoading[purchaseId]` is set to `true` by `approvePurchase` /
  `rejectPurchase` and cleared to `false` by the corresponding success or
  failure action.

### Effects

- `loadPendingPurchases$` — calls `GET /photographer/me/purchases?status=pending`;
  attaches the Cognito JWT from the auth state via an `HttpInterceptor` (same
  pattern as other photographer effects). On success dispatches
  `loadPendingPurchasesSuccess`. On failure dispatches `loadPendingPurchasesFailure`.
- `approvePurchase$` — calls `PUT /purchases/{purchaseId}/approve`; on 200 or
  (idempotent) already-approved 200, dispatches `approvePurchaseSuccess`. On 409
  (terminal-state conflict) or other non-200, dispatches `approvePurchaseFailure`
  with a human-readable error string.
- `rejectPurchase$` — same shape as `approvePurchase$` but against
  `PUT /purchases/{purchaseId}/reject`.
- Both action effects open a `MatSnackBar` on success inside the effect using
  `inject(MatSnackBar)`. They do not open the snack bar on failure — that is the
  row-level error message's responsibility (see `ApprovalsTabComponent` states).

---

## Component 1 — `DashboardComponent` (`photographer/dashboard/dashboard.component.ts`)

### Purpose

Hosts the photographer's Dashboard page and presents its content sections as
tabs. In RS-011 the only tab is "Approvals". Future stories add more tabs without
touching the router — new tabs are added as children of this component.

### Layout

The component renders within the existing `PhotographerLayoutComponent` content
area (the `<router-outlet>` inside `<main id="main-content">`).

Top to bottom:

1. **Page header**: The component calls `NavigationTitleService.setTitle('Dashboard')`
   on `ngOnInit` so the layout's top bar shows "Dashboard".
2. **Tab bar**: A `MatTabGroup` with `mat-tab-label` for each tab. In RS-011
   there is one tab labelled "Approvals" with badge count showing the number of
   pending purchases (see UX decision UX-D1 below). The tab bar sits at the
   top of the content area with no additional page heading above it — the layout's
   top bar already provides the "Dashboard" label.
3. **Tab body**: Each `<mat-tab>` body contains the corresponding child component.
   The "Approvals" tab body contains `<app-approvals-tab>`.

The `DashboardComponent` does not own any NgRx state directly. It passes the
`selectPendingPurchases.length` value down to the badge via a selector subscription.

### States

- **Loading**: N/A at this container level — `ApprovalsTabComponent` handles its
  own loading state.
- **Empty**: N/A — the tab bar is always shown even if the Approvals list is empty.
- **Error**: N/A — errors surface inside the tab content.
- **Success / default**: Tab bar visible; active tab content rendered.

### Responsive behaviour

- **375px (mobile)**: `MatTabGroup` tab labels are full-width at small breakpoints
  by default (Material behaviour). Tab label text "Approvals" plus badge is
  always visible — single tab so no horizontal scrolling needed.
- **1280px (desktop)**: Tab labels are left-aligned in the tab bar. Tab content
  area is the remaining height of the content column.

### Accessibility

- `MatTabGroup` provides `role="tablist"` / `role="tab"` / `role="tabpanel"`
  automatically — no manual ARIA needed.
- The badge number on the "Approvals" tab has `aria-label="Approvals: N pending"`,
  where N is the live count from the store.

### Angular Material components to use

- `MatTabsModule` (`MatTabGroup`, `MatTab`, `MatTabLabel`)
- `MatBadgeModule` — pending count badge on the tab label

### NgRx integration

- Subscribes to: `selectPendingPurchases` (to derive the badge count)
- Dispatches: none

---

## Component 2 — `ApprovalsTabComponent` (`photographer/dashboard/approvals-tab/approvals-tab.component.ts`)

### Purpose

Lists all pending purchase claims for the logged-in photographer, one row per
claim, with thumbnail, event name, masked runner email, payment reference,
claimed date, and Approve / Reject buttons. Each button opens a confirmation
dialog before the API call is made.

### Layout — 1280px (desktop)

The component renders inside the "Approvals" tab panel body. Max content width is
unconstrained — it fills the tab panel. Padding: `24px` top, `24px` horizontal.

**Loaded state (populated)**:

A `MatTable` with the following columns in order:

| Column | Content | Width |
|---|---|---|
| Photo | Watermarked thumbnail, `64px × 64px`, `object-fit: cover`, rounded `4px` | `80px` fixed |
| Event | Event name in `mat-body-medium`; `eventId` is not shown | flex 1 |
| Runner | Masked email (`r***@domain.com`) in `mat-body-medium` | `200px` fixed |
| Payment ref | `paymentRef` value in `font-family: monospace`, `mat-body-medium` | `160px` fixed |
| Claimed | Formatted `claimedAt` date in `mat-body-small`, `var(--mat-sys-on-surface-variant)` (e.g. "12 Apr 2026") | `120px` fixed |
| Actions | Approve button + Reject button, right-aligned within the cell | `200px` fixed |

The table has `matSort` disabled (no sort in v1). No pagination — all pending
purchases load in one request (expected to be a low-volume queue). If the volume
is high in a future story, pagination is added then.

**Actions column buttons**:

Two buttons per row, displayed side-by-side with `8px` gap:

- **Approve**: `mat-flat-button` using `color="primary"` (maps to
  `var(--mat-sys-primary)` background, `var(--mat-sys-on-primary)` text). Label:
  "Approve". Icon: `check` (mat-icon, left of label). `aria-label="Approve purchase
  from r***@domain.com"` (includes the masked email for screen reader context).
- **Reject**: `mat-stroked-button` with custom border and text colour using
  `var(--mat-sys-error)`. Label: "Reject". Icon: `close` (mat-icon, left of
  label). `aria-label="Reject purchase from r***@domain.com"`.

While a row's action is in-flight (`selectActionLoading(purchaseId) === true`),
both buttons in that row are replaced by a single `MatProgressSpinner`
(`diameter="24"`, `mode="indeterminate"`) centred in the actions cell. Both
buttons are hidden (not merely disabled) during loading to prevent double-submission.

If a row-level action fails (`selectActionError(purchaseId)` is non-null), an
inline error chip (`MatChip` read-only, error colour) appears below the buttons
in that row: "Action failed — try again." The buttons are shown again. Clicking
either button in a failed-action row opens the confirmation dialog anew.

**Per ADR-0003**: the same photo may appear multiple times in the table with
different masked runner emails — one row per `(purchaseId)`. The Photo column
thumbnail is repeated for each row. This is expected and intentional; the table
must not group rows by `photoId`.

### Layout — 375px (mobile)

On mobile the `MatTable` is replaced by a `MatCard` list. Each pending purchase
is a `MatCard` with `appearance="outlined"` stacked vertically with `16px` gap.
Inside each card, top to bottom:

1. **Thumbnail row**: Watermarked thumbnail `80px × 80px`, `object-fit: cover`,
   `border-radius: 4px`, left-aligned. Event name in `mat-title-small` to the
   right of the thumbnail, vertically centred.
2. **Details section** (below the thumbnail row), two lines:
   - Masked runner email in `mat-body-medium`
   - Payment ref in `font-family: monospace`, `mat-body-small` + claimed date in
     `mat-body-small`, `var(--mat-sys-on-surface-variant)`, separated by a
     middot (" · ")
3. **Action row**: Two full-width buttons stacked, Approve on top, Reject below,
   `8px` gap. Both buttons span the full card width.

The spinner and error chip follow the same behaviour as desktop but span the
full card width.

### States

**Loading (initial fetch)**:

While `selectApprovalsLoading === true`, the table / card list area shows three
skeleton rows. Each skeleton row matches the height of a populated row. The
skeleton is rendered using CSS animation (`animation: pulse`) applied to
placeholder `div` elements with `var(--mat-sys-surface-variant)` background.
No third-party skeleton library. On mobile, three skeleton cards are shown
instead.

**Empty (no pending purchases)**:

When `selectPendingPurchases.length === 0` and `selectApprovalsLoading === false`
and `selectApprovalsError === null`:

- A centred empty-state block is shown in place of the table:
  - `mat-icon` `inbox` at `64px`, `var(--mat-sys-on-surface-variant)` colour,
    `aria-hidden="true"`
  - Heading in `mat-title-medium`: "No pending approvals"
  - Body text in `mat-body-medium`, `var(--mat-sys-on-surface-variant)`:
    "All purchase claims have been reviewed. New claims will appear here when
    runners submit payment."
- No CTA button — the photographer cannot do anything proactively.

**Error (list fetch failed)**:

When `selectApprovalsError` is non-null and `selectApprovalsLoading === false`:

- The table / card list area is hidden.
- A `MatCard` with `appearance="outlined"` is shown instead:
  - `mat-icon` `error_outline` at `48px`, `var(--mat-sys-error)` colour,
    `aria-hidden="true"`
  - Text in `mat-body-medium`: "Could not load pending approvals. Check your
    connection and try again."
  - A `mat-stroked-button` "Retry" below the text.
    `aria-label="Retry loading pending approvals"`.
    Clicking it dispatches `ApprovalsActions.loadPendingPurchases()`.

**Success (after approve or reject)**:

- The row is removed from the table instantly (reducer removes it on success action).
- A `MatSnackBar` toast appears at the bottom-centre of the viewport:
  - Approve success: "Purchase approved — download link sent to runner."
    Duration: `5000ms`. No action button.
  - Reject success: "Purchase rejected." Duration: `4000ms`. No action button.
- The snackbars are opened from the NgRx effect (not the component), so the
  component does not need to subscribe to success actions for toast logic.

### Accessibility

- The `MatTable` has `aria-label="Pending purchase approvals"`.
- Column headers are `<th>` elements (Material table default). The "Photo" column
  header is visually empty but has `scope="col"` and `aria-label="Photo thumbnail"`.
- Each thumbnail `<img>` has `alt="Watermarked photo for [eventName]"` — event
  name is interpolated so screen readers identify which event each thumbnail
  belongs to.
- Approve and Reject buttons include the masked runner email in their `aria-label`
  so a screen reader user navigating by button can distinguish rows. Format:
  `aria-label="Approve purchase from r***@domain.com"` and
  `aria-label="Reject purchase from r***@domain.com"`.
- Spinner in the actions cell has `role="status"` and
  `aria-label="Processing action for purchase from r***@domain.com"`.
- Inline error chip has `role="alert"` so screen readers announce it immediately.
- Focus returns to the Approve or Reject button that triggered the action after
  the dialog closes with "Cancel". After a successful action the row is removed,
  so focus moves to the next row's Approve button, or — if the list is now empty
  — to the tab panel heading.
- On mobile, the card list container has `role="list"` and each card has
  `role="listitem"`.
- Colour is never the sole indicator of the Approve vs Reject distinction — icon
  (`check` vs `close`) and button label accompany the colour difference.

### Angular Material components to use

- `MatTableModule` — desktop table layout
- `MatCardModule` — mobile card layout; error state card; row error chip uses a
  `MatChip` (read-only)
- `MatButtonModule` (`mat-flat-button`, `mat-stroked-button`) — Approve and Reject
- `MatIconModule` — `check`, `close`, `inbox`, `error_outline` icons
- `MatProgressSpinnerModule` — per-row action loading state
- `MatChipsModule` (read-only `mat-chip`) — per-row error indicator
- `MatSnackBarModule` — success toast (opened from effect, not component)
- `MatBadgeModule` — not used in this component directly; badge is on the
  DashboardComponent tab label

### NgRx integration

**Selectors consumed**:

| Selector | Purpose |
|---|---|
| `selectPendingPurchases` | Populates the table rows / mobile cards |
| `selectApprovalsLoading` | Drives skeleton loader visibility |
| `selectApprovalsError` | Drives error state visibility |
| `selectActionLoading(purchaseId)` | Per-row spinner visibility |
| `selectActionError(purchaseId)` | Per-row inline error chip |

**Actions dispatched**:

| User event | Action dispatched |
|---|---|
| Component initialises (`ngOnInit`) | `ApprovalsActions.loadPendingPurchases()` |
| "Retry" button clicked in error state | `ApprovalsActions.loadPendingPurchases()` |
| User confirms Approve in dialog | `ApprovalsActions.approvePurchase({ purchaseId })` |
| User confirms Reject in dialog | `ApprovalsActions.rejectPurchase({ purchaseId })` |

The Approve / Reject buttons themselves do **not** dispatch NgRx actions. They
open the `ConfirmationDialogComponent` via `MatDialog.open()`. Only if the user
clicks "Confirm" in the dialog does the component dispatch the NgRx action.

---

## Component 3 — `ConfirmationDialogComponent` (`shared/confirmation-dialog/confirmation-dialog.component.ts`)

### Purpose

A reusable confirmation dialog that presents a title, a body message, and two
buttons (confirm and cancel). It is generic — it receives all copy via
`MatDialogData` and returns a boolean result via `MatDialogRef.close()`. It has
no knowledge of purchases, approvals, or any other business domain.

### Data contract (injected via `MAT_DIALOG_DATA`)

```typescript
interface ConfirmationDialogData {
  title: string;              // e.g. "Approve this purchase?"
  message: string;            // e.g. "The runner will receive a download link by email."
  confirmLabel: string;       // e.g. "Approve"
  cancelLabel: string;        // e.g. "Cancel" — defaults to "Cancel" if omitted
  confirmVariant: 'primary' | 'warn';  // 'primary' for approve, 'warn' for reject
}
```

The dialog returns `true` via `MatDialogRef.close(true)` when the confirm button
is clicked, and `false` (or `undefined` when dismissed by backdrop/escape) when
cancelled.

### How `ApprovalsTabComponent` opens this dialog

```typescript
// Approve button click handler
onApprove(purchase: PendingPurchase): void {
  const ref = this.dialog.open(ConfirmationDialogComponent, {
    data: {
      title: 'Approve this purchase?',
      message: `The runner will receive a download link by email. Payment reference: ${purchase.paymentRef}`,
      confirmLabel: 'Approve',
      cancelLabel: 'Cancel',
      confirmVariant: 'primary',
    } satisfies ConfirmationDialogData,
    width: '400px',
    maxWidth: '100vw',
  });
  ref.afterClosed().subscribe((confirmed: boolean | undefined) => {
    if (confirmed) {
      this.store.dispatch(ApprovalsActions.approvePurchase({ purchaseId: purchase.purchaseId }));
    }
  });
}

// Reject button click handler
onReject(purchase: PendingPurchase): void {
  const ref = this.dialog.open(ConfirmationDialogComponent, {
    data: {
      title: 'Reject this purchase?',
      message: 'The purchase claim will be marked as rejected. No email is sent to the runner.',
      confirmLabel: 'Reject',
      cancelLabel: 'Cancel',
      confirmVariant: 'warn',
    } satisfies ConfirmationDialogData,
    width: '400px',
    maxWidth: '100vw',
  });
  ref.afterClosed().subscribe((confirmed: boolean | undefined) => {
    if (confirmed) {
      this.store.dispatch(ApprovalsActions.rejectPurchase({ purchaseId: purchase.purchaseId }));
    }
  });
}
```

### Layout — 1280px (desktop)

The dialog is `400px` wide, height `auto`. Structure inside the dialog panel:

1. **Dialog title** (`mat-dialog-title`): The `title` string from
   `ConfirmationDialogData`. Rendered as an `h2`. A close icon button
   (`mat-icon-button`, `mat-icon: close`) is positioned at the top-right of the
   title bar using `display: flex; justify-content: space-between; align-items: center`.
2. **Dialog content** (`mat-dialog-content`): The `message` string in
   `mat-body-medium` typography. If the message is long enough to require
   scrolling (unlikely for this use case but required for generality), the
   `mat-dialog-content` element handles overflow automatically.
3. **Dialog actions** (`mat-dialog-actions`, `align="end"`): Two buttons,
   right-aligned, `8px` gap:
   - **Cancel**: `mat-stroked-button`. Calls `dialogRef.close(false)`.
     Label from `cancelLabel` (defaults to "Cancel").
   - **Confirm**: Either `mat-flat-button color="primary"` (when
     `confirmVariant === 'primary'`) or `mat-flat-button color="warn"` (when
     `confirmVariant === 'warn'`). Calls `dialogRef.close(true)`.
     Label from `confirmLabel`.

The Cancel button comes first in the DOM (left visually) and the Confirm button
comes last (right visually). This order places the default action to the right,
consistent with Material's dialog action convention.

**No loading state inside the dialog**: The dialog closes immediately when either
button is clicked. The `ApprovalsTabComponent` handles the in-flight loading state
at the row level (spinner in actions cell). The dialog does not wait for the API
call to complete.

### Layout — 375px (mobile)

- Dialog fills the full viewport width (`maxWidth: '100vw'`, dialog panel has
  no horizontal margin on mobile). Apply a `confirmation-dialog` global panel
  class in `styles.scss` that sets `width: calc(100vw - 32px)` at the
  `375px` breakpoint — 16px margin each side.
- Dialog action buttons are stacked vertically, full-width, in `flex-direction:
  column-reverse` order (Confirm on top, Cancel below) so the primary action is
  closer to the thumb.
- The close icon button in the title remains at the top-right.

### States

- **Loading**: N/A — the dialog itself has no loading state (see above).
- **Empty**: N/A — the dialog is always opened with data.
- **Error**: N/A — errors are handled by the caller after the dialog closes.
- **Open / default**: The only state. Title, message, and two buttons.
- **Cancel / dismiss**: `dialogRef.close(false)` — dialog closes; caller's
  `afterClosed()` receives `false` or `undefined`.
- **Confirm**: `dialogRef.close(true)` — dialog closes; caller's `afterClosed()`
  receives `true`.

### Accessibility

- `mat-dialog-title` is automatically used as the accessible name for the dialog
  via `aria-labelledby` (Angular Material default behaviour).
- `mat-dialog-content` provides `aria-describedby` linkage automatically.
- The close icon button has `aria-label="Close dialog"`.
- Cancel button has `aria-label` equal to its label text — no separate override
  needed since the label is descriptive.
- Confirm button has `aria-label` equal to its label text.
- When the dialog opens, focus is trapped inside the dialog panel (CDK
  `FocusTrap` applied by `MatDialog` automatically). Initial focus lands on the
  Cancel button — this is the safer default for a destructive confirmation; the
  photographer must actively move to Confirm. Set `cdkFocusInitial` on the Cancel
  button element.
- When the dialog closes, focus returns to the button that opened it (the
  Approve or Reject button in the table row). `MatDialogRef` restores focus to
  the previously focused element automatically.
- The dialog can be dismissed with the Escape key (Material default) — treated
  as Cancel, `dialogRef.close(false)`.
- Backdrop click closes the dialog and is treated as Cancel. Set
  `disableClose: false` (the default) on `MatDialog.open()` for this component.

### Angular Material components to use

- `MatDialogModule` (`MatDialogTitle`, `MatDialogContent`, `MatDialogActions`,
  `MatDialogClose`, `MatDialogRef`, `MAT_DIALOG_DATA`)
- `MatButtonModule` (`mat-flat-button`, `mat-stroked-button`)
- `MatIconModule` — close icon

### NgRx integration

None. The `ConfirmationDialogComponent` is a pure presentational dialog. It has
no store dependency. All NgRx actions are dispatched by `ApprovalsTabComponent`
in response to the dialog's `afterClosed()` observable.

---

## Routing changes

The existing `dashboard` route in `app.routes.ts` currently points to
`EventsPlaceholderComponent`. This must be replaced with `DashboardComponent`.
The route path stays `/photographer/dashboard`. No child route is needed for the
approvals tab — `DashboardComponent` owns its tabs internally.

The `approvals` NgRx slice is provided at the route level:

```typescript
{
  path: 'dashboard',
  loadComponent: () =>
    import('./features/photographer/dashboard/dashboard.component').then(
      (m) => m.DashboardComponent,
    ),
  providers: [provideState(approvalsFeature), provideEffects(ApprovalsEffects)],
},
```

The existing `EventsPlaceholderComponent` can be deleted once `DashboardComponent`
is implemented.

---

## Toast / SnackBar placement summary

All `MatSnackBar` instances opened by this story use Angular Material's default
positioning (bottom-centre on desktop, bottom full-width on mobile).

| Trigger | Message | Duration | Action |
|---|---|---|---|
| `approvePurchaseSuccess` (effect) | "Purchase approved — download link sent to runner." | 5000ms | None |
| `rejectPurchaseSuccess` (effect) | "Purchase rejected." | 4000ms | None |

Row-level failures (`approvePurchaseFailure`, `rejectPurchaseFailure`) are surfaced
as inline per-row error chips, not as snack bars — the photographer must be able
to identify which row failed and retry it directly.

---

## Storybook stories required

Stories use `provideMockStore` with relevant selectors preset — no real NgRx store
or HTTP calls.

### `ApprovalsTabComponent`

| Story | State preset |
|---|---|
| `Default` | 3 populated rows — including one photo appearing twice with different masked emails (ADR-0003 multi-runner case) |
| `Loading` | `selectApprovalsLoading: true`, empty purchases array |
| `Empty` | `selectApprovalsLoading: false`, empty purchases array, no error |
| `Error` | `selectApprovalsError: 'Network error'`, empty purchases array |
| `RowActionLoading` | One row has `selectActionLoading(purchaseId): true` — spinner shown in that row's actions cell, other rows normal |
| `RowActionError` | One row has `selectActionError(purchaseId): 'Action failed'` — inline error chip shown in that row |

### `ConfirmationDialogComponent`

Stories render the dialog panel directly (using Storybook's `moduleMetadata` with
`MatDialogRef` and `MAT_DIALOG_DATA` mocked via providers).

| Story | `ConfirmationDialogData` |
|---|---|
| `ApproveVariant` | `title: 'Approve this purchase?'`, `confirmLabel: 'Approve'`, `confirmVariant: 'primary'` |
| `RejectVariant` | `title: 'Reject this purchase?'`, `confirmLabel: 'Reject'`, `confirmVariant: 'warn'` |
| `LongMessage` | A message long enough to demonstrate content area scrolling |

### `DashboardComponent`

| Story | State |
|---|---|
| `WithPendingApprovals` | 5 purchases in the store — badge shows "5" |
| `NoPendingApprovals` | 0 purchases in the store — badge hidden or shows "0" |

---

## Colour and typography token reference

Tokens used in this story — always reference via CSS custom properties, never
hardcode hex values.

**Colour roles**:

- `var(--mat-sys-primary)` — Approve button fill
- `var(--mat-sys-on-primary)` — Approve button label text
- `var(--mat-sys-error)` — Reject button border and text; row error chip; error
  state icon
- `var(--mat-sys-on-error-container)` — error state body text
- `var(--mat-sys-surface-variant)` — skeleton loader shimmer base colour
- `var(--mat-sys-on-surface-variant)` — secondary text (claimed date, empty state
  body, event name in mobile card subtitle)
- `var(--mat-sys-surface-container)` — sidebar (inherited, not used in this story
  directly)

**Typography scale**:

- `mat-title-medium` — empty state heading
- `mat-body-medium` — table cell text, dialog message, mobile card email and
  event name
- `mat-body-small` — claimed date column, mobile card payment ref line
- `mat-title-small` — mobile card event name (next to thumbnail)

---

## UX decisions not in the story ACs (requires team review)

**UX-D1 — Pending count badge on the "Approvals" tab**: The ACs do not mention a
badge. The spec adds a `MatBadge` showing the count of pending purchases on the
tab label (e.g. "Approvals 3"). This gives the photographer immediate feedback
without opening the tab. **Decision: show live count badge; badge is hidden when
count is 0.** Review with PO whether this count should also appear on the "Dashboard"
sidebar nav item in `PhotographerLayoutComponent`.

**UX-D2 — Dialog closes immediately on confirm, loading shown in the row**: The
ACs say a confirmation dialog is shown before the request is sent (AC10). The
spec closes the dialog on confirm and shows the in-progress state at the row level.
An alternative is to keep the dialog open with a spinner until the API responds,
then close it. **Decision: close the dialog immediately and show the per-row
spinner. This gives the photographer faster visual feedback and lets them scroll
past a slow row.** Review if the team prefers keeping the dialog open during the
API call.

**UX-D3 — Desktop layout uses `MatTable`, mobile uses `MatCard` list**: The ACs
describe "purchase rows" but do not specify the layout component. The spec uses
`MatTable` on desktop (photographer is a power user who benefits from scannable
columns) and `MatCard` stacks on mobile. **Decision: `MatTable` at ≥ 768px,
card list at < 768px.** The breakpoint is detected with Angular CDK
`BreakpointObserver`. Review if a single responsive table with hidden columns
would be preferable.

**UX-D4 — Row-level action failures are inline chips, not toasts**: The ACs
specify a toast on success (AC11) but do not specify the failure UX for the
approve/reject actions. The spec uses a per-row error chip rather than a toast
so the photographer can see which specific row failed. **Decision: inline chip
per row; chip disappears when the user retries by clicking Approve or Reject
again.** Review if a toast is preferred for consistency with other error patterns
in the app.

**UX-D5 — `ConfirmationDialogComponent` initial focus on the Cancel button**:
The dialog spec places `cdkFocusInitial` on Cancel (not Confirm) as the safer
default for a destructive action. **Decision: initial focus on Cancel.** If the
team decides that Approve (a non-destructive action) should have initial focus,
the Reject dialog would still want Cancel as initial focus, which would mean
two different focus targets for the same component — requiring a new
`initialFocusTarget` field in `ConfirmationDialogData`. Review with the team
before implementation.

**UX-D6 — Payment reference shown in the approval dialog message**: The ACs do
not specify what information appears in the confirmation dialog body. The spec
includes the `paymentRef` in the Approve dialog message so the photographer can
cross-reference with their bank statement before confirming. The Reject dialog
message explains that no email is sent. **Decision: include `paymentRef` in
Approve dialog message; include "no email" note in Reject dialog message.**
Review if additional information (e.g. amount, event name) should be included.

**UX-D7 — Replace `EventsPlaceholderComponent` with `DashboardComponent`**: The
current `/photographer/dashboard` route points to the placeholder. The story
requires a real `DashboardComponent` to host the approvals tab. The spec replaces
the placeholder — the placeholder can be deleted. **Decision: delete placeholder,
create `DashboardComponent` at the same path.** Confirm no other story currently
depends on the placeholder remaining.

**UX-D8 — `store/approvals/` as a new separate NgRx slice**: The story could
extend `store/purchases/` (the existing runner-side slice) with photographer-side
approval state. The spec creates a new `store/approvals/` slice instead to keep
runner and photographer state orthogonal. **Decision: new `approvals` feature
slice; `purchases` slice is unchanged.** Review if a single `purchases` slice
with photographer vs runner sub-sections is preferable.
