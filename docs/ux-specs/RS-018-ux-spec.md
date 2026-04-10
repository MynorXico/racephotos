# UX Spec — RS-018: In-Progress Virtual Status Filter

**Story**: RS-018
**Persona**: Photographer — desktop-first power user monitoring bulk upload pipeline progress
**Date**: 2026-04-10
**Status**: draft

---

## Overview

RS-018 is a delta to two existing files and one type definition. No new components are
created. The changes are:

1. **`photo-status-badge.pipe.ts`** — Both `processing` and `watermarking` entries in
   `BADGE_MAP` must be updated to emit label `"In Progress"`, icon `hourglass_top`, and
   CSS class `badge--processing`. The separate `badge--watermarking` variant introduced
   by RS-017 is collapsed into `badge--processing`.

2. **`event-photos.component.ts`** — The `filterChips` array is replaced with the new
   ordered set: `All / In Progress / Indexed / Review Required / Error`. The `"In Progress"`
   chip sends value `"in_progress"` to the API.

3. **`photos.actions.ts` / `photos.reducer.ts`** — A new type alias `PhotoStatusFilter`
   is introduced to accommodate `"in_progress"` as a filter value without polluting
   `PhotoStatus` (the type for storable DynamoDB status values).

The RS-017 shimmer animation on `watermarking` photo cards is **not changed** — it is
driven directly by `photo.status === 'watermarking'` in the template and is independent
of the badge label.

---

## 1. `PhotoStatusBadgePipe` (`photo-status-badge.pipe.ts`)

### Purpose

Map a photo's stored `status` string to a `BadgeConfig` (CSS class, icon, label) for
display in `PhotoCardComponent`. RS-018 requires that both `processing` and `watermarking`
produce the same badge so that the badge is consistent with the "In Progress" filter chip.

### Current state (to be replaced)

```
processing  → { cssClass: 'badge--processing', icon: 'hourglass_top', label: 'Processing' }
watermarking → { cssClass: 'badge--watermarking', icon: 'autorenew',   label: 'Finalizing' }
```

### Target state after RS-018

Both `processing` and `watermarking` must map to:

```
{ cssClass: 'badge--processing', icon: 'hourglass_top', label: 'In Progress' }
```

Exact changes to `BADGE_MAP`:

| Key | `cssClass` | `icon` | `label` |
|---|---|---|---|
| `processing` | `badge--processing` (unchanged) | `hourglass_top` (unchanged) | **`'In Progress'`** (was `'Processing'`) |
| `watermarking` | **`badge--processing`** (was `badge--watermarking`) | **`hourglass_top`** (was `autorenew`) | **`'In Progress'`** (was `'Finalizing'`) |
| `indexed` | `badge--indexed` (unchanged) | `check_circle` (unchanged) | `'Indexed'` (unchanged) |
| `review_required` | `badge--review` (unchanged) | `rate_review` (unchanged) | `'Review Required'` (unchanged) |
| `error` | `badge--error` (unchanged) | `error` (unchanged) | `'Error'` (unchanged) |

The `FALLBACK` constant currently points to `BADGE_MAP['processing']`. After this change it
will correctly fall back to the "In Progress" badge — no change needed to the fallback line.

### Visual result on the card

Both a `processing` photo and a `watermarking` photo now render identically in the badge row:
an `hourglass_top` icon followed by the text "In Progress" on a `badge--processing` background.

The shimmer animation in the thumbnail area of `watermarking` cards (RS-017) continues to
differentiate the two states visually — that rendering path reads `photo.status === 'watermarking'`
directly and is unaffected by the badge change.

### SCSS impact

The `badge--watermarking` CSS class is no longer referenced by the pipe. The rule added by
RS-017 (`background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container)`)
may be removed from `photo-card.component.scss` to avoid dead CSS. The build agent should
remove it unless another template reference exists.

### States

N/A — `PhotoStatusBadgePipe` is a pure stateless transform. All states are handled by the
consuming component.

### Responsive behaviour

N/A — the pipe produces a `BadgeConfig` struct; layout is the responsibility of the
consuming template.

### Accessibility

The consuming template (`photo-card.component.html`) applies `[attr.aria-label]="'Status: ' +
badge.label"` to the badge span (existing pattern, unchanged). After this change:

- A `processing` photo announces "Status: In Progress" (was "Status: Processing").
- A `watermarking` photo announces "Status: In Progress" (was "Status: Finalizing").

Both are accurate: from the photographer's perspective these photos are in progress.
The fuller distinction (Rekognition vs watermark Lambda) is visible in the thumbnail area
shimmer for `watermarking` cards and is not needed in the badge aria-label.

### Angular Material components to use

None — the pipe is a pure TypeScript class with no template.

### NgRx integration

None — pure transform pipe.

---

## 2. `EventPhotosComponent` — filter chip bar (`event-photos.component.ts` / `.html`)

### Purpose

Replace the current five-chip status filter with a new set that exposes `in_progress` as a
single aggregated filter for all in-flight photos, giving the photographer one predictable
place to see the processing queue without needing separate "Processing" and "Finalizing" tabs.

### Current chip list (before RS-018)

| Position | Label | Value sent to API |
|---|---|---|
| 1 | All | `null` |
| 2 | Indexed | `'indexed'` |
| 3 | Review Required | `'review_required'` |
| 4 | Error | `'error'` |
| 5 | Processing | `'processing'` |

Note: "Watermarking" was never in this list (excluded by RS-017 spec UX-D2 and RS-017 AC4).

### Target chip list after RS-018

| Position | Label | Value sent to API | Default selected |
|---|---|---|---|
| 1 | All | `null` | Yes — selected on initial load |
| 2 | In Progress | `'in_progress'` | No |
| 3 | Indexed | `'indexed'` | No |
| 4 | Review Required | `'review_required'` | No |
| 5 | Error | `'error'` | No |

The "Processing" chip (value `'processing'`) is removed. No "Watermarking" or "Finalizing"
chip exists. The order All → In Progress → Indexed → Review Required → Error maps roughly
to pipeline progression order, making the set scannable from left to right.

### Layout — chip bar

The `mat-chip-listbox` with `class="filter-chips"` remains unchanged structurally. Only
the `filterChips` array in the component class changes. The "Error" chip continues to show
a leading `error_outline` icon — no other chip has a leading icon. "In Progress" does not
get a leading icon (the badge and thumbnail handle that visual language at the card level).

The chip bar is horizontally scrollable on mobile (existing CSS behaviour preserved) — with
five chips the row will still overflow a 375px viewport and must scroll. No chip is hidden
at any breakpoint; all five are always reachable.

### `FilterChip` interface change

The `FilterChip` interface currently types its `value` field as `PhotoStatus | null`. After
RS-018, it must accept `PhotoStatusFilter | null` to accommodate `'in_progress'`:

```typescript
// Before
interface FilterChip { label: string; value: PhotoStatus | null }

// After
interface FilterChip { label: string; value: PhotoStatusFilter | null }
```

The `filterChips` array must be updated:

```typescript
readonly filterChips: FilterChip[] = [
  { label: 'All',             value: null           },
  { label: 'In Progress',     value: 'in_progress'  },
  { label: 'Indexed',         value: 'indexed'      },
  { label: 'Review Required', value: 'review_required' },
  { label: 'Error',           value: 'error'        },
];
```

### `onFilterChip` and `filterLabel` method signatures

Both methods currently accept `PhotoStatus | null`. They must be updated to accept
`PhotoStatusFilter | null` once the type is introduced.

`filterLabel('in_progress')` must return `'in progress'` (lower-cased chip label) for use
in the empty-state heading ("No in progress photos"). The `filterChips.find()` logic in
`filterLabel()` handles this automatically because `'in_progress'` will now exist in the
`filterChips` array — no special case needed.

### States

#### Loading (initial — `isInitialLoading() === true`)

The filter chip bar is rendered immediately and fully interactive during initial load —
the skeleton cards appear in the grid below, but the chip bar itself does not skeletonise.
This is the current behaviour and is unchanged by RS-018. The photographer can switch filter
while the first page is loading; the component dispatches `FilterByStatus` which triggers
a fresh `LoadPhotos`, resetting the skeleton.

This means the "In Progress" chip is clickable even before the first API response arrives.
The grid shows skeleton cards until the filtered response returns. This is correct behaviour.

#### Empty (zero results under "In Progress" filter)

When `activeFilter() === 'in_progress'` and `photos().length === 0` after load completes,
the empty-state block renders. The existing template already handles this:

```html
No {{ filterLabel(activeFilter()) }} photos
```

With `filterLabel('in_progress')` returning `'in progress'`, the heading reads:
**"No in progress photos"**

The supporting body text reads: **"Try selecting a different filter."** (existing copy,
unchanged — it is already the right message for an active-filter empty state).

This state is realistic and expected at the start of an event (before any uploads are
processed) or after the pipeline has caught up. The photographer seeing "No in progress
photos" under the "In Progress" chip is a reassuring signal, not an error.

#### Error (API failure)

The existing error state is unchanged — `cloud_off` icon, "Could not load photos",
"Something went wrong. Please try again.", Retry button. This fires for any filter
including "In Progress". No special error text is needed for `in_progress`.

#### Success / default

The photo grid renders all photos whose DynamoDB status is `processing` or `watermarking`.
Cards for `processing` photos show the static `hourglass_top` thumbnail placeholder.
Cards for `watermarking` photos show the RS-017 shimmer animation. Both show the same
"In Progress" badge in the content strip. The grid is visually mixed but the badge is
consistent — the photographer sees a unified "in progress" set.

### Chip active / inactive visual states

Angular Material `mat-chip-listbox` / `mat-chip-option` handles selected state via M3
tokens automatically. The selected chip receives the primary-container fill; unselected
chips use surface. No custom CSS is needed beyond what the existing `filter-chips` class
already provides. The "All" chip (value `null`) is selected on initial load because
`activeFilter()` initialises to `null` in `PhotosState`.

When the photographer selects "In Progress", the chip receives the selected style and the
grid reloads. When they select "All" again, "In Progress" returns to the unselected style.
There is no "deselect to show All" interaction — clicking "All" is the explicit way to
remove the filter. This matches the existing chip behaviour.

### Responsive behaviour

#### 375px (mobile)

The chip bar is horizontally scrollable with `overflow-x: auto` (existing CSS). With five
chips, the row is approximately 440px wide (estimated: All ~64px, In Progress ~112px,
Indexed ~80px, Review Required ~144px, Error ~68px + gaps). This overflows a 375px viewport
by ~65px, requiring a short scroll — the same amount as the current five-chip layout.
No chips are hidden or collapsed on mobile. Touch target on each chip is at least 48px
tall per M3 guidelines (existing Material behaviour, unchanged).

The "In Progress" chip replaces the "Processing" chip in the scroll sequence. Its label
is longer ("In Progress" vs "Processing") by approximately 16px — a negligible width change
that does not alter the overall scroll experience.

#### 1280px (desktop)

All five chips fit in a single row without scrolling at desktop width. No layout changes.
The chip bar sits below the page header and above the results summary line (existing layout,
unchanged).

### Accessibility

- The `mat-chip-listbox` carries `aria-label="Filter photos by status"` (existing, unchanged).
- Each `mat-chip-option` receives its visible label as its accessible name automatically via
  Angular Material (the chip's text content is the accessible label). The "In Progress" chip
  therefore announces as "In Progress" to screen readers — no extra `aria-label` needed.
- The `aria-live="polite"` region below the chip bar announces the photo count after filter
  change: "Showing N photos" — the existing template handles this and is unchanged. After
  selecting "In Progress", screen readers will announce the new count once loading completes.
- When zero results are returned under "In Progress", the empty-state block uses
  `aria-live="polite"` (existing), so screen readers announce the "No in progress photos"
  heading without requiring focus movement.
- The "Error" chip retains its leading `error_outline` icon (existing). The icon is
  `matChipAvatar` and is decorative — the chip's text label "Error" is the accessible name.

### Angular Material components to use

| Component | Usage |
|---|---|
| `MatChipsModule` (`MatChipListbox`, `MatChipOption`) | Filter chip bar — unchanged; only the data changes |
| `MatIconModule` | Error chip leading icon — unchanged |

No new Material components are introduced.

### NgRx integration

#### Type changes (prerequisite)

Before the component can be updated, two type changes are required in the store layer:

**`photos.actions.ts`** — Introduce `PhotoStatusFilter`:

```typescript
// PhotoStatus represents real DynamoDB status values only.
// 'in_progress' is a query-time alias and must never appear on a Photo object.
export type PhotoStatus =
  | 'processing'
  | 'watermarking'
  | 'indexed'
  | 'review_required'
  | 'error';

// PhotoStatusFilter extends PhotoStatus with the virtual filter alias.
// Used for FilterByStatus action and PhotosState.activeFilter only.
export type PhotoStatusFilter = PhotoStatus | 'in_progress';
```

**`photos.actions.ts`** — Update `FilterByStatus` action prop:

```typescript
'Filter By Status': props<{ eventId: string; status: PhotoStatusFilter | null }>(),
```

**`photos.reducer.ts`** — Update `PhotosState.activeFilter`:

```typescript
export interface PhotosState {
  photos: Photo[];
  nextCursor: string | null;
  activeFilter: PhotoStatusFilter | null;   // was: PhotoStatus | null
  loading: boolean;
  error: string | null;
}
```

`Photo.status` remains typed as `PhotoStatus` — there is no code path that could assign
`'in_progress'` to a photo object, and the TypeScript type enforces this.

#### Selectors subscribed to by `EventPhotosComponent`

All existing selectors are unchanged in name and return type. However `selectActiveFilter`
now infers `PhotoStatusFilter | null` from the updated `PhotosState` — consuming components
receive the correct type automatically.

| Selector | Used for |
|---|---|
| `selectAllPhotos` | Populating the photo grid |
| `selectPhotosLoading` | `isInitialLoading`, `isLoadMoreInFlight`, load-more spinner |
| `selectPhotosError` | Error state block |
| `selectHasMorePages` | Load more button visibility |
| `selectActiveFilter` | Chip listbox `[value]` binding, `filterLabel()`, empty-state copy |
| `selectPhotoCount` | Results summary count, aria-live region |
| `selectSelectedEvent` | Event name subtitle in page header |
| `selectEventsLoading` | Event name skeleton |

#### Actions dispatched by `EventPhotosComponent`

| User event | Action dispatched |
|---|---|
| Page load / route param change | `PhotosActions.clearPhotos()` then `EventsActions.loadEvent({ id })` then `PhotosActions.loadPhotos({ eventId })` |
| Chip click — any chip | `PhotosActions.filterByStatus({ eventId, status: PhotoStatusFilter \| null })` |
| "Load more" button click | `PhotosActions.loadNextPage({ eventId, cursor })` |
| Retry button click | `PhotosActions.loadPhotos({ eventId })` |
| Component destroy | `PhotosActions.clearPhotos()` |

The `FilterByStatus` action now accepts `'in_progress'` as a valid status value. The NgRx
effect that handles `filterByStatus` dispatches `LoadPhotos` — the effect passes `status`
as the API query parameter, so `status=in_progress` reaches the Lambda unchanged. No effect
change is needed beyond the type update.

---

## 3. `photo-card.component.html` — thumbnail placeholder label (minor)

### Purpose

The static `hourglass_top` placeholder (branch 3 of the thumbnail area, for `processing`
photos and any other non-watermarking null-thumbnail status) currently displays the label
"Processing" in a `<span class="mat-body-small placeholder-label">`. After RS-018, the
badge for `processing` photos reads "In Progress", so "Processing" in the thumbnail area
becomes inconsistent.

### Change

Update the `placeholder-label` span text inside the `!photo.thumbnailUrl` branch from
`"Processing"` to `"In progress"` (sentence case, matching the badge label in plain
reading form):

```html
<!-- Before -->
<span class="mat-body-small placeholder-label">Processing</span>

<!-- After -->
<span class="mat-body-small placeholder-label">In progress</span>
```

The `aria-label` on the container (`"Thumbnail not yet available"`) is not changed —
it remains the accurate accessible description for a photo that has no thumbnail yet.

The shimmer branch for `watermarking` (`photo.status === 'watermarking'`) still uses
`"Finalizing watermark…"` for both its visible label and its `aria-label`. This label
describes the specific operation in progress and is more informative than "In progress"
in that context. It does not need to match the badge label — the badge and the thumbnail
serve different informational roles on the card.

### States

N/A — this is a template literal change, not a state change.

### Responsive behaviour

"In progress" is two characters shorter than "Processing" — no truncation risk at any
viewport width.

### Accessibility

The `aria-label="Thumbnail not yet available"` on the outer `.thumbnail-placeholder`
container remains unchanged. The span text is `aria-hidden` relative to the outer label
because the container provides the authoritative accessible description. The span change
has no accessibility impact.

---

## 4. Storybook stories delta

The following Storybook files must be updated. This section specifies what changes, not
how Storybook is structured (the build agent should follow existing story conventions in
each file).

### `photo-status-badge.pipe.stories.ts`

- Update the `processing` story: badge label changes from "Processing" to "In Progress".
- Update the `watermarking` story: badge label changes from "Finalizing" to "In Progress";
  icon changes from `autorenew` to `hourglass_top`; CSS class changes from
  `badge--watermarking` to `badge--processing`. The visual appearance of the `processing`
  and `watermarking` story rows is now identical — this is intentional and should be
  noted in the story's `parameters.docs.description`.

### `photo-card.component.stories.ts`

- Any story whose badge showed "Processing" now shows "In Progress".
- The `Watermarking` story added by RS-017 continues to exist. Its badge now shows
  "In Progress" (was "Finalizing"). Its shimmer thumbnail area is unchanged.

### `event-photos.component.stories.ts`

- All chip-set stories must be updated to reflect the new order:
  `All / In Progress / Indexed / Review Required / Error`.
- Remove any story that demonstrated the old "Processing" chip in isolation.
- Add a story `InProgressFilter` that pre-sets `activeFilter: 'in_progress'` and provides
  a mix of `processing` and `watermarking` mock photos. This story verifies that both
  statuses appear under the single "In Progress" chip with consistent badges.
- The existing `LoadedWithPhotos` story should retain its mix of all statuses; verify that
  the "Processing" chip in its chip-bar rendering is gone and replaced by "In Progress".

---

## 5. Playwright E2E tests delta

### Test 1 — "In Progress" chip exists; "Processing" chip does not

Given the event photos page loads, then:
- A `mat-chip-option` with accessible name `"In Progress"` is present.
- No `mat-chip-option` with accessible name `"Processing"` is present.
- The chip listbox contains exactly, in order: "All", "In Progress", "Indexed",
  "Review Required", "Error".

### Test 2 — "In Progress" chip triggers correct API call

Given the photographer clicks the "In Progress" chip, then:
- The intercepted API request URL contains `status=in_progress`.
- No request with `status=processing` or `status=watermarking` is made.

### Test 3 — Badge consistency under "In Progress" filter

Given a mock API response under `status=in_progress` contains one photo with
`status: 'processing'` and one with `status: 'watermarking'`, then:
- Both photo cards display a badge with text "In Progress".
- No badge with text "Processing", "Finalizing", or "Watermarking" is present.

### Test 4 — Empty state under "In Progress" filter

Given a mock API response under `status=in_progress` returns zero photos, then:
- The heading "No in progress photos" is visible.
- The body text "Try selecting a different filter." is visible.
- The chip bar remains fully visible and interactive.

### Test 5 — Responsive chip bar at 375px

At viewport 375px wide, given the page loads, then:
- The chip bar is scrollable (overflow-x scroll — verify via bounding box comparison
  between chip bar scroll width and viewport width).
- All five chips are reachable by scrolling (verify "Error" chip is in the DOM and
  accessible, even if off-screen initially).
- Take a Playwright screenshot snapshot at this viewport as the visual baseline.

---

## UX decisions not explicitly stated in the story ACs

**UX-D1 — RS-017 shimmer for `watermarking` cards is preserved unchanged.**
AC6 says both statuses show label "In Progress" but does not address the thumbnail-area
shimmer. Preserving it is the correct UX decision: the badge unifies the filter-level
label, but the card-level thumbnail continues to provide finer-grained feedback to the
photographer (shimmer = watermark Lambda running; static hourglass = Rekognition running).
The team should confirm that retaining the visual distinction at thumbnail level is desired.
If the team prefers uniform thumbnails for both in-progress states, the `watermarking`
branch in `photo-card.component.html` can be collapsed into the `!photo.thumbnailUrl`
branch — but this spec recommends against it.

**UX-D2 — `watermarking` badge collapses to `badge--processing` (not a new third class).**
The story says both statuses should map to `{ cssClass: 'badge--processing', icon:
'hourglass_top', label: 'In Progress' }` explicitly. This spec follows that instruction.
The RS-017 `badge--watermarking` CSS class becomes dead code and should be removed. If the
team anticipates distinguishing the two states again in a future story, retaining the class
(but not referencing it) is acceptable — document it as intentionally unused.

**UX-D3 — Thumbnail placeholder label changes from "Processing" to "In progress".**
The story ACs do not mention this label. It is changed for consistency: a photographer
reading a card that says "In progress" in the badge but "Processing" in the thumbnail
placeholder would experience a minor but avoidable terminology conflict. The thumbnail
`aria-label` ("Thumbnail not yet available") is not changed because it accurately describes
the situation regardless of what the badge says.

**UX-D4 — "In Progress" chip has no leading icon.**
The story does not specify a chip icon. The current "Error" chip has a leading `error_outline`
icon to draw attention to a negative state. "In Progress" is a neutral/positive state (photos
are being processed as expected). Adding an icon like `hourglass_top` or `autorenew` to the
chip would add visual weight without informational gain. This spec omits a chip icon. The team
may add one if they wish, using `matChipAvatar` per the existing error chip pattern.

**UX-D5 — Chip order places "In Progress" second, immediately after "All".**
The story specifies the order "All / In Progress / Indexed / Review Required / Error" (AC5)
explicitly. This spec follows it exactly. The rationale (pipeline order) is noted in the
spec body above.

**UX-D6 — Empty state copy uses "No in progress photos" (sentence case, no hyphen).**
"in progress" as a noun phrase is not hyphenated. The chip label is "In Progress" (title
case for the chip button). The empty state heading uses the `filterLabel()` method which
lower-cases the chip label: `'in progress'`. The full heading therefore reads "No in
progress photos" — grammatically correct without a hyphen. The team should verify this
copy is acceptable; an alternative is to hard-code the empty-state label for `in_progress`
separately from the chip label to allow "No in-progress photos" if the hyphen is preferred.
