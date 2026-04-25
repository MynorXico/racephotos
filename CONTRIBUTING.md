# Contributing to RaceShots

Thank you for your interest in contributing. This guide covers everything you need to get started.

---

## Prerequisites

| Tool          | Version | Install                                    |
| ------------- | ------- | ------------------------------------------ |
| Go            | 1.22+   | https://go.dev/dl/                         |
| Node.js       | 20.x    | https://nodejs.org/                        |
| Docker        | 24+     | https://docs.docker.com/get-docker/        |
| AWS CDK       | 2.x     | `npm install -g aws-cdk`                   |
| golangci-lint | 1.62+   | See [tooling guide](docs/setup/tooling.md) |

---

## First-time setup

```bash
# 1. Clone the repo
git clone https://github.com/<your-fork>/racephotos.git
cd racephotos

# 2. Fill in local environment variables
cp .env.example .env.local
# Edit .env.local if you need overrides (defaults work for LocalStack)

# 3. Install root dev tooling (husky, commitlint, prettier, lint-staged)
npm install

# 4. Install CDK dependencies
cd infra/cdk && npm ci && cd ../..

# 5. Install Angular dependencies
cd frontend/angular && npm ci && cd ../..

# 6. Start LocalStack
docker-compose up -d

# 7. Seed LocalStack with resources matching CDK definitions
make seed-local
```

### Working with CDK locally

`cdk.context.json` is gitignored — it contains AWS account IDs and must not be
committed. Before running `cdk synth` locally, generate it from your SSM parameters:

```bash
# Requires tools-account credentials and all /racephotos/* SSM params to exist.
# Run scripts/seed-ssm.sh first if you haven't already.
AWS_PROFILE=tools ./scripts/generate-cdk-context.sh

cd infra/cdk
npx cdk synth --profile tools
```

The pipeline runs `generate-cdk-context.sh` automatically on every synth — no manual
step needed in CI. See [aws-bootstrap.md](docs/setup/aws-bootstrap.md) for full
one-time AWS setup instructions.

---

## Development workflow

### Running the validation suite

```bash
make validate        # full suite: tests, lint, cdk-check, ng-build, ng-lint, ng-test, storybook
make test-unit       # Go unit tests only (no AWS, no LocalStack)
make test-integration # Go integration tests (requires LocalStack)
make lint            # Go linting (golangci-lint)
make cdk-check       # CDK TypeScript type-check + jest (CI-safe, no AWS credentials)
make ng-build        # Angular production build
make ng-lint         # Angular ESLint
make ng-test         # Angular Karma unit tests
make storybook-build # Storybook component build
make e2e             # Playwright E2E (requires `ng serve` running)
```

### Code formatting

```bash
make format          # Prettier on all TS/HTML/SCSS/JSON/YAML/MD
cd frontend/angular && npm run format   # Angular files only
```

---

## Commit conventions

This project enforces [Conventional Commits](https://www.conventionalcommits.org/).
The `commit-msg` hook validates your message automatically.

**Format:** `<type>(<scope>): <description>`

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `build`, `perf`

**Scopes:** `photo-upload`, `photo-processor`, `watermark`, `search`, `payment`, `shared`,
`cdk`, `ci`, `frontend`, `angular`, `ngrx`, `auth`, `adr`, `docs`, `stories`, `deps`, `config`, `release`

**Examples:**

```
feat(photo-upload): add presigned URL expiry configuration
fix(search): return 404 when bib number has no results
docs(adr): add ADR-0008 for payment flow
chore(deps): bump @angular/core to 19.2.1
```

---

## Pull request guidelines

- Keep PRs focused on a single concern
- All CI checks must pass before merge
- Reference the user story in the PR description (e.g., `Implements RS-001`)
- Do not include AWS account IDs, real domain names, or PII in committed files
- Update `environments.example.ts` and `.env.example` if you add a new config key
- Update `scripts/seed-local.sh` if you add a new AWS resource in CDK
- Add every new Lambda to the SAM local invoke structure — see [local-lambda-debugging.md](docs/setup/local-lambda-debugging.md): event files in `testdata/events/`, an entry in `template.yaml`, and a `make invoke-<name>` target in the root `Makefile`

---

## Project structure

See [CLAUDE.md](CLAUDE.md) for the full repository layout and all architectural conventions.

---

## Open-source rules (non-negotiable)

1. No AWS account IDs in committed files
2. No real domain names — use `example.com` as placeholder
3. No personal or company-specific names — "RaceShots" only
4. `environments.example.ts` and `.env.example` must stay in sync with actual config shape
5. All manual setup steps must be documented in `docs/setup/`
6. `scripts/seed-local.sh` must mirror CDK resource definitions
7. Every Lambda must be runnable locally via `make invoke-<name>` — add it to the SAM structure described in [docs/setup/local-lambda-debugging.md](docs/setup/local-lambda-debugging.md)

---

## Reporting bugs

Open a GitHub Issue using the **Bug report** template. Fill in:

- Steps to reproduce
- Expected vs actual behaviour
- Environment (OS, Go version, Node version, browser if UI)
- Which area of the system is affected (upload, search, payment, etc.)

A maintainer will triage the issue within 24 hours, assign a severity (P1–P3),
and create an internal bug doc at `docs/bugs/BUG-NNN-<slug>.md`.

### Want to fix it yourself?

1. Comment on the issue — a maintainer will assign it to you
2. Fork the repo and create a fix branch from `main`:
   ```bash
   git checkout -b fix/BUG-NNN-<slug>
   ```
3. Write a **failing automated test** (unit or integration) that reproduces the bug first, then fix the implementation
4. Run the full validation suite:
   ```bash
   make validate
   ```
5. Open a PR that references the issue (`Fixes #<number>`) and the bug doc
6. All CI checks must pass before review

See [docs/development-workflow.md](docs/development-workflow.md) for the complete
bug flow, severity levels, and pipeline monitoring steps.
