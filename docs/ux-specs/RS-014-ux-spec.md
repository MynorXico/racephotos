# UX Spec — RS-014: Public events listing homepage

**Story**: RS-014  
**Route**: `/` (public, no auth guard)  
**Persona**: Runner — casual user, mobile-first, unfamiliar with the platform  
**Written**: 2026-04-19

---

## Overview

The homepage is the primary organic discovery channel for runners who do not have
a direct event link. Two components compose this page:

- `EventsListPageComponent` — the route host. Owns the page shell, dispatches the
  initial load, and manages "Load more" pagination state.
- `EventCardComponent` — a reusable, fully presentational card that renders one
  event's name, date, and location. Must have a Storybook story file.

The existing `store/events/` NgRx slice is extended with a new `listPublicEvents`
action group so that the public listing does not collide with the authenticated
photographer event actions that share the same feature key.

### Current routing gap

`app.routes.ts` currently redirects `/` to `/login`. This redirect must be
replaced with the `EventsListPageComponent` route. Runners who want to log in as
photographers can navigate to `/login` directly. No auth guard is added to `/`.

---

## NgRx slice extension: `store/events/`

### New actions to add to `events.actions.ts`

Add a second `createActionGroup` (or expand the existing one) with these actions.
Because the existing `EventsActions` group is used by authenticated photographer
flows, adding a distinct prefix (`[Public Events]`) avoids confusion in DevTools
and effect `ofType` filters.

| Action | Payload | When dispatched |
|---|---|---|
| `List Public Events` | `{ cursor?: string }` | Component `OnInit` and "Load more" button click |
| `List Public Events Success` | `{ events: Event[]; nextCursor: string \| null; append: boolean }` | Effect receives 200 from `GET /events` |
| `List Public Events Failure` | `{ error: string }` | Effect receives non-200 or network error |

The `append` boolean distinguishes the initial load (replace the list) from a
"Load more" fetch (append to the existing list). The reducer uses it to either set
`state.publicEvents` or spread `[...state.publicEvents, ...events]`.

### New state shape additions to `EventsState`

```typescript
interface EventsState {
  // ... existing fields unchanged ...

  /** Events returned by the public listing endpoint (GET /events). */
  publicEvents: Event[];
  /** Cursor for the next public listing page; null when all pages are loaded. */
  publicNextCursor: string | null;
  /** Whether a public listing request (initial or load-more) is in flight. */
  publicLoading: boolean;
  /** Error from the most recent public listing request. */
  publicError: string | null;
}
```

The initial values for the new fields are `[]`, `null`, `false`, and `null`
respectively.

### New selectors to add to `events.selectors.ts`

| Selector | Derived from |
|---|---|
| `selectPublicEvents` | `state.publicEvents` |
| `selectPublicNextCursor` | `state.publicNextCursor` |
| `selectPublicEventsLoading` | `state.publicLoading` |
| `selectPublicEventsError` | `state.publicError` |
| `selectHasMorePublicEvents` | `state.publicNextCursor !== null` |

### New effect

Add `listPublicEvents$` to `EventsEffects`. It calls `GET /events` (no auth
header — the route is public). When `cursor` is provided it appends `?cursor=`.
On success it dispatches `listPublicEventsSuccess` with `append: cursor !== undefined`.

---

## EventsListPageComponent (`src/app/home/events-list-page/events-list-page.component.ts`)

### Purpose

Route host for `/`. Loads the paginated public event listing on init and presents
a scrollable grid of `EventCardComponent` instances. A "Load more" button at the
bottom appends the next page to the existing list without replacing it.

### Layout

**Page structure, top to bottom:**

1. **Page header bar** — a thin bar across the full viewport width containing:
   - The RaceShots wordmark / logo on the left (plain text "RaceShots" using
     `mat-headline-6` typography as a placeholder until brand assets are available)
   - A "Photographer login" text link (`MatButton`, basic variant) on the right
     that navigates to `/login`
   - The header bar has a bottom border that visually separates it from the content
     area; it is not a sticky `MatToolbar` to avoid layout complexity on mobile

2. **Hero text block** — immediately below the header, vertically centred within a
   fixed-height area (120px desktop, 88px mobile):
   - Primary headline: "Find your race photos" — `mat-headline-4` on desktop,
     `mat-headline-5` on mobile
   - Subheadline: "Search any event below to find photos by your bib number." —
     `mat-body-1` typography, secondary colour
   - Both lines are centred horizontally

3. **Event card grid** — the primary content area. A responsive CSS grid of
   `EventCardComponent` instances (see responsive behaviour for column counts).
   The grid has a consistent gap of 16px at mobile and 24px at desktop.

4. **"Load more" button** — rendered below the card grid only when
   `selectHasMorePublicEvents` is true. It is a full-width `MatButton` (stroked,
   not raised) with the label "Load more events". While a load-more request is
   in flight the button is disabled and its label is replaced by an inline
   `MatProgressSpinner` (diameter 20) with visually hidden text "Loading more
   events". The button disappears entirely once `nextCursor` becomes null.

5. **Footer** — a minimal single-line centred footer below the Load more button
   reading "RaceShots — open-source race photo platform". `mat-caption` typography,
   secondary colour. 48px top padding.

**Maximum content width**: 1200px, horizontally centred via auto left/right
margins. The header bar spans full viewport width; only the inner content (hero +
grid + load more) is constrained.

**Page padding**: 16px left/right at mobile; 24px left/right at desktop (applied
inside the max-width container).

### States

**Loading (initial page load)**:

- The hero text block is rendered immediately (it requires no data).
- The card grid area shows 6 skeleton `MatCard` placeholders in the same grid
  layout as the real cards. Each skeleton card:
  - Has a shimmer grey block at the top representing the card image area
    (height 72px, full card width, `border-radius: 4px`)
  - Has two shimmer lines below for the event name (width 70%, height 16px) and
    the date + location line (width 50%, height 14px)
  - The shimmer uses a CSS animation (`background: linear-gradient(...)` slide)
    — no third-party skeleton library
- The "Load more" button is not rendered during the initial load.
- The page `<title>` is "RaceShots — Find your race photos" throughout all states.

**Loaded (cards present)**:

- The skeleton cards are replaced by real `EventCardComponent` instances.
- If `nextCursor` is non-null, the "Load more" button is visible below the grid.
- If `nextCursor` is null (fewer than 20 events returned or last page reached),
  the "Load more" button is not rendered.

**Load-more in progress**:

- Existing cards remain visible and interactive.
- The "Load more" button enters disabled state with the inline spinner replacing
  its label.
- No skeleton cards are inserted — the new cards simply appear below the
  existing cards when the effect succeeds.

**Empty (zero events)**:

- The skeleton cards are replaced by a centred block:
  - `mat-icon` of `event_busy` at 64px, secondary colour
  - Primary text: "No events listed yet." — `mat-body-1` typography, bold
  - Secondary text: "Check back soon." — `mat-body-2` typography, secondary colour
  - No CTA button — runners have no action to take here
  - The block has 64px top and bottom padding
- The "Load more" button is not rendered.
- The empty state block has `role="status"` so screen readers announce it.

**Error (API failure)**:

- The skeleton cards are replaced by a centred error block:
  - `mat-icon` of `cloud_off` at 64px, M3 `error` colour token
  - Primary text: "Unable to load events." — `mat-body-1`, error colour
  - Secondary text: "Something went wrong. Please try again." — `mat-body-2`
  - A "Try again" `MatButton` (stroked) that dispatches
    `EventsActions.listPublicEvents({})` (no cursor — retry from the first page)
- The error block has `role="alert"` so screen readers announce it immediately.
- The "Load more" button is not rendered.
- If the error occurs during a load-more (not the initial load), the existing
  cards remain visible. The error block is shown below the existing grid in place
  of the Load more button. A `MatSnackBar` is also opened with the message
  "Could not load more events. Tap to retry." — tapping the snackbar action
  retries the last cursor. (See UX-D3.)

### Responsive behaviour

**375px (mobile)**:

- Page header: wordmark on left, "Photographer login" link on right — both fit
  in a single row at this width (the link is short enough). Header height: 56px.
- Hero block height: 88px. Headline is `mat-headline-5`. Subheadline wraps to
  two lines if necessary.
- Card grid: **single column** (`grid-template-columns: 1fr`). Cards span the
  full content width.
- "Load more" button: full content width, minimum height 48px (touch target).
- Grid gap: 16px.

**768px (tablet)**:

- Card grid: **two columns** (`grid-template-columns: repeat(2, 1fr)`).
- Grid gap: 20px.

**1280px (desktop)**:

- Hero block height: 120px. Headline is `mat-headline-4`.
- Card grid: **three columns** (`grid-template-columns: repeat(3, 1fr)`).
- Grid gap: 24px.
- "Load more" button: centred, max-width 320px (not full page width — avoids
  an overly stretched button on large screens).

All breakpoints are implemented via CSS `@media` queries in the component SCSS,
not Angular CDK BreakpointObserver.

### Accessibility

- The page `<title>` is "RaceShots — Find your race photos" (static, no dynamic
  update needed since this page carries no user-specific content).
- The hero headline is the page `<h1>`. The header wordmark is a `<span>`, not
  a heading, to avoid two `<h1>` elements.
- The card grid container has `role="list"` so each `EventCardComponent` (which
  sets `role="listitem"` on its host) is correctly associated.
- The card grid is labelled with `aria-label="Upcoming race events"`.
- The "Load more" button has `aria-label="Load more events"` and `aria-busy="true"`
  while a load-more request is in flight.
- The skeleton loading area has `aria-label="Loading events, please wait"`
  and `role="status"` so screen readers announce it.
- Colour is not the sole indicator of the error state — the `cloud_off` icon
  and plain-text message accompany the error colour.
- Focus order is: header wordmark → photographer login link → (if present) first
  event card → subsequent cards → Load more button → footer. This is the natural
  DOM order; no manual `tabindex` manipulation is needed.
- Keyboard users can Tab through all event cards and activate any card with Enter
  or Space.

### Angular Material components to use

- `MatButtonModule` (basic) for the "Photographer login" header link
- `MatButtonModule` (stroked) for "Load more events" and "Try again"
- `MatProgressSpinnerModule` (inline, diameter 20) inside the "Load more" button
  while loading
- `MatIconModule` (`event_busy`, `cloud_off`) for empty and error state icons
- `MatSnackBarModule` — opened by the effect on load-more failure (see UX-D3)
- No `MatToolbar` for the header — a plain `<header>` element with CSS styling
  avoids sticky-header positioning complexity on mobile

### NgRx integration

**Selectors subscribed** (via `toSignal`):

| Signal name in component | Selector |
|---|---|
| `events` | `selectPublicEvents` |
| `loading` | `selectPublicEventsLoading` |
| `error` | `selectPublicEventsError` |
| `hasMore` | `selectHasMorePublicEvents` |
| `nextCursor` | `selectPublicNextCursor` |

**Actions dispatched**:

| User event | Action dispatched |
|---|---|
| Component `ngOnInit` | `EventsActions.listPublicEvents({})` |
| "Load more" button click | `EventsActions.listPublicEvents({ cursor: nextCursor() })` |
| "Try again" button click (initial error) | `EventsActions.listPublicEvents({})` |

**Route registration change required in `app.routes.ts`**:

Replace the existing catch-all redirect:
```typescript
// Before (RS-014 removes this):
{ path: '', redirectTo: '/login', pathMatch: 'full' }

// After:
{
  path: '',
  loadComponent: () =>
    import('./home/events-list-page/events-list-page.component').then(
      (m) => m.EventsListPageComponent,
    ),
}
```

No `canActivate` guard — this route is public (AC5). No additional `providers`
array needed — the `events` feature state is registered at the root level.

---

## EventCardComponent (`src/app/home/events-list-page/event-card/event-card.component.ts`)

### Purpose

A fully presentational, reusable card that renders a single event's name, date,
and location. Emitting a click navigates the runner to the event's search page
at `/events/{id}`. This component must have a Storybook story file.

### Layout

A `MatCard` with `appearance="outlined"` to give it a subtle border without an
elevated shadow — appropriate for a listing where many cards appear together.

**Internal structure, top to bottom:**

1. **Card visual accent bar** — a thin horizontal stripe (height 4px, full card
   width) at the very top of the card using the primary colour token
   (`var(--mat-sys-primary)`). This provides colour identity without requiring a
   photo image (since the public listing API does not return photo thumbnails in v1).
   The stripe is a CSS `::before` pseudo-element on the card host, not a separate DOM
   element. (See UX-D1.)

2. **`mat-card-content`** — the card body, containing from top to bottom:
   - **Event name**: `mat-title-2` typography (or `mat-subtitle-1` if
     `title-2` is not available in the project's Material version), rendered as a
     `<h2>` to maintain document heading hierarchy (the page `<h1>` is the hero
     headline). Maximum 2 lines; overflow is clipped with an ellipsis on line 2.
   - **Date row**: a `mat-icon` of `calendar_today` (16px, inline, secondary colour)
     followed immediately by the formatted event date (e.g. "15 March 2025") in
     `mat-body-2` typography, secondary colour. Icon and text are in a flex row with
     a 6px gap.
   - **Location row**: a `mat-icon` of `location_on` (16px, inline, secondary colour)
     followed by the event location string in `mat-body-2` typography, secondary
     colour. Same flex-row layout as the date row. Location text is capped at 1 line
     with ellipsis overflow.

3. **`mat-card-actions`** — flush with the card bottom:
   - A single "Search photos" `MatButton` (flat, primary colour, full card width)
     — full-width reinforces the touch target on mobile and makes the CTA
     unmistakable. The button text is "Search photos".

**Card dimensions**: height is determined by content (no fixed height). Minimum
height is approximately 140px at mobile. The primary accent bar + card-content
padding + card-actions height drives the natural minimum.

**The entire card surface is a click target** (not just the button). The host
element has `tabindex="0"` and `role="listitem"`. Clicking anywhere on the card —
or pressing Enter/Space when the card is focused — dispatches the same navigation
as the "Search photos" button. (See UX-D2.)

### States

**Loading**: N/A — this component only mounts with valid event data. The parent
handles skeletons.

**Empty**: N/A — the parent handles zero results.

**Error**: N/A — the parent handles API failure.

**Success / default**: accent bar, event name, date row, location row, and
"Search photos" button all visible.

**Hover / focus**: on hover (desktop) and focus (all devices), the card surface
shows a Material state-layer tint (handled automatically by `MatCard`). The focus
ring must be clearly visible — do not suppress the default Material focus outline
via CSS.

### Responsive behaviour

**375px (mobile)**:

- Card fills the single grid column (full content width minus page padding).
- `mat-card-content` padding: 16px.
- Event name: 2-line max, `mat-subtitle-1`.
- "Search photos" button: full card width, minimum height 48px to meet touch
  target guidelines.
- Date and location rows: `mat-body-2` (same across breakpoints — the text is
  already small enough).

**1280px (desktop)**:

- Card fills one of three grid columns.
- `mat-card-content` padding: 16px (unchanged — card width changes, not padding).
- "Search photos" button: full card width, standard Material height (48px raised,
  but this is `flat` variant — follows Material default height ~36px with 8px
  padding above/below). Touch target is not a concern at desktop.

### Accessibility

- The host element has `role="listitem"` so it is correctly associated with the
  parent grid's `role="list"`.
- The host has `tabindex="0"` for keyboard focus.
- `(keydown.enter)` and `(keydown.space)` on the host trigger the same navigation
  as clicking the card, preventing a dead-end for keyboard users who focus the card
  rather than the button.
- The "Search photos" button has `aria-label="Search photos for {event.name}"` to
  distinguish it from identical-text buttons on adjacent cards. The visible label
  alone ("Search photos") is ambiguous when multiple cards are present.
- The date `mat-icon` has `aria-hidden="true"` — the date text alongside it
  carries the meaning.
- The location `mat-icon` has `aria-hidden="true"` — the location text carries
  the meaning.
- The event name `<h2>` provides a named landmark that screen reader users can
  browse with heading navigation.
- Colour is not the sole indicator of any state — the primary accent bar is
  decorative only and conveys no status information.

### Angular Material components to use

- `MatCardModule` (`mat-card` with `appearance="outlined"`, `mat-card-content`,
  `mat-card-actions`)
- `MatButtonModule` (flat, primary colour) for "Search photos"
- `MatIconModule` (`calendar_today`, `location_on`) for the date and location rows
- `DatePipe` (Angular built-in) to format `event.date` from ISO 8601 to
  "d MMMM y" (e.g. "15 March 2025") — use the `'longDate'` pre-set

### Inputs and outputs

```typescript
@Input({ required: true }) event!: Event;   // from event.model.ts
@Output() cardClick = new EventEmitter<string>(); // emits event.id
```

The parent `EventsListPageComponent` handles navigation:

```typescript
onCardClick(eventId: string): void {
  void this.router.navigate(['/events', eventId]);
}
```

Routing is handled in the parent, not inside `EventCardComponent`, so the card
remains fully presentational and testable in Storybook without a router.

### NgRx integration

Fully presentational — no store access. All data flows in via `@Input` and all
interactions flow out via `@Output`. The parent dispatches no NgRx action on card
click; it uses the Angular `Router` directly since navigation to `/events/{id}` is
a route transition, not a state change requiring NgRx.

---

## Storybook stories: `event-card.component.stories.ts`

The Storybook story file must cover all of the following variants. The `event`
input uses realistic fixture data throughout.

| Story name | Description |
|---|---|
| `Default` | A typical event: name ~30 chars, date in the future, location ~20 chars |
| `LongEventName` | Event name that exceeds two lines (60+ chars) — verifies ellipsis clamp |
| `LongLocation` | Location string that exceeds one line — verifies single-line ellipsis |
| `PastEvent` | `date` is in the past — verifies no special past-event styling is applied (v1 has none) |
| `Loading` (in the page Storybook, not the card) | Rendered inside the skeleton wrapper to show the shimmer placeholder — this story lives in the page stories file |

All stories must render the component inside a `div` with a fixed width of 360px
so the card fills a realistic mobile column width in the Canvas panel.

The `cardClick` output must be connected to a Storybook action (using `fn()` from
`@storybook/test`) so reviewers can verify the event fires on card click and on
Enter/Space keypress.

---

## Date formatting decision

The API returns `event.date` as an ISO 8601 string (`YYYY-MM-DD`). The card
renders it with Angular's `DatePipe` using the `'longDate'` format, which produces
"April 19, 2026" in the `en` locale (or the equivalent in the user's locale if
Angular's LOCALE_ID is configured). If the project uses a non-default locale, the
`DatePipe` will automatically adapt — no locale-specific code is needed in the
component. (See UX-D4.)

---

## UX decisions not in the story ACs

The following decisions were made by the UX spec author and are not explicitly
stated in the story. Flag these for team review before build begins.

**UX-D1 — Card visual treatment without photo thumbnails**  
The public listing API (`GET /events`) does not return a representative photo
thumbnail for each event (the story ACs list only name, date, location). Cards
without images can look sparse and identical. This spec adds a thin primary-colour
accent bar at the top of each card as a simple visual identity element. An
alternative is to show the event initials in a coloured `MatIcon`-sized avatar.
Confirm with the PO whether a cover image field should be added to the Event model
in a future story, or whether the accent bar is sufficient for v1.

**UX-D2 — Full card surface as click target vs. button-only**  
The story (AC8) says "a visitor clicks an event card" without specifying whether
the click target is the card surface or only the CTA button. This spec makes the
entire card surface a click target (consistent with the RS-009 photo card pattern)
because runners on mobile have limited precision — a large touch target reduces
errors. The dedicated "Search photos" button is kept for keyboard and assistive
technology users who need an explicit interactive element. If the PO prefers
button-only interaction (simpler focus management), the `tabindex="0"` and
keydown handlers on the host can be removed and the button becomes the sole
interactive element.

**UX-D3 — Load-more error UX (snackbar vs. inline)**  
The story does not distinguish initial-load errors from load-more errors. This
spec treats them differently: a load-more error shows a `MatSnackBar` (which does
not disrupt the visible cards) plus an inline error block replacing the Load more
button. This avoids hiding cards the runner has already seen. Confirm whether a
simpler approach (replace the entire grid with the error state on any failure) is
preferred.

**UX-D4 — Date formatting locale**  
The story does not specify a date display format. This spec uses Angular's built-in
`DatePipe` with `'longDate'` (`d MMMM y`). If the product targets a specific
locale (e.g. Guatemala, where the primary currency is GTQ), the Angular `LOCALE_ID`
provider should be set accordingly in `app.config.ts`. This spec does not change
the locale configuration — it uses whatever `LOCALE_ID` is active.

**UX-D5 — Page header vs. shared app shell**  
The story does not specify whether the homepage should use the same app shell
(header/nav) as the photographer area. The photographer area has
`PhotographerLayoutComponent` as its layout shell. The runner-facing pages
(`/events/:id`, `/download/:token`, `/redownload`) currently have no shared shell.
This spec adds a minimal inline header to `EventsListPageComponent` rather than
creating a shared runner layout component. If more runner-facing routes are added
in future stories, extracting a `RunnerLayoutComponent` shell should be considered
at that point.

**UX-D6 — "Load more" vs. infinite scroll**  
The story explicitly says "Load more" button (not infinite scroll, not paginator).
This spec follows that direction. No Intersection Observer, no virtual scroll, no
CDK virtual list. The button must remain visible and accessible to keyboard users.

**UX-D7 — Skeleton card count**  
Six skeleton cards are shown during the initial load (matching the RS-009 skeleton
pattern for consistency). The story's default page size is 20, but showing 20
skeleton cards on mobile (single column) would produce an excessively long page
before data arrives. Six is a reasonable above-the-fold representation. Confirm
or adjust the count.

**UX-D8 — Photographer login link placement**  
The story has no UI requirement for a photographer login entry point on the
homepage. This spec adds a "Photographer login" text link in the header bar
because the homepage is the natural entry point for all users, including
photographers who arrive at the root URL. If the PO wants the homepage to be
runner-only with no visible login affordance, the header link can be removed.
