# Story: Internationalization — English and Latin Spanish (extensible)
**ID**: RS-021
**Epic**: Frontend
**Status**: ready
**Has UI**: yes

## Context

RaceShots serves photographers and runners across Latin America where English is
not the primary language. Today all UI text and transactional emails are
English-only. This story introduces runtime i18n support for English (`en`) and
Latin Spanish (`es-419`) across both the photographer portal and the runner-facing
pages, extending Journey 1 and Journey 2 with an extensible pattern — contributors
add a language by dropping one JSON file with no code or build changes. All four
existing SES email templates are also localised.

## Acceptance criteria

- [ ] AC1: Given a user's browser language is set to any `es-*` variant and no
  `racephotos_locale` key exists in `localStorage`, When they load any RaceShots
  page, Then the UI renders entirely in Latin Spanish.

- [ ] AC2: Given a user opens the language switcher and selects English, When the
  selection is confirmed, Then `racephotos_locale=en` is written to `localStorage`,
  the page reloads, and all visible strings render in English — and subsequent
  visits preserve English regardless of browser locale.

- [ ] AC3: Given a photographer has `preferredLocale: "es-419"` saved in their
  profile, When a runner creates an order for that photographer's photos, Then
  the photographer notification email uses the `racephotos-photographer-claim-es-419`
  SES template.

- [ ] AC4: Given a runner created an order with browser locale `es-419` (stored as
  `Order.Locale`), When the photographer approves the purchase, Then the download-ready
  email sent to the runner uses the `racephotos-runner-purchase-approved-es-419` SES
  template.

- [ ] AC5: Given a runner's order has `Locale: "es-419"`, When the photographer
  rejects the purchase or the runner requests a re-download link, Then those
  transactional emails also use the Spanish SES template variants.

- [ ] AC6: Given a runner is on the event search page with locale `es-419`, When
  they search by bib number and proceed through the full purchase stepper (cart
  review → email → bank details → confirmation), Then all labels, payment
  instructions, error messages, and status chips render in Latin Spanish.

- [ ] AC7: Given a contributor creates `src/assets/i18n/fr.json` and adds `"fr"`
  to the supported-locales list in `LocaleService`, When the app loads with a
  French browser locale, Then French strings display without any other code
  changes.

- [ ] AC8: Given a browser locale that is not `en` or `es-419` (e.g. `de`), When
  the page loads with no stored preference, Then the UI falls back to English.

## Out of scope

- Server-side locale negotiation via `Accept-Language` header on Lambda API responses
- Right-to-left (RTL) language support
- Locale-specific number/currency formatting beyond what Angular's built-in pipes
  provide automatically with the active `LOCALE_ID`
- Photographer locale preference in the Angular profile UI (locale is set by
  updating `preferredLocale` via the existing profile form in this story;
  a dedicated locale picker component may be added in a follow-up)
- Language-specific watermark text on photos

## Tech notes

### Frontend — Angular

- **Library**: `@ngx-translate/core` + `@ngx-translate/http-loader`.
  Single compiled bundle; translation JSON files are loaded at runtime from
  CloudFront. Contributors add a language by adding one JSON file — no build
  changes required. (ADR-0013 documents this choice over `@angular/localize`.)
- **Translation files**:
  - `src/assets/i18n/en.json` — English strings (flat key/value)
  - `src/assets/i18n/es-419.json` — Latin Spanish strings (same key set)
  Keys use dot-notation namespacing: `event.search.bibLabel`, `purchase.step.bankDetails.title`, etc.
- **`LocaleService`** (`src/app/core/services/locale.service.ts`):
  - On startup: reads `localStorage['racephotos_locale']`; falls back to
    `navigator.language` prefix-matched against supported locales; falls back
    to `"en"`.
  - `setLocale(code: string)`: writes `racephotos_locale` to `localStorage`,
    then calls `window.location.reload()`. The page re-bootstraps in the new
    locale. **`LOCALE_ID` is never mutated mid-session** — Angular's DI token
    is resolved once at bootstrap via `APP_INITIALIZER` (see below).
  - `getCurrentLocale(): string`: reads `localStorage` (or browser default).
    Called by `APP_INITIALIZER` and `LanguageSwitcherComponent`.
  - Supported locales list is the single place to register a new language.
  - **NgRx deviation (intentional)**: locale switching is a synchronous
    side-effect-free operation (localStorage write + page reload) with no HTTP
    calls and no cross-slice state. A standalone service is appropriate here;
    an NgRx slice would add boilerplate with no benefit. Per ADR-0005, components
    must not call HTTP directly — this service does not violate that rule.
- **`APP_INITIALIZER`** in `app.config.ts`:
  - Reads `localStorage['racephotos_locale']` (or browser default via
    `LocaleService.getCurrentLocale()`) before the DI graph resolves.
  - Provides `LOCALE_ID` and calls `TranslateService.use(locale)` so both
    `@ngx-translate` strings and Angular's `DatePipe`/`CurrencyPipe`/
    `DecimalPipe` use the correct locale from the first render.
- **`LanguageSwitcherComponent`** (`src/app/shared/language-switcher/`):
  - `MatMenuModule`-based dropdown showing locale display names.
  - On selection: calls `LocaleService.setLocale(code)` — triggers reload.
  - Added to the `PhotographerLayoutComponent` toolbar and to the public
    event-search page header.
- **Storybook**: every new or modified component requires a story that
  demonstrates both English and Latin Spanish states.

### Backend — shared models

- **`lambdas/shared/models/order.go`**: add `Locale string`
  (`dynamodbav:"locale"`) — IETF BCP 47 tag (`"en"` or `"es-419"`) captured
  at order creation from the request body. Empty string treated as `"en"` by
  the template-selection helper.
- **`lambdas/shared/models/photographer.go`**: add `PreferredLocale string`
  (`dynamodbav:"preferredLocale"`) — set by the photographer via the profile
  form. Empty string defaults to `"en"`.
- **Shared helper** (`lambdas/shared/`): `LocaleTemplateName(base, locale string) string`
  returns `base + "-" + locale` when `locale` is a supported value (`"en"`,
  `"es-419"`), otherwise returns `base + "-en"`. All email-sending lambdas use
  this helper — never construct template names inline.

### Backend — Lambda changes

- **`lambdas/create-order`**:
  - Add `locale` to `createOrderRequest`; validate it is a non-empty IETF tag
    (max 35 chars, no further format enforcement in v1); store in `Order.Locale`.
  - Select the photographer notification template via
    `LocaleTemplateName("racephotos-photographer-claim", photographer.PreferredLocale)`.
- **`lambdas/approve-purchase`**: select runner email template via
  `LocaleTemplateName("racephotos-runner-purchase-approved", order.Locale)`.
- **`lambdas/reject-purchase`**: **new behavior added in this story** — RS-011
  explicitly scoped out sending a rejection email to the runner ("No email is
  sent to the runner in v1"). RS-021 adds it: add `Email EmailSender` to the
  `Handler` struct, call `SendTemplatedEmail` after a successful rejection write,
  and select the template via
  `LocaleTemplateName("racephotos-runner-purchase-rejected", order.Locale)`.
  Add corresponding CDK `EmailSender` injection and `grantSendEmail` grant to
  `PaymentConstruct`. (New SES template pair — add to `SesConstruct`.)
- **`lambdas/redownload-resend`**: add `Orders OrderStore` to the `Handler`
  struct. `OrderStore` does **not** exist in this lambda — define it in
  `store.go` alongside the other interfaces (model it on the `OrderStore`
  in `lambdas/reject-purchase/handler/`). Also extend the
  `GetApprovedPurchasesByEmail` `ProjectionExpression` to include `orderId`
  and `approvedAt` (currently only `downloadToken` and `photoId` are projected
  — both new fields are needed for locale lookup). After fetching approved
  purchases, identify the purchase with the most recent `ApprovedAt` timestamp,
  fetch its parent order via `Orders.GetOrder(ctx, purchase.OrderID)`, and use
  that order's `Locale` to select the template:
  `LocaleTemplateName("racephotos-runner-redownload-resend", order.Locale)`.
  If the order fetch fails, fall back to `"en"` (log the error, do not abort
  the send).
- **`lambdas/update-photographer`**: accept and persist `preferredLocale` in the
  update request body; validate against the supported-locale list.
- **Interface**: no new interface *concepts*. Each Lambda is a self-contained Go
  module, so local definitions are required where missing: `reject-purchase` must
  add `EmailSender` + `SESEmailSender` to its `handler/` package (model on
  `lambdas/create-order/handler/email.go`); `redownload-resend` must add
  `OrderStore` + `DynamoOrderStore` to `store.go` (model on
  `lambdas/reject-purchase/handler/`). The `EmailSender` signature already accepts
  a template name string in every lambda — callers simply pass the locale-resolved
  name from `LocaleTemplateName`.

### CDK — `SesConstruct`

- Rename the four existing template entries to use an `-en` locale suffix
  (e.g. `racephotos-photographer-claim-en`). All Lambda changes happen in the
  same PR so the rename is atomic.
- Add four `es-419` counterpart entries for each template.
- New HTML/text source files in `infra/cdk/constructs/ses-templates/`:
  `photographer-claim-en.*`, `photographer-claim-es-419.*`,
  `runner-claim-confirmation-en.*`, `runner-claim-confirmation-es-419.*`,
  `runner-purchase-approved-en.*`, `runner-purchase-approved-es-419.*`,
  `runner-redownload-resend-en.*`, `runner-redownload-resend-es-419.*`.
  (Also add `runner-purchase-rejected-en.*` and `runner-purchase-rejected-es-419.*`
  if not already present.)
- `grantSendEmail` ARN list must include all `-en` and `-es-419` template ARNs.

### DynamoDB access pattern

`Order.Locale` and `Photographer.PreferredLocale` are non-key attributes written
at creation/update time and read via existing PK lookups. No new GSI needed.

### New env vars

None.

### ADR dependency

ADR-0013 (i18n approach: `@ngx-translate` runtime JSON vs. `@angular/localize`
compile-time bundles) — accepted, see `docs/adr/0013-i18n-runtime-translation.md`.
No open decisions from `PRODUCT_CONTEXT.md` block this story.

## Definition of Done

### All stories
- [ ] Interface written before implementation
- [ ] Table-driven unit tests written before implementation
- [ ] Unit tests pass (`make test-unit`)
- [ ] Integration test written with `//go:build integration` tag
- [ ] Integration test passes against LocalStack (`make test-integration`)
- [ ] CDK construct updated and `cdk synth` passes
- [ ] `environments.example.ts` updated if new config key added
- [ ] `.env.example` updated if new env var added
- [ ] ADR written for any non-obvious architectural decision
- [ ] Story status set to `done`

### UI stories only (skip if Has UI: no)
- [ ] Angular component compiles with `ng build --aot` (zero errors, zero warnings)
- [ ] Angular unit tests pass (`ng test --watch=false --code-coverage`)
  - Component logic: >80% line coverage
- [ ] Storybook story written for every new component (`*.stories.ts`)
- [ ] `npx storybook build` passes (no broken renders)
- [ ] Playwright E2E test written covering all acceptance criteria
- [ ] Playwright test passes against local dev server (`npx playwright test`)
- [ ] Playwright screenshot snapshot committed (visual baseline)
- [ ] Responsive layout verified at 375px (mobile) and 1280px (desktop) via Playwright
