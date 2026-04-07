# UX Spec — RS-005: Event management (create, view, edit, archive, share)

**Story**: RS-005
**Persona**: Photographer — desktop-first power user, technically capable, manages multiple events
**Date**: 2026-04-06
**Status**: draft

---

## Overview

This spec covers five components delivered by RS-005:

1. `EventListComponent` — `/photographer/events` — replaces the existing `EventsPlaceholderComponent`
2. `EventCreateComponent` — `/photographer/events/new` — new-event form
3. `EventDetailComponent` — `/photographer/events/:id` — read-only event view with share section
4. `EventEditComponent` — `/photographer/events/:id/edit` — edit form pre-filled with event data
5. `EventArchiveDialogComponent` — `MatDialog` confirmation before archiving

All five components live inside the `PhotographerLayoutComponent` shell established in RS-004. They are all lazy-loaded behind `authGuard`. The `NavigationTitleService` pattern from RS-004 applies to every component — each calls `titleService.setTitle(...)` in `ngOnInit`.

The existing `EventsPlaceholderComponent` at `src/app/features/photographer/events-placeholder/` is replaced entirely by `EventListComponent`. The router entry for `path: 'events'` is updated to point to the new component; the child routes `events/new`, `events/:id`, and `events/:id/edit` are added.

---

## Status badge design

A status badge appears on both the event list row and the event detail page. It uses `MatChip` in display-only mode (not selectable).

**Active** — `MatChip` with:
- Background: `var(--mat-sys-tertiary-container)`
- Text colour: `var(--mat-sys-on-tertiary-container)`
- Leading icon: `radio_button_checked` (filled circle, 18px)
- Label text: "Active"
- `aria-label="Status: Active"` on the chip host element

**Archived** — `MatChip` with:
- Background: `var(--mat-sys-surface-variant)`
- Text colour: `var(--mat-sys-on-surface-variant)`
- Leading icon: `archive` (18px)
- Label text: "Archived"
- `aria-label="Status: Archived"` on the chip host element

The icon is always present alongside the colour so that status is never communicated by colour alone. Both chip variants use `MatChipsModule` with `appearance="outlined"` suppressed — styling is applied via a single SCSS mixin that reads from the M3 theme tokens above, defined in a shared `_chips.scss` partial imported by the feature SCSS.

---

## Component 1 — `EventListComponent`

**Path**: `src/app/features/photographer/events/event-list/event-list.component.ts`
**Route**: `/photographer/events`

### Purpose

Displays all of the authenticated photographer's events — active and archived — in a data table sorted by creation date descending, and provides entry points to create a new event or navigate into an existing one.

### Layout — 1280px (desktop)

The component renders inside the `PhotographerLayoutComponent` content area. Max content width: `960px`, left-aligned with `24px` top and horizontal padding.

Structure top to bottom:

1. **Page header row**: `display: flex`, `align-items: center`, `justify-content: space-between`, `margin-bottom: 24px`.
   - Left: heading "My Events" in `mat-headline-small`.
   - Right: "Create Event" primary button — `mat-flat-button` with `add` icon prefix. Navigates to `/photographer/events/new`.

2. **Filter chip row** (below the header, `margin-bottom: 16px`): A horizontal row of `MatChipListbox` (single-select, not a form field). Three filter options:
   - "All" (default selected)
   - "Active"
   - "Archived"
   Selecting a filter updates a local `filter` signal. The table rows are filtered client-side from the NgRx `selectAllEvents` selector output. No extra API call is made.

3. **Data table** — `MatTable` with `mat-sort` enabled on the Name and Date columns.

   Table columns in order:

   | Column header | Binding | Notes |
   |---|---|---|
   | Name | `event.name` | Text link (`routerLink`) to `/photographer/events/:id` in `mat-body-medium` |
   | Date | `event.date` | ISO 8601 date formatted via Angular `DatePipe` as `'mediumDate'` (e.g. "Apr 6, 2026") |
   | Location | `event.location` | Plain text |
   | Price | `event.pricePerPhoto` with `event.currency` | Formatted as `{currency} {pricePerPhoto}` (e.g. "USD 10.00") — no currency pipe needed, the API returns the value as a number; format with `DecimalPipe('1.2-2')` |
   | Status | Status badge component | The inline badge described in the "Status badge design" section above |
   | Actions | Icon buttons | `mat-icon-button` with `edit` icon (navigates to `/:id/edit`) and `archive` icon (opens `EventArchiveDialogComponent`) — the archive icon button is hidden (`display: none`) when `event.status === 'archived'` |

   Row click (anywhere except the action buttons) also navigates to `/:id`. Use `(click)` on the `<tr mat-row>` with a guard that checks the click target does not originate from an action button.

4. **Pagination**: `MatPaginator` below the table. Page size: 20 (matches API default). Since the API uses cursor-based pagination (AC6), the `MatPaginator` is configured with `hidePageSize="true"` and only Next / Previous controls are shown. The `nextCursor` value from the store drives the Next button's disabled state — if `nextCursor` is null, the Next button is disabled.

### Layout — 375px (mobile)

- The "Create Event" button collapses to a `mat-mini-fab` (`add` icon, no label) fixed at the bottom-right of the viewport: `position: fixed; bottom: 24px; right: 24px; z-index: 100`. `aria-label="Create new event"`.
- The page header row shows only the heading. The button is removed from the header row.
- The filter chip row scrolls horizontally (overflow-x auto, no wrapping).
- The `MatTable` drops the Location and Price columns. Only Name, Date, Status, and Actions columns remain.
- The Actions column shows only the `edit` icon button. The `archive` icon button is hidden on mobile; archiving must be done from the detail page.
- `MatPaginator` shows only page navigation arrows, no labels.

### States

**Loading**: On `ngOnInit` the component dispatches `EventsActions.loadEvents()`. While `selectEventsLoading === true`:
- The table is replaced by a column of five `MatProgressBar` shimmer rows. Each shimmer row is a `<div>` with `height: 52px`, `margin-bottom: 2px`, and a `loading-shimmer` CSS animation using `var(--mat-sys-surface-variant)` (same pattern as RS-004 profile shimmer).
- The "Create Event" button is `[disabled]="true"`.
- The filter chips are `[disabled]="true"`.

**Empty (API returned an empty array)**: The table body is replaced by an empty-state block centred vertically in the table area:
- Icon: `event_note` in `72px` size, `var(--mat-sys-on-surface-variant)`.
- Primary text: "No events yet" in `mat-title-medium`.
- Secondary text: "Create your first event to start sharing photos with runners." in `mat-body-medium`, `var(--mat-sys-on-surface-variant)`.
- A "Create Event" `mat-flat-button` centred below the text, navigating to `/photographer/events/new`.

**Error**: When `selectEventsError` is non-null:
- The table body is replaced by an error block centred vertically in the table area:
  - Icon: `error_outline` in `72px` size, `var(--mat-sys-error)`.
  - Primary text: "Could not load your events." in `mat-title-medium`.
  - "Retry" `mat-stroked-button` below — clicking it dispatches `EventsActions.loadEvents()`.
- The "Create Event" button remains enabled (the photographer can still attempt to create).

**Populated (default)**: The table renders with rows. Active and archived events coexist; the filter chips allow narrowing. The "Create Event" button is enabled.

### Responsive behaviour summary

| Element | 375px | 1280px |
|---|---|---|
| "Create Event" button | Fixed `mat-mini-fab` bottom-right | `mat-flat-button` in page header |
| Table columns | Name, Date, Status, Actions | All six columns |
| Archive icon in Actions | Hidden | Visible when status is active |
| Filter chips | Horizontally scrollable | Wrappable row |
| Paginator labels | Hidden | Visible |

### Accessibility

- The `MatTable` has `aria-label="My events"`.
- `MatSort` headers are standard `<th>` elements — Material provides `aria-sort` automatically.
- Each action button carries an explicit `aria-label`: `aria-label="Edit {{event.name}}"` and `aria-label="Archive {{event.name}}"`.
- The status badge chip has `aria-label="Status: Active"` or `aria-label="Status: Archived"` as described in the badge section.
- The filter `MatChipListbox` has `aria-label="Filter events by status"`.
- The fixed FAB on mobile has `aria-label="Create new event"`.
- Row click navigation via `(click)` on `<tr>` must add `tabindex="0"` and a `(keydown.enter)` handler on the row so keyboard users can activate it without reaching the Name link column.
- Focus after dialog close (archive dialog): `MatDialog` returns focus to the element that opened it — the archive icon button. Verify `MatDialog` `restoreFocus` option is `true` (default).

### Angular Material components

- `MatTableModule` — data table
- `MatSortModule` — sortable column headers
- `MatPaginatorModule` — pagination controls
- `MatButtonModule` — `mat-flat-button`, `mat-icon-button`, `mat-stroked-button`, `mat-mini-fab`
- `MatIconModule` — add, edit, archive, event_note, error_outline icons
- `MatChipsModule` — status badge chips, filter chips (`MatChipListbox`)
- `MatProgressBarModule` — loading shimmer rows
- `MatDialogModule` — opens `EventArchiveDialogComponent`

### NgRx integration

**Selectors consumed**:

| Selector | Purpose |
|---|---|
| `selectAllEvents` | Populates the table data source |
| `selectEventsLoading` | Controls loading shimmer |
| `selectEventsError` | Controls error state |
| `selectNextCursor` | Controls paginator Next button disabled state |

**Actions dispatched**:

| User event | Action |
|---|---|
| Component initialises (`ngOnInit`) | `EventsActions.loadEvents()` |
| Paginator Next clicked | `EventsActions.loadEvents({ cursor: nextCursor })` |
| Paginator Previous clicked | `EventsActions.loadEventsPreviousPage()` — see UX decision UX-D1 |
| Archive icon button clicked | Opens `EventArchiveDialogComponent` — dialog result dispatches `EventsActions.archiveEvent({ id })` |
| Retry button clicked | `EventsActions.loadEvents()` |

---

## Component 2 — `EventCreateComponent`

**Path**: `src/app/features/photographer/events/event-create/event-create.component.ts`
**Route**: `/photographer/events/new`

### Purpose

Provides a form for the photographer to create a new event with name, date, location, per-photo price, currency, and optional watermark text. On success, navigates to the new event's detail page.

### Layout — 1280px (desktop)

The component renders inside the `PhotographerLayoutComponent` content area. Max content width: `720px`, left-aligned with `24px` top and horizontal padding.

Structure top to bottom:

1. **Page heading**: "Create Event" in `mat-headline-small`. `24px` bottom margin.

2. **Form** (`ReactiveFormsModule`, single `FormGroup` named `eventForm`). All fields use `MatFormField` with `appearance="outline"`.

   Fields in tab order:

   | Field | Label | Type | Required | Validators |
   |---|---|---|---|---|
   | `name` | "Event name" | text | Yes | `required`, `maxLength(200)` |
   | `date` | "Event date" | `MatDatepicker` | Yes | `required`, must be a valid date |
   | `location` | "Location" | text | Yes | `required`, `maxLength(200)` |
   | `pricePerPhoto` | "Price per photo" | number input | Yes | `required`, `min(0.01)`, `pattern('^[0-9]+(\.[0-9]{1,2})?$')` |
   | `currency` | "Currency" | `MatSelect` | Yes | `required` |
   | `watermarkText` | "Watermark text" | text | No | `maxLength(200)` |

   The `currency` `MatSelect` uses the same curated currency list constant established in RS-004 `ProfileComponent` (USD, EUR, GBP, GTQ, MXN, CAD, AUD, BRL). Pre-selected to the photographer's `defaultCurrency` from the photographer profile store, falling back to "USD". The constant must be defined once in a shared `currencies.constants.ts` file imported by both `ProfileComponent` and `EventCreateComponent`.

   The `watermarkText` field has a hint text: `"Default: {event name} · racephotos.example.com"`. The hint updates reactively as the photographer types in the `name` field — it reads `eventForm.get('name').value` via an `AsyncPipe` or a signal derived from `valueChanges`. If `name` is empty the hint shows: `"Default: {Event name} · racephotos.example.com"` with `{Event name}` as literal placeholder text.

   The `pricePerPhoto` field has a prefix in the form field: the selected `currency` code (e.g. "USD"). This prefix updates when the currency selection changes.

3. **Action row**: `display: flex`, `justify-content: flex-end`, `gap: 16px`, `margin-top: 24px`.
   - "Cancel" — `mat-stroked-button` — navigates back to `/photographer/events`.
   - "Create Event" — `mat-flat-button` (primary) — submits the form.

### Layout — 375px (mobile)

- Max content width removed; full bleed with `16px` horizontal padding from the layout shell.
- All form fields remain single-column full-width.
- The action row becomes `flex-direction: column-reverse` — "Create Event" on top, "Cancel" below. Both buttons full-width.
- The date picker uses `MatDatepicker` in touch mode (`[touchUi]="isMobile"` using the same `BreakpointObserver` signal pattern from `PhotographerLayoutComponent`).

### Form fields — error messages

All errors appear via `mat-error` inside the `MatFormField`. They are shown only after the field is touched or after a failed submit attempt sets all controls to touched.

| Field | Condition | Message |
|---|---|---|
| `name` | Required | "Event name is required." |
| `name` | Too long | "Event name must be 200 characters or fewer." |
| `date` | Required | "Event date is required." |
| `date` | Invalid date | "Enter a valid date." |
| `location` | Required | "Location is required." |
| `location` | Too long | "Location must be 200 characters or fewer." |
| `pricePerPhoto` | Required | "Price per photo is required." |
| `pricePerPhoto` | Zero or negative | "Price must be greater than zero." |
| `pricePerPhoto` | Invalid format | "Enter a valid price (e.g. 10.00)." |
| `currency` | Required | "Please select a currency." |
| `watermarkText` | Too long | "Watermark text must be 200 characters or fewer." |

### States

**Default (initial load)**: The form renders with all fields empty except `currency` pre-filled from the photographer profile. No error messages shown. The "Create Event" button is enabled.

**Loading (photographer profile not yet loaded)**: While `selectProfileLoading === true`, the `currency` field shows a `MatProgressSpinner` (`diameter="16"`) inline in the select trigger area and the `MatSelect` is `[disabled]="true"`. All other fields are enabled — the photographer can start filling in the form. The `currency` field unlocks once the profile loads.

**Submitting**: After "Create Event" is clicked with a valid form:
- `EventsActions.createEvent({ event: formValue })` is dispatched.
- The "Create Event" button text is replaced by `MatProgressSpinner` (`diameter="20"`) and `[disabled]="true"` is applied.
- All form fields become `[readonly]="true"`.
- "Cancel" is `[disabled]="true"`.

**Error (API failure)**: When `selectEventsError` is non-null and the component is in submitting state:
- `MatSnackBar` opens at bottom-centre.
- If the error message from the API indicates a 400: "Some event details are invalid. Please check the form and try again." Duration: `6000ms`. No action button.
- For other errors: "Could not create the event. Please try again." Duration: `6000ms`. No action button.
- All form fields return to editable. The "Create Event" button returns to its normal state. The form values are preserved (not reset).

**Success**: When `EventsActions.createEventSuccess` fires:
- The effect navigates to `/photographer/events/{newEvent.id}`.
- No snackbar is needed — the navigation to the new detail page is sufficient confirmation.

### Accessibility

- The form has `aria-label="Create event form"`.
- `MatFormField` error messages link to inputs via `aria-describedby` automatically.
- The `MatDatepicker` input has `aria-label="Event date"`.
- The `pricePerPhoto` input has `aria-label="Price per photo"` and `aria-describedby` pointing to the currency prefix element.
- The `MatSelect` for currency has `aria-label="Currency"`.
- On form submit with validation errors, focus is programmatically moved to the first invalid field.
- Touch targets for all interactive elements meet the 48px minimum.

### Angular Material components

- `MatFormFieldModule` with `appearance="outline"`
- `MatInputModule`
- `MatSelectModule` — currency dropdown
- `MatDatepickerModule` + `MatNativeDateModule` — event date picker
- `MatButtonModule` — `mat-flat-button`, `mat-stroked-button`
- `MatProgressSpinnerModule` — submitting state and currency field loading
- `MatSnackBarModule` — error toast

### NgRx integration

**Selectors consumed**:

| Selector | Purpose |
|---|---|
| `selectProfile` | Pre-fills `currency` field with `defaultCurrency` |
| `selectProfileLoading` | Controls currency field loading state |
| `selectEventsLoading` | Controls submitting state (true while `createEvent` is in flight) |
| `selectEventsError` | Triggers error snackbar |

**Actions dispatched**:

| User event | Action |
|---|---|
| Form submitted (valid) | `EventsActions.createEvent({ event: formValue })` |
| Navigation to `/events` on success | Dispatched from `EventsEffects.createEvent$` — not the component |

---

## Component 3 — `EventDetailComponent`

**Path**: `src/app/features/photographer/events/event-detail/event-detail.component.ts`
**Route**: `/photographer/events/:id`

### Purpose

Displays the full details of a single event, provides action buttons for editing, archiving, and uploading photos, and renders a share section with the public event URL and a client-side QR code.

### Layout — 1280px (desktop)

The component renders inside the `PhotographerLayoutComponent` content area. Max content width: `960px`, left-aligned with `24px` top and horizontal padding.

Structure top to bottom:

1. **Page header row**: `display: flex`, `align-items: flex-start`, `justify-content: space-between`, `margin-bottom: 24px`.
   - Left: event name in `mat-headline-small`, with the status badge (`MatChip`) immediately to its right, vertically centred with the text baseline using `align-items: center` and `gap: 12px`.
   - Right: action buttons in a horizontal row with `gap: 8px`:
     - "Edit" — `mat-stroked-button` with `edit` icon prefix — navigates to `/:id/edit`.
     - "Archive" — `mat-stroked-button` with `archive` icon prefix — opens `EventArchiveDialogComponent`. Hidden (`*ngIf`) when `event.status === 'archived'`.

2. **Details card** — `MatCard` with `appearance="outlined"`, `margin-bottom: 24px`.
   - Card header: `mat-title-medium` text "Event Details". No `MatCardHeader` component — use a plain `<h2>` with the typography class inside `mat-card-content`.
   - Two-column grid inside the card (`display: grid; grid-template-columns: 1fr 1fr; gap: 16px 32px`):

   | Label | Value | Binding |
   |---|---|---|
   | "Date" | Formatted via `DatePipe` `'longDate'` | `event.date` |
   | "Location" | Plain text | `event.location` |
   | "Price per photo" | `{currency} {pricePerPhoto}` | `event.pricePerPhoto`, `event.currency` |
   | "Currency" | ISO 4217 code | `event.currency` |
   | "Watermark text" | Plain text | `event.watermarkText` |
   | "Created" | `DatePipe` `'medium'` | `event.createdAt` |

   Each label is in `mat-body-small`, `var(--mat-sys-on-surface-variant)`. Each value is in `mat-body-medium`, `var(--mat-sys-on-surface)`.

3. **Links row**: Two `mat-flat-button` links side by side with `gap: 16px`.
   - "Upload Photos" — navigates to `/photographer/events/:id/upload` (RS-006 route, not yet implemented — use `[disabled]="true"` with `aria-label="Upload photos — coming soon"` until RS-006 is merged).
   - "View Photos" — navigates to `/photographer/events/:id/photos` (RS-008 route — same disabled treatment until RS-008 is merged).
   Both buttons have their respective icons: `upload` and `photo_library`.

4. **Share section** — `MatCard` with `appearance="outlined"`.
   - Card heading: `mat-title-medium` "Share with Runners" in a row with a `share` icon to its left.
   - Below the heading: supporting text in `mat-body-small`, `var(--mat-sys-on-surface-variant)`: "Share this link or QR code with runners so they can search for their photos."
   - **Two-column layout** inside the card (`display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: start`):
     - **Left column — URL section**:
       - Label "Public URL" in `mat-body-small`, `var(--mat-sys-on-surface-variant)`.
       - A read-only `MatFormField` `appearance="outline"` containing the public event URL string `/events/{id}` — the full absolute URL is derived by the component using `AppConfigService.publicBaseUrl + '/events/' + event.id`. The input is `[readonly]="true"` and `[value]="publicUrl"`.
       - A "Copy link" `mat-stroked-button` with `content_copy` icon below the field. On click, it calls `navigator.clipboard.writeText(publicUrl)` and then shows a `MatSnackBar` with message "Link copied to clipboard." (2000ms, no action). The button temporarily changes its label to "Copied!" and icon to `check` for 2 seconds using a local signal, then reverts.
     - **Right column — QR code**:
       - `<qrcode>` component from `angularx-qrcode`. Props: `[qrdata]="publicUrl"`, `[width]="200"`, `[errorCorrectionLevel]="'M'"`, `[margin]="1"`. No server call — rendered entirely client-side per AC11.
       - Below the QR code: a `mat-stroked-button` "Download QR" with `download` icon. On click, the component programmatically retrieves the `<canvas>` element rendered by `angularx-qrcode` and calls `.toDataURL('image/png')` to trigger a download as `racephotos-event-{event.id}.png`. This is a synchronous client-side operation — no Lambda call.
       - `alt` text for the QR code region: `aria-label="QR code for event {{event.name}} public URL"` on the wrapping `<figure>` element.

### Layout — 375px (mobile)

- The page header row stacks vertically: event name + badge on top, action buttons below (full-width `mat-stroked-button` each, stacked with `gap: 8px`).
- The details card uses a single-column layout (grid changes to `grid-template-columns: 1fr`).
- The links row stacks vertically — each button full-width.
- The share section uses a single-column layout — URL section on top, QR code below centred horizontally. The QR code width reduces to `160`.
- The "Download QR" button sits below the QR code, full-width.

### States

**Loading**: On `ngOnInit` the component dispatches `EventsActions.loadEvent({ id })` reading `id` from `ActivatedRoute.paramMap`. While `selectEventsLoading === true`:
- The entire component body below the page header row is replaced by a single centred `MatProgressSpinner` (`diameter="48"`, `mode="indeterminate"`).
- The page header row shows only the page title placeholder text "Loading event…" with no action buttons.

**Error**: When `selectEventsError` is non-null after a `loadEventFailure`:
- If the error is a 404: show a centred `MatCard` with icon `event_busy` (`72px`, `var(--mat-sys-error)`), text "Event not found.", and a `mat-stroked-button` "Back to My Events" navigating to `/photographer/events`.
- For other errors: show the same card layout with text "Could not load this event." and a "Retry" `mat-stroked-button` dispatching `EventsActions.loadEvent({ id })`.

**Success (default)**: The full layout described above renders with event data bound from `selectSelectedEvent`.

**Post-archive**: When `EventsActions.archiveEventSuccess` fires while this component is active:
- The NgRx store updates `selectedEvent.status` to `"archived"`.
- The component re-renders from the store: the "Archive" button disappears (driven by `*ngIf`), the status badge updates to "Archived". No navigation occurs — the detail page stays loaded per AC10.
- A `MatSnackBar` opens: "Event archived. It is no longer visible in the public listing." Duration: `5000ms`. No action button.

### Accessibility

- The event name heading has a unique `id` so the `<main>` content area can be labelled by it via `aria-labelledby`.
- The "Archive" button has `aria-label="Archive event {{event.name}}"`.
- The "Edit" button has `aria-label="Edit event {{event.name}}"`.
- The public URL field has `aria-label="Public event URL"` and `aria-readonly="true"`.
- The copy button has `aria-label="Copy event link to clipboard"` and `aria-live="polite"` on a visually-hidden adjacent span that announces "Copied!" after the click.
- The QR code `<figure>` has `aria-label="QR code for event {{event.name}} public URL"` and `role="img"`. Screen readers do not need to interact with the canvas — the URL is already available in the adjacent read-only field.
- The "Download QR" button has `aria-label="Download QR code as PNG image"`.
- The "Upload Photos" and "View Photos" disabled buttons use `aria-disabled="true"` in addition to `[disabled]` for screen reader compatibility.

### Angular Material components

- `MatCardModule` — details card, share card, error card
- `MatButtonModule` — `mat-stroked-button`, `mat-flat-button`
- `MatIconModule` — all icons
- `MatChipsModule` — status badge
- `MatProgressSpinnerModule` — loading state
- `MatSnackBarModule` — copy-to-clipboard confirmation, post-archive toast
- `QRCodeModule` from `angularx-qrcode`

### NgRx integration

**Selectors consumed**:

| Selector | Purpose |
|---|---|
| `selectSelectedEvent` | Populates all event data fields |
| `selectEventsLoading` | Controls loading spinner |
| `selectEventsError` | Controls error state |

**Actions dispatched**:

| User event | Action |
|---|---|
| Component initialises | `EventsActions.loadEvent({ id: routeId })` |
| "Archive" button clicked | Opens `EventArchiveDialogComponent` |
| Dialog confirmed | `EventsActions.archiveEvent({ id: event.id })` dispatched by dialog |
| Retry button clicked (error state) | `EventsActions.loadEvent({ id: routeId })` |

---

## Component 4 — `EventEditComponent`

**Path**: `src/app/features/photographer/events/event-edit/event-edit.component.ts`
**Route**: `/photographer/events/:id/edit`

### Purpose

Provides a pre-filled form for editing the mutable fields of an existing event. On success, navigates back to the event detail page.

### Layout — 1280px (desktop)

Layout mirrors `EventCreateComponent`. Max content width: `720px`, left-aligned with `24px` top and horizontal padding.

Structure top to bottom:

1. **Page heading**: "Edit Event" in `mat-headline-small`. `24px` bottom margin. Directly below in `mat-body-medium`, `var(--mat-sys-on-surface-variant)`: the event name in italics — read-only context identifier, e.g. "Editing: Guatemala City Half Marathon 2026". This text is not editable.

2. **Form** — identical field set to `EventCreateComponent`, with the same validators and error messages. All fields are pre-populated from `selectSelectedEvent` on init.

3. **Action row**: `display: flex`, `justify-content: flex-end`, `gap: 16px`, `margin-top: 24px`.
   - "Cancel" — `mat-stroked-button` — resets the form to the last saved values and navigates to `/photographer/events/:id`.
   - "Save changes" — `mat-flat-button` (primary) — submits the form.

### Layout — 375px (mobile)

Same as `EventCreateComponent` mobile layout. Action row stacks `column-reverse` with full-width buttons.

### Form pre-population

On `ngOnInit`, if `selectSelectedEvent` is non-null, the component calls `form.patchValue(selectedEvent)` immediately. If `selectSelectedEvent` is null (direct navigation to the URL without a prior detail load), the component dispatches `EventsActions.loadEvent({ id: routeId })` and waits for the store to populate — during this window the loading state described below is active.

The `date` field requires special handling: the API returns `date` as an ISO 8601 string. The `MatDatepicker` `FormControl` must hold a `Date` object. The component converts the string to a `Date` on patch and back to ISO 8601 on submit using a utility function `isoStringToDate(s: string): Date` and `dateToIsoString(d: Date): string` defined in a local `date-utils.ts` file inside the events feature folder.

### States

**Loading (event data not yet in store)**: Same spinner pattern as `EventDetailComponent` loading state — the form area is replaced by a centred `MatProgressSpinner` (`diameter="48"`).

**Submitting**: Same as `EventCreateComponent` submitting state. The "Save changes" button shows an inline spinner.

**Error (API failure on save)**: Same snackbar pattern as `EventCreateComponent` error state. Messages:
- 400 response: "Some event details are invalid. Please check the form and try again." Duration `6000ms`.
- 403 response: "You don't have permission to edit this event." Duration `6000ms`.
- Other: "Could not save changes. Please try again." Duration `6000ms`.

**Success**: When `EventsActions.updateEventSuccess` fires, the effect navigates to `/photographer/events/:id`. A `MatSnackBar` is opened by the effect (not the component) with message "Event updated successfully." Duration `4000ms`.

### Accessibility

- The form has `aria-label="Edit event form"`.
- The context identifier text ("Editing: {event name}") has `role="status"` so screen readers read it on page load.
- All other accessibility requirements are identical to `EventCreateComponent`.

### Angular Material components

Identical to `EventCreateComponent`:
- `MatFormFieldModule`, `MatInputModule`, `MatSelectModule`, `MatDatepickerModule`, `MatNativeDateModule`, `MatButtonModule`, `MatProgressSpinnerModule`, `MatSnackBarModule`

### NgRx integration

**Selectors consumed**:

| Selector | Purpose |
|---|---|
| `selectSelectedEvent` | Pre-fills the form |
| `selectEventsLoading` | Controls loading spinner |
| `selectEventsError` | Controls error snackbar |

**Actions dispatched**:

| User event | Action |
|---|---|
| Component initialises (event not in store) | `EventsActions.loadEvent({ id: routeId })` |
| Form submitted (valid) | `EventsActions.updateEvent({ id: routeId, event: formValue })` |
| "Cancel" clicked | No action — `form.reset(originalValues)`, then `router.navigate(['/photographer/events', routeId])` |

---

## Component 5 — `EventArchiveDialogComponent`

**Path**: `src/app/features/photographer/events/event-archive-dialog/event-archive-dialog.component.ts`
**Usage**: opened via `MatDialog.open()` from both `EventListComponent` and `EventDetailComponent`

### Purpose

Presents a confirmation dialog before archiving an event, explaining the consequence (the event is removed from the public listing but remains accessible via direct link), and requires an explicit confirm action.

### Layout

The dialog is a standard `MatDialog` with a max width of `480px` and no custom panel class required.

Structure top to bottom inside the dialog:

1. **Dialog title** (`mat-dialog-title`): "Archive event?" — `mat-title-large`.

2. **Dialog content** (`mat-dialog-content`):
   - A short paragraph in `mat-body-medium`:
     "Archiving **{event.name}** will remove it from the public event listing. Runners who already have the direct link can still find their photos. This action cannot be undone."
     The event name is bolded using `<strong>` — it is injected via `MAT_DIALOG_DATA`.
   - A second short paragraph in `mat-body-small`, `var(--mat-sys-on-surface-variant)`:
     "You can still view and share this event's direct link after archiving."

3. **Dialog actions** (`mat-dialog-actions`, `align="end"`):
   - "Cancel" — `mat-stroked-button` — `[mat-dialog-close]="false"`. Label: "Cancel".
   - "Archive" — `mat-flat-button` with background using `var(--mat-sys-error)` and text `var(--mat-sys-on-error)` (this is a destructive action — use the error role colour, not the primary). `[mat-dialog-close]="true"`. Label: "Archive event".
   - The "Archive event" button shows a `MatProgressSpinner` (`diameter="20"`) and is `[disabled]="true"` while `selectEventsLoading === true` after confirmation (the caller component listens for the dialog close result and dispatches the action; the dialog itself does not dispatch).

### Dialog data

Injected via `MAT_DIALOG_DATA`:
```typescript
interface ArchiveDialogData {
  eventId: string;
  eventName: string;
}
```

### Dialog result

The dialog returns a `boolean` via `MatDialogRef.close(result)`:
- `true` — user confirmed archive
- `false` or `undefined` — user cancelled (backdrop click, Escape, or Cancel button)

The caller component (`EventListComponent` or `EventDetailComponent`) subscribes to `dialogRef.afterClosed()` and dispatches `EventsActions.archiveEvent({ id: data.eventId })` only when the result is `true`.

### States

**Default**: The dialog renders with event name and action buttons. No loading state within the dialog itself — the loading state is handled by the buttons in the caller component (the archive icon button in the list or the Archive button in the detail).

**N/A states**: The dialog does not have its own loading, empty, or error states. If the archive API call fails after the dialog closes, the caller component surfaces the error via `MatSnackBar`.

### Responsive behaviour

- At 375px, `MatDialog` renders as a bottom sheet by default in M3 — `MatDialog` in Angular Material 17 does not automatically do this, so the component must detect mobile and use `MatBottomSheet` instead (see UX decision UX-D2 below).
- At 1280px, the dialog renders centred as specified above.

### Accessibility

- `mat-dialog-title` is automatically linked to the dialog panel via `aria-labelledby` by `MatDialog`.
- `mat-dialog-content` is automatically linked via `aria-describedby`.
- The "Cancel" button is the first focusable element — `cdkFocusInitial` is applied to it so focus does not land on the destructive action by default.
- The "Archive event" button has `aria-label="Confirm archive event {{eventName}}"` to distinguish it from other archive buttons that may exist in the page behind the overlay.
- Pressing Escape closes the dialog with result `false` — this is `MatDialog` default behaviour and must not be overridden.

### Angular Material components

- `MatDialogModule` — `mat-dialog-title`, `mat-dialog-content`, `mat-dialog-actions`, `MAT_DIALOG_DATA`, `MatDialogRef`
- `MatButtonModule` — `mat-stroked-button`, `mat-flat-button`
- `MatProgressSpinnerModule` — button loading state

### NgRx integration

The dialog component itself does not interact with NgRx. It receives data via `MAT_DIALOG_DATA` and returns a boolean result. All NgRx dispatch happens in the caller.

---

## Events NgRx slice additions

The existing `events.actions.ts` is a stub with only `loadEvents`, `loadEventsSuccess`, and `loadEventsFailure`. RS-005 requires the full action set listed in the story tech notes.

### Required actions (extend `EventsActions` `createActionGroup`)

| Action | Props |
|---|---|
| `loadEvents` | `cursor?: string` (optional, for pagination) |
| `loadEventsSuccess` | `events: Event[], nextCursor: string \| null` |
| `loadEventsFailure` | `error: string` |
| `loadEvent` | `id: string` |
| `loadEventSuccess` | `event: Event` |
| `loadEventFailure` | `error: string` |
| `createEvent` | `event: CreateEventRequest` |
| `createEventSuccess` | `event: Event` |
| `createEventFailure` | `error: string` |
| `updateEvent` | `id: string, event: UpdateEventRequest` |
| `updateEventSuccess` | `event: Event` |
| `updateEventFailure` | `error: string` |
| `archiveEvent` | `id: string` |
| `archiveEventSuccess` | `event: Event` |
| `archiveEventFailure` | `error: string` |

### State shape (`events.reducer.ts`)

```typescript
interface EventsState {
  events: Event[];
  selectedEvent: Event | null;
  loading: boolean;
  error: string | null;
  nextCursor: string | null;
}
```

### Selectors (`events.selectors.ts`)

- `selectAllEvents` — `state.events`
- `selectSelectedEvent` — `state.selectedEvent`
- `selectEventsLoading` — `state.loading`
- `selectEventsError` — `state.error`
- `selectNextCursor` — `state.nextCursor`

### Event model (`src/app/features/photographer/events/event.model.ts`)

```typescript
export interface Event {
  id: string;
  photographerId: string;
  name: string;
  date: string;          // ISO 8601
  location: string;
  pricePerPhoto: number;
  currency: string;      // ISO 4217
  watermarkText: string;
  status: 'active' | 'archived';
  visibility: 'public' | 'unlisted';
  archivedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEventRequest {
  name: string;
  date: string;
  location: string;
  pricePerPhoto: number;
  currency?: string;
  watermarkText?: string;
}

export interface UpdateEventRequest extends Partial<CreateEventRequest> {}
```

---

## Shared constants

### `currencies.constants.ts`

Define one shared constants file at `src/app/features/photographer/shared/currencies.constants.ts`. Both `EventCreateComponent`/`EventEditComponent` and the existing `ProfileComponent` import from this path. The RS-004 spec did not create this file — the build agent must refactor `ProfileComponent` to import from this shared constant instead of its own local definition.

---

## Toast / SnackBar placement summary

All `MatSnackBar` instances use Angular Material default positioning: bottom-centre on desktop, bottom full-width on mobile.

| Component | Trigger | Message | Duration | Action |
|---|---|---|---|---|
| `EventListComponent` | `archiveEventSuccess` | "Event archived." | 3000ms | None |
| `EventListComponent` | `loadEventsFailure` (retry context) | "Could not load your events." | 6000ms | "Retry" |
| `EventCreateComponent` | `createEventFailure` (400) | "Some event details are invalid. Please check the form and try again." | 6000ms | None |
| `EventCreateComponent` | `createEventFailure` (other) | "Could not create the event. Please try again." | 6000ms | None |
| `EventDetailComponent` | `archiveEventSuccess` | "Event archived. It is no longer visible in the public listing." | 5000ms | None |
| `EventDetailComponent` | `archiveEventFailure` | "Could not archive the event. Please try again." | 6000ms | None |
| `EventDetailComponent` | Copy link clicked | "Link copied to clipboard." | 2000ms | None |
| `EventEditComponent` | `updateEventSuccess` (via effect) | "Event updated successfully." | 4000ms | None |
| `EventEditComponent` | `updateEventFailure` (400) | "Some event details are invalid. Please check the form and try again." | 6000ms | None |
| `EventEditComponent` | `updateEventFailure` (403) | "You don't have permission to edit this event." | 6000ms | None |
| `EventEditComponent` | `updateEventFailure` (other) | "Could not save changes. Please try again." | 6000ms | None |

---

## Colour and typography token reference (additions to RS-004)

All tokens listed in RS-004 remain valid. The following are used additionally in RS-005:

**Colour roles**:
- `var(--mat-sys-tertiary-container)` — active status badge background
- `var(--mat-sys-on-tertiary-container)` — active status badge text and icon
- `var(--mat-sys-error)` — archive button fill (destructive action), error icon
- `var(--mat-sys-on-error)` — archive button text (on error-coloured background)

**Typography**:
- `mat-headline-small` — page headings (My Events, Create Event, Edit Event, event name on detail)
- `mat-title-large` — dialog title
- `mat-title-medium` — card section headings (Event Details, Share with Runners)
- `mat-body-medium` — table cell text, detail field values, dialog body
- `mat-body-small` — table column sub-labels, detail field labels, hint text, secondary text

---

## UX decisions not in the story ACs (requires team review)

**UX-D1 — Previous page pagination**: AC6 specifies cursor-based pagination with a `nextCursor` field but does not mention how previous-page navigation works. Cursor pagination typically does not support backwards navigation without a cursor stack. The spec introduces a `loadEventsPreviousPage` action backed by a cursor stack maintained in the store (an array of previously seen cursors). The build agent must implement the cursor stack in `EventsState` as `cursorHistory: string[]`. Review with the PO whether backward pagination is required in v1 or if Next-only is acceptable.

**UX-D2 — Archive confirmation as `MatBottomSheet` on mobile**: `MatDialog` at 375px renders as a centred modal, which is ergonomically poor (thumb reach). The spec calls for using `MatBottomSheet` with the same content at mobile breakpoints. This requires two separate component references or a unified template approach. The simplest implementation: `EventArchiveDialogComponent` detects mobile via `BreakpointObserver` and the caller chooses between `MatDialog.open()` and `MatBottomSheet.open()` accordingly. Review if the added complexity is worth the UX gain, or if a full-width low-positioned `MatDialog` with `position: { bottom: '0' }` is a sufficient alternative.

**UX-D3 — "Upload Photos" and "View Photos" buttons disabled until RS-006/RS-008**: The detail page shows both buttons per AC9 but those routes do not exist yet. The spec renders them as disabled with a tooltip ("Coming soon"). This keeps the full intended layout stable in the Playwright baseline screenshot but prevents dead navigation. Review if the team prefers to omit the buttons entirely until the stories are merged.

**UX-D4 — QR code download uses canvas `.toDataURL()`**: `angularx-qrcode` renders to a `<canvas>` element. The spec downloads the QR by reading the canvas. This works when the component and the QR code are on the same origin but has CORS limitations if the library ever switches to an `<img>` element. Review if this approach is acceptable or if the library's built-in `allowEmptyString` and `qrCodeURL` output mechanisms should be used instead.

**UX-D5 — `publicBaseUrl` from `AppConfigService`**: The public event URL displayed in the share section must be an absolute URL (e.g. `https://example.com/events/{id}`). The spec assumes `AppConfigService` already exposes a `publicBaseUrl` string. If this property does not exist on the service, the build agent must add it sourced from `config.json` (the same pattern as `apiBaseUrl`). Review if the public base URL is the same domain as the Angular app or a separate CloudFront distribution.

**UX-D6 — `currencies.constants.ts` refactor**: The RS-004 spec assumed the currency list would be defined locally in `ProfileComponent`. The RS-005 `EventCreateComponent` and `EventEditComponent` need the same list. The spec centralises it in a shared constants file and requires `ProfileComponent` to be updated. This is a small refactor that crosses story boundaries. Review if it should be handled in RS-005 or deferred to a separate chore ticket.

**UX-D7 — Row click navigation on `MatTable`**: Standard `MatTable` rows are not interactive by default. The spec adds `tabindex="0"` and `(keydown.enter)` to `<tr mat-row>` for keyboard navigation. This is a deliberate accessibility enhancement not required by the ACs. Review if the team wants to keep row-level click navigation or restrict navigation to the Name link column only.
