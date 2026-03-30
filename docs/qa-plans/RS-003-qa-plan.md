# QA Plan: RS-003 — CDK SES construct + email templates

## Scope

This plan covers the infrastructure-only changes introduced by RS-003:

- `infra/cdk/constructs/ses-construct.ts` — `SesConstruct` class
- `infra/cdk/stacks/ses-stack.ts` — `SesStack` that resolves the SSM from-address
- `infra/cdk/stages/racephotos-stage.ts` — `SesStack` instantiation within the stage
- `infra/cdk/test/ses-stack.test.ts` — jest / `@aws-cdk/assertions` unit tests
- `scripts/seed-ssm.sh` — interactive SSM parameter seeding
- `scripts/seed-local.sh` — LocalStack SES identity + template seeding
- `.env.example` — new `RACEPHOTOS_SES_FROM_ADDRESS` env var

There is no Go Lambda code in this story. Test cases that require a running
environment target either the jest CDK assertion suite or LocalStack.

---

## Test cases

### TC-001: CDK synth succeeds without the SSM parameter pre-existing

**Category**: Boundary
**Setup**: No SSM parameter `/racephotos/env/dev/ses-from-address` seeded.
Run `cdk synth` (simulates a developer's first synth or a pipeline Synth step).
**Action**: Construct `SesStack` and synthesize.
**Expected**: Synth completes without error. The produced CloudFormation template
contains an `AWS::SSM::Parameter::Value<String>` parameter with
`Default: /racephotos/env/dev/ses-from-address`, and the `AWS::SES::EmailIdentity`
resource references it via `{"Ref": "..."}`. No cross-account role assumption
occurs at synth time — the SSM value is resolved by CloudFormation at deploy time.
**Why it matters**: `ssm.StringParameter.valueForStringParameter` is used (not
`valueFromLookup`) so the pipeline build role never needs to assume the CDK lookup
role in the target account. This was the root cause of the pipeline Synth failure
fixed in PR #45 — confirmed recurring across PRs #40, #41, and #45.

---

### TC-002: Empty string from-address does not silently create a broken identity

**Category**: Boundary
**Setup**: Set the SSM parameter `/racephotos/env/dev/ses-from-address` to an
empty string (`aws ssm put-parameter --value ""`). Deploy the stack to a dev
account. Construct `SesStack` locally with `Template.fromStack()`.
**Action**: Call `Template.fromStack(stack)` and inspect the `AWS::SES::EmailIdentity`
resource.
**Expected**: Either CloudFormation validation rejects the empty value during
synth (acceptable error), or the construct explicitly guards against it and
throws a descriptive error — never silently produces a CloudFormation resource
with an empty `EmailIdentity` property.
**Why it matters**: `seed-ssm.sh` warns but defaults to `noreply@example.com`
when left blank, yet nothing prevents a developer from manually writing an
empty string to SSM. An empty identity ARN would break every subsequent IAM
grant scoped to it.

---

### TC-003: Maximum-length email address in SSM

**Category**: Boundary
**Setup**: Set the SSM parameter `/racephotos/env/dev/ses-from-address` to a
254-character email address (`a...a@b.com` where the local part fills the RFC 5321 limit).
**Action**: Deploy `SesStack` targeting that SSM value. Run `cdk synth` and inspect
the resulting CloudFormation template.
**Expected**: The `AWS::SES::EmailIdentity` resource is created with the full
address. CDK and CloudFormation must not truncate or reject it at synth time.
**Why it matters**: Photographers choosing long business email addresses must
not trigger silent truncation or a non-obvious deploy failure.

---

### TC-004: SES template name collision across environments sharing one AWS account

**Category**: Boundary
**Setup**: Instantiate two `SesStack` instances in the same CDK `App` — one
with `envName: 'dev'` and one with `envName: 'qa'`, both targeting the same
`account` and `region`.
**Action**: Run `cdk synth` for the combined app.
**Expected**: CloudFormation reports a duplicate `TemplateName` error, because
the template names have no `{envName}` suffix and both stacks would attempt to
create `racephotos-photographer-claim` in the same AWS account.
**Why it matters**: The construct comment explicitly states templates are
account-scoped with no env suffix on the assumption of isolated accounts. If a
contributor deploys DEV and QA into the same account, all four templates will
conflict. This scenario should be documented as unsupported, or a guard should
be added. The test makes the failure mode explicit so it is not discovered at
deploy time.

---

### TC-005: Template variable names match what ADR-0001 and ADR-0002 specify

**Category**: Input validation
**Setup**: Synthesize the stack with the dev config.
**Action**: Inspect all four `AWS::SES::Template` resources in the CloudFormation
template. Extract all `{{variableName}}` tokens from both `HtmlPart` and
`TextPart` of each template.
**Expected**:

- `racephotos-photographer-claim`: contains `{{runnerEmailMasked}}`,
  `{{eventName}}`, `{{photoReference}}`, `{{dashboardUrl}}`
- `racephotos-runner-claim-confirmation`: contains `{{eventName}}`,
  `{{photoReference}}`, `{{paymentReference}}`
- `racephotos-runner-purchase-approved`: contains `{{eventName}}`,
  `{{downloadUrl}}`
- `racephotos-runner-redownload-resend`: contains `{{downloadLinks}}`
- No template contains a variable name that is absent from this list
  (extra variables would indicate a calling Lambda must supply them and would
  fail at send time if it does not)
  **Why it matters**: A Lambda calling `SendTemplatedEmail` must supply exactly
  the variables the template expects. A mismatched name (e.g. `downloadLink` vs
  `downloadUrl`) causes SES to return `MissingRenderingAttributeException` at
  runtime, silently omitting the link from the email the runner receives.

---

### TC-006: Plain-text parts contain the same variables as HTML parts

**Category**: Input validation
**Setup**: Synthesize stack and inspect all four templates.
**Action**: For each template, compare the set of `{{variableName}}` tokens in
`HtmlPart` vs `TextPart`.
**Expected**: Every variable present in `HtmlPart` is also present in
`TextPart`, and vice versa. No variable appears in one part but not the other.
**Why it matters**: Email clients that render only the plain-text part (some
corporate mail gateways) would show unfilled placeholders or missing
information if the variable sets differ. A runner seeing
`Your payment reference: ` (blank) instead of `Your payment reference: RS-XXXX`
has no way to identify their transfer.

---

### TC-007: grantSendEmail called multiple times on the same grantee is idempotent

**Category**: Idempotency
**Setup**: Construct `SesStack`. Create a single `iam.Role`.
**Action**: Call `stack.ses.grantSendEmail(role)` twice with the same role.
**Expected**: `Template.fromStack()` produces exactly one `AWS::IAM::Policy`
containing `ses:SendEmail` and `ses:SendTemplatedEmail` for that role — not
two duplicated policy statements. CDK's `Grant` deduplication must handle this.
**Why it matters**: Downstream Lambda construct authors may call
`grantSendEmail` during construct initialization and again in a helper method
without checking whether the grant already exists. Duplicate policy statements
are harmless in IAM but produce noisy CloudFormation diffs and make test
assertions fragile.

---

### TC-008: grantSendEmail called on two different grantees produces two separate policies

**Category**: Authorization
**Setup**: Construct `SesStack`. Create two `iam.Role` objects: `roleA` and `roleB`.
**Action**: Call `stack.ses.grantSendEmail(roleA)` and `stack.ses.grantSendEmail(roleB)`.
**Expected**: Two separate `AWS::IAM::Policy` resources exist — each scoped to its
respective role. Neither policy's principal includes the other role.
**Why it matters**: IAM grants must not merge principals. If `Grant.add()` adds
both roles to a single policy statement it would grant roleA the ability to
send email even after roleB is removed, and vice versa.

---

### TC-009: IAM grant Resource is the identity ARN, not a wildcard

**Category**: Authorization
**Setup**: Synthesize stack; call `grantSendEmail` on a test role.
**Action**: Locate the `AWS::IAM::Policy` that contains `ses:SendEmail` in the
synthesized template. Inspect the `Resource` field.
**Expected**: `Resource` is a specific ARN referencing the `AWS::SES::EmailIdentity`
logical resource — not `"*"`. The ARN must not contain a wildcard segment.
**Why it matters**: An over-broad IAM policy would allow the Lambda to send
email from any SES identity in the account, including identities belonging to
other products or workloads that happen to be in the same AWS account.

---

### TC-010: ses:SendRawEmail is not granted

**Category**: Authorization
**Setup**: Call `grantSendEmail` on a test role and synthesize.
**Action**: Enumerate every `Action` value in every IAM policy statement in the
synthesized template.
**Expected**: The string `ses:SendRawEmail` does not appear anywhere.
**Why it matters**: CDK's built-in `emailIdentity.grantSendEmail()` grants
`SendRawEmail` rather than `SendTemplatedEmail`. The custom `grantSendEmail`
method in `SesConstruct` explicitly avoids this. A regression (e.g. switching
to the CDK built-in) would grant raw-email capability, enabling the Lambda to
construct arbitrary email headers and bypass SES template enforcement.

---

### TC-011: SesStack deploys before payment Lambda stack in stage dependency ordering

**Category**: State machine
**Setup**: Inspect `RacePhotosStage` constructor. Examine CDK dependency edges
on the stacks it creates.
**Action**: Synthesize the full stage. Using `cdk-dependency-order` or equivalent,
verify the topological order of stacks in the CloudFormation wave.
**Expected**: `SesStack` has no declared dependency on any Lambda stack.
Conversely, any future payment/download Lambda stack (RS-006, RS-011) that
calls `sesStack.ses.grantSendEmail()` creates a CDK cross-stack dependency
that places `SesStack` earlier in the deployment wave.
**Why it matters**: If a Lambda stack deploys before `SesStack` and calls
`ses:SendTemplatedEmail` before the template exists, the call fails with
`TemplateDoesNotExistException`. The ordering must be implicit via CDK's
dependency tracking, not a manual `addDependency()` call.

---

### TC-012: `local` envName is not a valid target for seed-ssm.sh

**Category**: Input validation
**Setup**: Run `seed-ssm.sh` interactively. When prompted for environments,
observe that the script iterates over `dev qa staging prod`.
**Action**: Confirm `local` is absent from the loop.
**Expected**: `seed-ssm.sh` never writes to `/racephotos/env/local/ses-from-address`
in the TOOLS account SSM. The `local` env is handled exclusively by
`seed-local.sh` against LocalStack.
**Why it matters**: If a developer accidentally runs `seed-ssm.sh` and `local`
were iterated, it would write a parameter to the TOOLS account that has no
corresponding real AWS environment and could confuse `generate-cdk-context.sh`.

---

### TC-013: seed-ssm.sh blank SES address defaults to example.com placeholder and warns

**Category**: Input validation
**Setup**: Run `seed-ssm.sh`. For one environment, press Enter without typing
an address when prompted for the SES from-address.
**Action**: Observe the script output and inspect the SSM parameter written.
**Expected**: Script prints a WARNING message stating the address was left
empty. The parameter `/racephotos/env/{envName}/ses-from-address` is set to
`noreply@example.com` rather than an empty string. The script does not abort.
**Why it matters**: An empty SSM parameter would cause CloudFormation to create
an `EmailIdentity` with an empty string, which AWS would reject with a
`ValidationException`. The placeholder value prevents the deploy from failing
while still being obviously invalid (noreply@example.com is not a real
domain the contributor controls), giving a clear signal to fix it.

---

### TC-014: seed-ssm.sh with invalid AWS profile exits with non-zero status

**Category**: Failure injection
**Setup**: Run `seed-ssm.sh` and enter a profile name that does not exist in
`~/.aws/config`.
**Action**: Observe the script behaviour after the `aws sts get-caller-identity`
call.
**Expected**: Script prints `ERROR: Could not authenticate with profile '...'`
and exits with a non-zero status code. No SSM parameters are written.
**Why it matters**: Without early profile validation a script author could
write all parameters before realizing they targeted the wrong account —
potentially overwriting prod parameters with dev values or vice versa.

---

### TC-015: seed-local.sh is idempotent — re-running does not fail

**Category**: Idempotency
**Setup**: LocalStack running. Run `seed-local.sh` once to completion.
**Action**: Run `seed-local.sh` a second time without restarting LocalStack.
**Expected**: Second run exits 0. No error messages. All SES templates are
re-created with the latest content (delete-then-create pattern). The SSM
parameter `ses-from-address` is overwritten with the same value.
**Why it matters**: `seed-local.sh` is documented as safe to re-run. If
`ses verify-email-identity` or `ssm put-parameter` emits unhandled errors on
the second run, `set -euo pipefail` will abort the entire seed, leaving
downstream resources (DynamoDB, SQS) partially seeded.

---

### TC-016: seed-local.sh when RACEPHOTOS_SES_FROM_ADDRESS is unset

**Category**: Boundary
**Setup**: Unset `RACEPHOTOS_SES_FROM_ADDRESS` from the environment. Run
`seed-local.sh`.
**Action**: Observe which email address is used to verify the SES identity in
LocalStack and written to SSM.
**Expected**: Falls back to `noreply@example.com` (the default in the parameter
expansion `${RACEPHOTOS_SES_FROM_ADDRESS:-noreply@example.com}`). Seed
completes successfully.
**Why it matters**: New contributors who have not yet created `.env.local` must
not encounter a script failure. The fallback ensures the local environment is
usable before the contributor customizes their from-address.

---

### TC-017: seed-local.sh SES template creation succeeds even when LocalStack is slow to start

**Category**: Failure injection
**Setup**: Start LocalStack but do not wait for it to be fully ready before
running `seed-local.sh`.
**Action**: Observe the `wait_for_localstack` loop behaviour.
**Expected**: Script polls up to 30 times with 2-second intervals waiting for
S3 to report `available` or `running`. If SES is available before S3, no
incorrect early exit occurs. If LocalStack does not become ready within 60
seconds, the script exits with a clear error message.
**Why it matters**: The health check only polls for S3 readiness, but SES
seeding happens later in the same script. LocalStack service startup order is
not guaranteed. If S3 becomes ready before SES the script could reach the SES
section while `ses verify-email-identity` is not yet available. The `||
true` guard on each SES call masks this silently — the test validates that the
developer is warned, not that the call silently succeeded-but-did-nothing.

---

### TC-018: SesStack does not produce any resource with a hardcoded email address

**Category**: Input validation
**Setup**: Synthesize `SesStack` with no special overrides (`cdk synth`). Because
`valueForStringParameter` is used, the email address is never embedded in the
synthesized template — only a `AWS::SSM::Parameter::Value<String>` CloudFormation
parameter reference appears.
**Action**: Serialize the synthesized CloudFormation template to JSON. Search
for any string matching `@`.
**Expected**: No hardcoded email addresses appear anywhere in the synthesized
template — not in resource properties, metadata, tags, or outputs.
**Why it matters**: A committed email address in the CDK construct would
expose a contributor's real email in version control, violating the open-source
privacy requirement stated in `CLAUDE.md`.

---

### TC-019: addArnOutput produces a CfnOutput with a non-empty Value

**Category**: Boundary
**Setup**: Synthesize `SesStack` (`cdk synth`). No context injection is needed —
`valueForStringParameter` emits a CloudFormation parameter reference that is
resolved at deploy time.
**Action**: Inspect the `Outputs` section of the synthesized CloudFormation
template for `SesIdentityArn`.
**Expected**: One `CfnOutput` named `SesIdentityArn` exists with a non-empty
`Value` that resolves to the ARN of the created `AWS::SES::EmailIdentity`.
The output has a `Description` field that is non-empty.
**Why it matters**: The output is used by downstream stacks and developers for
debugging. If `emailIdentityArn` is a CDK token that fails to resolve, the
output value will be an unresolved `{"Ref": "..."}` or `{"Fn::GetAtt": ...}`
that has no matching resource — causing a CloudFormation export error.

---

### TC-020: prod config with enableDeletionProtection does not change SES resource behaviour

**Category**: Boundary
**Setup**: Synthesize `SesStack` with `prodConfig` (`enableDeletionProtection: true`).
**Action**: Inspect the synthesized template for `DeletionPolicy` on the
`AWS::SES::EmailIdentity` and `AWS::SES::Template` resources.
**Expected**: `AWS::SES::EmailIdentity` and `AWS::SES::Template` resources have
`DeletionPolicy: Retain` when `enableDeletionProtection` is `true`, or the
CDK does not support `DeletionPolicy` on these resource types — in which case
verify that the construct does not attempt to set it (no silent no-op).
**Why it matters**: Deleting a verified SES identity in prod would break
outbound email for all environments until the identity is re-verified
(including DNS/DKIM propagation). If the prod SES stack is torn down, the
identity should be retained. The current `SesConstruct` does not set
`RemovalPolicy` on either resource — this TC verifies whether that is
intentional or an oversight.

---

### TC-021: SES templates in seed-local.sh match variable names in ses-construct.ts

**Category**: Input validation
**Setup**: Compare the template `HtmlPart` and `TextPart` variable names in
`seed-local.sh` against the corresponding templates in `ses-construct.ts`.
**Action**: For each of the four templates, list the `{{variableName}}` tokens
in the LocalStack seed JSON vs. the CDK construct definition.
**Expected**: Variable names match exactly between seed and construct for all
four templates. No variable present in the CDK construct template is absent
from the LocalStack seed template, and vice versa.
**Why it matters**: The LocalStack seed uses abbreviated HTML to keep the
script compact. If the variable names diverge (e.g. the seed uses
`{{paymentRef}}` while the construct uses `{{paymentReference}}`), local
integration tests written against LocalStack will pass with a variable name
that fails in a real AWS environment — a silent environment gap.

---

### TC-022: `racephotos-runner-purchase-approved` template does not include an expiry statement

**Category**: Input validation
**Setup**: Synthesize the stack and extract the `racephotos-runner-purchase-approved` template.
**Action**: Search `HtmlPart` and `TextPart` for any phrase suggesting the
download link expires (e.g. "expires", "24 hours", "valid for").
**Expected**: Neither part contains any expiry language. Both parts state the
link "works indefinitely".
**Why it matters**: ADR-0002 explicitly notes that the 24-hour TTL is on the
S3 presigned URL (a backend implementation detail), while the `downloadToken`
URL itself does not expire. Expiry language in the template email would
confuse runners who believe their link has expired when it has not, generating
unnecessary re-download requests.

---

### TC-023: Concurrent CDK deployments do not leave orphaned SES templates

**Category**: Concurrency
**Setup**: Simulate two concurrent CloudFormation updates to `SesStack` — one
that is triggered by the pipeline and one triggered manually. Both target the
same template name `racephotos-photographer-claim`.
**Action**: Observe CloudFormation stack update behaviour when two ChangeSet
executions overlap on the same `AWS::SES::Template` resource.
**Expected**: CloudFormation's distributed lock prevents both ChangeSets from
executing simultaneously. The second update queues or fails gracefully with
`UPDATE_ROLLBACK`. No orphaned template with a stale name remains after the
conflict resolves.
**Why it matters**: The `seed-local.sh` script uses delete-then-create to
work around SES's non-idempotent `create-template` API. CloudFormation
handles updates differently. A race between the pipeline and a manual deploy
(disallowed by convention but possible) could leave a template in a deleted
state if the delete succeeds but create fails mid-update.

---

### TC-024: SesConstruct can be instantiated with the `local` envName

**Category**: Boundary
**Setup**: Create an `EnvConfig` with `envName: 'local'` and inject a test
email address via CDK context.
**Action**: Construct `SesStack` with this config. Run `Template.fromStack()`.
**Expected**: Construct instantiates without error. The SSM lookup path used
is `/racephotos/env/local/ses-from-address`. The `EmailIdentity` resource is
created with the injected email.
**Why it matters**: Although `local` is not a pipeline-deployed environment,
contributors running `cdk synth` locally with `RACEPHOTOS_ENV=local` must not
encounter a type error or guard clause that rejects `local` as an `envName`.
The `EnvConfig` type allows `local` and the construct must handle it.

---

### TC-025: `.env.example` documents `RACEPHOTOS_SES_FROM_ADDRESS` with a non-real placeholder

**Category**: Input validation
**Setup**: Read `.env.example` directly.
**Action**: Locate the `RACEPHOTOS_SES_FROM_ADDRESS` entry and inspect its value.
**Expected**: Value is `noreply@example.com` or another RFC 2606 reserved
domain — never a real contributor email. A comment must explain that
`seed-local.sh` reads this variable.
**Why it matters**: `.env.example` is committed to version control. A real
email address here would expose a contributor's personal or business email
in the public repository, violating the open-source privacy requirement.

---

## Risk areas

### Risk 1 — SES template naming without env suffix in shared-account deployments

The construct comment documents that template names carry no `{envName}` suffix
because the assumption is each environment has an isolated AWS account. This
is not enforced anywhere in the CDK code. A contributor who deploys DEV and QA
into the same account (valid for cost-saving in a self-hosted context) will
encounter a silent CloudFormation drift issue: the second stack deployment
overwrites the templates with identical content, masking a naming collision.
TC-004 surfaces the failure mode, but the correct resolution (add env suffix,
or add an explicit guard with a descriptive error) requires a developer decision.
Flag for developer attention before RS-006 is merged.

### Risk 2 — Template variable contract between ses-construct.ts and future Lambda stories

The four templates define an implicit contract: variable names used in
`CfnTemplate` must exactly match the template data keys the calling Lambda
passes to `SendTemplatedEmail`. This contract is entirely untested until RS-006
and RS-011 implement the send calls. If a Lambda story author uses a different
variable name (e.g. `photo_reference` vs `photoReference`, or `download_url`
vs `downloadUrl`), SES will silently render the variable as an empty string —
runners receive emails with blank fields. There are no shared type definitions
or constants coupling the template variable names to the Lambda code at compile
time. Consider introducing a shared constants file in `shared/` (or a TypeScript
types file) before RS-006 is written.

### Risk 3 — RemovalPolicy omission on prod SES identity

`SesConstruct` does not set `RemovalPolicy` on `emailIdentity` or any
`CfnTemplate`. For prod, where `enableDeletionProtection: true`, this means a
CDK stack destroy would delete the verified SES identity, requiring re-verification
(including DKIM DNS propagation, which can take up to 72 hours). The story's ACs
do not mention removal policy for SES resources, and CDK's `ses.EmailIdentity`
L2 construct may not support `RemovalPolicy.RETAIN` directly. This gap is
unspecified and could cause a production outage during a rollback. Requires
clarification before the first prod deploy of SesStack.
