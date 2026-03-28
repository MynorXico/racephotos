# Development Plan — RaceShots

This document tracks what must be in place before product code is written,
the ordered PR sequence to get there, and all open decisions pending resolution.

Update this file as PRs are merged and decisions are made.

---

## Current state (last updated: 2026-03-28)

### Done
| Item | PR |
|---|---|
| Angular 19 scaffold (SCSS, routing, no SSR) | #1 |
| Playwright E2E (Chromium + Mobile Chrome, visual snapshots) | #1 |
| Playwright MCP server (`claude mcp add playwright`) | #1 |
| golangci-lint v1.62.2 + `.golangci.yml` | #2 |
| Makefile (`test-unit`, `lint`, `cdk-check`, `ng-build`, `ng-test`, `storybook-build`, `e2e`, `validate`) | #1 #2 |
| Storybook 8 (Angular builder, `compodoc: false`) | #2 |
| GitHub Actions CI (backend, infrastructure, frontend, storybook jobs) | #2 |
| Claude Code skill commands: `/write-story`, `/write-adr`, `/build-feature`, `/validate-feature`, `/ship-feature` | #1 #2 |
| Story template with backend + UI DoD checklists | #1 |
| ADR-0001: Photographer approval via SES email + in-app dashboard | #2 |
| ADR-0003: Multi-bib photos → independent purchases per runner | #2 |
| ADR-0005: NgRx for Angular state management | #2 |
| ADR-0002: Runner self-serve re-download via email verification | #3 |
| ADR-0004: Events publicly listed on homepage (visibility field for v2) | #3 |
| ADR-0006: Angular Material (M3) as design system | #3 |
| ADR-0007: AWS Amplify v6 auth-only for Cognito integration | #3 |

### Not started
See the PR sequence below.

---

## PR sequence before first product code

Each PR below must be merged in order before `/ship-feature` is invoked for any
product story. Do not start development until all 8 are merged.

---

### PR 3 — Product decisions: ADRs 0002, 0004, 0006, 0007 ✅ Ready to merge

**Deliverables:**
- `docs/adr/0002-runner-self-serve-redownload.md` ✅
- `docs/adr/0004-public-event-listing.md` ✅
- `docs/adr/0006-angular-material-design-system.md` ✅
- `docs/adr/0007-aws-amplify-cognito-auth.md` ✅

---

### PR 4 — Code quality standards: Husky, Prettier, ESLint, Commitlint, Dependabot

**Deliverables:**
- Root-level `package.json` with Husky + lint-staged + Commitlint
- `commitlint.config.js` (conventional commits: `feat:`, `fix:`, `chore:`, etc.)
- `.prettierrc` + `.prettierignore`
- `@angular-eslint` installed and configured (`eslint.config.js` for Angular)
- `.github/dependabot.yml` (npm weekly for both `frontend/angular` and `infra/cdk`; Go modules monthly)
- `.github/CODEOWNERS`
- `CONTRIBUTING.md` (contributor guide: clone → fill environments.ts → docker-compose → make seed-local → make validate)
- Husky pre-commit hook: lint-staged runs ESLint + Prettier on staged files
- Husky commit-msg hook: commitlint validates message format
- CI workflow updated to run `npm run lint` on the frontend job

**Why before code:** every agent-generated commit and every contributor PR must
pass these checks. Retrofitting formatting and lint rules to 10+ files is painful.

---

### PR 5 — Frontend infrastructure: NgRx + Angular environments + Cognito auth ADR

**Deliverables:**
- NgRx installed: `@ngrx/store`, `@ngrx/effects`, `@ngrx/entity`, `@ngrx/router-store`, `@ngrx/store-devtools`
- Root store wired in `app.config.ts`
- Feature store folder structure created: `src/app/store/{auth,events,photos,purchases}/`
- `src/environments/environment.ts` + `environment.prod.ts` (API base URL, Cognito pool ID, region)
- `docs/adr/0007-cognito-auth-sdk.md` (AWS Amplify vs. thin wrapper)
- Angular build configurations updated to swap environments per target

**Blocked on:** answer to Cognito auth SDK question — see section below.

---

### PR 6 — Local development baseline: docker-compose, seed script, .env.example

**Deliverables:**
- `docker-compose.yml` (LocalStack, with health check and port 4566)
- `.env.example` (all `RACEPHOTOS_*` vars with placeholder values)
- `scripts/seed-local.sh` (creates S3 buckets, DynamoDB table, SQS queue matching CDK definitions)
- `docs/setup/local-dev.md` updated with the actual working commands

**Why before code:** no Lambda can be tested locally without this. The first
`make test-integration` call will fail without a running LocalStack and seeded resources.

---

### PR 7 — Frontend deployment: FrontendConstruct CDK + deploy CI job

**Deliverables:**
- `infra/cdk/constructs/frontend-construct.ts` (S3 website bucket + CloudFront distribution)
- `infra/cdk/stages/racephotos-stage.ts` updated to include `FrontendConstruct`
- `environments.example.ts` updated with `domainName` and `certificateArn` placeholders
- `.github/workflows/deploy-frontend.yml` job: runs on merge to `main`, builds Angular, syncs to S3, invalidates CloudFront

**Why before code:** frontend features cannot be demoed or user-tested without a
deployed URL. Wiring this early means every merged frontend story is immediately live.

---

### PR 8 — Observability standards: CloudWatch alarms + X-Ray base constructs

**Deliverables:**
- `infra/cdk/constructs/observability-construct.ts`: reusable L3 construct that
  wraps a Lambda function with: X-Ray tracing, CloudWatch error alarm, log group
  with retention, and (for SQS Lambdas) DLQ depth alarm
- All future Lambda constructs must accept and use this construct
- `docs/adr/0008-observability-strategy.md` (CloudWatch only vs. third-party like Datadog/Sentry)

**Why before code:** CLAUDE.md mandates X-Ray on every Lambda and DLQ alarms on
every SQS consumer. Defining the reusable construct now means agents can wire it
in one line instead of duplicating alarm configuration across 5 Lambdas.

---

### PR 9 — Complete v1 story backlog

**Deliverables (10 story files in `docs/stories/`):**
- `RS-001-cdk-storage-constructs.md`
- `RS-002-photo-upload-lambda.md`
- `RS-003-photo-processor-lambda.md`
- `RS-004-watermark-lambda.md`
- `RS-005-search-lambda.md`
- `RS-006-payment-lambda.md`
- `RS-007-frontend-shell.md`
- `RS-008-frontend-search-page.md`
- `RS-009-frontend-purchase-flow.md`
- `RS-010-frontend-photographer-dashboard.md`

Each story must: reference the relevant ADRs, list all acceptance criteria,
specify interfaces and env vars, and have a fully filled-in Definition of Done.

**Why before code:** agents receive one story file as their entire context.
An incomplete story produces incomplete code. Writing all stories upfront also
surfaces cross-story dependencies and inconsistencies before they become bugs.

---

### PR 10 — Agent infrastructure: GitHub MCP, Lambda CLAUDE.md template, /new-adr skill

**Deliverables:**
- GitHub MCP configured (`claude mcp add github -s user -- npx -y @modelcontextprotocol/server-github`)
  and documented in `docs/setup/tooling.md`
- `lambdas/LAMBDA_CLAUDE_TEMPLATE.md` — service-level CLAUDE.md template that
  each Lambda copies and fills in (service name, env vars, interfaces, test patterns)
- `.claude/commands/new-adr.md` — skill that takes an open question, reasons
  through options given project constraints, and produces a full ADR with options
  and consequences (different from `/write-adr` which just formats a decision already made)
- `.claude/commands/review-story.md` — skill that reads a story and checks it
  against the template, ADR references, domain rules, and DoD before marking it ready

---

## Open decisions (must be resolved before the PR that depends on them)

| # | Question | Blocks | Status |
|---|---|---|---|
| A | **Runner re-download**: self-serve email verification against purchase record | PR 9 (RS-006, RS-009) | ✅ ADR-0002 written |
| B | **Event visibility**: publicly listed on homepage (add `visibility` field for v2 unlisted support) | PR 9 (RS-007, RS-008) | ✅ ADR-0004 written |
| C | **Design system**: Angular Material (M3 theming, CDK, tree-shaken imports) | PR 3, PR 5, PR 9 | ✅ ADR-0006 written |
| D | **Cognito auth SDK**: AWS Amplify v6 (`aws-amplify/auth` only, wrapped in NgRx effects) | PR 5, PR 9 (RS-007) | ✅ ADR-0007 written |

---

## Build order (after all 10 PRs are merged)

Run `/ship-feature <story-file>` for each, in order:

```
1.  RS-001  CDK storage constructs (S3 + DynamoDB)
2.  RS-002  Photo upload Lambda
3.  RS-003  Photo processor Lambda
4.  RS-004  Watermark Lambda
5.  RS-005  Search Lambda
6.  RS-006  Payment Lambda
7.  RS-007  Frontend shell (routing, auth)
8.  RS-008  Frontend search page
9.  RS-009  Frontend purchase flow
10. RS-010  Frontend photographer dashboard
```

---

## Conventions quick reference

| Thing | Convention |
|---|---|
| Commit format | Conventional commits: `feat(scope): description` |
| Branch naming | `feature/RS-NNN-kebab-title` |
| PR title | `[RS-NNN] Story title` |
| ADR numbering | Four-digit sequence: `0001`, `0002`, … |
| Story numbering | `RS-NNN` |
| Env vars | `RACEPHOTOS_` prefix, documented in Lambda `main.go` |
| Go errors | `fmt.Errorf("operation: %w", err)` |
| Angular state | NgRx — no direct HTTP in components, always dispatch an action |
| Styling | TBD — pending design system decision (open question C) |
