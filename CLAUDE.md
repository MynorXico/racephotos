# CLAUDE.md — RaceShots

This file is read by Claude Code at the start of every session.
Follow every rule here unless a service-level CLAUDE.md explicitly overrides it.

This is an open-source project. All conventions here are designed so that any
contributor can fork this repo, configure their own AWS accounts, and deploy
without modifying application code.

---

## Project identity

- **Product name**: RaceShots
- **Go module path**: defined in each Lambda's `go.mod` — use relative `replace`
  directives for shared packages, never hardcoded remote paths
- **CDK app**: TypeScript, located at `infra/cdk/`
- **Frontend**: Angular, located at `frontend/angular/`
- **Primary runtime**: Go 1.22+ for all Lambda functions
- **AWS region**: configured via `RACEPHOTOS_REGION` env var — never hardcoded
- **LocalStack endpoint**: `http://localhost:4566` (when `RACEPHOTOS_ENV=local`)

---

## Configuration philosophy (critical for open-source)

**Zero hardcoded infrastructure values.** Every value that differs between
contributors or environments must come from one of:

1. **Environment variables** — for runtime Lambda config
2. **`infra/cdk/config/environments.ts`** — for CDK deploy-time config (gitignored)
3. **`.env.local`** (gitignored) — for local developer overrides

The repo must be cloneable and deployable by any contributor who fills in their
own `environments.ts` and `.env.local`. No AWS account IDs, region names, bucket
names, table names, domain names, or API keys may appear in any committed file.

Claude Code must never introduce a hardcoded infrastructure value. If a value is
environment-specific, put it in the correct config layer and document it.

---

## Repository layout (never deviate from this)

```
race-photos/
├── CLAUDE.md                        ← you are here
├── PRODUCT_CONTEXT.md
├── CONTRIBUTING.md
├── .env.example                     ← committed placeholder — contributors copy to .env.local
├── .gitignore                       ← must include: .env.local, environments.ts, *.tfvars
├── Makefile                         ← test, build, seed-local, lint
├── docker-compose.yml               ← LocalStack
├── docs/
│   ├── adr/                         ← Architecture Decision Records
│   ├── stories/                     ← User stories (PO output)
│   └── setup/
│       ├── local-dev.md             ← LocalStack setup guide for new contributors
│       └── aws-bootstrap.md         ← CDK bootstrap + cross-account trust instructions
├── infra/
│   └── cdk/
│       ├── bin/app.ts
│       ├── stacks/
│       ├── constructs/
│       ├── stages/
│       └── config/
│           ├── environments.example.ts  ← committed template
│           └── environments.ts          ← gitignored — contributor fills this in
├── lambdas/
│   ├── photo-upload/                ← presigned URL generator
│   │   ├── CLAUDE.md               ← service-level overrides
│   │   ├── main.go
│   │   ├── go.mod
│   │   └── go.sum
│   ├── photo-processor/             ← Rekognition + index to DynamoDB
│   ├── watermark/                   ← apply watermark to processed photos
│   ├── search/                      ← bib number search
│   └── payment/                     ← unlock + signed download URL
├── shared/                          ← shared Go packages (local module)
│   ├── go.mod
│   ├── models/
│   ├── apperrors/
│   └── awsclients/
├── frontend/
│   └── angular/
├── scripts/
│   ├── seed-local.sh                ← creates LocalStack resources matching CDK definitions
│   └── test-integration.sh
└── .github/
    └── workflows/
        └── ci.yml
```

---

## Go conventions

### Module and package structure

- Each Lambda is a self-contained Go module with its own `go.mod`
- Shared packages live in `shared/` as a local module
- Each Lambda references shared via a `replace` directive — no remote import path needed:
  ```
  replace github.com/racephotos/shared => ../../shared
  ```
- The module path prefix `github.com/racephotos/` is a placeholder. Forks may
  rename it — it has no runtime effect
- Package names: short, lowercase, no underscores — `processor`, `watermark`, `search`
- `main.go` per Lambda contains only handler wiring and config loading — no business logic

### Error handling

- All errors wrapped with context: `fmt.Errorf("processBib: %w", err)`
- Sentinel errors in `shared/apperrors/`: e.g. `ErrBibNotFound`, `ErrPhotoLocked`
- Lambda handlers return structured error responses — never raw Go error strings
- Log the full error with request context before returning to the caller

### Naming

- Exported: `PascalCase` — `ProcessPhoto`, `GeneratePresignedURL`
- Unexported: `camelCase` — `extractBibNumber`, `buildS3Key`
- Environment variable names: `RACEPHOTOS_` prefix for all project-specific vars
  (e.g. `RACEPHOTOS_ENV`, `RACEPHOTOS_RAW_BUCKET`, `RACEPHOTOS_TABLE_NAME`)
- DynamoDB attribute names: `PascalCase` matching the model struct field name

### Interfaces for all external dependencies

Every AWS SDK call must sit behind an interface. Never call SDK constructors
directly in business logic — always inject via interface.

```go
// correct pattern
type TextDetector interface {
    DetectText(ctx context.Context, input *rekognition.DetectTextInput,
        optFns ...func(*rekognition.Options)) (*rekognition.DetectTextOutput, error)
}

type PhotoStore interface {
    PutPhoto(ctx context.Context, photo models.Photo) error
    GetPhotosByBib(ctx context.Context, eventID, bibNumber string) ([]models.Photo, error)
}

type Processor struct {
    detector TextDetector
    store    PhotoStore
}
```

### Context propagation

- Every function doing I/O accepts `ctx context.Context` as its first parameter
- Pass the Lambda request context all the way down
- Never use `context.Background()` inside a handler or anything it calls

---

## Testing conventions

### Order of operations (non-negotiable)

1. Write the interface
2. Write table-driven tests using mocks
3. Write the implementation
4. Run tests — all must pass before moving on

### Libraries

- Assertions: `github.com/stretchr/testify` (`assert` and `require`)
- Mocking: `github.com/golang/mock/gomock` — generate mocks from interfaces
- No additional test libraries without an ADR

### Test file layout

- Unit tests: `foo_test.go` alongside `foo.go`
- Integration tests: `lambdas/<name>/test/integration/integration_test.go`
- Integration tests require build tag: `//go:build integration`

### Coverage expectations

- Business logic packages: >80% line coverage
- `main.go` handler: covered by integration tests only
- Generated mocks: excluded from coverage

### Running tests

```bash
make test-unit          # unit tests — no AWS, no LocalStack
make test-integration   # integration tests — requires LocalStack running
make test               # both
```

### Rekognition in local and test environments

Rekognition is not available in LocalStack. All code uses the `TextDetector`
interface. When `RACEPHOTOS_ENV=local`, the Lambda init wires in a file-backed
mock that reads from `testdata/rekognition-responses/`. This lets the full
async pipeline run locally without real Rekognition calls.

---

## CDK conventions

### Language

TypeScript, strict mode. No `any`. All constructs fully typed.

### One Stage class, multiple instantiations

Never duplicate stacks per environment. `RacePhotosStage` accepts `EnvConfig`.
All environment-specific values live in `environments.ts` (gitignored).

```typescript
// environments.example.ts — committed; contributors copy to environments.ts
export const environments: Record<string, EnvConfig> = {
  dev: {
    envName: 'dev',
    account: 'REPLACE_WITH_DEV_ACCOUNT_ID',
    region: 'REPLACE_WITH_REGION',
    rekognitionConfidenceThreshold: 0.7,
    watermarkStyle: 'text_overlay',
    photoRetentionDays: 90,
    enableDeletionProtection: false,
  },
  prod: {
    envName: 'prod',
    account: 'REPLACE_WITH_PROD_ACCOUNT_ID',
    region: 'REPLACE_WITH_REGION',
    rekognitionConfidenceThreshold: 0.9,
    watermarkStyle: 'text_overlay',
    photoRetentionDays: 365,
    enableDeletionProtection: true,
  },
};
```

### EnvConfig shape

```typescript
export interface EnvConfig {
  envName: 'local' | 'dev' | 'qa' | 'staging' | 'prod';
  account: string;
  region: string;
  rekognitionConfidenceThreshold: number;
  watermarkStyle: 'text_overlay' | 'diagonal_tile' | 'bottom_bar';
  photoRetentionDays: number;
  enableDeletionProtection: boolean;
}
```

### Resource naming

All resource names must include `envName` to avoid clashes across contributors:

```typescript
tableName: `racephotos-photos-${config.envName}`;
```

### Removal policies

Driven by `config.enableDeletionProtection` — never by a hardcoded env name check:

- `false` → `RemovalPolicy.DESTROY`
- `true` → `RemovalPolicy.RETAIN`

### SSM parameter lookups — deploy-time only (critical)

**Always use `valueForStringParameter`. Never use `valueFromLookup`.**

`valueFromLookup` requires the pipeline build role to assume the CDK lookup role
(`cdk-hnb659fds-lookup-role-*`) in the target account at synth time. The pipeline
build role does not have that cross-account permission — the Synth step will fail with:

> Could not assume role in target account … is not authorized to perform: sts:AssumeRole
> on resource: arn:aws:iam::{account}:role/cdk-hnb659fds-lookup-role-{account}-{region}

Use `valueForStringParameter` instead — it emits an `AWS::SSM::Parameter::Value<String>`
CloudFormation parameter that CloudFormation resolves at deploy time:

```typescript
// ✅ correct — resolved at deploy time by CloudFormation
const value = ssm.StringParameter.valueForStringParameter(this, '/racephotos/env/...');

// ❌ wrong — requires cross-account lookup role at synth time; breaks the pipeline
const value = ssm.StringParameter.valueFromLookup(this, '/racephotos/env/...');
```

In CDK unit tests, assert the CloudFormation parameter rather than injecting context:

```typescript
template.hasParameter('*', {
  Type: 'AWS::SSM::Parameter::Value<String>',
  Default: '/racephotos/env/dev/the-param',
});
```

This issue has recurred on every new stack that introduced a `valueFromLookup` call
(PRs #40, #41, RS-003 hotfix PR #45).

### Construct granularity

One construct file per logical service:

- `PhotoStorageConstruct` — S3 buckets + lifecycle rules
- `ProcessingPipelineConstruct` — SQS, DLQ, processor Lambda
- `WatermarkConstruct` — watermark Lambda + S3 trigger
- `SearchConstruct` — search Lambda + API Gateway route
- `PaymentConstruct` — payment Lambda + DynamoDB purchase table
- `FrontendConstruct` — CloudFront + S3 for Angular

---

## Lambda conventions

### Environment variable contract

Every Lambda must have a comment block at the top of `main.go`:

```go
// Environment variables:
//   RACEPHOTOS_ENV             required — "local"|"dev"|"qa"|"staging"|"prod"
//   RACEPHOTOS_RAW_BUCKET      required — S3 bucket for original uploads
//   RACEPHOTOS_TABLE_NAME      required — DynamoDB table name
//   RACEPHOTOS_CONFIDENCE_MIN  optional — Rekognition confidence floor (default: 0.80)
```

CDK constructs inject these from `EnvConfig`. Never read `os.Getenv` outside
of `main.go` — pass config as a typed struct into business logic.

### X-Ray tracing

Enable on every Lambda CDK construct. Wrap all outbound SDK calls in named subsegments.

### SQS + DLQ pattern

Every SQS-triggered Lambda must have:

- DLQ with `maxReceiveCount: 3`
- CloudWatch alarm: DLQ `ApproximateNumberOfMessagesVisible > 0`
- Partial batch failure response — return `batchItemFailures`, not a top-level error

### Logging

- Structured JSON with `log/slog` (Go 1.21+)
- Every entry includes: `requestId`, `service`, `env`, `level`
- Never log presigned URLs, payment references, or runner email addresses

---

## Local development

### First-time setup (new contributor)

```bash
git clone <repo>
cp infra/cdk/config/environments.example.ts infra/cdk/config/environments.ts
# edit environments.ts — fill in your account IDs and region
cp .env.example .env.local
# edit .env.local if needed
docker-compose up -d
make seed-local
```

### Local env vars (live in .env.local, never committed)

```bash
RACEPHOTOS_ENV=local
AWS_ENDPOINT_URL=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_REGION=us-east-1
```

---

## Open-source contributor rules

1. **No AWS account IDs in committed files** — ever, in any form
2. **No real domain names in committed files** — use `example.com` as placeholder
3. **No personal or company-specific names in code** — "RaceShots" only
4. **`environments.example.ts` and `.env.example` must stay in sync** with the
   actual config shape — update them whenever a new config key is added
5. **All manual setup steps must be documented** in `docs/setup/`
6. **`scripts/seed-local.sh` must mirror the CDK resource definitions** — when
   a new bucket, queue, or table is added in CDK, it must also be seeded locally

---

## What Claude Code must always do

1. Read `docs/stories/<feature>.md` before writing code for a feature
2. Read `docs/adr/<service>.md` if one exists for the service being modified
3. Write the interface and tests before the implementation
4. Document every new env var in `main.go` and inject it in the CDK construct
5. Update `environments.example.ts` and `.env.example` if a new config key is added
6. Self-review generated code for: missing error wrapping, missing context
   propagation, missing X-Ray segments, SDK calls bypassing interfaces, and
   any hardcoded infrastructure value

## What Claude Code must never do

- Hardcode account IDs, region names, bucket names, table names, or domain names
- Use `context.Background()` inside a Lambda handler or anything it calls
- Return raw AWS SDK errors to API Gateway
- Skip DLQ configuration on any SQS-triggered Lambda
- Write integration tests that call real AWS endpoints
- Log presigned URLs, payment references, or runner PII
- Modify `environments.ts` without being explicitly asked
- Add a dependency without checking if an existing library already covers it
- Use `CronCreate` or `/loop` for pipeline monitoring — use a bash polling loop
  instead (see "Pipeline monitoring" below)
- Push directly to `main` — `main` is a protected branch; always create a
  feature or fix branch and open a PR, even for docs-only changes
- Merge a PR without explicit user approval — always present the PR URL and
  wait; "no need to review" means skip code review, not permission to merge

---

## Pipeline monitoring

When monitoring `racephotos-pipeline` after a PR merge, **always use a bash
polling loop**. Never use `CronCreate` or `/loop` — those create indefinite
recurring jobs that must be manually cancelled.

```bash
for i in $(seq 1 30); do
  STATUS=$(aws codepipeline get-pipeline-state \
    --name racephotos-pipeline \
    --profile tools_readonly \
    --query 'stageStates[*].{Stage:stageName,Status:latestExecution.status}' \
    --output json)
  echo "$STATUS"
  # break when all stages Succeeded, or on Failed requiring intervention
  sleep 180
done
```

Key facts:

- Pipeline name: `racephotos-pipeline` (not `RacePhotosPipeline`)
- Read profile: `tools_readonly` — write operations require `tools`
- `UpdatePipeline = Cancelled` while `Build = InProgress` is **normal
  self-mutation** — find the new execution and monitor that one
- Never auto-merge a fix PR; always present the URL and wait for user approval
