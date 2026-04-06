# UX Spec — RS-004: Photographer account (auth shell + profile setup)

**Story**: RS-004
**Persona**: Photographer — desktop-first power user, technically capable, expects efficiency
**Date**: 2026-04-05
**Status**: draft

---

## Overview

This spec covers three components delivered by RS-004:

1. `LoginComponent` — `/login` — unauthenticated entry point for photographers
2. `PhotographerLayoutComponent` — `/photographer/*` shell — persistent sidebar nav wrapping all photographer pages
3. `ProfileComponent` — `/photographer/profile` — reactive form to manage account display name, currency, and bank transfer details

It also covers the `AuthGuard` redirect behaviour the user observes during route resolution.

---

## AuthGuard redirect behaviour (`src/app/core/auth/auth.guard.ts`)

### Purpose

Prevents unauthenticated access to any `/photographer/*` route and shows no broken intermediate state during the redirect.

### Behaviour by auth status

| `AuthStatus` (NgRx) | Guard action                                                                                                         | What the user sees                                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unknown`           | Guard waits — returns an Observable that does not emit until status resolves to `authenticated` or `unauthenticated` | The current view stays in place; a full-page `MatProgressSpinner` (indeterminate, `diameter="48"`) overlaid on a semi-transparent `var(--mat-sys-surface)` backdrop is shown while status is `unknown`. This prevents a flash of protected content. |
| `authenticated`     | Guard allows navigation                                                                                              | Normal route render                                                                                                                                                                                                                                 |
| `unauthenticated`   | Guard calls `router.createUrlTree(['/login'])` with `queryParams: { returnUrl: <attempted path> }`                   | User lands on `/login` with the `returnUrl` query param preserved for post-login redirect                                                                                                                                                           |

### Notes

- The spinner overlay is rendered by the root `AppComponent`, not by the guard itself. The guard reads `selectAuthStatus`; `AppComponent` renders the overlay whenever status is `unknown`.
- The `returnUrl` query parameter must not include the `/login` path itself (guard must strip it to prevent redirect loops).

---

## Component 1 — `LoginComponent`

**Path**: `src/app/features/auth/login/login.component.ts`
**Route**: `/login`

### Purpose

Authenticates a photographer via Cognito credentials and redirects them to their intended destination (or `/photographer/events` by default).

### Layout — 1280px (desktop)

The page is vertically and horizontally centred in the viewport. It uses a single-column card layout with a maximum width of `400px`. There is no global navigation bar on this page.

Structure top to bottom inside the card:

1. Product wordmark — "RaceShots" — rendered in `mat-headline-medium` typography. Centred. No logo image (v1 text-only).
2. Page heading — "Sign in to your account" — rendered in `mat-title-large`. Centred.
3. Email field — full-width `MatFormField` with `appearance="outline"`.
4. Password field — full-width `MatFormField` with `appearance="outline"`, `type="password"` with a suffix `MatIconButton` (`mat-icon-button`) to toggle visibility (`visibility` / `visibility_off` icons).
5. "Sign in" primary action button — full width, `mat-flat-button` with `color` driven by the `primary` role token.
6. Supporting text below the button: "Need an account? Contact your administrator." — `mat-body-small` typography, centred, `var(--mat-sys-on-surface-variant)` colour. This is static text, not a link (registration is out of scope in v1).

Background: `var(--mat-sys-surface-container-low)` fills the viewport. The card sits on `var(--mat-sys-surface)` with the default M3 card elevation.

### Layout — 375px (mobile)

- Card fills the full viewport width with `16px` horizontal padding applied to the outer wrapper, no border-radius on the card at this breakpoint.
- All elements remain single-column and in the same order.
- The card has no visible elevation shadow at mobile — the background and card share the same surface tone, removing the floating-card appearance.
- Touch targets for all buttons and the password toggle meet the 48px minimum.

### Form fields

#### Email

- **Label**: "Email address"
- **Type**: `email` with `autocomplete="email"`
- **Validators**: `Validators.required`, `Validators.email`
- **Error messages** (shown below the field via `mat-error`):
  - Required (dirty + empty): "Email address is required."
  - Invalid format: "Enter a valid email address."

#### Password

- **Label**: "Password"
- **Type**: `password` with `autocomplete="current-password"`
- **Validators**: `Validators.required`, `Validators.minLength(8)`
- **Error messages**:
  - Required (dirty + empty): "Password is required."
  - Too short (dirty): "Password must be at least 8 characters."
- **Suffix button**: `aria-label="Toggle password visibility"`, toggles `input[type]` between `password` and `text`. Icon switches between `visibility_off` (when hidden) and `visibility` (when shown).

### States

**Pristine (initial load)**: Form renders with no error messages. The "Sign in" button is enabled (validation runs on submit attempt, not on load). No spinner visible.

**Dirty / invalid (user has typed then blurred a field with an error)**: `MatFormField` shows error state with `mat-error` message linked to the field via `aria-describedby`. The field underline/outline renders in `var(--mat-sys-error)`. Error messages appear beneath the relevant field only.

**Submitting**: After the user clicks "Sign in" with valid-looking form values:

- The `AuthActions.signIn({ username, password })` action is dispatched.
- The "Sign in" button is replaced inline by a `MatProgressSpinner` (`diameter="20"`, `mode="indeterminate"`) centred where the button text was. The button remains in the DOM but its text is replaced and `[disabled]="true"` is applied.
- Both form fields become `[readonly]="true"` to prevent input during the request.
- The guard reads `selectAuthStatus === 'unknown'` during this window; the spinner on the button is sufficient feedback — no additional overlay is needed on the login page itself.

**Error (Cognito returns an error)**: The `AuthActions.signInFailure` action carries an `error` string.

- A `MatSnackBar` opens at the **bottom-centre** of the viewport (default M3 snack position).
- Duration: `6000ms`.
- Message text: "Sign-in failed. Check your email and password and try again."
- No action button on the snackbar (the form is still present for retry).
- The button returns to its normal enabled state. Fields become editable again.
- Do not render the raw Cognito error string to the user — always show the generic message above.

**Success**: `AuthActions.signInSuccess` fires. `AuthEffects` navigates to `returnUrl` query param value if present, otherwise to `/photographer/events`. The login page is not shown again.

### Accessibility

- The card has `role="main"` on its outer element. There is only one `<main>` per page.
- Form has `aria-label="Sign in form"`.
- Each `MatFormField` error message is linked to its input via `aria-describedby` (Material handles this automatically when using `mat-error` inside `mat-form-field`).
- The password visibility toggle button has `aria-label="Toggle password visibility"` and `aria-pressed` bound to the current visibility boolean.
- Focus is moved to the email field on page load via `cdkFocusInitial` on the email input.
- The "Sign in" button is the last focusable element in the card. Tab order follows DOM order (email → password → toggle icon → button).
- Colour is never the sole indicator of error state — the `mat-error` text appears alongside the coloured outline.

### Angular Material components

- `MatCardModule` — card container
- `MatFormFieldModule` with `appearance="outline"` — both fields
- `MatInputModule` — inputs inside form fields
- `MatButtonModule` — `mat-flat-button` for submit, `mat-icon-button` for password toggle
- `MatIconModule` — `visibility` / `visibility_off` icons
- `MatProgressSpinnerModule` — inline loading state in the button
- `MatSnackBarModule` — error toast

### NgRx integration

| Event                            | Action dispatched                                                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Form submitted with valid values | `AuthActions.signIn({ username: email.value, password: password.value })`                                                                                                          |
| Component initialises            | `AuthActions.loadSession()` dispatched by `AppComponent` at startup — `LoginComponent` reads `selectAuthStatus` to decide whether to redirect immediately if already authenticated |

**Selectors consumed**:

- `selectAuthStatus` — if `authenticated` on init, navigate away immediately to `/photographer/events`
- `selectAuthError` — drives the snackbar (effect or component can open it; see UX decision note below)

**Loading selector**: The existing auth slice does not have a dedicated `loading` boolean. The submitting state is inferred from `selectAuthStatus === 'unknown'` after dispatch. The component tracks a local `submitting` signal set to `true` on submit and `false` when `signInSuccess` or `signInFailure` arrives. This avoids coupling the loading state to the `unknown` status, which is also used during the initial session check.

---

## Component 2 — `PhotographerLayoutComponent`

**Path**: `src/app/features/photographer/layout/photographer-layout.component.ts`
**Route**: wraps all `/photographer/*` child routes as a named router outlet parent

### Purpose

Provides a persistent navigation shell — sidebar on desktop, collapsible drawer on mobile — for all photographer-facing pages.

### Layout — 1280px (desktop)

The layout is a two-column flex row occupying 100% of the viewport height minus the browser chrome.

**Left column — sidebar navigation** (`width: 240px`, fixed, not scrollable):

- Top section: product wordmark "RaceShots" in `mat-title-medium`, `16px` top padding.
- Navigation list directly below the wordmark. Uses `MatNavList` (`mat-nav-list`). Three navigation items in this order:
  1. "My Events" — icon: `event`, routes to `/photographer/events`
  2. "Dashboard" — icon: `dashboard`, routes to `/photographer/dashboard`
  3. "Profile" — icon: `manage_accounts`, routes to `/photographer/profile`
- Each `MatListItem` uses `routerLink` and `routerLinkActive="active-link"`. The active item renders with `var(--mat-sys-secondary-container)` background and `var(--mat-sys-on-secondary-container)` text — achieved via a CSS class on the host that reads from the M3 theme, not via hardcoded hex.
- Bottom section of the sidebar (pinned to `margin-top: auto`): a `mat-stroked-button` "Sign out" button, full sidebar width, with `logout` icon to the left of the label.
- Sidebar background: `var(--mat-sys-surface-container)`.
- A `1px` right border on the sidebar using `var(--mat-sys-outline-variant)`.

**Right column — main content area** (`flex: 1`, scrollable):

- Background: `var(--mat-sys-surface)`.
- A top bar spanning the content column width: `height: 56px`, `display: flex`, `align-items: center`, `padding: 0 24px`. Contains:
  - Page title (bound dynamically via the router or a `@Input` from child components — see UX decision note).
  - Logged-in email address right-aligned in `mat-body-small`, `var(--mat-sys-on-surface-variant)`.
- Below the top bar: `<router-outlet>` renders the active child component.

### Layout — 375px (mobile)

- The sidebar is hidden by default. A `MatSidenav` (`mat-sidenav-container`) replaces the fixed sidebar. `mode="over"`, `position="start"`.
- A hamburger `mat-icon-button` (`menu` icon) appears in the top bar at the far left, replacing the dynamic page title location. The page title moves to the right of the hamburger icon.
- Tapping the hamburger opens the `MatSidenav`. Tapping outside the drawer or a nav item closes it.
- The `MatSidenav` content is identical to the desktop sidebar. Width: `280px`.
- The signed-in email is hidden on mobile (too narrow).
- The top bar height is `56px` (same as desktop).

### States

**Loading (session check in progress)**: While `selectAuthStatus === 'unknown'`, the layout shell renders normally but the `<router-outlet>` area shows a centred `MatProgressSpinner` (`diameter="48"`, `mode="indeterminate"`) instead of the child component. The sidebar nav is visible and functional — only the content area is blocked. This matches the guard behaviour described above.

**Authenticated (normal)**: Full layout renders. Active nav item is highlighted.

**Sign out in progress**: The "Sign out" button gains `[disabled]="true"` and shows a `MatProgressSpinner` (`diameter="20"`) inline in place of the button label. The sidebar nav items are also disabled during this window to prevent navigation to a protected page while sign-out completes.

**Empty / N/A**: The layout shell itself has no empty state — child components handle their own empty states.

**Error / N/A**: The layout shell does not surface API errors. Child components handle their own error states.

### Responsive behaviour summary

| Element          | 375px                                 | 1280px                   |
| ---------------- | ------------------------------------- | ------------------------ |
| Sidebar          | Hidden; opens as `MatSidenav` overlay | Fixed, always visible    |
| Hamburger button | Visible                               | Hidden                   |
| Signed-in email  | Hidden                                | Right-aligned in top bar |
| Page title       | Right of hamburger                    | Left in top bar          |
| Nav items        | Inside drawer                         | In fixed sidebar         |

### Accessibility

- `MatSidenav` component provides `role="navigation"` on the nav element automatically.
- Add `aria-label="Photographer navigation"` to the `mat-nav-list`.
- The hamburger button has `aria-label="Open navigation menu"` and `aria-expanded` bound to the sidenav open state.
- The "Sign out" button has `aria-label="Sign out of RaceShots"`.
- Each `MatListItem` navigation link has its text as the accessible label (no additional `aria-label` needed — the visible text is descriptive).
- Focus management on mobile: when the sidenav opens, focus moves to the first nav item inside the drawer. When the sidenav closes (via escape or backdrop click), focus returns to the hamburger button. `MatSidenav` handles this via CDK focus trap — verify `cdkTrapFocus` is active in the drawer.
- The main content area has `role="main"` and `id="main-content"`. A skip link ("Skip to main content") is rendered before the sidenav as the first focusable element in the DOM, linking to `#main-content`. It is visually hidden until focused.

### Angular Material components

- `MatSidenavModule` — `mat-sidenav-container`, `mat-sidenav`, `mat-sidenav-content`
- `MatListModule` — `mat-nav-list`, `mat-list-item`
- `MatIconModule` — nav icons, hamburger icon, sign-out icon
- `MatButtonModule` — `mat-icon-button` (hamburger), `mat-stroked-button` (sign out)
- `MatProgressSpinnerModule` — content-area loading state, sign-out in-progress state
- `RouterModule` — `routerLink`, `routerLinkActive`

### NgRx integration

**Selectors consumed**:

- `selectAuthStatus` — controls content area loading overlay
- `selectAuthEmail` — displays signed-in email in top bar

**Actions dispatched**:

| User event                | Action                                                      |
| ------------------------- | ----------------------------------------------------------- |
| "Sign out" button clicked | `AuthActions.signOut()`                                     |
| Component initialises     | No action — session was loaded by `AppComponent` at startup |

**Effects dependency**: `AuthEffects.signOut$` calls `signOut()` from `aws-amplify/auth`, then dispatches `AuthActions.signOutSuccess()`. A separate navigation effect (in `AuthEffects`) listens for `signOutSuccess` and calls `router.navigate(['/login'])`.

---

## Component 3 — `ProfileComponent`

**Path**: `src/app/features/photographer/profile/profile.component.ts`
**Route**: `/photographer/profile` (child of `PhotographerLayoutComponent`)

### Purpose

Allows a photographer to view and update their display name, default currency, and bank transfer details that runners see when purchasing photos.

### Layout — 1280px (desktop)

The component renders inside the `PhotographerLayoutComponent` content area. Max content width: `720px`, left-aligned within the content area with `24px` top and left padding.

Structure top to bottom:

1. **Section heading**: "Account Profile" — `mat-headline-small`. `24px` bottom margin.
2. **Info banner** (conditional — shown only on first load when profile was just initialised from a 404): A `MatCard` with `appearance="outlined"` and a light informational background using `var(--mat-sys-secondary-container)`. Text: "Welcome to RaceShots. Fill in your bank details so runners can pay you directly." Icon: `info` to the left of the text. Dismissed automatically when the user successfully saves for the first time. Not dismissible manually.
3. **Form** (`ReactiveFormsModule`): Uses a single `FormGroup`. Fields are grouped into two visual sections using `MatDivider` between them.

**Section A — Account**

- Display Name field (first in tab order)
- Default Currency field

**Section B — Bank Transfer Details**
A `MatCard` with `appearance="outlined"` wrapping the bank fields. The card header text reads "Bank Transfer Details" in `mat-title-medium`. A subtitle below in `mat-body-small`, `var(--mat-sys-on-surface-variant)`: "These details are shown to runners when they purchase your photos."

- Bank Name field
- Account Holder field
- Account Number field
- Payment Instructions field (multiline)

4. **Action row**: `display: flex`, `justify-content: flex-end`, `gap: 16px`, `margin-top: 24px`.
   - "Cancel" — `mat-stroked-button` — resets the form to the last saved values and navigates back to `/photographer/events`.
   - "Save changes" — `mat-flat-button` (primary role token) — submits the form.

### Layout — 375px (mobile)

- Content area: `0` left padding (full bleed to the `16px` edge padding of the layout shell).
- All form fields remain full-width single-column.
- The action row becomes `flex-direction: column-reverse` (Save on top, Cancel below) so the primary action is closer to the thumb. Buttons are full-width.
- The info banner remains at the top.
- Max content width constraint is removed.

### Form fields

All fields use `MatFormField` with `appearance="outline"`.

#### Display Name

- **Label**: "Display name"
- **Hint**: "Shown to runners on your event pages."
- **Type**: text, `autocomplete="off"`
- **Validators**: `Validators.required`, `Validators.maxLength(100)`
- **Errors**:
  - Required: "Display name is required."
  - Too long: "Display name must be 100 characters or fewer."

#### Default Currency

- **Label**: "Default currency"
- **Type**: `MatSelect` (dropdown), not a free-text input — prevents invalid ISO 4217 codes at the form level.
- **Options**: A curated list of currencies defined as a constant in the component. Minimum list: USD, EUR, GBP, GTQ, MXN, CAD, AUD, BRL. Each option shows the currency code and name (e.g., "USD — US Dollar"). The full list may be expanded in a later story; the build agent must define this as a `readonly` constant array, not hardcoded into the template.
- **Validators**: `Validators.required`
- **Error**: "Please select a currency."
- **Note**: Using a `MatSelect` with a fixed list means the AC9 server-side 400 for invalid currency codes should be rare in practice but must still be handled (see error state below).

#### Bank Name

- **Label**: "Bank name"
- **Type**: text
- **Validators**: `Validators.maxLength(100)`
- **Error**: "Bank name must be 100 characters or fewer."
- **Required**: No — bank details are optional at the point of profile creation; a photographer may save the profile and add bank details later.

#### Account Holder

- **Label**: "Account holder name"
- **Type**: text
- **Validators**: `Validators.maxLength(100)`
- **Error**: "Account holder name must be 100 characters or fewer."
- **Required**: No

#### Account Number

- **Label**: "Account number"
- **Hint**: "Your account or IBAN number."
- **Type**: text — not `number` or `tel` — because IBANs contain letters and formatting varies by country.
- **Validators**: `Validators.maxLength(50)`
- **Error**: "Account number must be 50 characters or fewer."
- **Required**: No
- **Sensitive**: This field must never be logged. The build agent must not add `console.log` statements or NgRx DevTools serialisation for this field's value.

#### Payment Instructions

- **Label**: "Payment instructions"
- **Hint**: "Additional instructions shown to runners, e.g. reference format or bank branch details."
- **Type**: `textarea`, `cdkTextareaAutosize`, `cdkAutosizeMinRows="3"`, `cdkAutosizeMaxRows="8"` (from `CdkTextareaAutosize` in `@angular/cdk/text-field`)
- **Validators**: `Validators.maxLength(500)`
- **Error**: "Payment instructions must be 500 characters or fewer."
- **Required**: No

### States

**Loading (initial page load)**:

On `ngOnInit`, the component dispatches `PhotographerActions.loadProfile()`. While `selectProfileLoading === true`:

- Each `MatFormField` is replaced by a `MatProgressBar` skeleton. Specifically, the form container shows a full-width `MatProgressBar` (`mode="query"`, `aria-label="Loading profile"`) at the top of the form section, and all form fields are rendered but with `[readonly]="true"` and a visual shimmer achieved by adding a CSS class (`loading-shimmer`) that applies `animation: pulse` via keyframes referencing `var(--mat-sys-surface-variant)` as the shimmer colour. Do not use a third-party skeleton library.
- The "Save changes" button is `[disabled]="true"`.

**Empty (GET returned 404 — first visit)**:

The effect calls `PUT /photographer/me` with empty defaults (`displayName: ''`, `defaultCurrency: 'USD'`, all bank fields empty). After `updateProfileSuccess`:

- The info banner described in the Layout section becomes visible.
- All fields are empty (or pre-filled with the `defaultCurrency: 'USD'` default).
- The form is editable immediately.

**Error (GET or PUT fails at the API level)**:

If `PhotographerActions.loadProfileFailure` fires:

- `MatSnackBar` opens at bottom-centre: "Could not load your profile. Please refresh the page."
- Duration: `8000ms`.
- SnackBar action: "Retry" — clicking it dispatches `PhotographerActions.loadProfile()` again.
- The form remains visible but all fields are `[readonly]="true"` and the "Save changes" button is `[disabled]="true"`.

If `PhotographerActions.updateProfileFailure` fires:

- `MatSnackBar` opens at bottom-centre.
- If the error message from the API contains a 400 status (invalid currency code per AC9): "Invalid currency code. Please select a valid currency from the list."
- For all other errors: "Could not save your profile. Please try again."
- Duration: `6000ms`.
- No SnackBar action button (the form is still editable for retry).
- The "Save changes" button returns to its enabled state.

**Submitting**:

After "Save changes" is clicked:

- The form is validated client-side first. If invalid, all touched errors appear and focus moves to the first invalid field — the form does not submit.
- If valid, `PhotographerActions.updateProfile({ profile: formValue })` is dispatched.
- The "Save changes" button text is replaced by a `MatProgressSpinner` (`diameter="20"`, inline) and the button is `[disabled]="true"`.
- The form fields become `[readonly]="true"`.

**Success**:

When `PhotographerActions.updateProfileSuccess` fires:

- The NgRx profile state is updated with the returned profile.
- The form is patched with the returned values (in case the server normalised any field).
- The "Save changes" button returns to its normal enabled state.
- Form fields become editable.
- `MatSnackBar` opens at bottom-centre: "Profile saved successfully."
- Duration: `4000ms`.
- No SnackBar action button.
- The info banner (if shown) is hidden.

### Responsive behaviour summary

| Element          | 375px                             | 1280px                    |
| ---------------- | --------------------------------- | ------------------------- |
| Form width       | Full bleed (minus layout padding) | Max `720px`, left-aligned |
| Action buttons   | Full-width, stacked, Save on top  | Inline row, right-aligned |
| Bank detail card | Flat (no elevation)               | Outlined card             |
| Info banner      | Full width                        | Full width, max `720px`   |

### Accessibility

- The form has `aria-label="Account profile form"`.
- All `MatFormField` components link their `mat-error` elements to the input via `aria-describedby` automatically. The build agent must verify this is not overridden.
- The Default Currency `MatSelect` has `aria-label="Default currency"` in addition to the visible label (the `MatFormField` label covers this, but `MatSelect` must carry the label).
- The Payment Instructions `textarea` has `aria-label="Payment instructions"`.
- The Account Number field has `aria-label="Account number"` and must NOT have `autocomplete="cc-number"` or any payment-specific autocomplete attribute — this is not a card number.
- The info banner has `role="status"` and `aria-live="polite"` so screen readers announce it when it appears.
- Error snackbars have `aria-live="assertive"` (handled by `MatSnackBar` by default).
- Success snackbar uses the default `MatSnackBar` `aria-live="polite"` behaviour.
- On form submit with validation errors, focus is programmatically moved to the first field with an error using `ViewChildren(MatFormField)` — iterate to find the first one whose control is invalid and call `.focus()` on its underlying `nativeElement`.
- The "Cancel" and "Save changes" buttons have descriptive visible labels — no additional `aria-label` needed.

### Angular Material components

- `MatCardModule` — bank details card, info banner card
- `MatFormFieldModule` with `appearance="outline"` — all fields
- `MatInputModule` — text inputs and textarea
- `MatSelectModule` — currency dropdown
- `MatButtonModule` — `mat-stroked-button` (Cancel), `mat-flat-button` (Save)
- `MatProgressSpinnerModule` — inline button loading, textarea
- `MatProgressBarModule` — page-level loading state
- `MatSnackBarModule` — success, error, retry toasts
- `MatDividerModule` — section separator between Account and Bank Details
- `MatIconModule` — info icon in banner
- `CdkTextareaAutosize` from `@angular/cdk/text-field` — auto-growing textarea

### NgRx integration

**Feature store slice**: `store/photographer/`

**Selectors consumed**:

| Selector               | Purpose                                               |
| ---------------------- | ----------------------------------------------------- |
| `selectProfile`        | Pre-fills all form fields on load                     |
| `selectProfileLoading` | Drives loading shimmer and button disabled state      |
| `selectProfileError`   | Drives error snackbar and retry state                 |
| `selectProfileSaving`  | Drives submit button spinner and field readonly state |

Note: The story's tech notes define `loadProfileFailure` and `updateProfileFailure` but do not enumerate a `saving` boolean. The reducer should track `saving: boolean` separately from `loading: boolean` to distinguish page-load from submit-in-progress states. The build agent must add `saving` to `PhotographerState`. This is flagged as a UX decision below.

**Actions dispatched**:

| User event                          | Action                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Component initialises (`ngOnInit`)  | `PhotographerActions.loadProfile()`                                                                             |
| GET returns 404 (in effect)         | `PhotographerActions.updateProfile({ profile: emptyDefaults })` — dispatched from the effect, not the component |
| "Save changes" clicked (form valid) | `PhotographerActions.updateProfile({ profile: formValue })`                                                     |
| "Cancel" clicked                    | No NgRx action — component calls `form.reset(lastSavedValues)` then `router.navigate(['/photographer/events'])` |
| Retry clicked in error snackbar     | `PhotographerActions.loadProfile()`                                                                             |

**Effect responsibilities** (for the build agent, not strictly UX but load-bearing for the spec):

- `loadProfile$` — calls `GET /photographer/me`; on 404 response specifically, dispatches `PhotographerActions.updateProfile({ profile: emptyDefaults })` instead of `loadProfileFailure`; on other errors dispatches `loadProfileFailure`.
- `updateProfile$` — calls `PUT /photographer/me`; on success dispatches `updateProfileSuccess({ profile: response })`; on 400 includes the server error message in `updateProfileFailure({ error: message })`.

---

## Toast / SnackBar placement summary

All `MatSnackBar` instances in this story use the Angular Material default positioning: **bottom-centre** of the viewport on desktop; **bottom** full-width on mobile. No custom `panelClass` overrides are needed for positioning.

| Component          | Trigger                        | Message                                                                | Duration | Action  |
| ------------------ | ------------------------------ | ---------------------------------------------------------------------- | -------- | ------- |
| `LoginComponent`   | `signInFailure`                | "Sign-in failed. Check your email and password and try again."         | 6000ms   | None    |
| `ProfileComponent` | `loadProfileFailure`           | "Could not load your profile. Please refresh the page."                | 8000ms   | "Retry" |
| `ProfileComponent` | `updateProfileFailure` (400)   | "Invalid currency code. Please select a valid currency from the list." | 6000ms   | None    |
| `ProfileComponent` | `updateProfileFailure` (other) | "Could not save your profile. Please try again."                       | 6000ms   | None    |
| `ProfileComponent` | `updateProfileSuccess`         | "Profile saved successfully."                                          | 4000ms   | None    |

---

## Colour and typography token reference

Use only the following M3 system token references — never hardcode hex values.

**Colour roles used in this story**:

- `var(--mat-sys-primary)` — primary action button fill (`mat-flat-button`)
- `var(--mat-sys-on-primary)` — primary action button text
- `var(--mat-sys-surface)` — page backgrounds, card backgrounds
- `var(--mat-sys-surface-container)` — sidebar background
- `var(--mat-sys-surface-container-low)` — login page viewport background
- `var(--mat-sys-secondary-container)` — active nav item background, info banner background
- `var(--mat-sys-on-secondary-container)` — active nav item text, info banner text
- `var(--mat-sys-error)` — form field error state outline
- `var(--mat-sys-on-error-container)` — error text
- `var(--mat-sys-on-surface-variant)` — secondary text (hint text, email display, subtitle text)
- `var(--mat-sys-outline-variant)` — sidebar border, divider lines

**Typography scale used in this story**:

- `mat-headline-medium` — login page wordmark
- `mat-headline-small` — profile page section heading
- `mat-title-large` — login page sub-heading
- `mat-title-medium` — sidebar wordmark, bank details card heading
- `mat-body-small` — login supporting text, signed-in email, field hints
- `mat-body-medium` — form field content (Material default for inputs)

---

## UX decisions not in the story ACs (requires team review)

The following decisions were made to produce a complete, buildable spec. Each is flagged for explicit team review before implementation begins.

**UX-D1 — Auth status `unknown` spinner location**: The spec places the full-viewport overlay spinner in `AppComponent` rather than in the guard or in `PhotographerLayoutComponent`. This means there is a brief spinner visible on initial load for all users (including runners) while Cognito session is checked. The alternative — placing the spinner only within the photographer layout — would leave runner pages unaffected but the session check latency is the same either way. **Decision: full-page overlay in `AppComponent` while status is `unknown`; the overlay is removed as soon as status resolves.** Review if runner journey pages should be exempt.

**UX-D2 — `saving` boolean in PhotographerState**: The story tech notes define `loading` and `error` in the state shape but not a separate `saving` flag. A single `loading` flag cannot distinguish "loading the profile for the first time" from "submitting the form". The spec requires both states for correct UI behaviour. **Decision: add `saving: boolean` to `PhotographerState`.** The build agent must include this in the reducer and selectors.

**UX-D3 — Default Currency as `MatSelect` with a fixed list**: AC9 describes the server returning a 400 for invalid currency codes. The spec uses a `MatSelect` with a curated list rather than a free-text input to prevent invalid submissions at the UI level. This narrows the supported currencies to those explicitly listed. **Decision: use a fixed curated list of ~8 currencies; expand via a follow-on story.** If a photographer needs an unlisted currency, they must request it be added. Review with the PO.

**UX-D4 — "Cancel" button navigates to `/photographer/events`**: The story does not specify what "Cancel" does. The spec navigates to the events list as the most logical destination after abandoning a profile edit. **Decision: Cancel resets the form and navigates to `/photographer/events`.** Review if the navigation target should be configurable based on the `returnUrl` or breadcrumb context.

**UX-D5 — Page title binding mechanism**: The top bar in `PhotographerLayoutComponent` displays a dynamic page title. The story does not specify how this title is supplied. The spec implies each child component sets a title (e.g., "My Events", "Profile") that the layout reads. **Decision: child components use Angular's `Title` service to set the document title; the layout reads this via a `@Input` or a shared `NavigationService`. The build agent should use a lightweight `NavigationTitleService` (a single BehaviourSubject) injected into both the layout and each child component.** Review if router data configuration (`data: { title: 'Profile' }`) is preferred instead.

**UX-D6 — Info banner dismissal**: The spec auto-hides the info banner after the first successful save. It is not manually dismissible. This avoids needing a dismiss action in the store. **Decision: the component tracks a local `showWelcomeBanner` signal set to `false` on `updateProfileSuccess`. No NgRx state needed for this.** Review if it should persist across page refreshes (would require store/local-storage integration).

**UX-D7 — 404 initialisation flow is handled in the effect, not the component**: AC4 states that Angular "immediately calls `PUT /photographer/me` with empty defaults" on a 404. The spec routes this through the `loadProfile$` effect rather than having the component subscribe to the 404 case and dispatch separately. This keeps the component free of response-code logic. **Decision: `loadProfile$` effect detects 404 and dispatches `updateProfile({ profile: emptyDefaults })` inline.** Review if an explicit `initProfile` action would be clearer.
