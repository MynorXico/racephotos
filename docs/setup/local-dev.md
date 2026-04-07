# Local development setup

This guide gets you from a fresh clone to a fully running local environment
with LocalStack, seeded AWS resources, and the Angular dev server.

---

## Prerequisites

| Tool           | Version | Notes                                                             |
| -------------- | ------- | ----------------------------------------------------------------- |
| Docker         | 24+     | Required for LocalStack. Use Compose v2 (`docker compose`)        |
| `awscli-local` | latest  | `pip install awscli-local` — wraps `aws` with LocalStack endpoint |
| Go             | 1.22+   | Lambda development                                                |
| Node.js        | 20.x    | Angular + CDK                                                     |
| AWS SAM CLI    | latest  | `pip install aws-sam-cli` — required for local Lambda debugging   |

> **`awscli-local` not installed?** Use the regular `aws` CLI with
> `--endpoint-url http://localhost:4566` instead. Example:
>
> ```bash
> aws dynamodb put-item --endpoint-url http://localhost:4566 --table-name racephotos-photographers ...
> ```
>
> The seed script also detects whichever is available automatically.

---

## First-time setup

### 1. Configure CDK (one-time)

```bash
cp infra/cdk/config/environments.example.ts infra/cdk/config/environments.ts
# Edit environments.ts — fill in your AWS account IDs and region
```

### 2. Configure local environment variables

```bash
cp .env.example .env.local
# .env.local works as-is for LocalStack — defaults are correct
```

### 3. Install dependencies

```bash
npm install                          # root dev tooling (husky, prettier, etc.)
cd infra/cdk && npm ci && cd ../..
cd frontend/angular && npm ci && cd ../..
```

### 4. Start LocalStack

```bash
docker compose up -d
```

Wait until healthy (usually ~15 seconds):

```bash
docker compose ps   # Status should show "(healthy)"
```

### 5. Seed LocalStack resources

```bash
make seed-local
```

This creates all AWS resources matching the CDK definitions:

- S3: `racephotos-raw-local`, `racephotos-processed-local`
- DynamoDB: `racephotos-photos-local` (single table, PK/SK + GSI1)
- SQS: `racephotos-processing-local` + DLQ (maxReceiveCount=3)
- Cognito: user pool + app client (email login)
- SES: `noreply@example.com` verified sender

**The script prints the Cognito IDs at the end — copy them into your local frontend config (next step).**

### 6. Update frontend config

The Angular app reads `frontend/angular/src/assets/config.json` at startup. Update it with the values printed by `seed-local.sh`:

```json
{
  "apiBaseUrl": "http://localhost:3000",
  "region": "us-east-1",
  "cognitoUserPoolId": "<printed by seed-local.sh>",
  "cognitoClientId": "<printed by seed-local.sh>",
  "cognitoOauthDomain": "localhost.localstack.cloud:4566"
}
```

> `config.json` is committed as a placeholder (not secret). Local edits with
> LocalStack values are fine to leave uncommitted — LocalStack IDs are fake.
> Never commit real AWS Cognito IDs.

---

## Daily workflow

```bash
docker compose up -d    # start LocalStack (if not already running)
make test-unit          # Go unit tests — no LocalStack required
make test-integration   # Go integration tests — requires LocalStack
make lint               # Go lint
make cdk-check          # CDK type-check + jest (no AWS credentials needed)
make ng-build           # Angular production build check
make ng-lint            # Angular ESLint
make ng-test            # Angular Karma unit tests
make validate           # full suite (everything except e2e and synth)
```

### Running the Angular dev server

```bash
cd frontend/angular
npm start               # or: npx ng serve
```

Opens at `http://localhost:4200`. API calls to `/api/*` are proxied to
`http://localhost:3000` via `proxy.conf.json` (wired in `angular.json`).

---

## Debugging Lambdas locally

You can run any Lambda in a Docker container locally — with real memory limits,
timeout enforcement, and live logs — without deploying to AWS.

See **[local-lambda-debugging.md](local-lambda-debugging.md)** for the full
guide. Quick start:

```bash
make invoke-get-photographer EVENT=get-existing
make invoke-update-photographer EVENT=update-valid
```

---

## Re-seeding

`seed-local.sh` is idempotent. Re-run it any time to recreate resources
(e.g. after `docker compose down -v` which wipes LocalStack state).

```bash
make seed-local
```

---

## LocalStack persistence

The `docker compose.yml` sets `PERSISTENCE=1`. State is saved to `./volume/`
(gitignored). Stop and start without losing resources:

```bash
docker compose stop     # pause
docker compose start    # resume — resources still there
docker compose down -v  # wipe all state (then re-run make seed-local)
```

---

## Rekognition (not in LocalStack)

Rekognition is not emulated by LocalStack Community Edition.

When `RACEPHOTOS_ENV=local`, the photo-processor Lambda init wires in a
file-backed mock that reads responses from `testdata/rekognition-responses/`.
See the processor Lambda's `CLAUDE.md` for how to add test bib fixtures.

---

## Troubleshooting

See [docs/setup/troubleshooting.md](troubleshooting.md) for common issues.

Key ones:

- **"could not connect to LocalStack"** — run `docker compose up -d` and wait for healthy
- **"awslocal: command not found"** — `pip install awscli-local` or export `AWS_ENDPOINT_URL=http://localhost:4566`
- **Stale Cognito IDs in config.json** — run `make seed-local` again and update config.json with the new output
