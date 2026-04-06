# Story: Photographer account — auth shell + profile setup

**ID**: RS-004
**Epic**: Infrastructure / Frontend
**Status**: done
**Has UI**: yes

## Context

Before a photographer can create events or upload photos, they need to authenticate and set up their account profile. This story delivers the complete photographer auth flow (login, logout, protected routes) and the profile settings page where they configure their bank transfer details and default currency. Bank details are displayed to runners at purchase time (Journey 3, step 2).

## Acceptance criteria

- [ ] AC1: Given an unauthenticated user visits any `/photographer/*` route, when the Angular router resolves, then they are redirected to `/login`.
- [ ] AC2: Given a photographer visits `/login`, when they enter valid Cognito credentials and submit, then they are authenticated via Amplify v6 `signIn`, the NgRx auth state is updated, and they are redirected to `/photographer/events`.
- [ ] AC3: Given a photographer clicks "Sign out", when the action completes, then Amplify `signOut` is called, NgRx auth state is cleared, and they are redirected to `/login`.
- [ ] AC4: Given `GET /photographer/me` is called with a valid Cognito JWT, when the photographer has no existing profile record, then 404 is returned. The Angular app handles this by immediately calling `PUT /photographer/me` with empty defaults to initialise the profile.
- [ ] AC5: Given `GET /photographer/me` is called with a valid Cognito JWT, when a profile exists, then the full profile is returned: `{ id, displayName, defaultCurrency, bankName, bankAccountNumber, bankAccountHolder, bankInstructions, createdAt, updatedAt }`.
- [ ] AC6: Given `PUT /photographer/me` is called with a valid Cognito JWT and a valid body, when the request completes, then the Photographer record is updated and the updated profile is returned.
- [ ] AC7: Given a photographer visits `/photographer/profile`, when the page loads, then their current profile values are pre-filled in the form fields.
- [ ] AC8: Given a photographer fills in their bank details and saves, when `PUT /photographer/me` succeeds, then a success toast is shown and the NgRx profile state is updated.
- [ ] AC9: Given `PUT /photographer/me` is called with an invalid currency code, when the Lambda validates the request body, then a 400 error is returned with a descriptive message.
- [ ] AC10: Given `GET /photographer/me` or `PUT /photographer/me` is called without a valid Cognito JWT, when API Gateway evaluates the JWT authorizer, then 401 Unauthorized is returned.

## Out of scope

- Photographer registration UI (Cognito self sign-up is enabled but no custom registration page in v1 — photographers sign up via the Cognito hosted UI or admin console)
- Password reset UI (use Cognito hosted UI for now)
- Profile photo / avatar upload

## Tech notes

- New Lambda modules:
  - `lambdas/get-photographer/` — `GET /photographer/me`, Cognito JWT required
  - `lambdas/update-photographer/` — `PUT /photographer/me`, Cognito JWT required
- Both Lambdas add their routes to the `ApiConstruct` HTTP API (from RS-002)
- New model: `shared/models/photographer.go`
  ```go
  type Photographer struct {
      ID                string `dynamodbav:"id"`
      DisplayName       string `dynamodbav:"displayName"`
      DefaultCurrency   string `dynamodbav:"defaultCurrency"` // ISO 4217
      BankName          string `dynamodbav:"bankName"`
      BankAccountNumber string `dynamodbav:"bankAccountNumber"`
      BankAccountHolder string `dynamodbav:"bankAccountHolder"`
      BankInstructions  string `dynamodbav:"bankInstructions"`
      CreatedAt         string `dynamodbav:"createdAt"`
      UpdatedAt         string `dynamodbav:"updatedAt"`
  }
  ```
- Interface to implement:
  ```go
  type PhotographerStore interface {
      GetPhotographer(ctx context.Context, id string) (*models.Photographer, error)
      UpsertPhotographer(ctx context.Context, p models.Photographer) error
  }
  ```
- DynamoDB access pattern: `GetItem` by PK=photographerID (Cognito `sub` claim from JWT)
- `get-photographer` returns 404 (`apperrors.ErrNotFound`) when no record exists; it does NOT create one
- `update-photographer` uses `UpsertPhotographer` (PutItem) — creates the record on first call, updates on subsequent calls; Angular calls this on profile page load if GET returned 404
- Never log `BankAccountNumber`, `BankAccountHolder`, or `BankInstructions` fields — treat as financial PII
- New env vars:
  ```
  RACEPHOTOS_ENV                 required — "local"|"dev"|"qa"|"staging"|"prod"
  RACEPHOTOS_PHOTOGRAPHERS_TABLE required — DynamoDB table name
  ```
- CDK: new `PhotographerConstruct` in `infra/cdk/constructs/photographer-construct.ts`
  - Two Lambda functions, each wrapped with `ObservabilityConstruct`
  - IAM: photographers table grants `dynamodb:GetItem` only to get-photographer; `dynamodb:PutItem` only to update-photographer
  - Routes added to `ApiConstruct.httpApi` using the JWT authorizer from RS-002
- Angular structure:
  - `src/app/features/photographer/` feature module (lazy-loaded)
  - `src/app/core/auth/auth.guard.ts` — `CanActivateFn` that reads NgRx auth state; redirects to `/login` if no authenticated session
  - `src/app/core/auth/auth.interceptor.ts` — `HttpInterceptorFn` that calls `fetchAuthSession` (Amplify v6) and attaches `Authorization: Bearer <token>` to all requests to `apiBaseUrl`
  - `src/app/features/auth/login/login.component.ts` — dispatches `AuthActions.signIn({ username, password })`; `AuthEffects` calls `signIn` from `aws-amplify/auth`
  - `src/app/features/photographer/layout/photographer-layout.component.ts` — shell with sidebar nav: My Events, Dashboard, Profile, Sign out button
  - `src/app/features/photographer/profile/profile.component.ts` — Angular Material reactive form with fields: Display Name, Default Currency, Bank Name, Account Number, Account Holder, Payment Instructions
- NgRx:
  - `store/auth/auth.actions.ts` — `signIn`, `signInSuccess`, `signInFailure`, `signOut`, `signOutSuccess`, `loadSession`, `loadSessionSuccess`
  - `store/auth/auth.effects.ts` — wraps `signIn`, `signOut`, `fetchAuthSession` from `aws-amplify/auth`
  - `store/auth/auth.reducer.ts` — state shape: `{ user: AuthUser | null, loading: boolean, error: string | null }` (`AuthUser` from `aws-amplify/auth`)
  - `store/auth/auth.selectors.ts`
  - `store/photographer/photographer.actions.ts` — `loadProfile`, `loadProfileSuccess`, `loadProfileFailure`, `updateProfile`, `updateProfileSuccess`, `updateProfileFailure`
  - `store/photographer/photographer.effects.ts` — calls API via `AppConfigService.apiBaseUrl`
  - `store/photographer/photographer.reducer.ts`
  - `store/photographer/photographer.selectors.ts`
- Amplify initialisation follows ADR-0007: configure once in `app.config.ts` using values from `config.json` (fetched at app startup via `AppConfigService`); import only from `aws-amplify/auth`; components never call Amplify directly
- `.env.example`: add `RACEPHOTOS_PHOTOGRAPHERS_TABLE=racephotos-photographers`
- `environments.example.ts`: no new keys required

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

### UI stories only

- [ ] Angular component compiles with `ng build --aot` (zero errors, zero warnings)
- [ ] Angular unit tests pass (`ng test --watch=false --code-coverage`)
  - Component logic: >80% line coverage
- [ ] Storybook story written for every new component (`*.stories.ts`)
- [ ] `npx storybook build` passes (no broken renders)
- [ ] Playwright E2E test written covering all acceptance criteria
- [ ] Playwright test passes against local dev server (`npx playwright test`)
- [ ] Playwright screenshot snapshot committed (visual baseline)
- [ ] Responsive layout verified at 375px (mobile) and 1280px (desktop) via Playwright
