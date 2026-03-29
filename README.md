# RaceShots

Open-source race photo platform. Photographers upload event photos; runners find theirs by bib number using AI. Watermarked previews free, full-resolution unlocked after payment.

---

## How it works

1. **Photographer** uploads photos after a race event via the web app
2. **Amazon Rekognition** automatically detects bib numbers in each photo
3. **Runner** searches by their bib number and sees a watermarked preview
4. **Runner** pays the photographer directly via bank transfer and submits the reference
5. **Photographer** approves the payment and the runner downloads the full-resolution original

---

## Architecture

| Layer            | Technology                                        |
| ---------------- | ------------------------------------------------- |
| Lambda runtime   | Go 1.22+                                          |
| Infrastructure   | AWS CDK (TypeScript)                              |
| Database         | DynamoDB (on-demand)                              |
| Storage          | S3 (two buckets: private originals + watermarked) |
| Queue            | SQS + Dead Letter Queue                           |
| AI bib detection | Amazon Rekognition — `DetectText`                 |
| Auth             | Amazon Cognito User Pools                         |
| CDN              | Amazon CloudFront                                 |
| Frontend         | Angular 17+                                       |
| Local dev        | LocalStack via Docker                             |
| CI/CD            | GitHub Actions + AWS CDK Pipelines                |
| Observability    | CloudWatch Logs, Alarms, X-Ray                    |

### Multi-account layout

```
AWS Organization
├── TOOLS    — CDK Pipelines, CodePipeline, artifact bucket
├── DEV      — auto-deploy on merge to main
├── QA       — integration + load tests, auto after DEV green
├── STAGING  — pre-prod mirror, manual approval gate
└── PROD     — live, manual approval gate
```

All application stacks are deployed by the pipeline in TOOLS into their target accounts via cross-account IAM roles. You never run `cdk deploy` manually for application stacks.

---

## Repository layout

```
racephotos/
├── CLAUDE.md                        ← AI agent instructions (read this)
├── PRODUCT_CONTEXT.md               ← Product vision and domain rules
├── CONTRIBUTING.md
├── .env.example                     ← Copy to .env.local and fill in
├── Makefile
├── docker-compose.yml               ← LocalStack
├── docs/
│   ├── adr/                         ← Architecture Decision Records
│   ├── stories/                     ← User stories
│   └── setup/
│       ├── aws-bootstrap.md         ← One-time AWS setup guide
│       └── local-dev.md             ← LocalStack dev guide
├── infra/
│   └── cdk/
│       ├── bin/app.ts               ← CDK entry point
│       ├── stacks/pipeline-stack.ts ← Pipeline stack (TOOLS account)
│       ├── stages/racephotos-stage.ts
│       └── config/
│           ├── types.ts             ← Interfaces (committed)
│           └── environments.example.ts ← Documents SSM parameters needed
├── lambdas/
│   ├── photo-upload/                ← Presigned URL generator
│   ├── photo-processor/             ← Rekognition + DynamoDB indexer
│   ├── watermark/                   ← Watermark applicator
│   ├── search/                      ← Bib number search
│   └── payment/                     ← Payment unlock + signed URL
├── shared/                          ← Shared Go packages
├── frontend/angular/                ← Angular web app
└── scripts/
    ├── seed-ssm.sh                  ← One-time SSM parameter setup
    └── seed-local.sh                ← LocalStack resource seeder
```

---

## Prerequisites

- AWS CLI configured with named profiles for each account (`tools`, `dev`, `qa`, `staging`, `prod`)
- Node.js 20.x ([why not 21+?](docs/setup/troubleshooting.md#node-version))
- Go 1.22+
- Docker (for LocalStack)
- AWS CDK CLI: `npm install -g aws-cdk`

---

## First-time setup

### 1. Bootstrap CDK in all accounts

Each target account must trust the TOOLS account to deploy into it. See [docs/setup/aws-bootstrap.md](docs/setup/aws-bootstrap.md) for the full commands.

### 2. Create a GitHub CodeStar Connection

In the AWS Console under the **TOOLS account**:

1. Go to **CodePipeline → Settings → Connections**
2. Create connection → GitHub → name it `racephotos-github`
3. Authorize the GitHub app and select your repo
4. Copy the Connection ARN

### 3. Seed SSM parameters

All configuration lives in SSM Parameter Store in the TOOLS account — nothing sensitive is committed to the repo.

```bash
AWS_PROFILE=tools ./scripts/seed-ssm.sh
```

You will be prompted for each value interactively. See [docs/setup/aws-bootstrap.md](docs/setup/aws-bootstrap.md) for the full parameter list.

### 4. Deploy the pipeline

```bash
cd infra/cdk
npm install

export CDK_DEFAULT_ACCOUNT=$(AWS_PROFILE=tools aws sts get-caller-identity \
  --query Account --output text)
export CDK_DEFAULT_REGION=us-east-1

npx cdk synth --profile tools   # run twice if values look like dummy-value-for-*
npx cdk deploy --profile tools RacePhotosPipeline
```

After this, every push to `main` triggers the pipeline automatically. You never run `cdk deploy` again manually.

---

## Local development

```bash
# Start LocalStack
docker-compose up -d

# Seed local resources (S3 buckets, SQS queues, DynamoDB table)
./scripts/seed-local.sh

# Set local env vars
export RACEPHOTOS_ENV=local
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_REGION=us-east-1
```

See [docs/setup/local-dev.md](docs/setup/local-dev.md) for the full local development guide.

---

## Running tests

```bash
# Unit tests — no AWS or LocalStack needed
make test-unit

# Integration tests — requires LocalStack running
make test-integration

# All tests
make test
```

---

## Contributing

This is an open-source project — forks are encouraged. If you're deploying your own instance, the entire infrastructure is parameterised through SSM. No code changes are needed to run it under your own AWS accounts.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CLAUDE.md](CLAUDE.md) for development conventions.

---

## Troubleshooting

See [docs/setup/troubleshooting.md](docs/setup/troubleshooting.md) for solutions to common setup issues.
