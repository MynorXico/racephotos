# AWS Bootstrap Guide

One-time setup required before you can deploy RaceShots to your own AWS accounts.

---

## Prerequisites

- AWS CLI installed and configured with named profiles for each account
- CDK CLI installed: `npm install -g aws-cdk`
- Node.js 20.x (see `.nvmrc`)

Verify your profiles work:

```bash
AWS_PROFILE=tools aws sts get-caller-identity
AWS_PROFILE=dev   aws sts get-caller-identity
AWS_PROFILE=qa    aws sts get-caller-identity
AWS_PROFILE=staging aws sts get-caller-identity
AWS_PROFILE=prod  aws sts get-caller-identity
```

---

## Step 1 — Bootstrap CDK in all accounts

Bootstrap must be run once per account. Target accounts (DEV, QA, STAGING,
PROD) must explicitly trust the TOOLS account so the pipeline can deploy
into them.

```bash
REGION=us-east-1
TOOLS_ACCOUNT=$(AWS_PROFILE=tools aws sts get-caller-identity \
  --query Account --output text)

# Bootstrap TOOLS (no trust needed — it is the orchestrator)
AWS_PROFILE=tools cdk bootstrap aws://$TOOLS_ACCOUNT/$REGION \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess

# Bootstrap DEV
AWS_PROFILE=dev cdk bootstrap \
  aws://$(AWS_PROFILE=dev aws sts get-caller-identity --query Account --output text)/$REGION \
  --trust $TOOLS_ACCOUNT \
  --trust-for-lookup $TOOLS_ACCOUNT \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess

# Bootstrap QA
AWS_PROFILE=qa cdk bootstrap \
  aws://$(AWS_PROFILE=qa aws sts get-caller-identity --query Account --output text)/$REGION \
  --trust $TOOLS_ACCOUNT \
  --trust-for-lookup $TOOLS_ACCOUNT \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess

# Bootstrap STAGING
AWS_PROFILE=staging cdk bootstrap \
  aws://$(AWS_PROFILE=staging aws sts get-caller-identity --query Account --output text)/$REGION \
  --trust $TOOLS_ACCOUNT \
  --trust-for-lookup $TOOLS_ACCOUNT \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess

# Bootstrap PROD
AWS_PROFILE=prod cdk bootstrap \
  aws://$(AWS_PROFILE=prod aws sts get-caller-identity --query Account --output text)/$REGION \
  --trust $TOOLS_ACCOUNT \
  --trust-for-lookup $TOOLS_ACCOUNT \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
```

A minimal self-hosted deployment only needs TOOLS and PROD. QA and STAGING
are optional — simply skip bootstrapping them and leave those blocks commented
out in `pipeline-stack.ts`.

---

## Step 2 — Create a GitHub CodeStar Connection

This is a one-time manual step. It cannot be automated because AWS requires
a human to authorize the GitHub OAuth app.

1. Sign in to the **TOOLS account** in the AWS Console
2. Go to **CodePipeline → Settings → Connections**
3. Click **Create connection → GitHub**
4. Name it `racephotos-github`
5. Click **Connect to GitHub**, authorize the AWS Connector app
6. Select your repository (or your organization)
7. Click **Connect**
8. Copy the full **Connection ARN** — you will need it in Step 3

The Connection ARN looks like:

```
arn:aws:codeconnections:us-east-1:142755255530:connection/36127ac1-7a16-472c-aaad-b29ba0b21ea4
```

> **Note:** The Connection must be in **Available** status (green) before the
> pipeline can use it. If it shows **Pending**, click into it and complete the
> authorization step.

---

## Step 2b — Create ACM certificates (optional, custom domain only)

Skip this step if you are using the CloudFront default `*.cloudfront.net` domain
(enter blank / `none` when `seed-ssm.sh` asks for a domain name).

If you want a custom domain (e.g. `app.dev.example.com`):

1. **Certificates must be in `us-east-1`** regardless of your application region.
   This is a hard CloudFront requirement.

2. Sign in to the **target account** (DEV, PROD, etc.) in the AWS Console,
   **switch region to `us-east-1`**.

3. Go to **Certificate Manager → Request certificate → Public certificate**.

4. Enter your domain name (e.g. `app.dev.example.com`), choose **DNS validation**,
   and follow the CNAME instructions to prove domain ownership.

5. Once the status is **Issued**, copy the **Certificate ARN**.

6. `seed-ssm.sh` (Step 3) will prompt for this ARN when you provide a domain name
   for that environment.

> **Where the ARN is stored:** `/racephotos/env/{envName}/certificate-arn` in the
> TOOLS account's SSM. It references a certificate that physically lives in
> `us-east-1` of the target account — CloudFront resolves it correctly because
> the FrontendStack is deployed into the target account.

---

## Step 3 — Seed SSM parameters

All configuration is stored in SSM Parameter Store in the TOOLS account.
Run the seed script once — it prompts you for each value interactively:

```bash
AWS_PROFILE=tools ./scripts/seed-ssm.sh
```

You will be asked for:

| Parameter                   | Description                                                           |
| --------------------------- | --------------------------------------------------------------------- |
| TOOLS account ID            | Your TOOLS AWS account number                                         |
| TOOLS region                | e.g. `us-east-1`                                                      |
| GitHub owner                | Your GitHub username or org name                                      |
| GitHub repo                 | `racephotos` (or your fork name)                                      |
| GitHub branch               | `main`                                                                |
| CodeStar connection ARN     | From Step 2                                                           |
| DEV account ID + region     | Skip if not using DEV                                                 |
| DEV custom domain           | e.g. `app.dev.example.com` — blank → `none` (uses CloudFront default) |
| DEV certificate ARN         | Only prompted if domain is not blank; must be in `us-east-1`          |
| QA account ID + region      | Skip if not using QA                                                  |
| QA custom domain            | Same as DEV                                                           |
| QA certificate ARN          | Same as DEV                                                           |
| STAGING account ID + region | Skip if not using STAGING                                             |
| STAGING custom domain       | Same as DEV                                                           |
| STAGING certificate ARN     | Same as DEV                                                           |
| PROD account ID + region    | Skip if not using PROD                                                |
| PROD custom domain          | Same as DEV                                                           |
| PROD certificate ARN        | Same as DEV                                                           |

Verify parameters were created:

```bash
AWS_PROFILE=tools aws ssm get-parameters-by-path \
  --path "/racephotos" \
  --recursive \
  --query "Parameters[*].{Name:Name,Value:Value}" \
  --output table
```

---

## Step 4 — Deploy the pipeline

```bash
# These two exports are required before every cdk synth/deploy from your laptop.
# Add them to your shell profile or .env.local for convenience.
export CDK_DEFAULT_ACCOUNT=$(AWS_PROFILE=tools aws sts get-caller-identity \
  --query Account --output text)
export CDK_DEFAULT_REGION=us-east-1

# Generate cdk.context.json from SSM.
# This resolves all valueFromLookup calls so cdk synth never sees dummy values.
# cdk.context.json is gitignored — account IDs must not be committed.
# The pipeline runs this script automatically on every synth.
AWS_PROFILE=tools ./scripts/generate-cdk-context.sh

# Synth and deploy
cd infra/cdk && npm install
AWS_PROFILE=tools npx cdk synth
AWS_PROFILE=tools npx cdk deploy RacePhotosPipeline
```

> **Important:** After this deploy, the pipeline is self-mutating. Every push
> to `main` triggers it automatically. Do not run `cdk deploy` again manually
> for the pipeline or any application stack — let the pipeline handle it.

> **If the first pipeline run fails with `ssm:GetParameter` access denied:**
> This is a known chicken-and-egg issue — the CodeBuild role's SSM policy is
> applied by CloudFormation only after a successful synth, but the synth needs
> the policy to succeed. Fix it by running `cdk deploy` locally a second time
> (same commands above) to patch the role directly. Then re-trigger the
> pipeline. See [troubleshooting.md](troubleshooting.md) for full details.

---

## Step 5 — Verify the pipeline

1. Go to **AWS Console → TOOLS account → CodePipeline → racephotos-pipeline**
2. Confirm the **Source** stage is green and shows your GitHub repo
3. The pipeline will have run once automatically after deploy — it should show
   green through the **UpdatePipeline** stage and then idle (no application
   stages yet)

If Source shows a failure, check that the CodeStar Connection is in
**Available** status (see Step 2).

---

## Adding a new environment stage

When you are ready to deploy the first application stack to DEV:

1. Ensure DEV is bootstrapped (Step 1)
2. Ensure `/racephotos/env/dev/account-id` and `/racephotos/env/dev/region`
   exist in SSM (Step 3)
3. Uncomment the DEV stage block in `infra/cdk/stacks/pipeline-stack.ts`
4. Push to `main` — the pipeline self-mutates and adds the DEV stage

Repeat for QA, STAGING, and PROD as needed.

---

## cdk.json entry point note

`cdk init` generates an entry point named after the folder (`bin/cdk.ts` when
the folder is named `cdk/`). This project uses `bin/app.ts` instead. After
running `cdk init`, update `cdk.json`:

```json
{
  "app": "npx ts-node --prefer-ts-exts bin/app.ts"
}
```

And delete the generated file:

```bash
rm -f infra/cdk/bin/cdk.ts
```

See [troubleshooting.md](troubleshooting.md) if you encounter other issues.
