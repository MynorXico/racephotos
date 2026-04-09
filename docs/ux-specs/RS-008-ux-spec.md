# UX Spec — RS-008: Photographer event photos gallery

**Story**: RS-008
**Persona**: Photographer — desktop-first power user; may have thousands of photos per event; needs to verify processing outcomes and spot problems quickly
**Date**: 2026-04-08
**Status**: draft

---

## Overview

This spec covers three deliverables for RS-008:

1. `EventPhotosComponent` — the photo grid page at `/photographer/events/:id/photos`
2. `PhotoCardComponent` — the individual card rendered inside the grid (standalone, reusable)
3. `PhotoStatusBadgePipe` — a pure pipe that maps a `status` string to a CSS class and icon name

The components live inside the `PhotographerLayoutComponent` shell established in RS-004. They are lazy-loaded behind `authGuard`. The `NavigationTitleService` pattern applies — `EventPhotosComponent` calls `titleService.setTitle('Event Photos')` in `ngOnInit`.

A new NgRx slice — `store/photos/` — must be created before the component. The existing `store/photos/photos.actions.ts` stub (which currently contains only search-related actions) must be replaced with the full slice defined below.

---

## NgRx slice: `store/photos/`

### State shape

```typescript
interface PhotosState {
  photos: Photo[];                 // accumulates across "Load more" pages
  nextCursor: string | null;       // null when no further pages exist
  activeFilter: PhotoStatus | null; // null = "All" chip selected
  loading: boolean;                // true during any in-flight fetch
  error: string | null;            // non-null when the API returns an error
}

interface Photo {
  id: string;
  status: PhotoStatus;
  thumbnailUrl: string | null;     // null when watermark processing is not yet complete
  bibNumbers: string[];
  uploadedAt: string;              // ISO 8601
  errorReason: string | null;      // non-null only when status === 'error'
}

type PhotoStatus = 'processing' | 'indexed' | 'review_required' | 'error';
```

### Actions (all in `store/photos/photos.actions.ts`)

| Action | Props | Dispatched by |
|---|---|---|
| `PhotosActions['Load Photos']` | `{ eventId: string }` | Component — on `ngOnInit` and after filter chip change resets the list |
| `PhotosActions['Load Photos Success']` | `{ photos: Photo[]; nextCursor: string \| null }` | Effect — on first-page API success |
| `PhotosActions['Load Photos Failure']` | `{ error: string }` | Effect — on API error |
| `PhotosActions['Load Next Page']` | `{ eventId: string; cursor: string }` | Component — on "Load more" button click |
| `PhotosActions['Load Next Page Success']` | `{ photos: Photo[]; nextCursor: string \| null }` | Effect — on subsequent-page API success; reducer appends to existing array |
| `PhotosActions['Load Next Page Failure']` | `{ error: string }` | Effect — on subsequent-page API error |
| `PhotosActions['Filter By Status']` | `{ status: PhotoStatus \| null }` | Component — on filter chip selection; triggers `Load Photos` after resetting the list |
| `PhotosActions['Clear Photos']` | `{}` | Component — in `ngOnDestroy` to reset slice on navigation away |

### Selectors (all in `store/photos/photos.selectors.ts`)

| Selector | Returns |
|---|---|
| `selectAllPhotos` | `Photo[]` |
| `selectNextCursor` | `string \| null` |
| `selectActiveFilter` | `PhotoStatus \| null` |
| `selectPhotosLoading` | `boolean` |
| `selectPhotosError` | `string \| null` |
| `selectHasMorePages` | `boolean` — `nextCursor !== null` |
| `selectPhotoCount` | `number` — `photos.length` |

---

## Component: `EventPhotosComponent`

**Path**: `src/app/features/photographer/event-photos/event-photos.component.ts`
**Route**: `/photographer/events/:id/photos`
**Module**: lazy-loaded standalone; registers `photosFeature` via `provideState()` in the component's `providers` array

### Purpose

Shows the authenticated photographer all photos for a specific event in a filterable grid, with colour-coded status badges and a "Load more" button for pagination.

---

### Layout — 1280px (desktop)

The component renders inside the `PhotographerLayoutComponent` content area. Content is full-width up to `1200px`, centred, with `32px` top padding and `24px` horizontal padding.

Structure top to bottom:

**1. Breadcrumb / page header row**

`display: flex`, `align-items: center`, `gap: 8px`, `margin-bottom: 8px`.

- `mat-icon-button` with icon `arrow_back`, `aria-label="Back to event details"`, navigates to `/photographer/events/:id`.
- "Event Photos" heading in `mat-headline-small` immediately to the right of the back button.

Below the heading row, a single-line subheading shows the event name in `mat-body-medium`, `var(--mat-sys-on-surface-variant)`. The event name is loaded from `selectSelectedEvent` in the events slice (the component dispatches `EventsActions['Load Event']` on init to ensure this is available even on direct URL navigation). While the event is loading this line renders as a 160px wide skeleton shimmer bar.

**2. Filter chip row**

`display: flex`, `flex-wrap: wrap`, `gap: 8px`, `margin-bottom: 24px`.

Five `MatChipListbox` chips in a single `<mat-chip-listbox>` with `aria-label="Filter photos by status"` and `selectable` set (exactly one chip selected at all times). Chip labels and their corresponding `status` filter values:

| Chip label | `status` value sent to API | Chip selected class |
|---|---|---|
| All | `null` (no filter param) | Active on initial load |
| Indexed | `indexed` | — |
| Review Required | `review_required` | — |
| Error | `error` | — |
| Processing | `processing` | — |

Each chip is a `<mat-chip-option>` with `value` bound to the status string (or `null` for "All"). When the user selects a chip, the component dispatches `PhotosActions['Filter By Status']({ status })` which resets the photos array to `[]` and then dispatches `PhotosActions['Load Photos']({ eventId })`.

Chips are not links — they are filter controls. The active chip uses M3's built-in selected state (filled background using `--mat-sys-secondary-container`). No custom colour overrides are needed for the chips themselves. Status colouring belongs only on the photo card badges.

The "Error" chip shows a leading `mat-icon` `error_outline` at `18px` in `var(--mat-sys-error)` when its count is non-zero. (See UX-D1 below regarding count badges on chips.)

**3. Results summary line**

A single line of text below the chip row: "**N** photos" where N is `selectPhotoCount`. `mat-body-medium`. Updated reactively. While loading this line is hidden (not a skeleton — the grid skeleton provides the loading affordance).

**4. Photo grid**

A CSS grid: `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))`, `gap: 16px`. At 1280px with 24px horizontal padding this produces approximately 5 columns.

Each cell in the grid is a `PhotoCardComponent` (see below).

**5. Loading skeleton (grid)**

When `selectPhotosLoading` is true AND `selectAllPhotos` is empty (i.e. initial page load, not a "Load more" request), replace the photo grid with a skeleton grid. The skeleton grid uses the same CSS grid definition. It contains 15 skeleton card placeholders (three rows of five). Each skeleton card matches the `PhotoCardComponent` dimensions and contains:

- A `border-radius: 4px` grey rectangle (`var(--mat-sys-surface-variant)`) at 16:9 aspect ratio for the thumbnail area, with a shimmer animation.
- Below it: a 60px-wide shimmer bar (badge placeholder) and a 100px-wide shimmer bar (bib numbers placeholder), `margin-top: 8px`, `gap: 6px`.

The shimmer animation is a CSS `@keyframes` that transitions `background-position` on a `linear-gradient` — consistent with the shimmer pattern used in the event list (`EventListComponent`).

**6. "Load more" button**

Rendered below the grid, centred horizontally. Visible only when `selectHasMorePages` is true.

- `mat-stroked-button` labelled "Load more" with a leading `mat-icon` `expand_more`.
- `aria-label="Load more photos"`.
- While a "Load more" fetch is in progress (`selectPhotosLoading` is true AND `selectAllPhotos` is non-empty), the button is replaced by a `MatProgressSpinner` in `indeterminate` mode at `diameter: 32`, with `aria-label="Loading more photos"` and an adjacent `mat-body-medium` text "Loading more…" — the two sit on a centred flex row with `gap: 8px`. The button does not appear alongside the spinner.
- When `selectHasMorePages` is false (all pages loaded), the button is hidden with no replacement element.
- `margin-top: 24px`, `margin-bottom: 40px`.

**7. Empty state**

When `selectPhotosLoading` is false AND `selectAllPhotos` is empty AND `selectPhotosError` is null, the grid area is replaced by a centred empty-state block:

- `mat-icon` `photo_library`, `64px`, `var(--mat-sys-on-surface-variant)`.
- Heading: "No photos yet" in `mat-title-medium` when `activeFilter` is null.
- Heading: "No **{status}** photos" in `mat-title-medium` when a filter chip is active (the status label is human-readable: "indexed", "review required", "error", "processing").
- Body text: "Photos appear here once uploaded and processed." when `activeFilter` is null; "Try selecting a different filter." when a filter is active.
- No CTA button in the empty state — the filter chips above remain interactive for correction.

**8. Error state**

When `selectPhotosError` is non-null, the grid area is replaced by a centred error block:

- `mat-icon` `cloud_off`, `64px`, `var(--mat-sys-error)`.
- Heading: "Could not load photos" in `mat-title-medium`.
- Body text: "Something went wrong. Please try again." `mat-body-medium`.
- "Retry" `mat-stroked-button` with `color="warn"`, `aria-label="Retry loading photos"`. Clicking dispatches `PhotosActions['Load Photos']({ eventId })`.

---

### States

- **Loading (initial)**: skeleton grid shown (15 shimmer cards); filter chips visible and interactive; results summary line hidden.
- **Loading (Load more)**: existing photo cards remain visible; "Load more" button replaced by spinner; filter chips remain interactive.
- **Loaded / default**: photo grid with cards; results summary showing count; "Load more" button if more pages exist.
- **Empty**: empty-state block with icon and context-sensitive message; filter chips remain interactive so the photographer can clear the filter.
- **Error**: error block with icon, message, and Retry button; filter chips remain visible above.

---

### Responsive behaviour

#### 375px (mobile)

- Content has `16px` horizontal padding, no max-width constraint.
- Breadcrumb row: the back button sits on its own row (full width), the heading and event name subheading stack below it, left-aligned.
- Filter chip row: chips wrap onto multiple lines. All chips remain visible — no overflow menu. On mobile the chip labels truncate to single words if needed: "All", "Indexed", "Review Req.", "Error", "Processing".
- Photo grid: `grid-template-columns: repeat(2, 1fr)`, `gap: 12px`. Two columns at 375px. Cards are smaller — the thumbnail area maintains 16:9 aspect ratio.
- Skeleton grid: 6 skeleton cards (3 rows of 2) instead of 15.
- "Load more" button: full width (`width: 100%`) at mobile for a 48px minimum touch target.
- Empty and error state blocks: centred, icon reduces to `48px`, text wraps naturally.

#### 1280px (desktop)

The default layout described above.

---

### Accessibility

- `<mat-chip-listbox>` carries `aria-label="Filter photos by status"`. Each `<mat-chip-option>` is announced by screen readers with its label and selected state. The `selectable` binding ensures exactly one option is always selected. Keyboard navigation between chips uses arrow keys (Material's default `ListKeyManager`).
- The photo grid has `role="list"` on its container element so screen readers understand the grid as a collection. Each `PhotoCardComponent` host element carries `role="listitem"`.
- When the filter changes and a new fetch begins, an `aria-live="polite"` region (hidden visually, placed after the chip row) announces "Showing {N} photos" once loading completes. This region is updated by the component whenever `selectPhotoCount` changes.
- The "Load more" spinner region carries `role="status"` and `aria-label="Loading more photos"` so screen readers announce the loading state without repeating the full content.
- The error state block carries `role="alert"` and `aria-live="assertive"` so it is announced immediately when it appears.
- The empty state block carries `aria-live="polite"`.
- Colour is not the sole indicator of photo status — every badge uses both colour and an icon (see `PhotoCardComponent`).
- All icon-only buttons have explicit `aria-label` attributes.
- Focus order: back button → filter chips (arrow-key navigable within `chip-listbox`) → photo cards (Tab between cards) → "Load more" button.
- The skeleton shimmer cards carry `aria-hidden="true"` — they are decorative placeholders.

---

### Angular Material components to use

| Component | Usage |
|---|---|
| `MatChipListbox`, `MatChipOption` | Filter chip row |
| `MatCard`, `MatCardContent` | Photo cards (via `PhotoCardComponent`) |
| `MatButton` (`mat-stroked-button`) | "Load more", Retry |
| `MatIconButton` (`mat-icon-button`) | Back navigation |
| `MatIcon` | `arrow_back`, `photo_library`, `cloud_off`, `expand_more`, `error_outline` |
| `MatProgressSpinner` | "Load more" in-flight state |
| `MatTooltip` | Error reason tooltip on error-status cards |

Do not use `MatPaginator` — pagination is cursor-based append-only ("Load more"), not page-number navigation. Do not use `MatTable` — the grid card layout is appropriate for a photo gallery on a photographer operational view (cards communicate thumbnail + status at a glance faster than table rows).

---

### NgRx integration

**Selectors subscribed to** (via `toSignal` with `{ initialValue }` for all):

| Selector | Used for |
|---|---|
| `selectAllPhotos` | Grid data source |
| `selectPhotosLoading` | Show/hide skeleton vs spinner; disable "Load more" button |
| `selectPhotosError` | Show/hide error state |
| `selectNextCursor` | Provide cursor to `Load Next Page` action |
| `selectHasMorePages` | Show/hide "Load more" button |
| `selectActiveFilter` | Highlight selected chip; control empty-state message |
| `selectPhotoCount` | Results summary line |
| `selectSelectedEvent` (from events slice) | Event name in subheading |
| `selectEventsLoading` (from events slice) | Subheading skeleton shimmer |

**Actions dispatched**:

| User event | Action dispatched |
|---|---|
| `ngOnInit` | `EventsActions['Load Event']({ id: eventId })` then `PhotosActions['Load Photos']({ eventId })` |
| Filter chip selected | `PhotosActions['Filter By Status']({ status })` |
| "Load more" clicked | `PhotosActions['Load Next Page']({ eventId, cursor: nextCursor() })` |
| "Retry" clicked in error state | `PhotosActions['Load Photos']({ eventId })` |
| `ngOnDestroy` | `PhotosActions['Clear Photos']({})` |

The reducer for `Filter By Status` must reset `photos: []` and `nextCursor: null` and set `activeFilter`, then the effect listens for `Filter By Status` and dispatches `Load Photos` automatically — the component dispatches only `Filter By Status`, not `Load Photos` directly on a filter change.

---

## Component: `PhotoCardComponent`

**Path**: `src/app/features/photographer/event-photos/photo-card/photo-card.component.ts`
**Usage**: rendered inside the grid in `EventPhotosComponent`; also used standalone in Storybook

### Purpose

Displays a single photo's watermarked thumbnail, status badge, detected bib numbers, and (for error-status photos) a tooltip with the failure reason.

---

### Layout — 1280px (desktop)

The card is a `MatCard` with `border-radius: 8px`, no elevation shadow (use `appearance="outlined"` for a 1px border), and `overflow: hidden` to clip the thumbnail.

Structure top to bottom within the card:

**Thumbnail area**

A `16:9` aspect ratio container (`padding-top: 56.25%`, `position: relative`, `overflow: hidden`) at the top of the card. Inside it:

- `<img>` with `[src]="photo.thumbnailUrl"`, `alt=""` (decorative — the bib numbers below provide the accessible label), `object-fit: cover`, `width: 100%`, `height: 100%`, `position: absolute`, `inset: 0`.
- When `photo.thumbnailUrl` is null (photo not yet watermarked), the `<img>` is hidden and replaced by a centred placeholder block: `mat-icon` `hourglass_top` at `32px`, colour `var(--mat-sys-on-surface-variant)`, with a short label "Processing" below it in `mat-body-small`. This placeholder has the same `var(--mat-sys-surface-variant)` background as the thumbnail container.
- Image load error (broken `<img>` `error` event): the same placeholder block as above is shown, using icon `broken_image` instead of `hourglass_top`, with label "Unavailable".

**Card content strip** (`MatCardContent`, `padding: 10px 12px 12px`)

Row 1 — Badge and actions row: `display: flex`, `align-items: center`, `justify-content: space-between`.

Left side: the status badge (see `PhotoStatusBadgePipe` below). The badge is an inline `<span>` with `display: inline-flex`, `align-items: center`, `gap: 4px`, `border-radius: 12px`, `padding: 2px 8px`, `font-size: 12px`, `font-weight: 500`. It contains a `mat-icon` at `14px` and a text label.

Right side (error status only): a `mat-icon-button` with icon `info_outline` at `18px` and `[matTooltip]="photo.errorReason"`, `matTooltipShowDelay="0"`, `aria-label="View error details"`. This button appears only when `photo.status === 'error'` and `photo.errorReason` is non-null. When `errorReason` is null for an error-status photo, the button still appears with tooltip text "No error details available."

Row 2 — Bib numbers: `margin-top: 6px`. `mat-body-small`, `var(--mat-sys-on-surface-variant)`.

- When `photo.bibNumbers.length > 0`: display "Bibs: **101**, **204**" — the bib values are comma-separated, each wrapped in `<strong>`.
- When `photo.bibNumbers.length === 0`: display "No bibs detected" in `var(--mat-sys-on-surface-variant)` italics.
- Truncate to one line with `text-overflow: ellipsis` if the bib list is very long; a `[matTooltip]` on the bib row shows the full list on hover.

Row 3 — Timestamp: `margin-top: 4px`. `mat-body-small`, `var(--mat-sys-on-surface-variant)`. Format: `uploadedAt` formatted via Angular's `date` pipe as `'MMM d, y, h:mm a'`. Right-aligned.

---

### Status badge colour coding (`PhotoStatusBadgePipe`)

The `PhotoStatusBadgePipe` returns a `BadgeConfig` object:

```typescript
interface BadgeConfig {
  cssClass: string;   // applied to the badge <span>
  icon: string;       // mat-icon ligature name
  label: string;      // visible text
}
```

| `status` value | `cssClass` | `icon` | `label` | Background token | Text token |
|---|---|---|---|---|---|
| `indexed` | `badge--indexed` | `check_circle` | Indexed | `var(--mat-sys-tertiary-container)` | `var(--mat-sys-on-tertiary-container)` |
| `review_required` | `badge--review` | `rate_review` | Review Required | `#FFF3E0` (amber-50 equivalent) | `#E65100` (amber-900 equivalent) |
| `error` | `badge--error` | `error` | Error | `var(--mat-sys-error-container)` | `var(--mat-sys-on-error-container)` |
| `processing` | `badge--processing` | `hourglass_top` | Processing | `var(--mat-sys-surface-variant)` | `var(--mat-sys-on-surface-variant)` |

The amber colours for `review_required` are not available as M3 system tokens. They must be defined as SCSS variables in the component's stylesheet — never as inline styles. See UX-D2 below.

The pipe is `pure: true` (default). It takes a single `string` argument and returns a `BadgeConfig`. The pipe is declared in the same directory as `PhotoCardComponent` and exported for use in Storybook stories.

---

### States

- **Loading (thumbnail)**: the image loads naturally — no explicit loading skeleton inside the card. The skeleton shimmer for the whole card is handled at the grid level (15 placeholder cards in the grid skeleton). Individual card load shimmers are N/A.
- **Thumbnail missing** (`thumbnailUrl === null`): placeholder block with `hourglass_top` icon — described in layout above.
- **Thumbnail load error** (broken image): placeholder block with `broken_image` icon — described in layout above.
- **Error status**: red badge, `info_outline` tooltip button, `errorReason` in tooltip.
- **Default (indexed, review_required, processing)**: badge only — no tooltip button.

---

### Responsive behaviour

#### 375px (mobile)

The card inherits its width from the two-column CSS grid in the parent. No internal layout changes to the card are needed. The content strip padding reduces to `8px 10px 10px`. The timestamp row (Row 3) is hidden on mobile to save vertical space — the badge and bib numbers remain. The timestamp is accessible via the Storybook story but suppressed on mobile via `@media (max-width: 599px) { .card-timestamp { display: none; } }`.

#### 1280px (desktop)

The default layout described above.

---

### Accessibility

- The card `<mat-card>` host element carries `role="listitem"` (set via `host` binding in the component metadata).
- The card as a whole is not focusable or interactive — it is a display element. Only the tooltip button (for error-status cards) is interactive.
- The `<img>` has `alt=""` because it is decorative; the meaningful content is the bib numbers in Row 2. Screen readers will read "Bibs: 101, 204" from the text content.
- The info tooltip button carries `aria-label="View error details for this photo"` (not just "View error details") to distinguish it when multiple error cards are on screen.
- `MatTooltip` is keyboard-accessible by default (shown on focus as well as hover).
- The placeholder block for missing thumbnails carries `aria-label="Thumbnail not yet available"` or `aria-label="Thumbnail unavailable"` depending on the reason.
- Colour is never the sole status indicator: every badge combines colour, icon, and text label.

---

### Angular Material components to use

| Component | Usage |
|---|---|
| `MatCard`, `MatCardContent` | Card container |
| `MatIcon` | Badge icons, placeholder icons, info tooltip trigger icon |
| `MatIconButton` (`mat-icon-button`) | Error details tooltip button |
| `MatTooltip` | Error reason on the info button; bib overflow on the bib row |

Do not use `MatChip` inside the card for the badge — `MatChip` carries interactive semantics and keyboard focus. The badge is a display element only; a styled `<span>` with the pipe output is correct.

---

### NgRx integration

`PhotoCardComponent` is a dumb (presentational) component. It receives `@Input() photo: Photo` from `EventPhotosComponent`. It dispatches no actions and subscribes to no selectors. All state is passed via input binding.

---

## Pipe: `PhotoStatusBadgePipe`

**Path**: `src/app/features/photographer/event-photos/photo-status-badge.pipe.ts`

### Purpose

Maps a `PhotoStatus` string to a `BadgeConfig` (icon name, CSS class, display label) for rendering the status badge on a photo card.

### Implementation notes

- `pure: true` (default — no annotation needed).
- Exported as a standalone pipe with `standalone: true`.
- Returns a `BadgeConfig` object; the template destructures it with `[ngClass]`, `[matIcon]`, and text interpolation.
- Unknown status values fall back to the `processing` config to avoid runtime errors.
- The `BadgeConfig` interface and `PhotoStatus` type are co-located in the same file as the pipe, and re-exported from the pipe's barrel for use by `PhotoCardComponent` and Storybook.

### NgRx integration

N/A — pure transformation pipe with no store dependency.

---

## Storybook stories

### `EventPhotosComponent` stories (`event-photos.component.stories.ts`)

Four required stories plus one additional:

| Story export name | `photos` slice state | Notes |
|---|---|---|
| `Loading` | `{ photos: [], nextCursor: null, activeFilter: null, loading: true, error: null }` | Shows 15-card skeleton grid |
| `LoadedWithPhotos` | 12 mock photos (3 each of all four statuses), `nextCursor: 'abc123'`, `loading: false`, `error: null` | Shows grid, Load more button |
| `Empty` | `{ photos: [], nextCursor: null, activeFilter: null, loading: false, error: null }` | Shows empty state with `photo_library` icon |
| `EmptyFiltered` | `{ photos: [], nextCursor: null, activeFilter: 'error', loading: false, error: null }` | Shows "No error photos" empty state |
| `Error` | `{ photos: [], nextCursor: null, activeFilter: null, loading: false, error: 'Network error' }` | Shows error state with Retry button |

### `PhotoCardComponent` stories (`photo-card.component.stories.ts`)

Five stories, one per status plus one for the no-thumbnail state:

| Story export name | `photo` input |
|---|---|
| `Indexed` | `status: 'indexed'`, `bibNumbers: ['101', '204']`, valid `thumbnailUrl` |
| `ReviewRequired` | `status: 'review_required'`, `bibNumbers: ['305']`, valid `thumbnailUrl` |
| `Error` | `status: 'error'`, `bibNumbers: []`, `errorReason: 'Rekognition service error: timeout after 3 retries'`, valid `thumbnailUrl` |
| `ErrorNoReason` | `status: 'error'`, `bibNumbers: []`, `errorReason: null`, valid `thumbnailUrl` |
| `Processing` | `status: 'processing'`, `bibNumbers: []`, `thumbnailUrl: null` (shows placeholder) |

### `PhotoStatusBadgePipe` stories (`photo-status-badge.pipe.stories.ts`)

A single story rendering all four badge variants side-by-side in a flex row: `indexed`, `review_required`, `error`, `processing`. Uses a simple template-only component as the story host.

---

## UX decisions not explicitly stated in the story ACs

**UX-D1 — No per-chip photo count badges.**
The story does not specify whether the filter chips show a count of photos per status (e.g. "Error (3)"). This would require an additional API call or a summary field in the response. This spec omits per-chip counts to keep the API contract simple. The "Error" chip gets a leading `error_outline` icon as a visual cue when any error photos exist, but no numeric count. If the team wants counts, the list-event-photos Lambda response should include a `statusCounts: Record<PhotoStatus, number>` field, and a new NgRx selector and action are needed. Confirm before implementation.

**UX-D2 — Amber colour for `review_required` badge is not an M3 system token.**
M3 system tokens do not include an amber/warning palette. This spec uses fixed SCSS variables (`#FFF3E0` background, `#E65100` text) for the review badge to produce a visually distinct amber that does not conflict with the error red or the indexed green. These values must be defined in the component SCSS, never inline, and should be revisited if the team adopts a custom M3 extended palette that includes a warning colour.

**UX-D3 — `PhotoCardComponent` is a separate standalone component, not an inline `@for` block.**
The story tech notes specify only `EventPhotosComponent`. This spec splits the photo card into its own `PhotoCardComponent` to enable isolated Storybook stories and unit testing of card rendering logic. This is a minor structural decision that does not affect the public API or route contract.

**UX-D4 — "Load more" replaces button with spinner rather than disabling the button.**
Disabling the "Load more" button while loading would leave the photographer with no feedback that a fetch is in progress. Replacing it with a spinner communicates progress clearly. If the team prefers to keep the button visible but disabled with a `MatProgressBar` below the grid, that is also acceptable — the current spec's approach is the author's recommendation.

**UX-D5 — Timestamp row is hidden on mobile.**
The story ACs do not specify what card metadata to show at 375px. Hiding the timestamp at mobile preserves the card's compact size in a two-column grid. Bib numbers and status badge are the operationally critical fields. If the team wants the timestamp visible on mobile, the content strip padding and card height budget should be revisited.

**UX-D6 — The `photos` NgRx slice replaces the existing stub rather than extending it.**
The existing `store/photos/photos.actions.ts` contains only search actions (for the runner bib search feature, RS-009). The RS-008 photographer gallery slice uses the same store feature key. The build agent must reconcile these: either use a separate feature key (`photographer-photos` vs `runner-photos`) or extend the existing slice to support both use cases. This spec recommends separate feature keys to keep state concerns isolated. The stub file at `store/photos/photos.actions.ts` should be moved to `store/runner-photos/` and the new photographer slice created at `store/photos/` as described above. Confirm with the team before implementation.

**UX-D7 — Route `/photographer/events/:id/photos` must be added to `app.routes.ts`.**
This route does not yet exist. The build agent must add it as a lazy-loaded child under the photographer parent route alongside the existing `events/:id` and `events/:id/upload` routes.

**UX-D8 — "View photos" navigation link from `EventDetailComponent`.**
The story does not specify how the photographer navigates from the event detail page to the photos gallery. A `mat-stroked-button` labelled "View Photos" with icon `photo_library`, linking to `/photographer/events/:id/photos`, should be added to the `EventDetailComponent` action bar (RS-005 component). This is an additive change to a shipped component — confirm before implementation.
