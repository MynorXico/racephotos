# UX Spec — RS-019: Paginated photo browsing for runners

**Story**: RS-019  
**Status**: ready for build  
**Persona**: Runner (casual, mobile-first, unfamiliar with technical flows)  
**Component file**: `frontend/angular/src/app/events/event-search/event-search.component.ts`  
**Supporting component**: `frontend/angular/src/app/events/event-search/photo-grid/photo-grid.component.ts`

---

## Overview

RS-019 modifies **one existing component** (`EventSearchComponent`) and its
**child grid** (`RunnerPhotoGridComponent`). No new component files are created.
The changes introduce two browsing modes — `'all'` (all event photos) and `'bib'`
(filtered by bib number) — each with paginated "Load more" behaviour and a
"Showing X of Y photos" counter. The mode is driven by a new `mode` field in the
NgRx `runnerPhotos` slice.

All layout decisions below extend the existing SCSS patterns: the hero banner,
`.results-section`, `.skeleton-grid`, and `.state-container` conventions remain
unchanged. New elements are inserted into these existing sections.

---

## EventSearchComponent (`events/event-search/event-search.component.ts`)

### Purpose

Allows a runner to browse all event photos on page load, search by bib number, and
progressively load more photos from either the event gallery or their bib results.

### Layout

The page has two major sections that already exist: the **hero banner** (gradient
background, event name, bib search bar) and the **results section** (white/surface
background, scrollable content area). This story adds elements inside the results
section only — the hero is unchanged.

#### Results section — inside `.results-section`

The results section now contains the following elements in this top-to-bottom order:

1. **Results header row** (`.results-header`) — a single horizontal row containing:
   - Left: the "Showing X of Y photos" counter paragraph
   - Right: nothing (no controls on the right in this story)
   - This row is present whenever there are photos to display (all-event or bib mode)
   - It is absent during loading, error, and empty states

2. **Photo grid** — the existing `<app-runner-photo-grid>` component, unchanged
   in structure. The `aria-label` attribute on the inner `role="list"` div must
   reflect the current mode: `'Photos for bib NNN'` in bib mode, `'Event gallery'`
   in all-event mode.

3. **Load more row** (`.load-more-row`) — a centred row directly below the photo
   grid, present only when `nextCursor` is non-null:
   - One centred button: "Load more photos"
   - Below the button: an inline spinner that replaces the button text while loading
   - The row is removed from the DOM (not just hidden) when `nextCursor` is null

#### Bib search — existing behaviour, one addition

The bib form field already exists in the hero. Add a **clear (×) suffix icon button**
inside the `MatFormField` using `matSuffix`. The icon is `close`. It is visible only
when the bib field has a non-empty value. Clicking it clears the field value,
dispatches `loadEventPhotos`, and resets bib state. This is the mechanism for
AC4 (clear bib → all-event browse).

The existing `(blur)` event on the bib input is not sufficient for AC4 because the
runner may clear the field and press Enter rather than blurring. The clear button is
the primary affordance; additionally, when the bib field value becomes empty and the
runner submits the form (presses Enter or clicks Search), the component should detect
the empty value and dispatch `loadEventPhotos` rather than showing a validation error.

### "Showing X of Y photos" counter

**Text format**:

- All-event mode: `Showing 24 of 312 photos`
- Bib mode: `Showing 7 of 7 photos for bib 101`
- When loaded === total (all photos fetched): `Showing 312 of 312 photos` — no
  special treatment; the "Load more" button disappears naturally when `nextCursor`
  is null, which is the user-visible signal that all photos are loaded.

**Markup** (extends existing `.results-count` class):

```html
<p class="results-count" aria-live="polite" aria-atomic="true">
  Showing {{ photos().length }} of {{ totalCount() }} photos
  @if (mode() === 'bib') {
    for bib <strong>{{ searchedBib() }}</strong>
  }
</p>
```

**Styling**: use the existing `.results-count` styles — `font-size: 0.95rem`,
`color: var(--mat-sys-on-surface-variant)`. No new styles needed for the counter
itself. The `<strong>` bib number inherits the paragraph's colour; do not apply
a separate colour to it.

**Position**: inside `.results-header` div, above the photo grid. On mobile (375px)
this counter is the full width of the container. On desktop (1280px) it is
left-aligned within the `max-width: 1200px` content column.

### "Load more" button

**Placement**: centred horizontally below the last row of photo cards, inside a
`.load-more-row` wrapper div. Minimum touch target: 48px tall. On mobile the button
spans the full width of the container; on desktop it has `min-width: 200px` and
is centred.

**Normal state**:
- `mat-stroked-button` (not flat — this is a secondary action; flat is reserved
  for the primary Search and Purchase actions)
- Label: "Load more photos"
- No icon needed

**Loading state** (while `loadMoreEventPhotos` or `loadMoreBibPhotos` is in flight):
- The button label text is hidden (`visibility: hidden` to preserve button width)
- A `MatProgressSpinner` with `diameter="20"` and `mode="indeterminate"` is
  positioned absolutely centred within the button — same pattern as the existing
  Search button spinner in the hero
- The button `[disabled]="loadingMore()"` — prevents double-dispatch
- `aria-label="Loading more photos"` on the button while in loading state

**Hidden state**: when `nextCursor()` is null, remove the `.load-more-row` from
the DOM entirely using `@if`. Do not use `[hidden]` or `display: none`.

**Disabled state** (not applicable as a separate visual state — the button is either
present and active, present and loading, or absent).

### States

#### Loading — initial page load (all-event mode)

The skeleton loader already exists in the template (`@if (loading())`). It is
already triggered when `loading()` is true. No change to skeleton structure is
needed. The skeleton must now also display on initial page load before the first
`loadEventPhotosSuccess` arrives — this works automatically because dispatching
`loadEventPhotos` sets `loading: true` in the reducer.

The existing skeleton renders 6 cards in a responsive grid (1 / 2 / 3 columns at
375px / 768px / 1280px). This is sufficient — do not change the skeleton count or
structure.

The results header and "Load more" row are absent during initial loading.

#### Loading — "Load more" in progress

Photos already loaded remain visible. The photo grid is not replaced or dimmed.
Only the "Load more" button enters its loading state (spinner replaces label, button
disabled). The results counter remains visible and unchanged while the request is
in flight — it updates only on `loadMoreEventPhotosSuccess` or
`loadMoreBibPhotosSuccess`.

#### Empty — no indexed photos (AC7)

Displayed when `mode()` is `'all'`, `loading()` is false, `error()` is null, and
`photos().length` is 0.

Use the existing `.state-container` layout (centred column, 64px vertical padding).

- Icon: `hourglass_empty` inside the existing `.state-icon-wrap` circle (secondary
  container colour — not the error red variant)
- Heading (`h2.state-title`): `Photos are still being processed`
- Body (`p.state-hint`): `Check back soon — photos appear here as they are indexed.`
- No CTA button in this state (the runner cannot take action; telling them to wait
  is sufficient)

The existing "No results for bib NNN" empty state (bib mode, zero results) remains
unchanged. Its condition is: `mode()` is `'bib'`, `loading()` is false, `error()`
is null, `photos().length` is 0.

#### Error state

Two distinct error scenarios share the same visual treatment (existing `.state-container`
with error icon, "Something went wrong" heading, "Try again" button):

1. **Initial load error** (`loadEventPhotosFailure` or `searchByBibFailure`):
   `onRetry()` dispatches the appropriate action based on `mode()`:
   - `mode() === 'all'`: dispatch `loadEventPhotos({ eventId })`
   - `mode() === 'bib'`: dispatch `searchByBib({ eventId, bibNumber: searchedBib() })`

2. **Load more error** (`loadMoreEventPhotosFailure` or `loadMoreBibPhotosFailure`):
   The already-loaded photos grid remains visible. A `MatSnackBar` is opened with
   the message "Could not load more photos — tap to retry." The snackbar action
   label is "Retry". Tapping Retry re-dispatches the load-more action with the
   same cursor. The snackbar `duration` is 0 (indefinite) so the runner does not
   miss it. It is dismissed programmatically when the retry succeeds or the runner
   navigates away.

The load-more error must NOT replace the photo grid with the full-page error state.
The full-page error state is reserved for initial load failures only.

#### Success / default — all-event mode

After `loadEventPhotosSuccess`:
- Results header visible with counter: `Showing 24 of 312 photos`
- Photo grid populated with up to 24 `RunnerPhotoCardComponent` items
- "Load more photos" button visible below the grid if `nextCursor` is non-null

#### Success / default — bib mode

After `searchByBibSuccess` (which now carries `nextCursor` and `totalCount`):
- Results header visible with counter: `Showing 7 of 7 photos for bib 101`
- Photo grid populated with bib results
- "Load more photos" button visible only if `nextCursor` is non-null (bib results
  with ≤ 24 photos will have `nextCursor: null` — no button shown)

### Responsive behaviour

#### 375px (mobile)

- Hero and bib search bar: unchanged (existing mobile layout)
- Results counter: full width, left-aligned text, `font-size: 0.875rem`
- Photo grid: single column (existing `grid-template-columns: 1fr`)
- "Load more" button: `width: 100%`, `min-height: 48px` — full-width touch target
- The "Load more" row has `padding: 24px 0 0` (space above the button, room below)

#### 1280px (desktop)

- Results counter: left-aligned inside the `max-width: 1200px` column
- Photo grid: 3-column grid (existing `repeat(3, 1fr)` at 1280px breakpoint)
- "Load more" button: `min-width: 200px`, centred using `display: flex;
  justify-content: center` on the `.load-more-row` wrapper
- The "Load more" row has `padding: 32px 0 0`

### Accessibility

- The results counter `<p>` has `aria-live="polite"` and `aria-atomic="true"` so
  screen readers announce the updated count after each "Load more" success without
  interrupting ongoing speech.
- The "Load more" button has a static `aria-label="Load more photos"`. When in the
  loading state, the `aria-label` switches to `"Loading more photos"` — use
  `[attr.aria-label]="loadingMore() ? 'Loading more photos' : 'Load more photos'"`.
- The clear (×) icon button inside the bib field must have
  `aria-label="Clear bib number"`. It must be a `<button>` element (not a div or
  span) so it is keyboard-reachable. Use `type="button"` to prevent form submission.
- Focus order after clicking "Load more": the button retains focus while loading.
  After success, focus stays on the button if it is still present (more pages
  remain), or moves to the last newly appended photo card if the button is removed
  (all photos loaded). Implement this with `ViewChild` or `ElementRef` on the last
  photo card — see implementation note below.
- The photo grid `role="list"` `aria-label` must update when mode changes:
  - All-event: `aria-label="Event gallery"`
  - Bib mode: `aria-label="Photos for bib {{ searchedBib() }}"`
- The `.results-section` already has `aria-live="polite"` and `aria-atomic="false"`.
  Keep this as-is — it announces state transitions (loading → empty → results)
  without re-announcing every photo card.
- The empty state for processing uses `role="status"` (not `role="alert"`) because
  it is informational, not an error.
- Colour is not the sole indicator of any state — the load-more spinner is
  accompanied by `aria-label` text; the empty state uses an icon plus text.

### Angular Material components to use

| Purpose | Component |
|---|---|
| "Load more" button | `MatButton` (`mat-stroked-button`) |
| Spinner inside "Load more" button | `MatProgressSpinner` (`diameter="20"`, `mode="indeterminate"`) |
| Clear bib icon inside form field | `MatIconButton` (`mat-icon-button`, `matSuffix`) + `MatIcon` (`close`) |
| Load-more error notification | `MatSnackBar` (injected into component, opened in effect/subscription) |
| All other existing Material components | unchanged |

Do not add `MatChipSet` or `MatButtonToggle` for mode switching — the mode is
implicit from whether a bib is entered; there is no manual toggle the runner
operates.

### NgRx integration

#### New state fields required in `RunnerPhotosState`

```typescript
nextCursor: string | null;      // cursor for the next page; null = no more pages
totalCount: number;             // Y in "Showing X of Y"
mode: 'all' | 'bib';           // which browse mode is active
loadingMore: boolean;           // true while load-more request is in flight
loadMoreError: string | null;   // non-null triggers the snackbar
```

#### New selectors required

- `selectNextCursor` — `string | null`
- `selectTotalCount` — `number`
- `selectMode` — `'all' | 'bib'`
- `selectLoadingMore` — `boolean`
- `selectLoadMoreError` — `string | null`

All derived from `runnerPhotosFeature` via `createSelector`.

#### New signals in EventSearchComponent

```typescript
readonly nextCursor   = toSignal(this.store.select(selectNextCursor),   { initialValue: null });
readonly totalCount   = toSignal(this.store.select(selectTotalCount),   { initialValue: 0 });
readonly mode         = toSignal(this.store.select(selectMode),         { initialValue: 'all' as const });
readonly loadingMore  = toSignal(this.store.select(selectLoadingMore),  { initialValue: false });
readonly loadMoreError= toSignal(this.store.select(selectLoadMoreError),{ initialValue: null });
```

#### Actions dispatched by EventSearchComponent

| User event | Action dispatched |
|---|---|
| Component init (effect on `eventId` change) | `RunnerPhotosActions.loadEventPhotos({ eventId })` |
| Bib field cleared (clear button click) | `RunnerPhotosActions.loadEventPhotos({ eventId })` |
| Bib form submitted with empty value | `RunnerPhotosActions.loadEventPhotos({ eventId })` |
| Bib form submitted with valid bib | `RunnerPhotosActions.searchByBib({ eventId, bibNumber })` (existing) |
| "Load more" clicked in all-event mode | `RunnerPhotosActions.loadMoreEventPhotos({ eventId, cursor: nextCursor() })` |
| "Load more" clicked in bib mode | `RunnerPhotosActions.loadMoreBibPhotos({ eventId, bibNumber: searchedBib(), cursor: nextCursor() })` |
| "Retry" on load-more snackbar | Same as "Load more clicked" above (same cursor) |
| Component destroyed | `RunnerPhotosActions.clearResults()` (existing) |

#### Reducer behaviour for new actions

- `loadEventPhotos`: sets `loading: true`, `mode: 'all'`, clears `photos`, `nextCursor`,
  `totalCount`, `error`, `searchedBib`
- `loadEventPhotosSuccess`: sets `loading: false`, `photos` (replace), `nextCursor`,
  `totalCount`
- `loadEventPhotosFailure`: sets `loading: false`, `error`
- `loadMoreEventPhotos`: sets `loadingMore: true`, `loadMoreError: null`
- `loadMoreEventPhotosSuccess`: sets `loadingMore: false`, appends to `photos`,
  updates `nextCursor` (may become null)
- `loadMoreEventPhotosFailure`: sets `loadingMore: false`, `loadMoreError`
- `loadMoreBibPhotos`: sets `loadingMore: true`, `loadMoreError: null`
- `loadMoreBibPhotosSuccess`: sets `loadingMore: false`, appends to `photos`,
  updates `nextCursor`
- `loadMoreBibPhotosFailure`: sets `loadingMore: false`, `loadMoreError`
- `searchByBib` (extend existing): additionally sets `mode: 'bib'`
- `searchByBibSuccess` (extend existing): additionally sets `nextCursor`,
  `totalCount` from the extended API response fields
- `clearResults` (existing): resets all new fields to their initial values
  (`nextCursor: null`, `totalCount: 0`, `mode: 'all'`, `loadingMore: false`,
  `loadMoreError: null`)

#### Load-more error snackbar wiring

Open the snackbar in an `effect()` that watches `loadMoreError()`. When the signal
becomes non-null, open the snackbar. Store the `MatSnackBarRef` and close it on
the next successful load-more or on component destroy. Do not open a second snackbar
if one is already open.

```typescript
// Pattern (not final code — implementation may vary):
effect(() => {
  const err = this.loadMoreError();
  if (err && !this.snackBarRef) {
    this.snackBarRef = this.snackBar.open(
      'Could not load more photos — tap to retry.',
      'Retry',
      { duration: 0 }
    );
    this.snackBarRef.onAction()
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this.onLoadMore());
    this.snackBarRef.afterDismissed()
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe(() => { this.snackBarRef = null; });
  }
});
```

---

## RunnerPhotoGridComponent (`events/event-search/photo-grid/photo-grid.component.ts`)

### Purpose

Renders the photo card grid. This story requires one input change and one
`aria-label` change to support the two browsing modes.

### Layout

Unchanged from current implementation. The `.photo-grid` CSS grid and
`.selection-toolbar` are not modified.

### Input change

Add an `@Input() mode: 'all' | 'bib' = 'all'` input to the component.

The `aria-label` on the `role="list"` div currently reads:
```
[attr.aria-label]="searchedBib ? 'Photos for bib ' + searchedBib : 'Search results'"
```

Change to:
```
[attr.aria-label]="mode === 'bib' ? 'Photos for bib ' + searchedBib : 'Event gallery'"
```

This ensures screen readers announce the correct context when the runner is
browsing the event gallery (all-event mode) rather than searching.

### States

All states (loading, empty, error) are owned by `EventSearchComponent`, not this
child. This component always receives a non-empty `photos` array from its parent —
the parent controls when to render the grid at all.

**N/A**: Loading, Empty, Error (handled by parent).

**Success / default**: unchanged — renders the `@for` loop of `RunnerPhotoCardComponent`.

### Responsive behaviour

Unchanged. Grid breakpoints are already defined in `photo-grid.component.scss`:
- 375px: 1 column
- 768px: 2 columns
- 1280px: 3 columns, 24px gap

### Accessibility

- Update the `role="list"` `aria-label` as described in the Input change section above.
- No other accessibility changes required.

### Angular Material components to use

Unchanged from current implementation (`MatButtonModule`, `RunnerPhotoCardComponent`).

### NgRx integration

This component does not interact with the store directly. It receives `mode` as an
`@Input` from `EventSearchComponent`, which reads it from the store.

---

## Storybook stories to add/update

The story file is `events/event-search/event-search.component.stories.ts`.

Add the following named stories (supplement existing ones — do not remove existing
stories):

| Story name | State shape |
|---|---|
| `AllEventBrowse` | all-event mode, 24 photos loaded, `nextCursor: 'abc123'`, `totalCount: 312` |
| `AllEventBrowseLoadingMore` | all-event mode, 24 photos, `loadingMore: true`, `nextCursor: 'abc123'` |
| `AllEventBrowseAllLoaded` | all-event mode, 48 photos, `nextCursor: null`, `totalCount: 48` |
| `EmptyEventProcessing` | all-event mode, 0 photos, `loading: false`, `error: null`, `totalCount: 0` |
| `BibResultsWithCounter` | bib mode, 7 photos, `nextCursor: null`, `totalCount: 7`, `searchedBib: '101'` |
| `BibResultsLoadMore` | bib mode, 24 photos, `nextCursor: 'xyz'`, `totalCount: 50`, `searchedBib: '42'` |
| `LoadMoreError` | all-event mode, 24 photos loaded, `loadMoreError: 'network_error'` — snackbar visible |

Each story must include the new state fields in `runnerPhotosOverride`:
`nextCursor`, `totalCount`, `mode`, `loadingMore`, `loadMoreError`.

The existing `InitialState` story (`{ photos: [], searchedBib: null, loading: false }`)
now represents the transition state between route activation and the first
`loadEventPhotosSuccess`. The skeleton loader story (`Loading`) remains correct
as-is — it covers this transition.

---

## Template structure summary (EventSearchComponent)

The following is the intended order of template blocks inside `.results-section`
after this story. This supplements, not replaces, the existing HTML:

```
<section class="results-section" aria-live="polite" aria-atomic="false">

  <!-- Block 1: Initial load skeleton (existing, unchanged) -->
  @if (loading()) { ... skeleton-grid ... }

  <!-- Block 2: Error state for initial load (existing, unchanged) -->
  @else if (error()) { ... state-container role="alert" ... }

  <!-- Block 3: Empty — no indexed photos yet (NEW — AC7) -->
  @else if (mode() === 'all' && !loading() && photos().length === 0) {
    <div class="state-container" role="status"> hourglass_empty icon + text </div>
  }

  <!-- Block 4: Empty — bib search returned nothing (existing, updated condition) -->
  @else if (mode() === 'bib' && !loading() && photos().length === 0) {
    <div class="state-container" role="status"> existing no-results content </div>
  }

  <!-- Block 5: Results (all-event or bib mode) -->
  @else if (photos().length > 0) {

    <!-- Counter -->
    <div class="results-header">
      <p class="results-count" aria-live="polite" aria-atomic="true">
        Showing {{ photos().length }} of {{ totalCount() }} photos
        @if (mode() === 'bib') { for bib <strong>{{ searchedBib() }}</strong> }
      </p>
    </div>

    <!-- Grid -->
    <app-runner-photo-grid
      [photos]="photos()"
      [mode]="mode()"
      [pricePerPhoto]="selectedEvent()!.pricePerPhoto"
      [currency]="selectedEvent()!.currency"
      [eventId]="eventId()"
      [eventName]="selectedEvent()?.name ?? ''"
      [searchedBib]="searchedBib() ?? ''"
      (photoSelected)="onPhotoSelected($event)"
    />

    <!-- Load more row -->
    @if (nextCursor()) {
      <div class="load-more-row">
        <button
          mat-stroked-button
          class="load-more-btn"
          type="button"
          [disabled]="loadingMore()"
          [attr.aria-label]="loadingMore() ? 'Loading more photos' : 'Load more photos'"
          (click)="onLoadMore()"
        >
          @if (loadingMore()) {
            <mat-spinner diameter="20" />
            <span class="visually-hidden">Loading more photos</span>
          } @else {
            Load more photos
          }
        </button>
      </div>
    }

  }

</section>
```

---

## SCSS additions required

Add to `event-search.component.scss` (new rules only — do not modify existing rules):

```scss
// ── Load more row ─────────────────────────────────────────────────────────────

.load-more-row {
  display: flex;
  justify-content: center;
  padding-top: 24px;

  @media (min-width: 768px) {
    padding-top: 32px;
  }
}

.load-more-btn {
  position: relative;
  min-height: 48px;
  width: 100%;

  @media (min-width: 600px) {
    width: auto;
    min-width: 200px;
  }

  mat-spinner {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

Note: if `.visually-hidden` is already defined in `styles.scss` globally, do not
duplicate it here — use the global class directly.

---

## UX decisions made that are not in the story's ACs

The following decisions were made by this spec and were not explicitly stated in
the story. Flag these for team review before build begins.

**Decision 1 — Clear button is the primary AC4 mechanism, not blur-only.**
AC4 says "clears the bib field (empties it and blurs, or clicks a clear button)".
This spec makes the MatIconButton suffix the primary clear affordance and also
handles the form-submit-with-empty-value path. Blur-only detection (watching
`valueChanges` and triggering on the first empty value after a non-empty value) is
not implemented because it would fire mid-typing if the runner selects-all and
deletes. The team should confirm the clear button + empty-submit approach is
sufficient.

**Decision 2 — Load-more errors use MatSnackBar, not an inline error row.**
The story specifies no UI treatment for load-more errors (AC2 and the tech notes
describe the action but not the failure UI). The spec uses MatSnackBar with an
indefinite duration and a "Retry" action because it does not displace the already-
loaded photos, consistent with the runner persona's expectation that partial results
remain accessible. The team should confirm this over an alternative such as an
inline error chip below the grid.

**Decision 3 — Counter label: "Showing X of Y photos" (not "X / Y photos found").**
The story's tech notes show the exact template string
`Showing {{ photos().length }} of {{ totalCount() }} photos`. This spec uses that
verbatim. The team should confirm the copy, especially for the edge case where
Y is 0 (which transitions to the empty state, so the counter is never shown at Y=0).

**Decision 4 — Focus management after "Load more" removes the button.**
The story does not specify focus behaviour when the last page is loaded and the
"Load more" button disappears. This spec moves focus to the last newly appended
photo card in that case. If the implementation of card-level focus proves complex,
an acceptable fallback is to move focus to the results counter paragraph. The team
should decide before implementation.

**Decision 5 — Empty state heading copy.**
AC7 specifies the exact message: "Photos are still processing — check back soon".
This spec uses a split presentation: heading `Photos are still being processed`
(shorter, rendered at `h2` size) plus body text `Check back soon — photos appear
here as they are indexed.` This is a minor rewrite for readability at the h2 size.
If the team wants the AC7 text verbatim, use it as the heading without the body
paragraph.

**Decision 6 — `totalCount: 0` does not show the counter.**
The counter (`Showing X of Y photos`) is only rendered inside the `@else if
(photos().length > 0)` block. When the event has no indexed photos yet (AC7 empty
state), the counter is absent. This is consistent with Y reflecting the processed-
so-far count (AC6) and prevents displaying "Showing 0 of 0 photos" as an empty
state.

**Decision 7 — `skeletonCards` count stays at 6 for load-more skeleton.**
The existing skeleton grid shows 6 cards. During the initial all-event load, 6
skeleton cards are shown. During a "Load more" request, no skeleton cards are added
— only the button spinner is used. This avoids layout shift from inserting new
skeleton cards at the bottom of an existing populated grid. The team should confirm
this is acceptable.
