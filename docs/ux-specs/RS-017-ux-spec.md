# UX Spec — RS-017: `watermarking` transient status

**Story**: RS-017
**Persona**: Photographer — desktop-first power user; reviews processing outcomes from a dense card grid
**Date**: 2026-04-10
**Status**: draft

---

## Overview

This spec covers the two frontend deliverables for RS-017:

1. **`PhotoCardComponent` — `watermarking` state**: a fourth thumbnail-area rendering branch for photos whose status is `watermarking`. The photo has no `thumbnailUrl` in this state (always null per AC6). The card must communicate "still being finalised" rather than "something went wrong", which is what the existing `thumbnailUrl === null` placeholder currently implies when `status` is anything other than `watermarking`.

2. **`EventPhotosComponent` — filter chip bar**: `watermarking` must not appear as a selectable filter chip. This spec confirms the authoritative chip list and documents the exclusion explicitly.

No new component files are created. Both changes are confined to existing files.

---

## 1. `PhotoCardComponent` (`photo-card/photo-card.component.*`)

### Purpose

Render a fourth thumbnail-area state for `photo.status === 'watermarking'` that communicates active progress rather than absence or failure, so the photographer understands the photo is still being processed and not stuck.

### Background: existing thumbnail branches

The current template has three branches inside `.thumbnail-container`:

| Branch | Condition | Icon | Label |
|---|---|---|---|
| Loaded image | `photo.thumbnailUrl && !imageError()` | — | — |
| Thumbnail not yet available | `!photo.thumbnailUrl` | `hourglass_top` | "Processing" |
| Image load error | `photo.thumbnailUrl && imageError()` | `broken_image` | "Unavailable" |

The problem: branch 2 fires for every photo where `thumbnailUrl` is null — which now includes `watermarking` photos in addition to `processing` photos. Both show the same static `hourglass_top` placeholder, giving the photographer no way to distinguish "Rekognition is running" from "watermark is being applied". More critically, a `watermarking` photo that is stuck in the DLQ (AC5) looks identical to a `processing` photo, masking the problem.

### The new branch

Add a dedicated fourth branch that fires first when `photo.status === 'watermarking'`. The condition order in the template must be:

1. `photo.status === 'watermarking'` → shimmer skeleton (new)
2. `photo.thumbnailUrl && !imageError()` → loaded image (unchanged)
3. `!photo.thumbnailUrl` → static `hourglass_top` placeholder (unchanged, now only reached by `processing` and any other future non-watermarking null-thumbnail status)
4. `imageError()` → static `broken_image` placeholder (unchanged)

Because `watermarking` always has `thumbnailUrl === null` (AC6), branch 2 would never fire for a `watermarking` photo. Checking `status === 'watermarking'` first is the correct guard.

### Layout — `watermarking` thumbnail area

The shimmer skeleton fills the entire `.thumbnail-container` (the same `padding-top: 56.25%` / `position: relative` / `overflow: hidden` container used by the other branches).

Inside the container (using `position: absolute; inset: 0`):

- **Background**: `var(--mat-sys-surface-variant)` — same as the container background, so the shimmer appears to be "washing over" a blank photo area. This matches the shimmer pattern already used in the page-level skeleton cards (`event-photos.component.html` lines 59–60).
- **Shimmer animation**: a `linear-gradient` sweep from left to right, reusing the existing `.shimmer` keyframe animation already defined in the event-photos stylesheet. The shimmer class is applied directly to a `div` that fills the container with `position: absolute; inset: 0`.
- **Label row**: centred at the bottom of the container, above the shimmer layer (`z-index: 1`), using `position: absolute; bottom: 8px; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: 4px`:
  - A `mat-icon` `autorenew` at `20px`, colour `var(--mat-sys-on-surface-variant)`. The `autorenew` icon (a circular arrow) signals active processing distinctly from `hourglass_top` (waiting) and `broken_image` (failure). Do not use `hourglass_top` here — it is already the `processing` status icon and would create visual ambiguity.
  - A `<span class="mat-body-small placeholder-label">` with text "Finalizing watermark…" — matches the accessible label (see Accessibility below) and is consistent with the story's suggested wording in the tech notes.

The shimmer and label together occupy the full 16:9 thumbnail area. The label sits on top of the shimmer animation; both are inside the same `div.thumbnail-watermarking` container.

### How this differs from the existing `!photo.thumbnailUrl` placeholder

| Attribute | Existing `!thumbnailUrl` placeholder | New `watermarking` shimmer |
|---|---|---|
| Background | Static `var(--mat-sys-surface-variant)` | Animated shimmer on `var(--mat-sys-surface-variant)` |
| Icon | `hourglass_top` (static) | `autorenew` (static icon, shimmer behind it) |
| Label | "Processing" | "Finalizing watermark…" |
| `aria-label` on container | "Thumbnail not yet available" | "Finalizing watermark…" |
| Visual message | "Something hasn't happened yet" | "Work is actively in progress" |

The shimmer animation is the primary differentiator. A static placeholder with only an icon change would be insufficient — the motion communicates ongoing activity in a way a static icon cannot.

### SCSS changes (`photo-card.component.scss`)

Add a new block below the existing `.thumbnail-placeholder` rule:

```scss
.thumbnail-watermarking {
  position: absolute;
  inset: 0;
  overflow: hidden;

  // Shimmer layer — reuses the same @keyframes shimmer defined globally
  // (or in the parent component's stylesheet via ::ng-deep if not global).
  // If the shimmer keyframe is not yet global, define it here:
  //
  //   @keyframes shimmer {
  //     0%   { background-position: -400px 0; }
  //     100% { background-position: 400px 0; }
  //   }

  background: linear-gradient(
    90deg,
    var(--mat-sys-surface-variant) 25%,
    var(--mat-sys-surface-container-high) 50%,
    var(--mat-sys-surface-variant) 75%
  );
  background-size: 800px 100%;
  animation: shimmer 1.6s infinite linear;
}

.thumbnail-watermarking-label {
  position: absolute;
  bottom: 8px;
  left: 0;
  right: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: var(--mat-sys-on-surface-variant);

  // Slight translucent backing so the label is legible over the animated shimmer
  background: rgba(var(--mat-sys-surface-variant-rgb, 0 0 0), 0.4);
  padding: 4px 0;
}

.watermarking-icon {
  font-size: 20px;
  width: 20px;
  height: 20px;
}
```

Note on `--mat-sys-surface-container-high`: this is the M3 token for the lighter step in the neutral surface scale, available in Angular Material 17+ M3 themes. Use it as the shimmer highlight. If the deployed theme does not define it, fall back to `color-mix(in srgb, var(--mat-sys-surface-variant) 60%, white)`.

Note on `rgba` with CSS variable: the `background` with rgba on a CSS variable requires either a dedicated `-rgb` companion token or `color-mix`. The simpler alternative is to use `opacity: 0.85` on the label element itself if the project does not define RGB companion tokens. Document whichever approach is chosen.

### Template changes (`photo-card.component.html`)

Replace the current two-branch `@if / @else if / @else` inside `.thumbnail-container` with a four-branch structure. The first branch must be the new `watermarking` check:

```html
<div class="thumbnail-container">
  @if (photo.status === 'watermarking') {
    <div
      class="thumbnail-watermarking"
      aria-label="Finalizing watermark…"
      role="img"
    >
      <div class="thumbnail-watermarking-label" aria-hidden="true">
        <mat-icon class="watermarking-icon">autorenew</mat-icon>
        <span class="mat-body-small placeholder-label">Finalizing watermark…</span>
      </div>
    </div>
  } @else if (photo.thumbnailUrl && !imageError()) {
    <img … />
  } @else if (!photo.thumbnailUrl) {
    <div class="thumbnail-placeholder" aria-label="Thumbnail not yet available">
      <mat-icon class="placeholder-icon">hourglass_top</mat-icon>
      <span class="mat-body-small placeholder-label">Processing</span>
    </div>
  } @else {
    <div class="thumbnail-placeholder" aria-label="Thumbnail unavailable">
      <mat-icon class="placeholder-icon">broken_image</mat-icon>
      <span class="mat-body-small placeholder-label">Unavailable</span>
    </div>
  }
</div>
```

The `role="img"` on the watermarking container gives screen readers a landmark to read the `aria-label` from, equivalent to what an `<img alt="…">` would provide. The inner label row carries `aria-hidden="true"` because the outer container's `aria-label` is the authoritative accessible description — duplicating it would cause screen readers to announce it twice.

### Status badge — `watermarking`

The `PhotoStatusBadgePipe` must gain a `watermarking` entry in `BADGE_MAP`. The badge appears in the card content strip below the thumbnail for all statuses, including `watermarking`.

Add to `BADGE_MAP` in `photo-status-badge.pipe.ts`:

```typescript
watermarking: {
  cssClass: 'badge--watermarking',
  icon: 'autorenew',
  label: 'Finalizing',
},
```

Add to `photo-card.component.scss`:

```scss
&.badge--watermarking {
  background: var(--mat-sys-secondary-container);
  color: var(--mat-sys-on-secondary-container);
}
```

Rationale for `secondary-container`: it is visually distinct from `surface-variant` (used by `processing`) and from `tertiary-container` (used by `indexed`), without introducing a custom colour. It reads as "in-progress" without alarming the photographer. The `autorenew` icon on the badge echoes the thumbnail shimmer icon, reinforcing the "active processing" message at both points on the card.

The badge label "Finalizing" (not "Finalizing watermark…") keeps the badge compact — the thumbnail area carries the fuller label.

Add `badge--watermarking` to the SCSS `&.badge--*` block alongside the existing four variants.

### `PhotoStatus` type update (`photos.actions.ts`)

Add `'watermarking'` to the union:

```typescript
export type PhotoStatus =
  | 'processing'
  | 'watermarking'
  | 'indexed'
  | 'review_required'
  | 'error';
```

This is a prerequisite for the pipe's `BADGE_MAP` to be typed correctly and for `FilterChip` interfaces to compile without casting.

### States

- **Loading (initial)**: N/A — handled at grid level by `EventPhotosComponent` skeleton cards, not by `PhotoCardComponent`.
- **`watermarking` (new)**: animated shimmer in thumbnail area + `autorenew` icon + "Finalizing watermark…" label + `badge--watermarking` badge in content strip. This is the state specified by RS-017 AC3 and AC5.
- **`processing`**: unchanged — static `hourglass_top` icon, "Processing" label, `badge--processing` badge.
- **Thumbnail loaded (indexed, review_required)**: unchanged.
- **Image error**: unchanged — `broken_image` icon, "Unavailable" label.
- **Error status**: unchanged — `badge--error` badge + info tooltip button.

### Responsive behaviour

#### 375px (mobile)

No layout changes inside the card for the `watermarking` state. The shimmer fills the same 16:9 container at whatever card width the two-column grid produces. The bottom-aligned label and icon remain visible at the smaller card width. The timestamp row is hidden on mobile (existing rule, unchanged).

The `badge--watermarking` badge in the content strip is the same inline `<span>` size as all other badges — no change needed.

Touch target: the `watermarking` card is entirely non-interactive (no tooltip button, no click handler). No touch target consideration beyond the parent grid layout.

#### 1280px (desktop)

The default layout described above. At ~220px card width (five-column grid), "Finalizing watermark…" fits on one line in `mat-body-small` at 12px with no truncation.

### Accessibility

- The `.thumbnail-watermarking` container carries `aria-label="Finalizing watermark…"` and `role="img"` so screen readers announce the state as if it were an image description.
- The inner label row (icon + text) carries `aria-hidden="true"` to prevent double-announcement.
- The `badge--watermarking` badge in the content strip carries `[attr.aria-label]="'Status: ' + badge.label"` (existing pattern from the `@let badge` block), so screen readers announce "Status: Finalizing" as a complement to the thumbnail description.
- The shimmer animation must respect `prefers-reduced-motion`. Add to the SCSS:
  ```scss
  @media (prefers-reduced-motion: reduce) {
    .thumbnail-watermarking {
      animation: none;
      background: var(--mat-sys-surface-variant);
    }
  }
  ```
  In reduced-motion mode the card degrades to a static `surface-variant` fill — identical in appearance to the `processing` placeholder background but distinguished by the `autorenew` icon and "Finalizing watermark…" label.
- Colour is not the sole indicator of state: the `watermarking` state uses the shimmer animation, the `autorenew` icon, the label text, and the `secondary-container` badge colour — all four independently communicate the state.
- The `autorenew` icon carries `aria-hidden="true"` (as all decorative icons in this component do) because the surrounding text label is the accessible description.

### Angular Material components to use

| Component | Usage |
|---|---|
| `MatIcon` | `autorenew` icon in thumbnail area label and badge |

No new Material components are needed. The shimmer is a CSS animation on a plain `div`, consistent with the existing skeleton shimmer approach used in `EventPhotosComponent`.

### NgRx integration

`PhotoCardComponent` remains a presentational component. It dispatches no actions and subscribes to no selectors. The `watermarking` state is rendered from `@Input() photo: Photo` — the component reacts to the status value on the input, not to the store directly.

The only store-layer change is in `photos.actions.ts`: adding `'watermarking'` to `PhotoStatus`. This propagates automatically to the selectors, reducer, and effects that reference the type.

---

## 2. `EventPhotosComponent` — filter chip bar (`event-photos.component.ts` / `.html`)

### Confirmed chip list (current, before RS-017)

The `filterChips` array in `event-photos.component.ts` (line 70–76) contains exactly:

| Chip label | `value` |
|---|---|
| All | `null` |
| Indexed | `'indexed'` |
| Review Required | `'review_required'` |
| Error | `'error'` |
| Processing | `'processing'` |

### RS-017 requirement (AC4)

`watermarking` must not appear in this list. The photographer cannot meaningfully filter to `watermarking` photos — the status is transient and is expected to resolve to `indexed` or `review_required` within seconds. Surfacing it as a chip would confuse the photographer ("why are there permanent 'Finalizing' photos?") and encourage filtering to a set that should always be empty under normal operation.

The `filterChips` array must remain as-is after RS-017. No entry for `watermarking` is added.

**Operator escape hatch**: the story's tech notes specify that the `GET /events/{id}/photos?status=watermarking` API endpoint returns 200 (once the Lambda's `validStatuses` list is updated). Operators can query stuck-watermarking photos via the API directly. This is intentionally not surfaced in the photographer UI.

### Empty-state message when `watermarking` photos appear under "All"

When the photographer views the "All" chip (no status filter), `watermarking` photos appear in the grid and display their shimmer cards. No special empty-state message is needed — the "All" chip always shows all photos regardless of status.

The existing empty-state message "No photos yet" / "Photos appear here once uploaded and processed." continues to cover the case where zero photos have been uploaded.

### `filterLabel()` guard

`EventPhotosComponent.filterLabel()` uses `filterChips.find()` to translate an active `PhotoStatus | null` into a human-readable string for the empty-state heading. Because `watermarking` is never an active filter (it is not in `filterChips`), `filterLabel('watermarking')` will never be called from a chip interaction. However, the method falls back to `''` (empty string) if no chip matches, which is safe. No defensive case is needed.

---

## Storybook stories

### `PhotoCardComponent` stories — additions

Add one story to the existing `photo-card.component.stories.ts`:

| Story export name | `photo` input | Notes |
|---|---|---|
| `Watermarking` | `status: 'watermarking'`, `bibNumbers: []`, `thumbnailUrl: null` | Shows shimmer thumbnail area + "Finalizing" badge; no bib numbers (bibs are not yet confirmed at this stage) |

The story should demonstrate the shimmer animation at rest. Document in the story's `parameters.docs.description` that the shimmer animation can be disabled via `prefers-reduced-motion`.

### `PhotoStatusBadgePipe` stories — additions

Add `watermarking` to the existing all-badges story. The `watermarking` badge should appear between `processing` and `indexed` in the flex row to reflect pipeline order.

### `EventPhotosComponent` stories — updates

The existing `LoadedWithPhotos` story currently provides 12 mock photos (3 each of 4 statuses). Add 3 `watermarking` mock photos to the mock data (bringing the total to 15). The story should demonstrate that:

- The shimmer cards appear correctly in the grid alongside loaded cards.
- No `watermarking` chip appears in the filter row.

---

## Playwright E2E tests

Two new test cases are required:

**Test 1 — Watermarking card renders shimmer**
Given a mock API response containing a photo with `status: 'watermarking'` and `thumbnailUrl: null`, when the event photos page loads, then:
- A `.thumbnail-watermarking` element is visible within the card.
- The element's `aria-label` attribute equals "Finalizing watermark…".
- The status badge text within the card's content strip reads "Finalizing".
- Take a Playwright screenshot snapshot as the visual baseline for the shimmer state (animation will be paused/skipped by Playwright's default `--disable-gpu` and CSS animation pause in test mode — confirm behaviour and snapshot accordingly).

**Test 2 — Watermarking chip absent**
Given the event photos page loads (any set of photos), then:
- No `mat-chip-option` with the text "Watermarking" is present in the DOM.
- The chip listbox contains exactly: "All", "Indexed", "Review Required", "Error", "Processing".

---

## UX decisions not explicitly stated in the story ACs

**UX-D1 — `autorenew` icon chosen over `sync` or `cached`.**
The story tech notes suggest "a shimmer skeleton" but do not specify an icon. `autorenew` (circular arrow) is chosen over `sync` (two arrows) and `cached` (a stack) because it most directly conveys "a transformation is happening" (the watermark being applied), not "data is being refreshed". `hourglass_top` is deliberately avoided because it is already the `processing` badge icon — reusing it would eliminate the visual distinction this story is designed to create. The team should confirm the icon choice before implementation.

**UX-D2 — Badge label "Finalizing" rather than "Watermarking".**
"Watermarking" is an internal pipeline term. Photographers understand the watermark as an output, not as a verb describing a step. "Finalizing" communicates "almost ready" in plain language. The accessible description on the thumbnail container uses the fuller phrase "Finalizing watermark…" for context. The team may prefer "Processing" (matching the existing badge), but that would make the two transient states visually identical in the content strip — this spec deliberately distinguishes them.

**UX-D3 — Shimmer label is bottom-aligned, not centred.**
Centering the icon and label in the 16:9 area would place them at the same vertical position as the existing `processing` placeholder. Using `bottom: 8px` alignment distinguishes the layout subtly and leaves the upper portion of the card for the shimmer animation to read as a "space being filled". This is an author preference — the team may prefer centred alignment for consistency with the static placeholders.

**UX-D4 — `secondary-container` token for the `watermarking` badge.**
The story does not specify badge colours. `secondary-container` is chosen because it is visually distinct from the four existing badge colours (`tertiary-container` for indexed, amber for review_required, `error-container` for error, `surface-variant` for processing) while remaining within the M3 token system (no custom hex values needed). The team should verify this colour is acceptable against the deployed theme's secondary palette.

**UX-D5 — `watermarking` photos show zero bibs in the card bib row.**
At `watermarking` status, bib detection has completed (Rekognition ran in the photo-processor Lambda) but the final bib assignment is written by the watermark Lambda alongside `status: 'indexed'`. The API response for a `watermarking` photo includes the detected bib numbers from Rekognition in the `bibNumbers` field (or an empty array if none were detected). The card should render bib numbers as normal if the API populates them, or "No bibs detected" if not. This spec does not change the bib-row rendering logic — it relies on whatever the API returns. The story's Storybook story uses `bibNumbers: []` as the representative case because `watermarking` most commonly occurs before the final write confirms bibs; however, the component handles both. Confirm with the backend spec whether `bibNumbers` is populated at `watermarking` status.
