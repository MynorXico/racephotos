# ADR-0013: Runtime JSON translation with @ngx-translate over compile-time @angular/localize

**Date**: 2026-04-25
**Status**: accepted

## Context

RS-021 introduces internationalization for English and Latin Spanish (`es-419`),
extensible to additional languages. The Angular frontend must support runtime
language switching driven by browser locale detection and an explicit user
switcher, with the selection persisted in `localStorage`.

RaceShots is an open-source project intended to be self-hosted by individual
photographers and photography businesses worldwide. Contributors must be able to
add a new language without touching application code or the build pipeline.

Two mainstream Angular i18n approaches were considered:

1. **`@angular/localize`** — Angular's built-in compile-time i18n. Strings are
   extracted from templates using `i18n` attributes, and a separate compiled
   bundle is produced per locale. The CDN/server routes each user to the
   correct bundle based on the URL path or `Accept-Language` header.
2. **`@ngx-translate/core`** — A third-party library that loads translation
   strings from JSON files at runtime. A single compiled bundle is deployed;
   the app fetches the active locale's JSON from a well-known path at startup
   and on every language switch.

The decision must also cover how Angular's built-in locale-sensitive pipes
(`DatePipe`, `CurrencyPipe`, `DecimalPipe`) are handled. `LOCALE_ID` — the
Angular DI token these pipes read — is resolved once at app bootstrap and
cannot be updated mid-session without re-initialising the application.

## Decision

Use **`@ngx-translate/core`** (`@ngx-translate/core` + `@ngx-translate/http-loader`)
for all user-visible string translation.

Language switching triggers a **full page reload** via `window.location.reload()`
after `localStorage` is written. This means:

- `@ngx-translate` strings switch immediately for the new session.
- Angular's built-in locale-sensitive pipes (`DatePipe`, `CurrencyPipe`,
  `DecimalPipe`) are re-bootstrapped with the correct `LOCALE_ID` on reload,
  driven by an `APP_INITIALIZER` that reads `localStorage['racephotos_locale']`
  before the DI graph is constructed.
- The reload is imperceptible on a fast connection and acceptable for a
  deliberate user action (choosing a language).

`LOCALE_ID` is **never set dynamically mid-session**. The pattern
`setLocale(code)` writes to `localStorage` and immediately calls
`window.location.reload()`. The provider token is read only at bootstrap.

Translation files live at `src/assets/i18n/{locale}.json` and are served
by CloudFront. Adding a new language requires only:
1. A new `{locale}.json` file.
2. One entry in `LocaleService.SUPPORTED_LOCALES`.
No build changes, no CDK changes, no route configuration.

## Options considered

### Option A — `@angular/localize` (compile-time, separate bundles)

Pros:
- First-party Angular support; tree-shakes unused strings at compile time.
- No runtime network request for translation data.
- Excellent tooling: `ng extract-i18n` generates XLIFF/XMB for professional
  translators.

Cons:
- A separate Angular build artefact must be produced and deployed **per locale**.
  For a self-hosted open-source project this requires contributors to understand
  and configure the multi-locale build pipeline.
- Adding a new language requires a code + build change, a CDK deploy to push a
  new S3 artefact and update the CloudFront routing rule, and a pipeline run.
- Runtime language switching (without URL change) is not supported — the user
  must navigate to a different URL path (`/en/...` vs `/es/...`).
- The CDK `FrontendConstruct` and CloudFront routing rules must be updated every
  time a new locale is added, raising the contributor barrier.

### Option B — `@ngx-translate/core` (chosen)

Pros:
- Single Angular build artefact for all environments and all locales.
- Adding a language = one JSON file drop. Zero build, zero CDK, zero infra change.
- Language switching via page reload is a simple, well-understood pattern.
- Strong Angular community adoption; well-maintained; agents have reliable
  training data on the API.

Cons:
- Third-party dependency (not part of the Angular core team).
- Translation JSON must be downloaded at runtime (one small network request
  per session, served from CloudFront — negligible for typical connection speeds).
- `LOCALE_ID`-dependent pipes require a page reload to switch locale (accepted
  — see Decision section).

## Consequences

**Positive**:
- Self-hosters and contributors can add a language by placing one JSON file in
  `src/assets/i18n/` — no build or infrastructure change required.
- Single deployment artefact simplifies the CI/CD pipeline for all environments.
- `LocaleService.SUPPORTED_LOCALES` is the single registry for known languages;
  the `LocaleTemplateName` Go helper mirrors it for SES template selection.

**Negative / tradeoffs**:
- `window.location.reload()` on language switch causes a brief visual flash.
  Mitigated by persisting the new locale in `localStorage` before reload so the
  page bootstraps directly in the target language with no re-flash.
- `@ngx-translate` adds a small runtime dependency (~12 kB gzipped). Acceptable
  given the project's existing bundle size.

**Install commands** (run as part of RS-021):
```bash
cd frontend/angular
npm install @ngx-translate/core @ngx-translate/http-loader
```

**Agent instructions**:
- Use `TranslateModule.forRoot()` in `app.config.ts` with `HttpLoaderFactory`
  pointing to `./assets/i18n/` and `.json` extension.
- Use `TranslatePipe` in all templates: `{{ 'key' | translate }}`.
- Use `TranslateService.instant()` only in non-template contexts (e.g. form
  validators, Storybook args). Never call it before translation files are loaded.
- Never call `TranslateService.use()` directly from a component — always call
  `LocaleService.setLocale()` so the reload and `localStorage` write happen
  atomically.
- `LOCALE_ID` is provided via `APP_INITIALIZER` from `localStorage` at bootstrap
  — never override it elsewhere.

**Stories affected**: RS-021
