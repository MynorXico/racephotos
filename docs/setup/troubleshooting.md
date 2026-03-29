# Troubleshooting

Solutions to known issues encountered during setup and development.

---

## CDK / Synth issues

### "No stacks match the name(s) RacePhotosPipeline"

**Symptom**

```
npx cdk deploy RacePhotosPipeline
Error: No stacks match the name(s) RacePhotosPipeline
```

**Cause**
`cdk init` names the entry point after the folder it runs in. Since the CDK app
lives in `infra/cdk/`, it generates `bin/cdk.ts` — not `bin/app.ts`. The
`cdk.json` `app` field points to the wrong file.

**Fix**
Open `infra/cdk/cdk.json` and update the `app` field:

```json
{
  "app": "npx ts-node --prefer-ts-exts bin/app.ts"
}
```

Then delete the generated file if it still exists:

```bash
rm -f infra/cdk/bin/cdk.ts
```

---

### "App at '' should be created in the scope of a Stack, but no Stack found"

**Symptom**

```
Error: App at '' should be created in the scope of a Stack, but no Stack found
    at Function.valueFromLookup (parameter.js)
    at param (app.ts)
```

**Cause 1 — SSM lookup called before the stack is created**

`ssm.StringParameter.valueFromLookup` requires a Stack construct as its scope.
Calling it in `app.ts` before `new PipelineStack(...)` passes the `App` as
scope, which is not a Stack and triggers this error.

**Fix**
Move all SSM lookups inside the stack constructor, using `this` as the scope:

```typescript
// ✗ Wrong — called in app.ts with app as scope
const owner = ssm.StringParameter.valueFromLookup(app, "/racephotos/github/owner");

// ✓ Correct — called inside PipelineStack constructor with this as scope
private loadConfig() {
  const param = (name: string) => ssm.StringParameter.valueFromLookup(this, name);
  return { githubOwner: param("/racephotos/github/owner"), ... };
}
```

**Cause 2 — CDK_DEFAULT_ACCOUNT or CDK_DEFAULT_REGION not set**

SSM lookups also fail if the stack has no explicit `env`. The stack needs to
know which account and region to look up parameters in before it can make the
API call.

**Fix**
Export both variables before running `cdk synth`:

```bash
export CDK_DEFAULT_ACCOUNT=$(AWS_PROFILE=tools aws sts get-caller-identity \
  --query Account --output text)
export CDK_DEFAULT_REGION=us-east-1

npx cdk synth --profile tools
```

---

### SSM values show as `dummy-value-for-/racephotos/...`

**Symptom**
The synthesized CloudFormation template contains placeholder strings like
`dummy-value-for-/racephotos/github/owner` instead of real values.

**Cause**
This is expected behaviour on the very first `cdk synth` run. CDK makes SSM
API calls during synthesis and caches results in `cdk.context.json`. On the
first run, if the cache is empty, CDK uses dummy placeholders and populates
the cache in the background.

**Fix**
Run `cdk synth` a second time — the second run reads the cached real values:

```bash
npx cdk synth --profile tools  # first run — populates cdk.context.json
npx cdk synth --profile tools  # second run — uses real values
```

---

### TypeScript build errors: "Cannot find module '../config/environments'"

**Symptom**

```
stacks/pipeline-stack.ts(8,32): error TS2307:
  Cannot find module '../config/environments' or its corresponding type declarations.
```

**Cause**
`environments.ts` is gitignored — it does not exist in the repository or in
CI. Any file that imports from it will fail to compile in a fresh clone or in
CodePipeline.

**Fix**
Type definitions live in `config/types.ts` (committed). Values are loaded at
runtime from SSM inside the stack constructor. Import types from `types.ts`,
never from `environments.ts`:

```typescript
// ✗ Wrong
import { PipelineConfig } from '../config/environments';

// ✓ Correct
import { PipelineConfig } from '../config/types';
```

---

### CodePipeline build fails: "Cannot find module '../config/environments'"

**Cause**
Same as above — CodePipeline clones the repo from GitHub. `environments.ts`
is gitignored and never pushed, so the build step cannot find it.

**Fix**
Ensure no committed file imports from `environments.ts`. All imports must use
`config/types.ts`. Values come from SSM at synth time via `loadConfig()` in
`pipeline-stack.ts`.

---

## Node.js issues

### Node version warning from CDK CLI

**Symptom**

```
!! Node 21 has reached end-of-life on 2024-06-01 and is not supported. !!
```

**Cause**
CDK CLI 2.137+ does not support Node 21 (EOL). The warning does not by itself
cause failures — other issues may coincide with it but are independent.

**Recommendation**
Upgrade to Node 20 LTS to avoid any future compatibility issues:

```bash
nvm install 20
nvm use 20
nvm alias default 20
```

The repo includes an `.nvmrc` file — if you use nvm, running `nvm use` in the
repo root automatically selects the correct version.

---

## CodePipeline / CodeBuild issues

### Pipeline synth step fails: "not authorized to perform: ssm:GetParameter"

**Symptom**

```
[Error at /RacePhotosPipeline] User: arn:aws:sts::ACCOUNT:assumed-role/
RacePhotosPipeline-PipelineBuildSynthCdkBuildProjec-.../AWSCodeBuild-...
is not authorized to perform: ssm:GetParameter on resource:
arn:aws:ssm:us-east-1:ACCOUNT:parameter/racephotos/github/owner
because no identity-based policy allows the ssm:GetParameter action
```

**Cause**
CDK Pipelines chicken-and-egg problem. The IAM policy that grants the synth
CodeBuild role `ssm:GetParameter` on `racephotos/*` is defined in CDK
(`synthCodeBuildDefaults.rolePolicy` in `pipeline-stack.ts`). That policy is
only applied when CloudFormation updates the stack — but CloudFormation can
only update the stack after a successful `cdk synth` — which requires the
permission it doesn't yet have.

This happens on the first pipeline run after the stack is created, or after
any change to `synthCodeBuildDefaults` is pushed without a prior local deploy.

**Fix**
Run `cdk deploy` locally once to patch the CodeBuild role directly via
CloudFormation, bypassing the pipeline:

```bash
cd infra/cdk
export CDK_DEFAULT_ACCOUNT=$(AWS_PROFILE=tools aws sts get-caller-identity \
  --query Account --output text)
export CDK_DEFAULT_REGION=us-east-1

npx cdk deploy --profile tools RacePhotosPipeline
```

After the deploy completes, re-trigger the pipeline (push a commit or click
**Release change** in the CodePipeline console). The synth step will now
succeed, and the pipeline will self-mutate to stay in sync going forward.

> **Why this works:** The local deploy updates the CloudFormation stack
> directly, attaching the SSM policy to the CodeBuild role without going
> through the pipeline's synth step. Once the role has the permission, the
> pipeline can run and self-mutate normally.

---

## AWS / credential issues

### "Unable to resolve AWS account to use"

**Symptom**

```
Unable to resolve AWS account to use. It must be either configured when you
define your CDK Stack, or through the environment
```

**Fix**

```bash
export CDK_DEFAULT_ACCOUNT=$(AWS_PROFILE=tools aws sts get-caller-identity \
  --query Account --output text)
export CDK_DEFAULT_REGION=us-east-1
```

---

### SSM parameters return empty or access denied

**Symptom**
`seed-ssm.sh` runs but SSM lookups during `cdk synth` fail or return nothing.

**Cause**
Either the parameters were not created, or the active AWS profile does not
have `ssm:GetParameter` permissions in the TOOLS account.

**Diagnosis**

```bash
# Verify parameters exist
AWS_PROFILE=tools aws ssm get-parameters-by-path \
  --path "/racephotos" \
  --recursive \
  --query "Parameters[*].{Name:Name}" \
  --output table

# Verify your identity
AWS_PROFILE=tools aws sts get-caller-identity
```

If the parameters table is empty, re-run the seed script:

```bash
AWS_PROFILE=tools ./scripts/seed-ssm.sh
```

---

### Cross-account deploy role not found

**Symptom**

```
RacePhotosPipeline failed: Could not assume role
arn:aws:iam::DEV_ACCOUNT:role/cdk-hnb659fds-deploy-role-...
```

**Cause**
The target account (DEV, QA, etc.) was not bootstrapped with trust for the
TOOLS account, or bootstrap was run without the `--trust` flag.

**Fix**
Re-bootstrap the target account with explicit trust:

```bash
cdk bootstrap --profile dev \
  aws://DEV_ACCOUNT_ID/REGION \
  --trust TOOLS_ACCOUNT_ID \
  --trust-for-lookup TOOLS_ACCOUNT_ID \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
```

To verify trust is in place:

```bash
AWS_PROFILE=dev aws iam get-role \
  --role-name cdk-hnb659fds-deploy-role-DEV_ACCOUNT_ID-REGION \
  --query 'Role.AssumeRolePolicyDocument'
```

You should see `TOOLS_ACCOUNT_ID` in the `Principal` block.

---

## cdk.context.json

`cdk.context.json` is gitignored. It stores cached SSM lookup results and
other CDK context values resolved during `cdk synth`. Each developer and
the pipeline resolve their own values.

Do not commit this file — it contains account IDs and may differ between
contributors.

If you want to force CDK to re-resolve all context values (e.g. after rotating
an SSM parameter), delete the file and run `cdk synth` again:

```bash
rm infra/cdk/cdk.context.json
npx cdk synth --profile tools
```
