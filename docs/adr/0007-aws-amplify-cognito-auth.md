# ADR-0007: AWS Amplify for Cognito authentication in Angular

**Date**: 2026-03-28
**Status**: accepted

## Context

The Angular frontend needs to authenticate photographers via Amazon Cognito User
Pools. Runners are unauthenticated — they are identified only by email at purchase
time. Only the photographer-facing routes require auth.

The question: use the full `aws-amplify` library, or build a thin custom wrapper
directly against Cognito's REST/PKCE endpoints?

## Decision

Use **AWS Amplify v6** (`aws-amplify`) with the `Auth` category only.

Amplify is configured in `src/app/core/amplify.config.ts` and initialised once
at app startup in `app.config.ts`. Only the `Auth` module is imported — no
Storage, API, or other Amplify categories are used. All S3 and API calls go
through the app's own Lambda + API Gateway layer, not Amplify.

NgRx `AuthEffects` wraps Amplify calls (`signIn`, `signOut`, `fetchAuthSession`,
`getCurrentUser`) so components never call Amplify directly.

## Options considered

### Option A — AWS Amplify v6 Auth only (chosen)

Pros: handles PKCE flow, token refresh, hosted UI redirect, and session persistence
automatically; well-documented; Amplify v6 is tree-shakable so unused categories
don't bloat the bundle; Angular-friendly (promise-based API works cleanly with
NgRx effects).
Cons: Amplify is a large dependency even with tree-shaking; couples the app to an
AWS-specific library; upgrading Amplify major versions has historically been
breaking.

### Option B — Thin custom wrapper (direct Cognito REST/PKCE)

Pros: minimal bundle size; no third-party coupling; full control over the auth flow.
Cons: PKCE, token refresh, and session storage must be implemented manually; high
risk of security mistakes in the token handling logic; significant ongoing maintenance.

### Option C — Amazon Cognito Identity JS (lower-level than Amplify)

Pros: smaller than full Amplify.
Cons: deprecated in favour of Amplify v6; less community support going forward.

## Consequences

**Positive**:

- Token refresh is handled automatically — no manual interval or interceptor needed
- Hosted UI is available for free if a social login is added in v2
- `fetchAuthSession` returns JWT tokens that the Angular HTTP interceptor attaches
  to API Gateway requests as `Authorization: Bearer <token>`

**Negative / tradeoffs**:

- Amplify must be configured with the Cognito User Pool ID, App Client ID, and
  region — these come from `config.json` fetched at runtime (written by CDK deploy,
  never committed)
- Tree-shaking only works if Amplify categories are imported from their sub-paths
  (`aws-amplify/auth`) — never from the root `aws-amplify` barrel

**Install command** (runs as part of PR 5):

```bash
cd frontend/angular && npm install aws-amplify
```

**Agent instructions**:

- Import only from `aws-amplify/auth`, never from `aws-amplify` root
- All Amplify calls live in `AuthEffects` — components dispatch actions only
- The Angular HTTP interceptor (`AuthInterceptor`) calls `fetchAuthSession` and
  attaches the JWT to outbound requests — do not add auth headers manually elsewhere
- Amplify config is initialised in `app.config.ts` using values from `config.json` (fetched at startup)

**Runtime config delivery**: `UserPoolId`, `UserPoolClientId`, and the Cognito
region are written into `config.json` by `FrontendConstruct` during CDK deploy
(alongside `apiBaseUrl`). The Angular app fetches `config.json` at startup before
bootstrapping — values are never baked into the compiled bundle. This supports
one-click deploys to any environment without a post-build SSM injection step.

**Stories affected**: RS-007 (frontend shell — auth guard, login page, interceptor),
RS-010 (photographer dashboard — all routes behind auth guard)
