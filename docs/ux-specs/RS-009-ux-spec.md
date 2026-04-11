# UX Spec — RS-009: Runner searches for photos by bib number

**Story**: RS-009  
**Route**: `/events/:id` (public, no auth guard)  
**Persona**: Runner — casual user, mobile-first, unfamiliar with bank transfer flows  
**Written**: 2026-04-10

---

## Overview

Four components compose the runner search experience. The route host
(`EventSearchComponent`) owns the page shell and the bib search form.
`PhotoGridComponent` receives a list of photos as an `@Input` and renders the
card grid. `PhotoCardComponent` renders one watermarked thumbnail with price and
a Purchase action. `PhotoDetailComponent` is an overlay that shows a single
large watermarked preview with a prominent "Purchase this photo" call to action.

The NgRx slice that backs these components must be created as part of this story.
The stub actions file at `store/runner-photos/runner-photos.actions.ts` is the
starting point; it must be fleshed out into a full slice (actions, reducer,
effects, selectors) before any component implementation begins.

---

## NgRx slice: `store/runner-photos/`

The runner-photos slice is separate from the photographer `photos` slice.
The two serve different API endpoints, different data shapes, and different
personas. Do not reuse or extend the existing `photosFeature`.

### State shape

```typescript
interface RunnerPhotosState {
  eventId: string | null;
  eventName: string | null;
  eventDate: string | null;
  eventLocation: string | null;
  pricePerPhoto: number | null;
  currency: string | null;
  photos: RunnerPhoto[];
  searchedBib: string | null;
  loading: boolean;
  error: string | null;
  selectedPhotoId: string | null;
}

interface RunnerPhoto {
  photoId: string;
  watermarkedUrl: string;
  capturedAt: string | null;
}
```

### Actions (expand the existing stub)

| Action | Payload | When dispatched |
|---|---|---|
| `Search By Bib` | `{ eventId: string; bibNumber: string }` | Runner submits the bib form |
| `Search Success` | `{ photos: RunnerPhoto[]; eventName: string; eventDate: string; eventLocation: string; pricePerPhoto: number; currency: string }` | Effect receives 200 from the search API |
| `Search Failure` | `{ error: string }` | Effect receives a non-200 or network error |
| `Clear Results` | — | Component `ngOnDestroy` |
| `Select Photo` | `{ photoId: string }` | Runner clicks a photo card |
| `Deselect Photo` | — | Runner closes the detail view |
| `Load Event` | `{ id: string }` | Component `OnInit` (to show event header before any search) |
| `Load Event Success` | `{ eventName: string; eventDate: string; eventLocation: string; pricePerPhoto: number; currency: string }` | Effect receives event metadata |
| `Load Event Failure` | `{ error: string }` | Effect receives 404 or network error on event load |

### Selectors

| Selector | Derived from |
|---|---|
| `selectRunnerPhotosLoading` | `state.loading` |
| `selectRunnerPhotosError` | `state.error` |
| `selectRunnerPhotos` | `state.photos` |
| `selectSearchedBib` | `state.searchedBib` |
| `selectEventMetadata` | `{ eventName, eventDate, eventLocation, pricePerPhoto, currency }` |
| `selectSelectedPhoto` | Join `state.photos` with `state.selectedPhotoId` |
| `selectHasSearched` | `state.searchedBib !== null` |
| `selectHasResults` | `state.photos.length > 0` |

---

## EventSearchComponent (`src/app/events/event-search/event-search.component.ts`)

### Purpose

Route host for `/events/:id`. Loads event metadata on init, presents the event
header and bib search form, and coordinates the transition between the pre-search
state, the results grid, and the photo detail overlay.

### Layout

**Top of page — Event header** (always visible once metadata loads):
- Event name as a headline (`mat-headline-4` typography)
- Event date formatted as a human-readable string (e.g. "15 March 2025") beneath the name
- Event location as a secondary line beneath the date
- The three fields are stacked vertically, left-aligned, with comfortable vertical spacing

**Below the header — Bib search form**:
- A single `MatFormField` (appearance `outline`) labelled "Bib number"
- The input accepts numeric characters only; the label doubles as a visible label
- Inline hint text below the field: "Enter your race bib number to find your photos"
- A full-width "Find my photos" `MatButton` (raised, primary colour) sits directly
  below the form field
- The button and field fill the full content width at all breakpoints
- Submitting the form (Enter key or button click) dispatches `Search By Bib`

**Below the form — content area** (conditionally rendered):
- While loading: skeleton grid (see Loading state)
- After a successful search with results: `PhotoGridComponent`
- After a successful search with zero results: empty state message block
- After an API error: error block with retry button

The page has no sidebar, no navigation tabs, and no pagination controls (v1
returns all results, typically 5–20 photos per bib per event per the story's
out-of-scope note).

### States

**Loading (initial page load — event metadata)**:
- Event header area shows three skeleton lines (varying widths, `mat-skeleton`
  shimmer animation) in place of event name, date, and location
- The bib form is rendered but the "Find my photos" button is disabled while
  event metadata is loading
- No grid is shown yet

**Loading (after bib form submission)**:
- The bib form and event header remain visible
- The content area below the form shows a skeleton grid of 6 `MatCard` placeholders
  arranged in the same grid layout as the real results (see PhotoGridComponent layout)
- Each placeholder card shows a grey shimmer block for the image and two shorter
  shimmer lines for price and button
- The "Find my photos" button enters a disabled state and shows a `MatProgressSpinner`
  (diameter 20, inline) inside the button label area in place of the button text
- Do not hide the button — it must remain in the DOM so the layout does not shift

**Empty (zero results)**:
- The skeleton grid is replaced by a centred block containing:
  - A `mat-icon` of `search_off` (48px) in the secondary text colour
  - The message: "No photos found for bib {bib}. Photos may still be processing — try again later."
  - The bib number inside the message is rendered in bold, not interpolated as a separate element
- No CTA button in the empty state — the runner can simply edit the bib field and resubmit
- The message block has generous top and bottom padding (at least 48px each side)

**Error (event 404 or search API failure)**:
- Two distinct error messages:
  - Event not found (404 on event load): "This event could not be found. Check the link and try again." — no retry button; the page is effectively dead
  - Search API failure: "Something went wrong. Please try again." with a "Retry" `MatButton` (stroked, not raised) that dispatches `Search By Bib` again with the last-submitted bib value
- Error text uses the M3 `error` colour token
- The error block appears in the same content area below the form; the form itself remains usable

**Success / default**:
- Event header displays real data
- Bib form is enabled
- `PhotoGridComponent` is rendered below the form with the returned photo set

### Responsive behaviour

**375px (mobile)**:
- Event header: full-width, stacked, font size uses `mat-headline-5` (one size down from desktop)
- Bib form field and button: full-width, stacked vertically
- Photo grid: single-column (see PhotoGridComponent)
- Page padding: 16px left and right

**1280px (desktop)**:
- Maximum content width capped at 960px, horizontally centred via auto margins
- Event header: same stacking but uses `mat-headline-4`
- Bib form: the field and button sit side-by-side in a row — the field takes
  ~75% of the width and the button takes the remaining ~25%
- Page padding: 24px left and right

### Accessibility

- The page `<title>` updates to "{Event Name} — Find your photos" once event metadata loads
- The event name `<h1>` is the first heading on the page
- The bib form field has `aria-label="Bib number"` as well as a visible label
- The hint text below the field is linked to the input via `aria-describedby`
- The "Find my photos" button has `aria-busy="true"` while the search is loading
- The empty state container has `role="status"` so screen readers announce it when it appears
- The error block has `role="alert"` so screen readers announce it immediately

### Angular Material components to use

- `MatFormFieldModule` (appearance `outline`) for the bib input
- `MatInputModule` for the `<input>` inside the form field
- `MatButtonModule` (raised primary) for "Find my photos"
- `MatProgressSpinnerModule` (inline, diameter 20) inside the button during loading
- `MatIconModule` (`search_off`) for the empty state icon
- `ReactiveFormsModule` — `FormControl` for the bib input; validate `required` and
  pattern `^[0-9]{1,6}$` (bib numbers are numeric, max 6 digits — see UX decision UX-D1)

### NgRx integration

**Selectors subscribed**:
- `selectEventMetadata` — populates the event header
- `selectRunnerPhotosLoading` — disables the form button and shows skeletons
- `selectRunnerPhotosError` — shows the error block
- `selectHasSearched` — controls whether the empty/results/error area is rendered at all
- `selectHasResults` — switches between empty state and `PhotoGridComponent`
- `selectRunnerPhotos` — passed as `@Input` to `PhotoGridComponent`
- `selectSearchedBib` — used to interpolate the bib in the empty state message
  and to support retry dispatch
- `selectSelectedPhoto` — passed to `PhotoDetailComponent`; when non-null, the
  detail overlay is rendered

**Actions dispatched**:
- `RunnerPhotosActions.loadEvent({ id })` — on `OnInit` / route param change
- `RunnerPhotosActions.searchByBib({ eventId, bibNumber })` — on form submit
- `RunnerPhotosActions.deselectPhoto()` — when the detail overlay is closed
- `RunnerPhotosActions.clearResults()` — in `ngOnDestroy`

---

## PhotoGridComponent (`src/app/events/event-search/photo-grid/photo-grid.component.ts`)

### Purpose

Presentational component that renders the ordered set of watermarked photo cards
returned by a bib search. It has no direct store access — it receives data via
`@Input` and emits user interaction events via `@Output`.

### Layout

A CSS grid with responsive column counts (see Responsive behaviour). Each cell
contains one `PhotoCardComponent`. Cards are ordered by `capturedAt` ascending
(earliest photo first) when `capturedAt` is present; photos without a timestamp
sort to the end.

The grid has a consistent gap between cards (16px at mobile, 24px at desktop).
There are no section headings, filters, or sorting controls inside this component
— those decisions belong to the parent.

### States

**Loading**: N/A — the parent (`EventSearchComponent`) renders skeleton cards
during loading; this component only receives the final photos array and renders
it. The component should not be mounted while loading is true.

**Empty**: N/A — the parent handles the empty state. This component renders
only when `photos.length > 0`.

**Error**: N/A — handled by the parent.

**Success / default**: a grid of `PhotoCardComponent` instances, one per photo
in the input array.

### Responsive behaviour

**375px (mobile)**: single-column grid (`grid-template-columns: 1fr`). Cards
span the full content width. Image aspect ratio is 4:3, enforced via
`aspect-ratio: 4/3` on the image container.

**768px (tablet)**: two-column grid (`grid-template-columns: repeat(2, 1fr)`).

**1280px (desktop)**: three-column grid (`grid-template-columns: repeat(3, 1fr)`).

Breakpoints are implemented via CSS `@media` queries inside the component SCSS,
not Angular CDK BreakpointObserver, to keep the component presentational and
free of service injection.

### Accessibility

- The grid container has `role="list"` so `PhotoCardComponent` (which has
  `role="listitem"`) is correctly associated
- The grid is labelled with `aria-label="Photos for bib {bib}"` where bib is
  passed in as a second input; this updates reactively when the parent's
  searched bib changes

### Angular Material components to use

No Material layout primitives are used for the grid itself — it is a pure CSS
grid. `PhotoCardComponent` internally uses `MatCardModule`.

### NgRx integration

This component has no direct store access. Inputs and outputs only:

- `@Input() photos: RunnerPhoto[]`
- `@Input() pricePerPhoto: number`
- `@Input() currency: string`
- `@Input() searchedBib: string`
- `@Output() photoSelected: EventEmitter<string>` — emits `photoId`

The parent handles the emitted `photoId` by dispatching `RunnerPhotosActions.selectPhoto`.

---

## PhotoCardComponent (`src/app/events/event-search/photo-card/photo-card.component.ts`)

### Purpose

Displays a single watermarked photo thumbnail with the per-photo price and a
"Purchase" action. The card is clickable in its entirety to open the detail view,
and the Purchase button is a distinct interactive element that also initiates the
detail view.

Note: this is a new component under the `event-search/` tree. It is distinct
from the photographer-facing `event-photos/photo-card/photo-card.component.ts`
and must not extend or import it, as the data shapes and actions differ.

### Layout

A `MatCard` with the following internal structure, top to bottom:

1. **Image area**: a fixed-aspect-ratio image container (`aspect-ratio: 4/3`)
   with the watermarked thumbnail. The `<img>` uses `object-fit: cover`. The
   image has a subtle dark-to-transparent gradient overlay at the bottom 30% to
   improve text legibility if any caption is added in the future.
2. **Card content area** (`mat-card-content`):
   - Price line: "{currency} {pricePerPhoto}" in `mat-body-1` typography, bold
   - No secondary text (photo caption, date, bib list) on the card — that
     information is reserved for the detail view
3. **Card actions area** (`mat-card-actions`):
   - A single "Purchase" `MatButton` (stroked, full card width) positioned flush
     with the bottom of the card

The entire card surface (image + content + actions) is a click target that opens
the detail view. The Purchase button also opens the detail view in v1, since the
purchase flow begins in the detail modal (RS-010). Do not navigate away from the
route — dispatch `selectPhoto` instead.

### States

**Loading**: N/A — parent controls rendering; this component only mounts with a
valid photo.

**Empty**: N/A.

**Error — image load failure**: when the `<img>` fires an `(error)` event, replace
the image area with a centred `mat-icon` of `broken_image` (48px, secondary text
colour) on a light grey background. The card content and Purchase button remain
usable.

**Success / default**: thumbnail loaded, price displayed, Purchase button visible.

### Responsive behaviour

**375px (mobile)**: card fills the single grid column. Touch target for the
entire card is at least 48px tall (the card is naturally much taller — no special
treatment needed). The Purchase button minimum height is 48px to meet touch target
guidelines.

**1280px (desktop)**: card fills one of three grid columns. The Purchase button
height follows Material defaults (36px) since hover precision is available.

### Accessibility

- The `MatCard` host element has `role="listitem"` (set on the component host,
  matching the pattern from the photographer's `PhotoCardComponent`)
- The card has `tabindex="0"` so keyboard users can focus it
- On focus or hover, a visible focus ring appears (Material default)
- `(keydown.enter)` and `(keydown.space)` on the card host dispatch the same
  `photoSelected` output as a click, so keyboard users can open the detail view
- The `<img>` has `alt="Race photo for bib {bib}"` using the bib passed in from
  the grid parent; if multiple bibs are detected in the photo, the alt is
  "Race photo" (the component does not have bib-per-photo data — the bib context
  comes from the search, not from individual photo metadata)
- The Purchase button has `aria-label="Purchase photo"` as its visible label
  already communicates the action, but the aria-label adds photo context

### Angular Material components to use

- `MatCardModule` (`mat-card`, `mat-card-content`, `mat-card-actions`)
- `MatButtonModule` (stroked) for the Purchase button
- `MatIconModule` (`broken_image`) for the image error fallback

### NgRx integration

Fully presentational — no store access. Inputs and outputs:

- `@Input({ required: true }) photo: RunnerPhoto`
- `@Input({ required: true }) pricePerPhoto: number`
- `@Input({ required: true }) currency: string`
- `@Input() searchedBib: string` — used for the image `alt` attribute
- `@Output() photoSelected: EventEmitter<string>` — emits `photo.photoId`

---

## PhotoDetailComponent (`src/app/events/event-search/photo-detail/photo-detail.component.ts`)

### Purpose

Shows a large watermarked preview of the selected photo with the per-photo price
and a prominent "Purchase this photo" button that initiates the purchase flow
(RS-010). Rendered as a `MatDialog` overlay so the runner can dismiss it and
return to the grid without losing their search results.

### Layout

The dialog is opened by `EventSearchComponent` using `MatDialog.open()` when
`selectSelectedPhoto` returns a non-null value. The component is the dialog
content panel.

**Inside the dialog panel, top to bottom**:

1. **Close button**: a `MatIconButton` with `mat-icon` of `close` positioned in
   the top-right corner of the dialog header. Clicking it dispatches
   `RunnerPhotosActions.deselectPhoto()` and closes the dialog.
2. **Image area**: the watermarked photo rendered at maximum dialog width,
   maintaining the photo's natural aspect ratio. The image is not cropped — it
   letterboxes rather than covers to show the complete watermarked photo.
   Maximum image height is 60 vh so the price and CTA are always visible without
   scrolling on typical phone screens.
3. **Detail content area** (below the image):
   - Price line: "Price: {currency} {pricePerPhoto}" in `mat-title` typography
   - Subtitle line: "Watermark will be removed after purchase" in `mat-body-2`
     typography, secondary colour — this sets expectations about the preview state
4. **Action area** (below the content):
   - "Purchase this photo" `MatButton` (raised, primary colour, full panel width)
   - In v1 this button navigates to the purchase flow for RS-010; the exact
     navigation target is left for the RS-010 UX spec to define — dispatch
     `PurchasesActions.initiatePurchase({ photoId })` and let the effect handle routing

Dialog dimensions:
- Mobile (375px): `maxWidth: 100vw`, `width: 100%`, `position: bottom` (CDK
  bottom sheet behaviour via dialog configuration — see UX decision UX-D2)
- Desktop (1280px): `maxWidth: 720px`, `width: 90vw`, centred

### States

**Loading**: N/A — the dialog is only opened after a photo is already selected
from the loaded results. The `watermarkedUrl` is already known at open time.

**Empty**: N/A.

**Error — image load failure**: same pattern as `PhotoCardComponent` — replace
the image area with a `broken_image` icon at 64px on a light grey background.
The "Purchase this photo" button remains enabled since the image failure does not
prevent purchase.

**Success / default**: large watermarked image, price, watermark notice, and
Purchase CTA all visible.

### Responsive behaviour

**375px (mobile)**: the dialog slides up from the bottom of the screen, occupying
100% of the viewport width and up to 90% of the viewport height. The image fills
the full panel width. The close button is 48px x 48px (touch target). The
"Purchase this photo" button is full-width and 48px tall minimum.

**1280px (desktop)**: the dialog is centred in the viewport at `maxWidth: 720px`.
The image fills the panel width. The Purchase button follows standard Material
height (48px raised button with padding). The close button is in the top-right
corner of the dialog panel.

### Accessibility

- The dialog has `aria-labelledby` pointing to a visually hidden `<h2>` inside
  the panel that reads "Photo detail"
- Focus moves into the dialog when it opens (Material dialog handles this automatically)
- Focus returns to the triggering card when the dialog closes (Material handles this
  automatically when the dialog is closed with a reference to the opener element)
- The close button has `aria-label="Close photo detail"`
- The `<img>` has `alt="Large watermarked race photo"` — identical to the card alt
  is avoided here to distinguish the two contexts for screen reader users
- The "Purchase this photo" button does not need a separate `aria-label` — its
  visible text is sufficient

### Angular Material components to use

- `MatDialogModule` (`MatDialog` service to open, `MatDialogContent`,
  `MatDialogActions`) — do not use a CDK portal directly; use the Material
  dialog abstraction as specified in ADR-0006
- `MatButtonModule` (raised primary) for "Purchase this photo"
- `MatIconButton` + `MatIconModule` (`close`) for the dismiss button
- Dialog configuration: `{ panelClass: 'rs-photo-detail-dialog', autoFocus: 'first-tabbable', restoreFocus: true }`

### NgRx integration

`EventSearchComponent` owns dialog lifecycle — it opens the dialog when
`selectSelectedPhoto` emits a non-null value and closes it when `deselectPhoto`
is dispatched. `PhotoDetailComponent` itself is a pure content panel.

**If implemented as a standalone dialog content component** (preferred):
- `@Inject(MAT_DIALOG_DATA) data: { photo: RunnerPhoto; pricePerPhoto: number; currency: string }`
- Dispatches `PurchasesActions.initiatePurchase({ photoId: data.photo.photoId })` on Purchase button click
- Dispatches `RunnerPhotosActions.deselectPhoto()` on close button click (parent
  effect or the dialog `afterClosed()` subscription handles the actual `dialogRef.close()`)

---

## Route registration

Add to `app.routes.ts`:

```typescript
{
  path: 'events/:id',
  loadComponent: () =>
    import('./events/event-search/event-search.component').then(
      (m) => m.EventSearchComponent,
    ),
  providers: [
    provideState(runnerPhotosFeature),
    provideEffects(RunnerPhotosEffects),
  ],
}
```

No `canActivate` guard — this route is public (AC5).

---

## UX decisions not in the story ACs

The following decisions were made by the UX spec author and are not explicitly
stated in the story. Flag these for team review before build begins.

**UX-D1 — Bib number input validation pattern**  
The story does not specify bib number format. This spec assumes numeric-only,
1–6 digits (`^[0-9]{1,6}$`). If events permit alphanumeric bibs (e.g. "ELITE-7")
the pattern must be widened to `^[A-Za-z0-9-]{1,10}$`. Confirm with the PO.

**UX-D2 — Mobile photo detail as bottom sheet vs centred dialog**  
The story says "photo detail view" without specifying modal vs panel vs sheet. This
spec uses `MatDialog` for both breakpoints for implementation simplicity (one
component, one open call, CSS handles position). At 375px the dialog is configured
to appear at the bottom of the screen (via `position: { bottom: '0' }` in dialog
config) to feel native to mobile. An alternative is `MatBottomSheet` for mobile
only, but that would require two separate component registrations. Confirm whether
a bottom sheet is preferred at mobile.

**UX-D3 — Event header loaded independently of search**  
The story's AC5 says the event name, date, and location are shown when the page
loads — before any bib is searched. This spec dispatches `LoadEvent` on component
init and renders the header from that separate call. The search API (`GET
/events/{id}/photos/search`) also returns event metadata, so after the first
successful search the header data is refreshed from search results. This requires
the Angular route to also have access to the events API, separate from the
photos/search API. Confirm whether a separate event-fetch endpoint exists or
whether the header should rely entirely on the search response (meaning it would
only appear after a search).

**UX-D4 — "Purchase" button on the card opens the detail view, not the purchase flow directly**  
The story says the Purchase button on each card leads to the purchase flow (AC6)
and the detail view also has a "Purchase this photo" CTA (AC7). This spec treats
the card's Purchase button as opening the detail view, not jumping directly to
checkout, because AC7 implies the runner should see the large preview and price
before committing. This avoids a UX dead-end where the runner bypasses the preview.
Confirm this interpretation.

**UX-D5 — Bib form layout at desktop**  
The story says the form is full-width at 375px (AC9) but does not specify desktop
layout. This spec places the field and button side-by-side at 1280px (field 75%,
button 25%) to avoid an overly wide single-field form on large screens. This is
a common pattern for single-input search forms. Confirm or adjust the ratio.

**UX-D6 — Sorting order for photo grid**  
The story does not specify photo order. This spec sorts by `capturedAt` ascending
(earliest first), with un-timestamped photos at the end. This is a client-side
sort in the component, not an API concern. If the API returns photos in a
guaranteed order the sort can be removed.
