# UX Spec — RS-021: Internationalization (English and Latin Spanish, extensible)

**Story**: RS-021  
**Personas affected**: Photographer (portal), Runner (public pages)  
**Breakpoints**: 375px mobile, 1280px desktop  
**Translation library**: `@ngx-translate/core` — all visible strings use `{{ 'key' | translate }}`

---

## 1. LanguageSwitcherComponent (`src/app/shared/language-switcher/language-switcher.component.ts`)

### Purpose

Allows any user — photographer or runner — to switch the UI language between English and Español (Latino). Calls `LocaleService.setLocale()` on selection, which writes to `localStorage` and triggers a full page reload.

### Layout

The component renders as a single icon-button that opens a `MatMenu` dropdown. It is a self-contained, presentational component. Its host element is placed by the parent layout — it does not manage its own positioning.

**Trigger button**

- A `mat-icon-button` containing the Material icon `language` (globe with meridian lines).
- No visible label on desktop or mobile — the icon alone is the affordance.
- `aria-label` on the button must be the translated string for "Change language" (key: `language.changeAriaLabel`).
- `aria-haspopup="menu"` and `[matMenuTriggerFor]="langMenu"` are applied to the button.

**Menu panel (`matMenu`)**

- A `MatMenu` with two `mat-menu-item` entries in fixed display order:
  1. English
  2. Español (Latino)
- Each item contains:
  - A leading `mat-icon`: `check` when that locale is the currently active one, otherwise the icon slot is empty (24 px space preserved so labels align). Do **not** use colour alone to signal the active state — the `check` icon is required.
  - The display name as plain text (not translated — language names are always shown in their own language, per international convention).
- Menu width: `min-width: 180px`. No max-width constraint.
- Panel opens below the trigger button, left-aligned to the trigger on mobile (where the button is left of other header actions), right-aligned on desktop (button is at the right end of the toolbar).

**ASCII layout — menu open (desktop)**

```
[ ... toolbar content ... ] [ language icon-btn ▼ ]
                             ┌──────────────────────┐
                             │ ✓  English            │
                             │    Español (Latino)   │
                             └──────────────────────┘
```

**ASCII layout — menu open (mobile, 375px)**

```
[ ☰ ]  RaceShots              [ 🌐 ]
       ┌──────────────────────────┐
       │ ✓  English               │
       │    Español (Latino)      │
       └──────────────────────────┘
```

### States

- **Loading**: N/A — the component itself has no async operations. The page reload triggered by a language switch is handled at the browser level (see Section 4).
- **Empty**: N/A — the supported-locale list is always populated (minimum: `en` and `es-419`).
- **Error**: N/A — `LocaleService.setLocale()` performs only a synchronous `localStorage` write followed by `window.location.reload()`. No API call, no failure state.
- **Default (closed)**: globe icon button, no menu panel visible. The button tooltip (via `matTooltip`) shows the translated string for "Change language" (key: `language.changeAriaLabel`) on mouse hover.
- **Active locale highlighted**: when the menu is open, the currently active locale item displays the `check` icon. The active item's text is **not** bolded or colour-shifted — the icon is the sole differentiator (satisfying the "no colour alone" accessibility rule).

### Responsive behaviour

**375px (mobile)**

- The trigger button minimum touch target is 48 × 48 px (Material `mat-icon-button` default on touch devices — do not reduce this).
- The menu panel anchors to the button's position and opens downward. If the button is near a screen edge, the CDK overlay positions it to stay within the viewport — rely on CDK's default `FlexibleConnectedPositionStrategy`.

**1280px (desktop)**

- Identical visual component. No layout changes are needed beyond placement in the parent toolbar (described per parent component below).

### Accessibility

- Trigger button: `aria-label="{{ 'language.changeAriaLabel' | translate }}"`, `aria-haspopup="menu"`.
- When the menu is open, CDK sets `aria-expanded="true"` on the trigger automatically.
- Menu items: the active-language item has `aria-current="true"` set explicitly in the template. The `check` icon within that item also has `aria-hidden="true"` (the `aria-current` attribute carries the semantic, not the icon).
- Focus management: `MatMenu` provides built-in keyboard navigation (Arrow keys move between items, `Enter` selects, `Escape` closes and returns focus to the trigger). No custom focus logic required.
- Focus order: the trigger button must appear in document tab order in a logical position within the toolbar (after navigation items, before or co-located with sign-out — see placement notes per parent component).

### Angular Material components to use

- `MatMenuModule` (`MatMenu`, `MatMenuTrigger`, `MatMenuItem`)
- `MatButtonModule` (`mat-icon-button`)
- `MatIconModule` (`mat-icon`)
- `MatTooltipModule` (`matTooltip`) — for the hover tooltip on the trigger button

### NgRx integration

None. `LanguageSwitcherComponent` is a pure UI component backed by `LocaleService`. Per the story's tech notes, locale switching is an intentional NgRx deviation — a synchronous localStorage write + reload has no benefit from store slices.

- Does **not** subscribe to any NgRx selector.
- Does **not** dispatch any NgRx action.
- Injects `LocaleService` directly:
  - Reads `LocaleService.getCurrentLocale()` to determine which item shows the `check` icon.
  - Calls `LocaleService.setLocale(code)` on `MatMenuItem` click.

---

## 2. LanguageSwitcherComponent placement — PhotographerLayoutComponent toolbar (`src/app/features/photographer/layout/photographer-layout.component.ts`)

### Purpose

The photographer toolbar must expose language switching in the existing top bar without disrupting the current layout of the hamburger icon (mobile), page title, and user email.

### Layout

The existing top bar (`div.top-bar`) currently holds three elements:

1. `[mobile only]` hamburger `mat-icon-button` (left)
2. Page title `<span>` (left, after hamburger)
3. `[desktop only]` user email `<span>` (pushed right via CSS flex)

Add `<app-language-switcher>` as a fourth element, positioned to the **right of the user email** on desktop and to the **right edge** on mobile (where the email is not shown). The top bar becomes a flex row with `justify-content: space-between` on the left group (hamburger + title) and a right group (email + language switcher).

**ASCII layout — desktop (1280px)**

```
┌────────────────────────────────────────────────────────────┐
│  My Events (page title)      user@example.com  [ 🌐 ]      │
└────────────────────────────────────────────────────────────┘
```

**ASCII layout — mobile (375px)**

```
┌────────────────────────────────────────────────┐
│  [ ☰ ]  My Events                    [ 🌐 ]   │
└────────────────────────────────────────────────┘
```

The right group is a flex container with `align-items: center` and a 4 px gap between the email text and the language button. This ensures the button has enough space on narrow screens.

### States

Same states as the photographer layout already handles. The language switcher adds no new states to this component.

### Responsive behaviour

**375px**: hamburger is shown, email is hidden (existing behaviour), language button appears at the right edge. Minimum touch target preserved.

**1280px**: hamburger is hidden, email is shown, language button sits immediately to the right of the email.

### Accessibility

The existing `aria-label="Open navigation menu"` on the hamburger is unchanged. The language button's `aria-label` comes from the component itself (see Section 1). No additional ARIA changes required in the layout component.

### Angular Material components to use

No new Material components required in the layout itself — only `<app-language-switcher>` is added as a child.

### NgRx integration

No changes to `PhotographerLayoutComponent`'s NgRx subscriptions. The component already subscribes to `selectAuthEmail` and `selectAuthStatus`. No new selectors.

---

## 3. LanguageSwitcherComponent placement — EventsListPageComponent header (`src/app/home/events-list-page/events-list-page.component.ts`)

### Purpose

The public homepage header currently holds the "RaceShots" wordmark and a "Photographer login" link. Adding a language switcher here lets runners browsing on mobile (the primary form factor) switch to their preferred language before interacting with search.

### Layout

The existing header (`header.page-header`) is a flex row with:

- Left: `<span class="wordmark">` — "RaceShots" brand text
- Right: `<a mat-button>` — "Photographer login"

Insert `<app-language-switcher>` **between** the wordmark and the login link. The header becomes a three-element flex row:

```
Left: [wordmark]    Center: (none — flex spacer)    Right: [🌐] [Photographer login]
```

Group the language switcher and login link in a right-aligned flex container with a 4 px gap between them. This keeps the login link at the far right (its current position) and places the globe button immediately to its left.

**ASCII layout — desktop (1280px)**

```
┌───────────────────────────────────────────────────────────┐
│  RaceShots                          [ 🌐 ]  Photographer  │
│                                             login          │
└───────────────────────────────────────────────────────────┘
```

**ASCII layout — mobile (375px)**

```
┌─────────────────────────────────────────┐
│  RaceShots              [ 🌐 ]  Login   │
└─────────────────────────────────────────┘
```

On mobile, "Photographer login" is abbreviated to "Login" (key: `header.loginShort`) to prevent the three-element header from overflowing. At 375px the wordmark, globe button, and abbreviated login link must all fit on a single line. The full text "Photographer login" (key: `header.loginFull`) is used at desktop width. The class swap is driven by `BreakpointObserver` already used in other components, or by a CSS-only approach using `display: none` on different viewport-specific elements — the CSS-only approach is preferred here to avoid introducing `BreakpointObserver` into a component that does not currently use it.

UX DECISION (not in ACs): the login link text has two translation keys (`header.loginFull` / `header.loginShort`) to handle the mobile truncation requirement. The team should confirm the Spanish translation of "Login" is short enough for 375px. If it is not, the abbreviated version can be an icon-only button at the breakpoint below 480px.

### States

The header itself has no loading/empty/error states. The language switcher states are as defined in Section 1.

### Responsive behaviour

See layout ASCII above. On screens narrower than approximately 360px, if all three elements still overflow, the wordmark may be rendered as the RaceShots logo/icon only (future consideration — out of scope for this spec).

### Accessibility

The existing `aria-label="RaceShots"` on the wordmark span is unchanged. The language button retains its `aria-label` from Section 1. The login link retains its existing anchor text.

If the "Login" / "Photographer login" text is toggled via CSS visibility, ensure the hidden element is `aria-hidden="true"` or uses `display: none` (not `visibility: hidden`) so screen readers do not read both variants.

### Angular Material components to use

No new Material components in this component — only `<app-language-switcher>` is added.

### NgRx integration

No changes. `EventsListPageComponent` continues to select `selectPublicEvents`, `selectPublicEventsLoading`, `selectPublicEventsError`, `selectHasMorePublicEvents`, and `selectPublicNextCursor`. No new selectors needed.

---

## 4. LanguageSwitcherComponent placement — EventSearchComponent (`src/app/events/event-search/event-search.component.ts`)

### Purpose

The public event search page has no dedicated `<header>` element — the page begins directly with the hero section. A language switcher must be reachable on this page without adding a full header bar.

### Layout

Place `<app-language-switcher>` as a floating element anchored to the **top-right corner** of the hero section (`section.hero`). The hero already contains the event name, date, and search bar. The globe button overlays the hero's top-right corner using absolute positioning within the `position: relative` hero container.

**ASCII layout — desktop (1280px)**

```
┌──────────────────────────────────────────────────── [🌐] ┐
│                                                           │
│          Race Name                                        │
│          📅 Date  📍 Location                             │
│          Enter your bib number…                           │
│          [ bib input field ]  [ Search ]                  │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

**ASCII layout — mobile (375px)**

```
┌────────────────────────────────── [🌐] ┐
│                                        │
│    Race Name                           │
│    📅 Date                             │
│    Enter your bib number…              │
│    [ bib input ]  [ Search ]           │
│                                        │
└────────────────────────────────────────┘
```

The button uses `position: absolute; top: 12px; right: 12px` within the hero. On mobile the touch target is 48 × 48 px, which fits within the 12 px padding without clipping the hero content.

UX DECISION (not in ACs): rather than adding a full header bar to the event-search page — which would change the visual hierarchy established for the runner persona — the floating globe button approach keeps the hero focused on the search task while still making the language switcher discoverable. The team should validate via usability testing that runners find it.

### States, Responsive behaviour, Accessibility, Material components, NgRx

Same as Section 1. No new states, no NgRx integration.

---

## 5. ProfileComponent — preferredLocale field (`src/app/features/photographer/profile/profile.component.ts`)

### Purpose

Adds a "Preferred language for emails" field to the existing photographer profile form so the photographer can specify which SES email template locale is used when runners are notified about their photos.

### Layout

The form currently has two sections: "Account" (display name, default currency) and "Bank Transfer Details" (card with bank fields). The new field belongs in the **Account section**, positioned directly below the "Default currency" select and above the `<mat-divider>` that separates Account from Bank Transfer Details.

**Field specification**

| Property | Value |
|---|---|
| Label | `profile.preferredLocale.label` → "Preferred language for emails" |
| Hint text | `profile.preferredLocale.hint` → "Controls the language of notifications sent to you." |
| Control type | `mat-select` (same pattern as "Default currency") |
| Appearance | `outline` (matches all other fields in the form) |
| Options | Two `mat-option` entries (see below) |
| Validators | `Validators.required` |
| Default value | `"en"` — this must be patched in when the profile loads with an empty or missing `preferredLocale` |
| Width | `full-width` class (matches existing fields) |

**Option list (fixed order)**

1. Value: `"en"` — Display: "English"
2. Value: `"es-419"` — Display: "Español (Latino)"

Option display names are **not** run through `TranslatePipe`. Language names always render in their own language regardless of the active UI locale. These are static strings in the template.

**Form layout (Account section)**

```
┌─────────────────────────────────────────────┐
│ Display name                           [   ] │
│ Default currency                       [   ] │
│ Preferred language for emails          [   ] │  ← new field
│ ─────────────────────────────────────────── │  ← mat-divider
│  Bank Transfer Details card                  │
│  ...                                         │
└─────────────────────────────────────────────┘
```

### States

- **Loading**: the field is `[disabled]="loading() || saving()"` — same pattern as all other fields in the form. No separate skeleton; the existing `<mat-progress-bar mode="query">` at the top of the form covers the loading state.
- **Empty**: not applicable — the field always has a default value of `"en"`.
- **Error / validation**: if submitted while invalid (edge case: a stored value not in the option list), show `<mat-error>` with key `profile.preferredLocale.errorRequired` → "Please select a language." Linked to the field via `mat-form-field`'s built-in `aria-describedby` pattern.
- **Success / default**: the select shows the option matching the photographer's stored `preferredLocale`, or `"en"` if the field is absent from the API response.

### Responsive behaviour

**375px (mobile)**: full-width select, same as the "Default currency" field. The `mat-select` panel opens as a full-screen bottom sheet on mobile by default (Material behaviour). No custom changes needed.

**1280px (desktop)**: full-width select within the form container (max-width already controlled by `profile.component.scss`).

### Accessibility

- `<mat-label>` provides the accessible name — no additional `aria-label` needed.
- `<mat-error>` is associated with the field via Angular Material's form field machinery — no manual `aria-describedby` required.
- The `[disabled]` binding during load/save is reflected as `aria-disabled="true"` by `mat-select` automatically.
- Language option names are not translated (they are in the language they represent), ensuring screen reader users hear the correct language name.

### Angular Material components to use

- `MatFormFieldModule` + `MatSelectModule` (already imported in `ProfileComponent`)
- No new Material imports required.

### NgRx integration

**State shape change required (build agent must action)**

`photographer.state.ts` — add `preferredLocale: string` to the `Photographer` interface and to `emptyPhotographerDefaults` (default value `"en"`).

**Form integration**

Add `preferredLocale: ['en', [Validators.required]]` to the `FormGroup` in `ProfileComponent`.

In the `selectProfile` subscription, patch `preferredLocale: profile.preferredLocale || 'en'`.

In `onSave()`, include `preferredLocale: value.preferredLocale ?? 'en'` in the `updateProfile` dispatch payload.

**Selectors used** (unchanged from existing component)

- `selectProfile`
- `selectProfileLoading`
- `selectProfileSaving`
- `selectProfileError`
- `selectProfileSaveError`
- `selectWasAutoInitialized`

**Actions dispatched** (unchanged)

- `PhotographerActions.loadProfile()` — on init
- `PhotographerActions.updateProfile({ profile: { ..., preferredLocale } })` — on save

---

## 6. Page reload transition (language switch UX)

### Behaviour specification

When the user selects a language from `LanguageSwitcherComponent`:

1. `LocaleService.setLocale(code)` writes `racephotos_locale=<code>` to `localStorage`.
2. `window.location.reload()` is called immediately.
3. The browser navigates to the same URL, bootstraps Angular fresh, and `APP_INITIALIZER` reads the new locale from `localStorage` before rendering anything.

### Visual flash assessment

The reload produces a brief white flash (or the browser's default background colour) while the new bundle is parsed and Angular bootstraps. This is **acceptable as-is** for the following reasons:

- Language switching is a deliberate, infrequent user action — not an in-flow interaction.
- The new locale is written to `localStorage` before the reload, so the page renders directly in the target language with no secondary re-render or flash back to the previous language.
- A loading overlay before the reload would require `z-index` management across all host components and would be dismissed by the reload before it is perceived as meaningful by the user.

**No loading indicator is specified for the reload transition.**

UX DECISION (not in ACs): if usability testing reveals the flash is disorienting (particularly on slower mobile connections in Latin America where this product is targeted), a CSS-level fade can be applied in a follow-up story: the body starts with `opacity: 0; transition: opacity 0.15s` and a small `APP_INITIALIZER` fade-in removes the opacity after translations load. This is explicitly deferred; do not implement it in RS-021.

### Storybook note

Storybook stories for `LanguageSwitcherComponent` must not call `window.location.reload()`. The `LocaleService` should be provided as a Storybook mock that records the `setLocale` call and emits a Storybook action instead of reloading. This prevents Storybook from losing its state during story interaction.

---

## Summary of all components specified

| Component | Path | Scope |
|---|---|---|
| `LanguageSwitcherComponent` | `src/app/shared/language-switcher/` | New component — both portals |
| Toolbar placement | `src/app/features/photographer/layout/photographer-layout.component.*` | Modified — add switcher to top bar |
| Homepage header placement | `src/app/home/events-list-page/events-list-page.component.*` | Modified — add switcher between wordmark and login |
| Event-search hero placement | `src/app/events/event-search/event-search.component.*` | Modified — floating button in hero top-right |
| `ProfileComponent` — preferredLocale field | `src/app/features/photographer/profile/profile.component.*` | Modified — new form field + state shape |

---

## UX decisions not covered by ACs (flag for team review)

1. **Login link abbreviation on mobile** (Section 3): the public homepage header uses "Login" (short) at 375px and "Photographer login" at desktop, controlled by two CSS visibility classes or two translation keys. The team must confirm the Spanish short form fits within the available header space.

2. **Floating globe button in the event-search hero** (Section 4): no existing header bar exists on the event-search page. A floating `position: absolute` button in the hero top-right corner is specified rather than introducing a new header element. The team should validate discoverability with runners.

3. **Language names are never translated** (Sections 1 and 5): option display names ("English", "Español (Latino)") are hardcoded in their own language in all templates and are never passed through `TranslatePipe`. This is an intentional i18n convention. If a future language has a non-Latin name (e.g. Arabic, Chinese), the same rule applies.

4. **No reload loading indicator** (Section 6): the white flash during `window.location.reload()` is accepted as-is for v1. A CSS fade-in mechanism is deferred to a follow-up story.

5. **`aria-current="true"` on the active language menu item** (Section 1): `MatMenuItem` does not natively support `aria-current`. The attribute must be set via `[attr.aria-current]="isActive ? 'true' : null"` in the template. This is a custom accessibility enhancement not provided by Material out of the box.
