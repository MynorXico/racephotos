# Development Plan — RaceShots

This document tracks what must be in place before product code is written,
the ordered PR sequence to get there, and all open decisions pending resolution.

Update this file as PRs are merged and decisions are made.

---

## Current state (last updated: 2026-03-28)

### Done

| Item                                                                                                             | PR    |
| ---------------------------------------------------------------------------------------------------------------- | ----- |
| Angular 19 scaffold (SCSS, routing, no SSR)                                                                      | #1    |
| Playwright E2E (Chromium + Mobile Chrome, visual snapshots)                                                      | #1    |
| Playwright MCP server (`claude mcp add playwright`)                                                              | #1    |
| golangci-lint v1.62.2 + `.golangci.yml`                                                                          | #2    |
| Makefile (`test-unit`, `lint`, `cdk-check`, `ng-build`, `ng-test`, `storybook-build`, `e2e`, `validate`)         | #1 #2 |
| Storybook 8 (Angular builder, `compodoc: false`)                                                                 | #2    |
| GitHub Actions CI (backend, infrastructure, frontend, storybook jobs)                                            | #2    |
| Claude Code skill commands: `/write-story`, `/write-adr`, `/build-feature`, `/validate-feature`, `/ship-feature` | #1 #2 |
| Story template with backend + UI DoD checklists                                                                  | #1    |
| ADR-0001: Photographer approval via SES email + in-app dashboard                                                 | #2    |
| ADR-0003: Multi-bib photos → independent purchases per runner                                                    | #2    |
| ADR-0005: NgRx for Angular state management                                                                      | #2    |
| ADR-0002: Runner self-serve re-download via email verification                                                   | #3    |
| ADR-0004: Events publicly listed on homepage (visibility field for v2)                                           | #3    |
| ADR-0006: Angular Material (M3) as design system                                                                 | #3    |
| ADR-0007: AWS Amplify v6 auth-only for Cognito integration                                                       | #3    |
| Root `package.json` with Husky + lint-staged + Commitlint                                                        | #3    |
| `commitlint.config.js` (conventional commits, project scope-enum)                                                | #3    |
| `.prettierrc` + `.prettierignore`                                                                                | #3    |
| `@angular-eslint` + `eslint.config.js` (accessibility, NgRx HTTP restriction)                                    | #3    |
| `.github/dependabot.yml` (npm weekly, gomod monthly)                                                             | #3    |
| `.github/CODEOWNERS`                                                                                             | #3    |
| `CONTRIBUTING.md`                                                                                                | #3    |
| Husky pre-commit (lint-staged) + commit-msg (commitlint) hooks                                                   | #3    |
| CI frontend job: `make ng-lint` step added                                                                       | #3    |
| Makefile: `ng-lint`, `format` targets; `validate` includes `ng-lint`                                             | #3    |

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

### PR 4 — Code quality standards: Husky, Prettier, ESLint, Commitlint, Dependabot ✅ Ready to merge

**Deliverables:**

- Root-level `package.json` with Husky + lint-staged + Commitlint ✅
- `commitlint.config.js` (conventional commits: `feat:`, `fix:`, `chore:`, etc.) ✅
- `.prettierrc` + `.prettierignore` ✅
- `@angular-eslint` installed and configured (`eslint.config.js` for Angular) ✅
- `.github/dependabot.yml` (npm weekly for both `frontend/angular` and `infra/cdk`; Go modules monthly) ✅
- `.github/CODEOWNERS` ✅
- `CONTRIBUTING.md` (contributor guide: clone → fill environments.ts → docker-compose → make seed-local → make validate) ✅
- Husky pre-commit hook: lint-staged runs ESLint + Prettier on staged files ✅
- Husky commit-msg hook: commitlint validates message format ✅
- CI workflow updated to run `npm run lint` on the frontend job ✅

**Why before code:** every agent-generated commit and every contributor PR must
pass these checks. Retrofitting formatting and lint rules to 10+ files is painful.

---

### PR 5 — Frontend infrastructure: NgRx + runtime config + Amplify ✅ Ready to merge

**Design decision: environment-agnostic build**
One compiled Angular artifact is deployed to every environment (dev, qa, staging, prod).
No `environment.ts` file-replacement at build time. Instead, the deploy pipeline writes
`config.json` to S3 per environment; Angular loads it at startup via `APP_INITIALIZER`.
See `docs/setup/runtime-config.md`.

**Deliverables:**

- NgRx installed: `@ngrx/store`, `@ngrx/effects`, `@ngrx/entity`, `@ngrx/router-store`, `@ngrx/store-devtools` ✅
- `aws-amplify` installed ✅
- `src/app/core/config/app-config.model.ts` — `AppConfig` interface ✅
- `src/app/core/config/app-config.service.ts` — fetches `/assets/config.json` at startup ✅
- `src/assets/config.json` — committed placeholder (overwritten per env at deploy time) ✅
- `app.config.ts` — `APP_INITIALIZER` loads config + configures Amplify; NgRx root store wired ✅
- Feature store folder structure: `src/app/store/{auth,events,photos,purchases}/` ✅
  - Auth: full actions / state / reducer / selectors / effects (Amplify `getCurrentUser`, `signOut`)
  - Events / Photos / Purchases: typed action stubs (filled in by feature stories)
- `docs/setup/runtime-config.md` — documents the pattern and deploy injection steps ✅

---

### PR 6 — Local development baseline: docker-compose, seed script, .env.example ✅ Ready to merge

**Deliverables:**

- `docker-compose.yml` (LocalStack 3, health check, PERSISTENCE=1, port 4566) ✅
- `.env.example` (all `RACEPHOTOS_*` vars + AWS LocalStack vars with placeholder values) ✅
- `scripts/seed-local.sh` (creates S3 buckets, DynamoDB, SQS + DLQ, Cognito pool + client, SES identity; idempotent; prints frontend config values) ✅
- `docs/setup/local-dev.md` — full working guide: first-time setup → daily workflow → re-seeding → Rekognition mock ✅
- `frontend/angular/proxy.conf.json` — dev-server proxy `/api/*` → `http://localhost:3000` ✅
- `frontend/angular/angular.json` — proxy wired to serve config; `src/assets` added to build and test asset paths ✅

**Why before code:** no Lambda can be tested locally without this. The first
`make test-integration` call will fail without a running LocalStack and seeded resources.

---

### PR 7 — Frontend deployment: FrontendConstruct CDK via CodePipeline ✅ Ready to merge

**Deployment strategy: CodePipeline owns everything — no separate GitHub Actions deploy job.**

The existing CDK Pipelines setup (`PipelineStack`) is extended to build and deploy
the Angular frontend as part of each stage deployment. One pipeline run produces
one Angular artifact and deploys it to the correct environment with an
environment-specific `config.json` injected at deploy time.

**How it works:**

1. The `Synth` ShellStep is extended to build Angular before `cdk synth`:

   ```
   nvm install 20 && nvm use 20
   cd frontend/angular && npm ci && npx ng build --configuration=production
   ./scripts/generate-cdk-context.sh
   cd infra/cdk && npm ci && npm run build && npx cdk synth
   ```

   The `dist/` output is bundled as a CDK asset alongside the CloudFormation template.

2. `FrontendConstruct` creates an S3 bucket + CloudFront distribution and uses
   `BucketDeployment` with two sources:
   - `Source.asset(...)` — the Angular `dist/browser/` directory
   - `Source.jsonData('assets/config.json', { ... })` — the environment-specific
     `config.json`, generated at deploy time from construct outputs and SSM values.
     This overwrites the placeholder `config.json` that ships with the Angular build.
     CloudFront is invalidated automatically after every deploy.

3. `config.json` values come from:
   - `EnvConfig.region` — already in `EnvConfig`
   - `EnvConfig.apiBaseUrl` — new field added to `EnvConfig` (API Gateway URL per env)
   - Cognito user pool ID + client ID — passed in from `CognitoConstruct` outputs
     (not built yet; `FrontendConstruct` accepts them as optional, defaults to
     placeholder strings until RS-007 wires them in)
   - Custom domain / OAuth domain — derived from the domain SSM parameter

**All infrastructure coordinates in SSM — nothing in `environments.example.ts`:**

Two new SSM parameters per environment (seeded by `seed-ssm.sh`):

```
/racephotos/env/{envName}/domain-name      → "app.dev.example.com" or "none"
/racephotos/env/{envName}/certificate-arn  → "arn:aws:acm:us-east-1:..." or "none"
```

Storing `"none"` when no custom domain is needed (dev/qa can use the CloudFront
default `*.cloudfront.net` domain). `seed-ssm.sh` prompts for both per environment,
defaulting to `"none"` if left blank. `FrontendConstruct` reads them via
`valueFromLookup` and only wires in the custom domain + ACM cert when value ≠ `"none"`.

Note: ACM certificates for CloudFront must be created in `us-east-1` regardless
of the application region. See `docs/setup/aws-bootstrap.md`.

**`cdk.context.json` is never committed:**
`valueFromLookup` needs cached SSM values to avoid dummy-value failures at synth time,
but committing `cdk.context.json` would put account IDs in git. Instead,
`scripts/generate-cdk-context.sh` fetches all `/racephotos/*` SSM parameters via
`get-parameters-by-path` and writes the file dynamically before each `cdk synth`.
The pipeline ShellStep calls it automatically; contributors run it locally before
their first `cdk synth`.

**Deliverables:**

- `infra/cdk/constructs/frontend-construct.ts` — S3 + CloudFront + BucketDeployment
  with `Source.jsonData` config injection; optional custom domain + ACM cert ✅
- `infra/cdk/stages/racephotos-stage.ts` — wires in `FrontendConstruct` ✅
- `infra/cdk/stacks/pipeline-stack.ts` — Synth ShellStep calls context script +
  builds Angular first; `ssm:GetParametersByPath` added to CodeBuild IAM policy ✅
- `infra/cdk/config/types.ts` — `EnvConfig` gains `domainName` and `certificateArn` ✅
- `scripts/seed-ssm.sh` — prompts for profile explicitly; prompts for `domain-name`
  and `certificate-arn` per env ✅
- `scripts/generate-cdk-context.sh` — generates `cdk.context.json` from SSM at
  synth time; no account IDs committed to git ✅
- `docs/setup/aws-bootstrap.md` — documents ACM `us-east-1` requirement, new SSM
  parameters, and `generate-cdk-context.sh` usage ✅
- `CONTRIBUTING.md` — documents `generate-cdk-context.sh` for local CDK dev ✅

**Why before code:** frontend features cannot be demoed or user-tested without a
deployed URL. Wiring this early means every merged feature story is immediately live
in the target environment after the pipeline run completes.

---

### PR 8 — Observability standards: CloudWatch alarms + X-Ray base constructs ✅ Ready to merge

**Deliverables:**

- `infra/cdk/constructs/observability-construct.ts`: reusable L3 construct that
  wraps a Lambda function with: X-Ray tracing, CloudWatch error alarm, log group
  with retention, and (for SQS Lambdas) DLQ depth alarm ✅
- All future Lambda constructs must accept and use this construct ✅
- `docs/adr/0008-observability-strategy.md` (CloudWatch only vs. third-party like Datadog/Sentry) ✅

**Why before code:** CLAUDE.md mandates X-Ray on every Lambda and DLQ alarms on
every SQS consumer. Defining the reusable construct now means agents can wire it
in one line instead of duplicating alarm configuration across 5 Lambdas.

---

### PR 9 — Complete v1 story backlog

**Deliverables (14 story files in `docs/stories/`):**

| Story  | Title                                                    | Has UI |
| ------ | -------------------------------------------------------- | ------ |
| RS-001 | CDK storage constructs (S3×2, DynamoDB×5, SQS×2+DLQs) ✅ | no     |
| RS-002 | CDK Cognito + API Gateway ✅                             | no     |
| RS-003 | CDK SES construct + 4 email templates ✅                 | no     |
| RS-004 | Photographer account — auth shell + profile setup ✅     | yes    |
| RS-005 | Event management — create, view, edit, archive, share ✅ | yes    |
| RS-006 | Bulk photo upload — batch presign + upload UI ✅         | yes    |
| RS-007 | Photo processing pipeline — Rekognition + watermark ✅   | no     |
| RS-008 | Photographer views event photos gallery ✅               | yes    |
| RS-009 | Runner searches for photos by bib number ✅              | yes    |
| RS-010 | Runner purchases a photo ✅                              | yes    |
| RS-011 | Photographer approves or rejects a purchase ✅           | yes    |
| RS-012 | Runner downloads a photo via download token ✅           | yes    |
| RS-013 | Photographer manually tags bib numbers ✅                | yes    |
| RS-014 | Public events listing homepage ✅                        | yes    |

Each story references the relevant ADRs, lists all acceptance criteria,
specifies interfaces and env vars, and has a fully filled-in Definition of Done.

**Why before code:** agents receive one story file as their entire context.
An incomplete story produces incomplete code. Writing all stories upfront also
surfaces cross-story dependencies and inconsistencies before they become bugs.

#### Open decisions blocking PR 9 (answer before writing stories)

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Impact                                                                                                     | Status      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------- |
| P1  | **Processing chain**: photo-processor publishes to a second SQS queue → watermark Lambda consumes it (Option A). Two independent queues, each with its own DLQ + alarm. Keeps the SQS pattern reusable for future watermark variants.                                                                                                                                                                                                                                                                                                                                                                       | Determines whether there are 1 or 2 SQS queues; affects RS-001 CDK construct and RS-003/RS-004 story split | ✅ resolved |
| P2  | **Batch presigned URLs**: `POST /events/{eventId}/photos/presign` accepts up to 100 `{filename, contentType, size}` entries and returns 100 `{photoId, presignedUrl}` pairs. Angular chunks the file list into batches of 100 and uploads each batch with max 5 concurrent S3 PUTs. Presigned URL generation is pure local crypto — no S3 API call — so 100 URLs cost the same Lambda time as 1.                                                                                                                                                                                                            | Changes the upload Lambda API contract and the frontend upload story significantly                         | ✅ resolved |
| P3  | **Lambda granularity**: one Lambda per HTTP method across the entire system (not one Lambda per resource). `POST /events`, `GET /events`, `GET /events/{id}`, `PUT /events/{id}` are four separate Lambda modules. IAM least privilege (each Lambda only gets the permissions it needs), independent scaling, and independent deployment. Shared types, clients, and errors live in `shared/`. Each Lambda `main.go` is thin wiring only.                                                                                                                                                                   | Determines whether a new Lambda module and story are needed                                                | ✅ resolved |
| P4  | **Public events homepage**: yes — public listing page, sorted by `createdAt` DESC, paginated. Photographers can archive events; archived events are excluded from the listing but remain accessible via direct link. Events also shareable via direct link and QR code (QR code generated client-side in Angular — no Lambda needed). Event model gains `archivedAt` field. DynamoDB needs a GSI with a fixed partition key (e.g. `status="active"`) and `createdAt` as sort key for efficient sorted listing.                                                                                              | Adds frontend listing story, `GET /events` Lambda, and `archive-event` Lambda                              | ✅ resolved |
| P5  | **Currency + photographer profile**: currency is per-event but defaults to the photographer account preference. Photographer profile stored in DynamoDB (not Cognito attributes — more extensible). Profile fields: `defaultCurrency`, `bankName`, `bankAccountNumber`, `bankAccountHolder`, `bankInstructions` (free text shown to runners). Bank details also live on the profile — reused across all events. Purchase flow reads photographer profile to display bank details to runner. Adds `GET /photographer/me` and `PUT /photographer/me` Lambdas. Event creation pre-fills currency from profile. | Adds Photographer DynamoDB entity, 2 new Lambdas, affects purchase flow                                    | ✅ resolved |
| P6  | **Photographer dashboard split**: one dashboard page, two separate tabs — (1) Purchase approvals: review and approve/reject pending payment claims. (2) Review queue: photos with `status=review_required` awaiting manual bib tagging. Separate frontend stories per tab (different backend dependencies, buildable independently).                                                                                                                                                                                                                                                                        | Affects story count and scope of RS-010 equivalent                                                         | ✅ resolved |
| P7  | **Watermark — text-only in v1**: no logo upload. Watermark text = `{event.watermarkText}` (set by photographer at event creation, defaults to `{event.name} · racephotos.example.com`). No S3 asset storage or file-upload flow needed for watermark. Logo upload is v2.                                                                                                                                                                                                                                                                                                                                    | Watermark Lambda only handles text overlay; no logo S3 bucket needed                                       | ✅ resolved |
| P8  | **Download Lambdas**: `GET /download/{token}` and `POST /purchases/redownload-resend` are two separate Lambda modules under `lambdas/` (following P3 — one Lambda per HTTP method). Grouped conceptually as "download" domain, separate from payment/purchase Lambdas.                                                                                                                                                                                                                                                                                                                                      | Adds 2 Lambda modules and 2 stories                                                                        | ✅ resolved |
| P9  | **SES CDK construct**: dedicated `SesConstruct` CDK story — verified sender identity, IAM grants for all Lambdas that send email (payment approval, runner notification, redownload resend), and SES email templates (4 templates per ADR-0001 + ADR-0002). Folding into Lambda stories would scatter infrastructure concerns across multiple PRs.                                                                                                                                                                                                                                                          | Adds 1 CDK construct story before payment/download Lambda stories                                          | ✅ resolved |
| P10 | **Manual bib tagging v1 scope**: in scope for v1 — the review queue tab (P6) requires it. Backend: `PUT /photos/{id}/bibs` Lambda (photographer-authenticated, overwrites bib numbers, treated as ground truth per domain rule 12). Frontend: review queue tab in dashboard with photo grid and manual bib input per photo.                                                                                                                                                                                                                                                                                 | Adds backend Lambda and frontend tab story                                                                 | ✅ resolved |

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

| #   | Question                                                                                           | Blocks                | Status              |
| --- | -------------------------------------------------------------------------------------------------- | --------------------- | ------------------- |
| A   | **Runner re-download**: self-serve email verification against purchase record                      | PR 9 (RS-006, RS-009) | ✅ ADR-0002 written |
| B   | **Event visibility**: publicly listed on homepage (add `visibility` field for v2 unlisted support) | PR 9 (RS-007, RS-008) | ✅ ADR-0004 written |
| C   | **Design system**: Angular Material (M3 theming, CDK, tree-shaken imports)                         | PR 3, PR 5, PR 9      | ✅ ADR-0006 written |
| D   | **Cognito auth SDK**: AWS Amplify v6 (`aws-amplify/auth` only, wrapped in NgRx effects)            | PR 5, PR 9 (RS-007)   | ✅ ADR-0007 written |

---

## Build order (after all 10 PRs are merged)

Run `/ship-feature <story-file>` for each, in order. Each story depends on all stories before it.

```
 1.  RS-001  CDK storage constructs (S3×2, DynamoDB×5, SQS×2+DLQs)
 2.  RS-002  CDK Cognito + API Gateway
 3.  RS-003  CDK SES construct + email templates
 4.  RS-004  Photographer account (auth shell + profile)
 5.  RS-005  Event management (create, view, edit, archive, share)
 6.  RS-006  Bulk photo upload (batch presign + upload UI)
 7.  RS-007  Photo processing pipeline (Rekognition + watermark, no UI)
 8.  RS-008  Photographer event photos gallery
 9.  RS-009  Runner photo search
10.  RS-010  Runner purchases a photo
11.  RS-011  Photographer approves a purchase
12.  RS-012  Runner downloads a photo
13.  RS-013  Photographer tags undetected bibs
14.  RS-014  Public events listing homepage
```

---

## Conventions quick reference

| Thing           | Convention                                                     |
| --------------- | -------------------------------------------------------------- |
| Commit format   | Conventional commits: `feat(scope): description`               |
| Branch naming   | `feature/RS-NNN-kebab-title`                                   |
| PR title        | `[RS-NNN] Story title`                                         |
| ADR numbering   | Four-digit sequence: `0001`, `0002`, …                         |
| Story numbering | `RS-NNN`                                                       |
| Env vars        | `RACEPHOTOS_` prefix, documented in Lambda `main.go`           |
| Go errors       | `fmt.Errorf("operation: %w", err)`                             |
| Angular state   | NgRx — no direct HTTP in components, always dispatch an action |
| Styling         | Angular Material M3 — see ADR-0006                             |
