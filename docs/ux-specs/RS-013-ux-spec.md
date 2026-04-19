# UX Spec — RS-013: Photographer manually tags bib numbers

**Story**: RS-013  
**Route**: `/photographer/dashboard/review` (tab within the existing dashboard)  
**Persona**: Photographer — desktop-first, power user, efficiency-oriented  
**Date**: 2026-04-18

---

## Components covered

1. `ReviewQueueComponent` — the review tab content, hosts the photo card grid
2. `ReviewPhotoCardComponent` — one card per photo needing review (new, distinct from the read-only `PhotoCardComponent` in `event-photos/`)
3. `BibTagInputComponent` — chip-based bib number input with validation

> UX DECISION (not in ACs): A new `ReviewPhotoCardComponent` is specified rather than extending the existing `PhotoCardComponent` at `event-photos/photo-card/photo-card.component.ts`. The existing card is read-only (checkbox selection, status badge, uploaded-at metadata). The review card requires an interactive form (chip input + Save button + per-card save state). Merging these concerns into one component would make both significantly harder to test and maintain. The build agent must treat them as separate components.

---

## ReviewQueueComponent (`src/app/features/photographer/dashboard/review/review-queue.component.ts`)

### Purpose

Displays all photos in the selected event that require manual bib tagging (`status=review_required` or `status=error`), so the photographer can enter correct bib numbers and save them one card at a time.

### Layout

This component is a tab panel rendered inside `DashboardComponent`'s `<mat-tab-group>`. It owns everything below the tab strip.

**Desktop (1280px) — default:**

```
┌─────────────────────────────────────────────────────────────────┐
│ [Queue count badge: "12 photos to review"]         [Refresh btn]│
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  Card    │  │  Card    │  │  Card    │  │  Card    │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│  ┌──────────┐  ┌──────────┐  ...                               │
│  │  Card    │  │  Card    │                                     │
│  └──────────┘  └──────────┘                                     │
└─────────────────────────────────────────────────────────────────┘
```

- The header row contains a muted count label ("12 photos to review") on the left and a secondary "Refresh" `MatIconButton` (refresh icon, `aria-label="Refresh review queue"`) on the right.
- Below the header: a CSS grid of `ReviewPhotoCardComponent` instances.
- Grid: 4 columns at 1280px. Column width is fixed via `repeat(4, 1fr)` with a 16px gap.
- The grid scrolls vertically within the tab panel — there is no horizontal scroll.
- No pagination controls in v1 (single cursor per AC5, no "Load more" button needed until cursor support is wired; the full first page is displayed).

**Mobile (375px):**

- The count label and Refresh button stack: count label takes full width on its own line, Refresh button is right-aligned below it.
- Grid collapses to 1 column (single-column stacked list of cards).
- Cards are full-width.

### States

**Loading:**

- Show a 2×4 grid (desktop) or 2×1 column (mobile) of skeleton cards.
- Each skeleton card matches the dimensions of a real card: a grey rectangle for the thumbnail area (16:9 aspect ratio), two skeleton chips below it, and a skeleton input field.
- Use `MatProgressSpinner` with `mode="indeterminate"` centered above the skeleton grid — diameter 32px.
- The count label area shows a single 120px wide skeleton bar.
- The Refresh button is disabled during loading.

**Empty:**

- Hide the grid entirely.
- Center an empty-state block vertically and horizontally within the tab panel.
- Content (top to bottom):
  - `mat-icon`: `check_circle` in the theme's primary colour, 48px.
  - Heading (`mat-body-large` weight medium): "All photos have been processed."
  - Sub-text (`mat-body-medium` muted): "Nothing to review."
- No CTA button. The photographer has nothing to act on.

**Error (API failure loading the queue):**

- Hide the grid entirely.
- Center an error-state block:
  - `mat-icon`: `error_outline` in the theme's error colour, 48px.
  - Heading: "Could not load the review queue."
  - Sub-text: display the error string from the store, or fall back to "An unexpected error occurred."
  - A `MatButton` (stroked, colour="warn"): "Try again" — dispatches `ReviewQueueActions.loadReviewQueue({ eventId })`.

**Success / default (loaded-with-items):**

- The header row shows the count of photos returned.
- The grid shows all `ReviewPhotoCardComponent` instances.
- Each card manages its own save state independently (see card spec below).

### Responsive behaviour

- **375px**: 1-column grid, full-width cards, count label wraps to its own line.
- **1280px**: 4-column grid, 16px gap, count label and Refresh button on one row.

### Accessibility

- The tab panel itself carries `role="tabpanel"` (supplied by `MatTabsModule`).
- The count label is an `<h2>` styled with Material typescale — not just a `<p>` — so screen readers announce the section.
- The Refresh `MatIconButton` has `aria-label="Refresh review queue"`.
- The skeleton loading region has `aria-busy="true"` and `aria-label="Loading review queue"` on its container.
- The empty-state and error-state containers have `role="status"` so screen readers announce the change without requiring focus.
- Focus is not moved programmatically when the state transitions from loading to loaded — the tab panel retains focus.

### Angular Material components to use

- `MatTabsModule` — already used by `DashboardComponent`; this component is the panel content for the "Review" tab
- `MatIconModule` — for the empty-state icon, error icon, and Refresh button icon
- `MatIconButton` — Refresh button
- `MatProgressSpinner` — loading indicator
- `MatButton` — "Try again" error recovery button (stroked variant)

### NgRx integration

**New NgRx slice required**: `store/review-queue/` — separate from `store/photos/` because the review queue has distinct save-per-card loading/error state that must not pollute the general photos slice.

Selectors this component subscribes to:

| Selector | Purpose |
|---|---|
| `selectReviewQueueLoading` | drives skeleton / spinner state |
| `selectReviewQueueError` | drives error state |
| `selectReviewPhotos` | the array of photos to render |
| `selectSelectedEvent` | provides `eventId` for the API call (from existing `events` slice) |

Actions dispatched:

| User event | Action |
|---|---|
| Component `ngOnInit` | `ReviewQueueActions.loadReviewQueue({ eventId })` |
| Refresh button click | `ReviewQueueActions.loadReviewQueue({ eventId })` |

The effect for `loadReviewQueue` calls `GET /events/{id}/photos?status=review_required,error`, maps the response to `ReviewQueueActions.loadReviewQueueSuccess` or `ReviewQueueActions.loadReviewQueueFailure`.

> UX DECISION (not in ACs): A dedicated `review-queue` NgRx slice is specified rather than reusing `store/photos/`. The photos slice uses a single `loading`/`error` flag for the whole list AND does not track per-photo save state. Adding save state per photo ID into the photos slice would require significant reducer surgery that risks breaking RS-008's event photos page. The review queue slice is isolated and can be removed or evolved independently.

---

## ReviewPhotoCardComponent (`src/app/features/photographer/dashboard/review/review-photo-card.component.ts`)

### Purpose

Displays a single photo that requires review, with its watermarked thumbnail, current bib chips, a bib tag input, and a Save button — giving the photographer everything needed to tag and save the photo without leaving the queue.

### Layout

Each card is a `MatCard` with the following vertical structure:

```
┌───────────────────────────────────┐
│  [Thumbnail — 16:9 aspect ratio]  │
│  [ERROR badge if status=error]    │
├───────────────────────────────────┤
│  [Current bib chips row]          │
│  [BibTagInputComponent]           │
│  [Uploaded at — muted caption]    │
├───────────────────────────────────┤
│  [Save button — full width]       │
└───────────────────────────────────┘
```

**Thumbnail area:**

- The watermarked thumbnail fills the card width at a fixed 16:9 aspect ratio (use `aspect-ratio: 16/9` CSS, `object-fit: cover`).
- If `thumbnailUrl` is null or the image fails to load, show a grey placeholder with a centred `mat-icon` (`image_not_supported`, 32px, muted colour).
- For `status=error` photos: overlay an "Error" `MatChip` (colour="warn") in the top-left corner of the thumbnail, styled `position: absolute; top: 8px; left: 8px`. The chip contains a `warning` mat-icon followed by the text "Error".
- For `status=review_required` photos: no badge on the thumbnail.

**Bib chips row (below thumbnail):**

- Shows the photo's current `bibNumbers` as read-only `MatChip` elements (non-interactive, `selectable="false"`, `removable="false"`). These are the last-saved bibs, not the in-progress input chips.
- If `bibNumbers` is empty, show muted text "No bibs tagged yet" in place of chips.
- This row is always visible — it shows the saved state, not the editing state.

**BibTagInputComponent:**

- Rendered directly below the bib chips row.
- Full width of the card content area.
- See dedicated spec section below.

**Uploaded at caption:**

- Single line of muted `mat-caption` text: "Uploaded {date formatted as 'dd MMM yyyy, HH:mm'}".
- Positioned below the BibTagInput.

**Save button:**

- `MatButton` with `color="primary"`, full width (`style="width:100%"`).
- Label: "Save bibs"
- Disabled when: `BibTagInputComponent` has no chips entered (pending bib list is empty) AND `bibNumbers` is also empty (no existing bibs to re-confirm). In other words: disabled if the photographer has not entered any bib numbers at all.
- Shows a `MatProgressSpinner` (diameter 18px, inline-start of the label) when save is in progress for this card.
- After a successful save: the button briefly shows a `check` icon (200ms) then returns to normal. The card's bib chips row updates to reflect the newly saved bibs. The card does NOT disappear immediately — it remains visible until the next refresh (AC7 says "moves out of queue on next refresh").

**Error state for save:**

- Shown below the Save button as an inline `MatError`-styled `<p>` with `role="alert"`: "Failed to save. Please try again."
- The Save button remains enabled so the photographer can retry.

**Error photo message (AC8):**

- For `status=error` cards, add a muted text block below the thumbnail and above the bib chips row:
  "Processing failed — assign bibs manually or leave for review."
- This message is always visible for error-status cards. It is not dismissible.

### States

**Loading (card-level, during save):**

- Save button shows spinner + "Saving…" label.
- Save button and `BibTagInputComponent` are both disabled.
- No spinner on the thumbnail.

**Empty (no chips in input, no existing bibs):**

- Save button is disabled.
- `BibTagInputComponent` shows its placeholder text.
- Bib chips row shows "No bibs tagged yet".

**Error (save failure):**

- Inline error message below Save button: "Failed to save. Please try again."
- Save button re-enabled.
- `BibTagInputComponent` remains enabled.

**Success / default:**

- Thumbnail rendered.
- Bib chips row shows current (saved) bib numbers.
- `BibTagInputComponent` ready for input.
- Save button enabled (if chips are present or bibs exist).
- For `status=error` photos: Error badge overlay and error message are always present regardless of save state.

### Responsive behaviour

- **375px**: Card is full-width. Save button full-width. All fields stack vertically as described. Touch targets: Save button minimum height 48px; chip remove buttons minimum 44×44px touch target (Angular CDK handles this for `MatChip`).
- **1280px**: Card occupies one grid cell (approximately 280px wide at 4 columns with 16px gaps in a 1280px container). All elements are full-width within the card.

### Accessibility

- `MatCard` container: `role="article"` — each card is a self-contained reviewable item.
- The card has `aria-label="Photo uploaded {date}, status {status}"` on its root element.
- The "Error" badge chip has `aria-label="Processing error"`.
- The error message paragraph for `status=error` has `id="error-msg-{photoId}"` so `BibTagInputComponent` can reference it with `aria-describedby` if needed.
- The Save button has `aria-label="Save bib numbers for photo {photoId}"` to distinguish between multiple Save buttons on the page.
- When save is in progress, the Save button carries `aria-busy="true"`.
- The inline save-error paragraph has `role="alert"` so screen readers announce it immediately on appearance.
- The "No bibs tagged yet" text is wrapped in a `<span aria-live="polite">` so it announces when chips are cleared.

### Angular Material components to use

- `MatCardModule` — card container, card content, card actions
- `MatChipsModule` — read-only bib chips in the saved bibs row; "Error" badge chip
- `MatIconModule` — warning icon in error badge, image_not_supported fallback, check icon on success
- `MatButtonModule` — Save button (raised, primary)
- `MatProgressSpinnerModule` — inline spinner in Save button while saving

### NgRx integration

The card receives its `photo: ReviewPhoto` as an `@Input`. It does not subscribe to the store directly — the parent `ReviewQueueComponent` selects the list and passes items down. This keeps the card independently testable.

The card dispatches to the `review-queue` slice:

| User event | Action |
|---|---|
| Save button clicked | `ReviewQueueActions.savePhotoBibs({ photoId, bibNumbers })` |

The component subscribes to two per-photo selectors (passed by the parent or derived via `selectSaveLoadingForPhoto(photoId)` and `selectSaveErrorForPhoto(photoId)` memoised selectors):

| Selector | Purpose |
|---|---|
| `selectSaveLoadingForPhoto(photoId)` | drives Save button spinner and disabled state |
| `selectSaveErrorForPhoto(photoId)` | drives inline error message |

The `savePhotoBibs` effect calls `PUT /photos/{id}/bibs` and dispatches `ReviewQueueActions.savePhotoBibsSuccess` or `ReviewQueueActions.savePhotoBibsFailure`. On success:
1. The review-queue reducer updates the photo's `bibNumbers` and `status` in the `reviewPhotos` array in place — the card re-renders with updated chips and a success checkmark.
2. The effect **also dispatches `PhotosActions.upsertPhoto({ photo: updatedPhoto })`** into `store/photos/` so the event gallery (RS-008) reflects the new bib numbers immediately without a page reload. The card itself stays visible in the review queue until the next refresh (AC7).

> UX DECISION (not in ACs): Per-photo save loading/error state is stored as a `Record<photoId, boolean>` and `Record<photoId, string | null>` in the review-queue slice state. This mirrors the pattern used in `store/approvals/` (`selectActionLoadingMap`, `selectActionErrorMap`) which already exists in the codebase.

---

## BibTagInputComponent (`src/app/features/photographer/dashboard/review/bib-tag-input.component.ts`)

### Purpose

Provides a chip-based text input where the photographer types bib numbers one at a time, adding them as chips by pressing Enter or comma, and removing them by clicking the chip's remove icon — producing a validated list of bib numbers that the parent card passes to the Save action.

### Layout

```
┌──────────────────────────────────────────────────────┐
│ [chip: 101 ×]  [chip: 102 ×]  [input: "Add bib..."] │
│ [error text if validation fails]                      │
└──────────────────────────────────────────────────────┘
```

- A single `MatFormField` using `appearance="outline"`.
- Label: "Bib numbers" (floating label).
- Inside the form field: a `MatChipGrid` + `MatChipRow` per entered bib number, followed by a `MatChipInput`.
- Each chip: displays the bib number string with a remove icon button (`mat-icon`: `cancel`, `aria-label="Remove bib {number}"`).
- The text input placeholder (shown when no chips are present and the input is focused): "Type a bib and press Enter".
- The form field hint (always visible below the field): "Separate multiple bibs with Enter or comma."
- No character counter. Bib numbers are short (typically 1–5 digits).

### States

**Empty:**

- No chips in the grid.
- Placeholder text visible: "Type a bib and press Enter".
- Hint text visible.
- No error shown.

**With-chips:**

- One or more chip rows rendered.
- Input remains active after each chip is added — the photographer can immediately type the next bib.
- Chip order reflects insertion order (no sorting). The photographer may remove any chip by clicking its remove icon.

**Saving:**

- The `disabled` input is `true`.
- All chips lose their remove buttons (rendered without `[removable]`).
- The text input is hidden.
- The `MatFormField` carries `aria-disabled="true"`.

**Error (validation):**

- Triggered when the photographer commits a value (Enter or comma or blur) that fails validation.
- Validation rules:
  1. Empty or whitespace-only: rejected silently (the chip is not added; no error shown).
  2. Duplicate bib already in the chip list: rejected; show `MatError`: "Bib {number} is already added."
  3. Non-numeric characters (anything other than digits 0–9): rejected; show `MatError`: "Bib numbers must contain digits only."
  4. Longer than 10 characters: rejected; show `MatError`: "Bib number is too long."
- Only one error is shown at a time (first rule that fires wins).
- The invalid input text remains in the field so the photographer can correct it.
- Error is cleared as soon as the photographer modifies the input.

> UX DECISION (not in ACs): Rule 1 (empty/whitespace rejection) is silent (no error shown) because AC4 only defines a server-side 400 for empty strings. The client silently discards them to match the server's intent without alarming the user. Rules 2–4 are client-side UX guards not mentioned in the ACs — flagged here for team review. The backend must still validate and return 400 for invalid input; these guards are defence-in-depth only.

### Interaction details

**Adding a chip:**

1. Photographer types characters into the input.
2. On `Enter` key or `,` character: the current input value is trimmed of whitespace and commas.
3. If trimmed value passes validation: a new chip is added, the input clears, focus stays in the input.
4. If trimmed value fails validation: the chip is not added, the error message is shown, the raw value stays in the input.

**Removing a chip:**

- Click the chip's remove icon: the chip is removed from the list. Focus returns to the text input.
- Keyboard: when focus is on a chip, `Backspace` or `Delete` removes the chip (standard `MatChipRow` behaviour).

**Tab / Blur behaviour:**

- On blur, if the input contains a non-empty value that has not been committed: attempt to add it as a chip using the same validation logic. This prevents data loss when the photographer clicks Save immediately after typing a bib without pressing Enter.

> UX DECISION (not in ACs): The "commit on blur" behaviour is not in the ACs but is a standard chip-input UX pattern that prevents the most common data-loss scenario. Flagged for team review.

**Output:**

- The component exposes an `@Output() bibsChanged = new EventEmitter<string[]>()` that emits the current chip list after every add or remove.
- The parent `ReviewPhotoCardComponent` stores this list locally (a component-level signal) and passes it to the `savePhotoBibs` action on Save click.
- The component also accepts `@Input() initialBibs: string[]` — pre-populated when the photo already has `bibNumbers` (so the photographer can adjust existing tags rather than re-entering everything).
- The component accepts `@Input() disabled: boolean` — set to `true` by the parent during save.

### Responsive behaviour

- **375px**: The `MatFormField` is full-width. Chips wrap onto multiple lines naturally. Each chip remove button is at least 44×44px touch target (Material default). The input field itself has a minimum height of 48px even when empty.
- **1280px**: Same full-width within the card. Chips wrap as needed.

### Accessibility

- `MatFormField` label "Bib numbers" is the programmatic label for the whole chip grid.
- Each chip's remove button: `aria-label="Remove bib {number}"`.
- The `MatChipInput` has `aria-label="Add bib number"`.
- Validation errors rendered as `MatError` inside the `MatFormField` are automatically associated with the input via Angular Material's form field infrastructure.
- The chip grid announces chip additions and removals via `aria-live="polite"` (built into `MatChipGrid`).
- The hint text ("Separate multiple bibs with Enter or comma") is linked to the input via `MatHint`, which Angular Material renders with the correct `aria-describedby` relationship.
- When `disabled` is `true`: the `MatFormField` and all chips communicate their disabled state via standard ARIA (`aria-disabled`). The tab stop is removed from the text input (`tabindex="-1"` applied by Material when disabled).
- Keyboard navigation within the chip grid follows the standard `MatChipGrid` pattern: Tab moves into the grid, arrow keys move between chips, Backspace/Delete removes the focused chip, Tab from the last chip moves to the text input.

### Angular Material components to use

- `MatFormFieldModule` — `appearance="outline"` form field wrapper
- `MatChipsModule` — `MatChipGrid`, `MatChipRow`, `MatChipInput` (do not use the deprecated `MatChipList`)
- `MatIconModule` — remove icon (`cancel`) inside each chip
- `MatInputModule` — the underlying input element within `MatChipInput`

### NgRx integration

`BibTagInputComponent` is a pure presentational component. It has no store dependency. All state is managed via `@Input`/`@Output` and component-local signals. The parent `ReviewPhotoCardComponent` owns the connection between this component's output and the store action.

---

## Storybook story requirements

### `ReviewQueueComponent` stories (`review-queue.component.stories.ts`)

| Story name | Store state to provide |
|---|---|
| `loading` | `selectReviewQueueLoading = true`, `selectReviewPhotos = []` |
| `loaded-with-items` | `selectReviewQueueLoading = false`, `selectReviewPhotos` = array of 6 mock photos (mix of `review_required` and `error` statuses, some with existing bibs, some without) |
| `empty` | `selectReviewQueueLoading = false`, `selectReviewPhotos = []`, no error |

For `loaded-with-items`: include at least one photo with `status=error` to exercise the error badge, and at least one with pre-existing `bibNumbers` to exercise the chip pre-population.

### `BibTagInputComponent` stories (`bib-tag-input.component.stories.ts`)

| Story name | `@Input` values |
|---|---|
| `empty` | `initialBibs = []`, `disabled = false` |
| `with-chips` | `initialBibs = ['101', '102', '237']`, `disabled = false` |
| `saving` | `initialBibs = ['101', '102']`, `disabled = true` |
| `error` | `initialBibs = []`, `disabled = false` — use Storybook play function to type a duplicate bib and trigger the validation error state |

---

## New NgRx slice: `store/review-queue/`

The build agent must generate all four files before the components.

### State shape

```typescript
interface ReviewQueueState {
  photos: ReviewPhoto[];
  loading: boolean;
  error: string | null;
  saveLoading: Record<string, boolean>;   // keyed by photoId
  saveError: Record<string, string | null>; // keyed by photoId
}

interface ReviewPhoto {
  id: string;
  status: 'review_required' | 'error';
  thumbnailUrl: string | null;
  bibNumbers: string[];
  uploadedAt: string;
  errorReason: string | null;
}
```

### Actions

```
ReviewQueueActions.loadReviewQueue({ eventId })
ReviewQueueActions.loadReviewQueueSuccess({ photos })
ReviewQueueActions.loadReviewQueueFailure({ error })
ReviewQueueActions.savePhotoBibs({ photoId, bibNumbers })
ReviewQueueActions.savePhotoBibsSuccess({ photoId, updatedPhoto })
ReviewQueueActions.savePhotoBibsFailure({ photoId, error })
```

### Selectors

```
selectReviewQueueLoading
selectReviewQueueError
selectReviewPhotos
selectSaveLoadingForPhoto(photoId: string) — memoised factory selector
selectSaveErrorForPhoto(photoId: string)  — memoised factory selector
selectReviewPhotoCount                    — derived: selectReviewPhotos.length
```

### Effects

| Action | Side effect |
|---|---|
| `loadReviewQueue` | `GET /events/{eventId}/photos?status=review_required,error` |
| `savePhotoBibs` | `PUT /photos/{photoId}/bibs` with `{ bibNumbers }`; on success also dispatches `PhotosActions.upsertPhoto` to patch `store/photos/` for gallery cache consistency |

Both effects use the Cognito JWT (from `store/auth` selectors) as the Bearer token.

---

## File paths summary

| File | Purpose |
|---|---|
| `src/app/features/photographer/dashboard/review/review-queue.component.ts` | Queue page tab content |
| `src/app/features/photographer/dashboard/review/review-queue.component.html` | Template |
| `src/app/features/photographer/dashboard/review/review-queue.component.scss` | Grid layout, skeleton styles |
| `src/app/features/photographer/dashboard/review/review-queue.component.spec.ts` | Unit tests |
| `src/app/features/photographer/dashboard/review/review-queue.component.stories.ts` | Storybook: loading, loaded-with-items, empty |
| `src/app/features/photographer/dashboard/review/review-photo-card.component.ts` | Single photo card |
| `src/app/features/photographer/dashboard/review/review-photo-card.component.html` | Template |
| `src/app/features/photographer/dashboard/review/review-photo-card.component.scss` | Thumbnail aspect ratio, badge overlay, button layout |
| `src/app/features/photographer/dashboard/review/review-photo-card.component.spec.ts` | Unit tests |
| `src/app/features/photographer/dashboard/review/bib-tag-input.component.ts` | Chip-based bib input |
| `src/app/features/photographer/dashboard/review/bib-tag-input.component.html` | Template |
| `src/app/features/photographer/dashboard/review/bib-tag-input.component.scss` | Form field overrides |
| `src/app/features/photographer/dashboard/review/bib-tag-input.component.spec.ts` | Unit tests |
| `src/app/features/photographer/dashboard/review/bib-tag-input.component.stories.ts` | Storybook: empty, with-chips, saving, error |
| `src/app/store/review-queue/review-queue.actions.ts` | Actions + ReviewPhoto interface |
| `src/app/store/review-queue/review-queue.reducer.ts` | State + reducer |
| `src/app/store/review-queue/review-queue.effects.ts` | HTTP side effects |
| `src/app/store/review-queue/review-queue.selectors.ts` | All selectors including factory selectors |
