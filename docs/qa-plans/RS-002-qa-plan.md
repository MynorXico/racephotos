# QA Plan: RS-002 — CDK Cognito + API Gateway Constructs

## Scope

CDK TypeScript constructs and stacks under review:

- `infra/cdk/constructs/cognito-construct.ts` — Cognito User Pool + User Pool Client
- `infra/cdk/constructs/api-construct.ts` — HTTP API Gateway, JWT authorizer, SSM parameter
- `infra/cdk/stacks/auth-stack.ts` — AuthStack composition
- `infra/cdk/constructs/frontend-construct.ts` — config.json injection (cognitoConfig + apiBaseUrl props)
- `infra/cdk/stages/racephotos-stage.ts` — cross-stack wiring of AuthStack outputs into FrontendStack
- `scripts/seed-local.sh` — LocalStack Cognito idempotency

No Lambda functions are in scope. Tests are CDK unit tests (jest + `@aws-cdk/assertions`) and
shell-script verification unless stated otherwise.

---

## Test cases

### TC-001: User Pool removal policy is RETAIN when enableDeletionProtection is true

**Category**: Boundary
**Setup**: Instantiate `AuthStack` with `prodConfig` (`enableDeletionProtection: true`).
**Action**: Call `Template.fromStack(stack)` and inspect the `AWS::Cognito::UserPool` resource's
`DeletionPolicy` and `UpdateReplacePolicy` CloudFormation attributes.
**Expected**: Both are `"Retain"`. The existing test suite asserts resource _properties_ but does
not assert deletion policy on the User Pool resource itself.
**Why it matters**: A misconfigured removal policy on a prod User Pool would silently destroy
all photographer accounts on the next `cdk deploy --force` stack replacement. This is the highest
blast-radius misconfiguration in the whole story.

---

### TC-002: User Pool removal policy is DELETE when enableDeletionProtection is false

**Category**: Boundary
**Setup**: Instantiate `AuthStack` with `devConfig` (`enableDeletionProtection: false`).
**Action**: Inspect `AWS::Cognito::UserPool` `DeletionPolicy` attribute.
**Expected**: `"Delete"` (CDK default when `RemovalPolicy.DESTROY` is applied).
**Why it matters**: Confirms the removal policy branch is exercised in both directions and that
a dev deployment can be cleanly torn down.

---

### TC-003: JWT authorizer issuer URL uses the stack region, not a hardcoded region string

**Category**: Boundary / Misconfiguration
**Setup**: Synthesize `AuthStack` in a stack with a non-default region (e.g. `eu-west-1`).
Construct `devConfig` with `region: 'eu-west-1'` and pass it to `new cdk.App()` with
`env: { region: 'eu-west-1' }`.
**Action**: Inspect the `AWS::ApiGatewayV2::Authorizer` resource's `JwtConfiguration.Issuer`
property.
**Expected**: The issuer URL contains `eu-west-1`, not a hardcoded region. Because
`cdk.Stack.of(this).region` is used, the synthesized value should be the stack region token.
Verify no literal region string is baked in.
**Why it matters**: A hardcoded region in the issuer URL would cause JWT validation to fail
silently in every environment except the one the developer tested against — a cross-region deploy
bug that is invisible at synth time.

---

### TC-004: JWT authorizer audience is exactly the client ID from CognitoConstruct (no extras, no missing)

**Category**: Input validation
**Setup**: Synthesize `AuthStack` with `devConfig`.
**Action**: Find the `AWS::ApiGatewayV2::Authorizer` resource. Inspect `JwtConfiguration.Audience`.
**Expected**: Array contains exactly one entry — the `Ref` (or resolved token) of the
`AWS::Cognito::UserPoolClient`. No placeholder strings, no extra entries.
**Why it matters**: If the audience list is wrong (empty, contains a hardcoded placeholder, or
contains extra entries) every authenticated API call returns 401. This is not covered by the
existing test suite.

---

### TC-005: ALLOW_USER_SRP_AUTH is included in the User Pool Client auth flows

**Category**: Input validation
**Setup**: Synthesize `AuthStack` with `devConfig`.
**Action**: Inspect `AWS::Cognito::UserPoolClient` `ExplicitAuthFlows`.
**Expected**: Array contains `ALLOW_USER_SRP_AUTH`. The story AC2 specifies
`ALLOW_USER_PASSWORD_AUTH` and `ALLOW_REFRESH_TOKEN_AUTH`, but ADR-0007 states
Amplify uses `USER_SRP_AUTH` as its default (password never sent in plaintext).
The implementation in `cognito-construct.ts` sets `userSrp: true` — this must
appear in the synthesized CloudFormation.
**Why it matters**: If `ALLOW_USER_SRP_AUTH` is absent, all Amplify `signIn()` calls
fail at runtime with `NotAuthorizedException`. The existing test only checks for
`ALLOW_USER_PASSWORD_AUTH` and `ALLOW_REFRESH_TOKEN_AUTH` — `ALLOW_USER_SRP_AUTH`
is untested.

---

### TC-006: CORS AllowOrigins is a single-element array containing the exact custom domain (no trailing slash)

**Category**: Input validation
**Setup**: Synthesize `AuthStack` with `prodConfig` where `domainName: 'app.example.com'`.
**Action**: Inspect `AWS::ApiGatewayV2::Api` `CorsConfiguration.AllowOrigins`.
**Expected**: `['https://app.example.com']` — exactly one entry, no trailing slash, no wildcard.
**Why it matters**: A trailing slash (`https://app.example.com/`) or a wildcard leak would either
break CORS preflight for all API calls or expose the API to cross-origin abuse. The existing test
checks for `['https://app.example.com']` but does not verify the array has exactly one element —
a multi-entry array could pass `Match.arrayWith` while also containing `'*'`.

---

### TC-007: CORS AllowOrigins is `['*']` when domainName is `'none'` (dev/local path)

**Category**: Boundary
**Setup**: Synthesize `AuthStack` with `devConfig` (`domainName: 'none'`).
**Action**: Inspect `AWS::ApiGatewayV2::Api` `CorsConfiguration.AllowOrigins`.
**Expected**: Exactly `['*']`. Covered by an existing test, but add an assertion that the array
length is 1 to guard against accidental multi-origin injection.
**Why it matters**: If wildcard and a domain are both present in any environment, the CORS
behavior is undefined per browser implementations and may fail preflight silently.

---

### TC-008: domainName with a `dummy-value-for-` prefix during first pipeline synth does not produce an active custom domain

**Category**: Misconfiguration
**Setup**: Instantiate `AuthStack` with a config where
`domainName: 'dummy-value-for-/racephotos/env/dev/domain-name'` and
`certificateArn: 'dummy-value-for-/racephotos/env/dev/certificate-arn'`.
**Action**: Synthesize and inspect `AWS::ApiGatewayV2::Api` `CorsConfiguration.AllowOrigins`.
**Expected**: Because `ApiConstruct` checks `config.domainName !== 'none'` but does NOT check for
the `dummy-value-for-` prefix (unlike `FrontendConstruct`), the CORS origin will be set to
`['https://dummy-value-for-/racephotos/env/dev/domain-name']` on the first synth pass. This is
a **defect to flag** — `ApiConstruct` needs the same dummy-value guard that `FrontendConstruct` has.
**Why it matters**: On the first pipeline synth pass, an invalid origin string will be
deployed to API Gateway, breaking all CORS preflight until the pipeline self-mutates on the
second pass. This creates a broken deploy window.

---

### TC-009: config.json written to S3 contains no placeholder strings when cognitoConfig is supplied

**Category**: Input validation
**Setup**: Synthesize `FrontendStack` (via a test app with Angular dist present, or by stubbing
`hasRealEnv`/`hasAngularDist` to both be `true`) with real values:
`cognitoConfig: { userPoolId: 'us-east-1_ABCDEFG', clientId: 'abc123', region: 'us-east-1' }`,
`apiBaseUrl: 'https://xyz.execute-api.us-east-1.amazonaws.com'`.
**Action**: Inspect the `AWS::Lambda::Function` for the BucketDeployment custom resource handler.
Find the source asset that represents the JSON data. Verify the resolved JSON object contains the
supplied values, not `'REPLACE_WITH_USER_POOL_ID'`, `'REPLACE_WITH_CLIENT_ID'`,
`'REPLACE_WITH_REGION'`, or `'https://REPLACE_WITH_API_URL'`.
**Expected**: All four fields (`cognitoUserPoolId`, `cognitoClientId`, `cognitoRegion`,
`apiBaseUrl`) contain the injected values.
**Why it matters**: AC4 and AC6 both require no placeholders in the deployed config.json. If the
optional props fall through to defaults, the Angular app boots with placeholder config and all
Amplify auth calls fail with `ResourceNotFoundException`.

---

### TC-010: config.json placeholder defaults are used when cognitoConfig prop is omitted

**Category**: Boundary
**Setup**: Instantiate `FrontendConstruct` without passing `cognitoConfig` (prop is `undefined`).
**Action**: Inspect the resolved `Source.jsonData` arguments for `cognitoUserPoolId`.
**Expected**: Value is `'REPLACE_WITH_USER_POOL_ID'` — the default from the nullish coalescing
fallback. This is intentional pre-RS-002 behavior and must be preserved.
**Why it matters**: Removing or changing the fallback would cause pre-wired deployments (contributors
who have not yet run RS-002) to synthesize with `undefined` in config.json, which is worse than
a clearly named placeholder.

---

### TC-011: SSM parameter value is the API Gateway endpoint, not an unresolved CDK token

**Category**: Misconfiguration
**Setup**: Synthesize `AuthStack` with `devConfig`.
**Action**: Find `AWS::SSM::Parameter` with `Name: '/racephotos/env/dev/api-url'`. Inspect `Value`.
**Expected**: The `Value` must be a `Fn::GetAtt` or `Ref` pointing to the `AWS::ApiGatewayV2::Api`
resource — it must not be the literal string `"undefined"` or any other unresolved token.
`this.httpApi.apiEndpoint` resolves to a CloudFormation intrinsic at synth time; verify the
template uses the intrinsic, not a static placeholder.
**Why it matters**: If `apiEndpoint` is accidentally resolved to a stale or undefined string,
the SSM parameter contains garbage and the pipeline's config.json injection silently produces
a broken `apiBaseUrl`.

---

### TC-012: SSM parameter name uses envName, not a hardcoded environment string

**Category**: Input validation
**Setup**: Synthesize `AuthStack` with a `qaConfig` fixture (`envName: 'qa'`).
**Action**: Inspect `AWS::SSM::Parameter` `Name`.
**Expected**: `'/racephotos/env/qa/api-url'`. Covered partially by an existing test for `prod`,
but the test suite only checks `dev` and `prod` — add `qa` and `staging` to catch any
interpolation bug.
**Why it matters**: An incorrect SSM path would cause the pipeline to read the wrong parameter,
injecting a different environment's API URL into the Angular config.json.

---

### TC-013: Only one SSM parameter is created per AuthStack instantiation

**Category**: Boundary
**Setup**: Synthesize `AuthStack` with `devConfig`.
**Action**: Call `template.resourceCountIs('AWS::SSM::Parameter', 1)`.
**Expected**: Exactly 1 SSM parameter.
**Why it matters**: If a refactor accidentally creates the parameter twice (e.g. in both
`ApiConstruct` and `AuthStack`), CloudFormation will fail the deployment with a duplicate
logical ID error.

---

### TC-014: AuthStack exports (cognito.userPoolId, cognito.clientId, cognito.region, api.apiUrl) are all resolved strings, not empty

**Category**: Boundary
**Setup**: Instantiate `AuthStack` in a test app with `devConfig`.
**Action**: Assert that `stack.cognito.userPoolId`, `stack.cognito.userPoolArn`,
`stack.cognito.clientId`, `stack.cognito.region`, and `stack.api.apiUrl` are all truthy
(non-empty, non-undefined, non-null) strings.
**Expected**: All five are non-empty strings (CDK token strings are acceptable — they must not
be empty `''` or `undefined`).
**Why it matters**: `RacePhotosStage` passes these outputs directly into `FrontendStack`.
An empty string would silently produce an invalid config.json without any synth error.

---

### TC-015: CognitoConstruct.region equals the stack region, not a hardcoded string

**Category**: Misconfiguration
**Setup**: Synthesize `AuthStack` in a stack with `region: 'ap-southeast-1'`.
**Action**: Compare `stack.cognito.region` against the stack's region token.
**Expected**: `stack.cognito.region === cdk.Stack.of(authStack).region` — they are the same
token. The implementation uses `cdk.Stack.of(this).region`, which is correct, but this
should be explicitly asserted.
**Why it matters**: If a contributor accidentally replaces the stack region lookup with
`config.region`, they introduce a hardcoded string that violates the open-source config
philosophy and causes Amplify to point at the wrong Cognito endpoint in cross-region deployments.

---

### TC-016: seed-local.sh is idempotent — second run with existing pool does not create a duplicate

**Category**: Idempotency
**Setup**: LocalStack running. Run `bash scripts/seed-local.sh` once to completion.
**Action**: Run `bash scripts/seed-local.sh` a second time without resetting LocalStack state.
**Expected**: Script exits with code 0. Exactly one User Pool named `racephotos-photographers`
exists (verified with `awslocal cognito-idp list-user-pools --max-results 60`). Exactly one
app client named `racephotos-photographers-client` exists. No error messages printed to stderr.
**Why it matters**: AC7 explicitly requires idempotency. The existing `list-user-pools` check
guards against duplicate pool creation, but the app client check queries `list-user-pool-clients`
using the pool ID found or retrieved from the first step — if the pool ID lookup returned
`"None"` on the first run and a real ID on the second (race condition or listing pagination),
a duplicate client would be created.

---

### TC-017: seed-local.sh handles a LocalStack Cognito list-user-pools response with more than 10 pools

**Category**: Boundary
**Setup**: Pre-seed LocalStack with 10 or more User Pools with different names so that
`list-user-pools --max-results 10` returns a full page.
**Action**: Run `bash scripts/seed-local.sh`.
**Expected**: The script correctly detects that `racephotos-photographers` does not exist (or
exists among the 10) and creates (or reuses) it. The `--max-results 10` hard limit means that
if there are 11+ pools and `racephotos-photographers` is not in the first page, it will be
missed, causing a duplicate pool creation.
**Why it matters**: This is a latent pagination bug. In a contributor's LocalStack environment
that has been used for multiple test runs without reset, the pool count could exceed 10. The
`--max-results` value should be 60 (Cognito's maximum) or a paginating loop should be used.

---

### TC-018: seed-local.sh prints USER_POOL_ID and CLIENT_ID in the summary block

**Category**: Input validation
**Setup**: Run `bash scripts/seed-local.sh` against a fresh LocalStack instance.
**Action**: Capture stdout and verify the summary block (between the `══` separators) contains
non-empty, non-`"None"` values for `cognitoUserPoolId` and `cognitoClientId`.
**Expected**: Both values are LocalStack-generated IDs (e.g. `us-east-1_XXXXXX` and a UUID-like
client ID), not `"None"`, empty strings, or variable reference literals like `${USER_POOL_ID}`.
**Why it matters**: AC7 requires IDs to be printed. If `USER_POOL_ID` is still `"None"` at
summary time (because the `list-user-pools` query returned `"None"` and the create branch was
not taken due to a quoting issue), the developer gets no valid config to paste into `.env.local`.

---

### TC-019: seed-local.sh Cognito password policy mismatch with CDK construct

**Category**: Misconfiguration
**Setup**: Inspect the `create-user-pool` call in `seed-local.sh` and compare it to
`CognitoConstruct`.
**Action**: Compare `PasswordPolicy` fields in both:

- CDK: `MinimumLength:8, RequireUppercase:true, RequireLowercase:true, RequireNumbers:true, RequireSymbols:true`
- seed-local.sh: `MinimumLength:8, RequireUppercase:false, RequireLowercase:false, RequireNumbers:false, RequireSymbols:false`
  **Expected**: Both should enforce the same policy. Currently they do not — the seed script
  creates a pool with **no character class requirements** while the CDK construct creates one
  with all requirements enabled.
  **Why it matters**: This is a **confirmed defect**. Local integration tests that create test
  users with simple passwords (e.g. `password123`) will succeed locally but fail against any real
  AWS environment. Developers will waste time debugging an environment parity issue. The seed
  script should mirror the CDK password policy exactly.

---

### TC-020: seed-local.sh does not print COGNITO_USER_POOL_ID or COGNITO_CLIENT_ID as .env.local export lines

**Category**: Input validation
**Setup**: Run `bash scripts/seed-local.sh` and capture stdout.
**Action**: Check whether the summary block includes `RACEPHOTOS_COGNITO_USER_POOL_ID` or
equivalent env var export lines alongside the other `RACEPHOTOS_*` variables.
**Expected**: The summary block tells the developer to update `config.json` manually but does
not provide `RACEPHOTOS_*` environment variable lines for the Cognito IDs. Lambda functions
that need Cognito IDs at runtime (e.g. for token verification) would have no `.env.local`
variable to read.
**Why it matters**: Although no Lambda in this story reads Cognito IDs directly (auth is handled
by API Gateway's JWT authorizer), future Lambda stories may need to verify tokens out-of-band.
The missing variable lines are a gap between what seed-local.sh teaches and what
contributors may need. Flag for developer review.

---

### TC-021: RacePhotosStage wires FrontendStack with AuthStack outputs — FrontendStack depends on AuthStack

**Category**: Misconfiguration
**Setup**: Synthesize `RacePhotosStage` with a full config in a CDK app. Inspect the CloudFormation
assembly.
**Action**: Check that `FrontendStack`'s CloudFormation template contains cross-stack references
(`Fn::ImportValue` or SSM parameter reads) pointing to outputs from `AuthStack`, OR that the
stage wiring passes resolved tokens that CDK tracks as cross-stack dependencies.
**Expected**: CDK should add `AuthStack` as a dependency of `FrontendStack` in the stage's
`assembly.stacks` order. Verify that `auth.cognito.userPoolId` passed into `FrontendStack` is
a resolvable token at deploy time, not the unresolved CDK dummy value.
**Why it matters**: If the dependency graph is not established (e.g. if the constructs
use `Fn::ImportValue` but the exports were not declared), CloudFormation will deploy
FrontendStack before AuthStack and fail with an unresolved cross-stack reference.

---

### TC-022: HTTP API has no routes at synth time (routes are added per Lambda story)

**Category**: Boundary
**Setup**: Synthesize `AuthStack` with `devConfig`.
**Action**: Assert that the template contains zero `AWS::ApiGatewayV2::Route` resources.
**Expected**: `template.resourceCountIs('AWS::ApiGatewayV2::Route', 0)`.
**Why it matters**: AC3 explicitly states "no routes (routes added per Lambda story)". If a
default route was accidentally added (e.g. a catch-all `$default` route), it would be deployed
without auth, creating an open endpoint.

---

### TC-023: HTTP API default authorizer type is JWT (not Lambda or IAM)

**Category**: Input validation
**Setup**: Synthesize `AuthStack` with `devConfig`.
**Action**: Find `AWS::ApiGatewayV2::Authorizer` resource. Inspect `AuthorizerType`.
**Expected**: `"JWT"`. The implementation uses `HttpJwtAuthorizer`, which is correct, but
the assertion is missing from the existing test suite.
**Why it matters**: A misconfigured authorizer type (e.g. `REQUEST` for Lambda authorizer) would
pass all requests unauthenticated or fail with a 500-class error, silently breaking auth for
all future Lambda routes without a clear error message.

---

### TC-024: User Pool name does NOT include envName suffix

**Category**: Boundary
**Setup**: Synthesize `AuthStack` with `prodConfig` (`envName: 'prod'`).
**Action**: Inspect `AWS::Cognito::UserPool` `UserPoolName`.
**Expected**: `'racephotos-photographers'` — no `'-prod'` suffix.
**Why it matters**: The CDK construct comment and story tech notes state that Cognito names have
no envName suffix because each environment deploys to an isolated AWS account. If the name
inadvertently includes the envName, it would still work but would diverge from the seed-local.sh
naming convention and the documented pattern, causing confusion for contributors.

---

### TC-025: Synthesizing AuthStack with an `envName` of `'local'` does not throw

**Category**: Boundary
**Setup**: Create a `localConfig` fixture identical to `devConfig` but with `envName: 'local'`.
**Action**: Call `makeTemplate(localConfig)`.
**Expected**: No exception thrown. Template synthesizes successfully. SSM path is
`'/racephotos/env/local/api-url'`.
**Why it matters**: `EnvConfig` permits `'local'` as a valid `envName`. While CDK is not
typically used to deploy to LocalStack, contributors may run `cdk synth` locally for inspection.
If the SSM parameter name or any other string interpolation produces an invalid value for
`envName: 'local'`, it could cause synth errors that are difficult to diagnose.

---

## Risk areas

### Risk 1: `ApiConstruct` lacks the `dummy-value-for-` guard present in `FrontendConstruct`

`FrontendConstruct` explicitly guards against CDK's first-pass dummy values using
`config.certificateArn.startsWith('arn:')`. `ApiConstruct` only checks
`config.domainName !== 'none'` — it has no guard against the `dummy-value-for-` prefix
that CDK substitutes for SSM lookups on the first synth pass. This means the first pipeline
synth will deploy an invalid CORS origin to API Gateway. The developer should add a guard:

```typescript
const hasRealDomain =
  config.domainName !== 'none' && !config.domainName.startsWith('dummy-value-for-');
const corsAllowOrigins = hasRealDomain ? [`https://${config.domainName}`] : ['*'];
```

This is the highest-confidence defect found in this review. See TC-008.

### Risk 2: seed-local.sh Cognito password policy diverges from CDK construct

The `create-user-pool` call in `seed-local.sh` sets all character-class requirements to
`false`, while `CognitoConstruct` sets all to `true`. This breaks environment parity and
will cause false-passing local tests for any integration test that creates a Cognito user
with a simple password. See TC-019.

### Risk 3: `--max-results 10` in seed-local.sh Cognito pool lookup is a pagination trap

If a contributor's LocalStack instance has more than 10 User Pools, `list-user-pools
--max-results 10` will not return `racephotos-photographers` if it appears beyond the
first page, causing a duplicate pool to be created on every subsequent seed run.
The maximum allowed value for `--max-results` in this command is 60. See TC-017.
