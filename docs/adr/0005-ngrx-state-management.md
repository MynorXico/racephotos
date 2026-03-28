# ADR-0005: NgRx for Angular state management
**Date**: 2026-03-28
**Status**: accepted

## Context

The RaceShots Angular frontend has several distinct state concerns that interact:
- Authentication state (Cognito session, photographer vs. unauthenticated runner)
- Event list and selected event
- Photo search results (per bib query)
- Purchase flow state (selected photo, payment reference, claim status)
- Photographer review queue

The question: which state management approach to use across the Angular application?

## Decision

Use **NgRx** with the following packages:

| Package | Purpose |
|---|---|
| `@ngrx/store` | Single immutable state tree |
| `@ngrx/effects` | Side effects (HTTP calls, Cognito, S3 signed URLs) |
| `@ngrx/entity` | Normalised collections (photos, events, purchases) |
| `@ngrx/router-store` | Sync Angular Router state into the store |
| `@ngrx/store-devtools` | Redux DevTools integration (dev only) |

**Feature store structure**:
```
store/
├── auth/           actions, reducer, effects, selectors
├── events/         actions, reducer, effects, selectors
├── photos/         actions, reducer, effects, selectors  (search results)
├── purchases/      actions, reducer, effects, selectors
└── index.ts        root state interface + meta-reducers
```

Each feature module is lazy-loaded with its store slice via `provideState()`.

## Options considered

### Option A — NgRx (chosen)
Pros: explicit, traceable data flow; time-travel debugging via DevTools; clear
separation of async side effects from UI; scales well as feature count grows;
well-supported in Angular 19 with standalone components.
Cons: significant boilerplate for simple state; steeper learning curve for new
contributors; adds ~50 kB to initial bundle (mitigated by lazy loading).

### Option B — Angular Signals + services
Pros: zero extra dependency; idiomatic in Angular 17+; minimal boilerplate;
smaller bundle.
Cons: no built-in side-effect management pattern; async flows (search → HTTP →
update grid) require discipline to avoid spaghetti; harder to test effects in
isolation; no DevTools equivalent.

### Option C — Akita / NGXS
Pros: less boilerplate than NgRx.
Cons: smaller communities; not part of the Angular ecosystem; adds a dependency
that contributors must learn separately.

## Consequences

**Positive**:
- All async operations (API calls, Cognito token refresh, signed URL fetches)
  go through Effects — easy to test with `provideMockActions`
- Store state is serialisable — easy to snapshot in Playwright tests
- DevTools give agents and developers full visibility into state transitions
  during UI validation

**Negative / tradeoffs**:
- Every new feature requires actions + reducer + effects + selectors boilerplate
  — agents must generate all four files, not just a component
- Bundle size increases ~50 kB; acceptable given photo-heavy content already
  dominates page weight
- `@ngrx/store-devtools` must be excluded from production builds

**Install command**:
```bash
cd frontend/angular && ng add @ngrx/store@latest && ng add @ngrx/effects@latest \
  && ng add @ngrx/entity@latest && ng add @ngrx/router-store@latest \
  && npm install --save-dev @ngrx/store-devtools
```

**Agent instructions**: when building a feature with UI, generate the NgRx
slice (actions, reducer, effects, selectors) before the component. The component
must not call HTTP directly — always dispatch an action.

**Stories affected**: RS-007 (frontend-shell), RS-008 through RS-010 (all frontend stories)
