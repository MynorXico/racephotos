# QA Plan: RS-001 — CDK Storage Constructs

## Scope

CDK TypeScript constructs and the LocalStack seed script changed in PR #35:

- `infra/cdk/constructs/photo-storage-construct.ts`
- `infra/cdk/constructs/database-construct.ts`
- `infra/cdk/constructs/processing-pipeline-construct.ts`
- `infra/cdk/stacks/storage-stack.ts`
- `infra/cdk/test/storage-stack.test.ts`
- `scripts/seed-local.sh`

There are no Go Lambda files in this PR. All test cases are CDK assertion tests
(`@aws-cdk/assertions`) except where noted as seed-script tests (manual
shell execution against LocalStack).

---

## Test cases

### TC-001: EnvConfig 'local' is not a valid envName

**Category**: Boundary
**Setup**: `EnvConfig.envName` type is `'dev' | 'qa' | 'staging' | 'prod'` — the string `'local'` is not included.
**Action**: Construct a test fixture with `envName: 'local'` (cast through `as unknown as EnvConfig` if TypeScript rejects it) and call `makeTemplate`.
**Expected**: TypeScript compiler rejects `'local'` at compile time. If runtime instantiation is attempted (e.g. via a loose cast), the CDK construct must not silently produce bucket names ending `-local`.
**Why it matters**: `seed-local.sh` uses `ENV_NAME="local"` and creates `racephotos-raw-local`. If the CDK construct ever accepts `'local'`, a developer deploying to a real AWS account could accidentally match the LocalStack bucket name. The type-level exclusion is the guard; this test confirms it stays in place.

---

### TC-002: photoRetentionDays = 1 (minimum boundary)

**Category**: Boundary
**Setup**: `devConfig` with `photoRetentionDays: 1`.
**Action**: `makeTemplate(config)` — assert lifecycle rule.
**Expected**: Both buckets have `ExpirationInDays: 1`. CDK should not throw or silently omit the rule.
**Why it matters**: `cdk.Duration.days(1)` is valid but should be verified. A value of 0 would be rejected by S3 and should also be tested (TC-003).

---

### TC-003: photoRetentionDays = 0 triggers synthesis error

**Category**: Boundary
**Setup**: `devConfig` with `photoRetentionDays: 0`.
**Action**: Call `makeTemplate(config)` inside `expect(() => makeTemplate(config)).toThrow()`.
**Expected**: CDK or S3 construct validation throws during synth because an expiration of 0 days is not a valid S3 lifecycle value.
**Why it matters**: `EnvConfig` declares `photoRetentionDays: number` — nothing prevents a contributor from setting 0. If CDK silently emits `ExpirationInDays: 0`, CloudFormation deployment will fail with an opaque error. A synth-time guard is far cheaper to debug.

---

### TC-004: Lifecycle rule ID is stable ('expire-objects') across both buckets

**Category**: Boundary
**Setup**: `devConfig`.
**Action**: In the template, find both bucket resources and assert that each `LifecycleConfiguration.Rules[0].Id` equals `'expire-objects'`.
**Expected**: Rule ID is `expire-objects` on both buckets.
**Why it matters**: CloudFormation uses the rule ID to detect drift. If the ID were generated or omitted, an update changing `photoRetentionDays` could cause CloudFormation to create a second rule instead of updating the first, leaving orphan rules that never expire objects.

---

### TC-005: autoDeleteObjects is false when enableDeletionProtection is true

**Category**: Boundary
**Setup**: `prodConfig` (`enableDeletionProtection: true`).
**Action**: Assert that no `AWS::Lambda::Function` resource with a description matching `auto delete objects` exists in the template (CDK adds a custom resource Lambda when `autoDeleteObjects: true`).
**Expected**: The auto-delete Lambda is absent from the prod template.
**Why it matters**: `autoDeleteObjects: !config.enableDeletionProtection` is the intended guard. The existing removal-policy tests only check `DeletionPolicy: Retain`; they do not confirm that the auto-delete Lambda (which could forcibly empty and delete the bucket) is also absent from prod stacks.

---

### TC-006: CloudFront distribution uses REDIRECT_TO_HTTPS viewer protocol policy

**Category**: Boundary
**Setup**: `devConfig`.
**Action**: `t.hasResourceProperties('AWS::CloudFront::Distribution', { DistributionConfig: Match.objectLike({ DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }) }) })`.
**Expected**: Viewer protocol policy is `redirect-to-https`, not `allow-all`.
**Why it matters**: The existing test (TC in the file) only counts that one distribution exists. It never verifies that the distribution enforces HTTPS. A misconfigured distribution would serve watermarked photos over plain HTTP, violating the security intent of serving photos only via CloudFront with HTTPS.

---

### TC-007: CloudFront distribution comment matches racephotos-photos-cdn-{envName}

**Category**: Boundary
**Setup**: `devConfig` and `prodConfig`.
**Action**: Assert `DistributionConfig.Comment` equals `racephotos-photos-cdn-dev` for devConfig and `racephotos-photos-cdn-prod` for prodConfig.
**Expected**: Comments match per AC7.
**Why it matters**: AC7 explicitly names the distribution `racephotos-photos-cdn-{envName}`. The current test suite does not verify this. An operator searching the CloudFront console by comment to identify the right distribution will find nothing if the comment is wrong.

---

### TC-008: S3 bucket notification is scoped to the raw bucket only, not the processed bucket

**Category**: Boundary
**Setup**: `devConfig`.
**Action**: Count how many `Custom::S3BucketNotifications` resources exist and assert that each notification references only the raw bucket's logical ID, not the processed bucket's logical ID.
**Expected**: Exactly one `Custom::S3BucketNotifications` resource, and its `BucketName` property resolves to the raw bucket.
**Why it matters**: If `addEventNotification` were accidentally called on the processed bucket, Rekognition would be re-triggered on watermarked output files, creating an infinite processing loop. The existing test only checks that a `QueueConfiguration` with `s3:ObjectCreated:*` exists — it does not confirm which bucket owns the notification.

---

### TC-009: S3 ObjectCreated notification references the processing queue, not the watermark queue

**Category**: Boundary
**Setup**: `devConfig`.
**Action**: Resolve the `QueueArn` in the `QueueConfigurations` of the `Custom::S3BucketNotifications` resource and assert it matches the ARN of `racephotos-processing`, not `racephotos-watermark`.
**Expected**: The queue destination is `racephotos-processing`.
**Why it matters**: The existing test checks that the event type is `s3:ObjectCreated:*` but never asserts which queue ARN is the destination. Swapping the queues would silently route raw-upload events to the watermark queue, bypassing Rekognition entirely.

---

### TC-010: racephotos-events GSI attribute types are STRING

**Category**: Boundary
**Setup**: `devConfig`.
**Action**: Assert that `photographerId`, `createdAt`, and `status` attribute definitions on `racephotos-events` all have `AttributeType: S`.
**Expected**: All three GSI attributes are STRING.
**Why it matters**: The existing test checks that the GSI index names exist but does not verify attribute types. If a future refactor changed `createdAt` to a NUMBER type, DynamoDB range-key sort semantics would change from lexicographic to numeric, silently breaking date ordering.

---

### TC-011: racephotos-purchases has exactly five GSIs — no more, no fewer

**Category**: Boundary
**Setup**: `devConfig`.
**Action**: Assert `GlobalSecondaryIndexes.length === 5` on the `racephotos-purchases` table resource.
**Expected**: Exactly 5 GSIs.
**Why it matters**: The current test uses `Match.arrayWith(...)` which is a subset match — it will still pass if a sixth (unintended) GSI were added, e.g. due to a copy-paste error from another table. Over-provisioning GSIs affects write amplification on a high-volume purchases table.

---

### TC-012: racephotos-purchases downloadToken-index has no sort key

**Category**: Boundary
**Setup**: `devConfig`.
**Action**: Locate the `downloadToken-index` GSI in the template and assert its `KeySchema` contains exactly one element (HASH only, no RANGE).
**Expected**: No sort key on `downloadToken-index`.
**Why it matters**: The download-token lookup pattern is a point query (one token = one purchase). Adding a sort key is not harmful structurally but it changes the uniqueness guarantee and could mask a future bug where two purchases share a token — a HASH-only GSI would surface duplicates at query time, while a composite key would hide them.

---

### TC-013: racephotos-rate-limits TTL attribute name is exactly 'expiresAt'

**Category**: Boundary
**Setup**: `devConfig`.
**Action**: Assert `TimeToLiveSpecification.AttributeName === 'expiresAt'` on the rate-limits table.
**Expected**: TTL attribute name is `expiresAt`.
**Why it matters**: The redownload-resend Lambda will write an `expiresAt` number attribute. If the CDK TTL config named it anything else (e.g. `expiry`, `ttl`), DynamoDB would not auto-expire items, causing rate-limit keys to accumulate indefinitely. The existing test covers this, but the seed script sets TTL separately via `update-time-to-live` — see TC-020.

---

### TC-014: Processing queue visibility timeout is not inherited by the watermark queue

**Category**: Boundary
**Setup**: `devConfig`.
**Action**: Find the `racephotos-watermark` queue resource and assert its `VisibilityTimeout` is NOT `300` (or assert it takes the SQS default of 30 seconds).
**Expected**: Watermark queue uses the default visibility timeout (30s), not the 5-minute value set on the processing queue.
**Why it matters**: The PR comment correctly documents the 5-minute reasoning (Rekognition headroom). The watermark Lambda has no such requirement. If visibility timeout were accidentally shared at 300s, a failed watermark attempt would delay redelivery to consumers for 5 minutes per failure — compounding latency on high-volume events.

---

### TC-015: DLQ queues have no redrive policy of their own

**Category**: Boundary
**Setup**: `devConfig`.
**Action**: Assert that `racephotos-processing-dlq` and `racephotos-watermark-dlq` do NOT have a `RedrivePolicy` property set.
**Expected**: DLQ resources have no `RedrivePolicy`.
**Why it matters**: A DLQ with its own redrive policy would create a cyclic redelivery chain. Messages would bounce between the DLQ and an unknown queue indefinitely rather than being held for investigation. CDK does not prevent this by default.

---

### TC-016: StorageStack exposes photoStorage, db, and pipeline as public properties

**Category**: Boundary
**Setup**: Instantiate `StorageStack` in a test.
**Action**: Assert that `stack.photoStorage`, `stack.db`, and `stack.pipeline` are all defined (not undefined).
**Expected**: All three properties are set after construction.
**Why it matters**: Downstream Lambda stacks (RS-003+) will reference `storageStack.db.eventsTable.tableName` etc. If a refactor ever moved construct instantiation after the constructor body (e.g. into a late-init method), these references would be undefined at synth time and produce a cryptic CloudFormation error rather than a clear TypeScript error.

---

### TC-017: seed-local.sh is idempotent — second run does not fail

**Category**: Idempotency
**Setup**: LocalStack running (`docker-compose up -d`). Run `bash scripts/seed-local.sh` once to seed all resources.
**Action**: Run `bash scripts/seed-local.sh` a second time immediately, without stopping LocalStack or removing any resources.
**Expected**: Script exits 0. No `set -e` abort due to `ResourceAlreadyExistsException`, `BucketAlreadyOwnedByYou`, or any other idempotency error. All log lines print without error output.
**Why it matters**: AC6 requires idempotency. The script uses `2>/dev/null || true` on most commands to swallow errors. However, if any command has a non-zero exit code that is NOT swallowed (e.g. the Cognito `list-user-pools` call, the TTL `update-time-to-live` call on an already-configured table, or the SQS create with a mismatched attribute), `set -euo pipefail` will abort the script mid-run and leave resources in a partial state.

---

### TC-018: seed-local.sh is idempotent — Cognito pool created only once

**Category**: Idempotency
**Setup**: Run `bash scripts/seed-local.sh` twice.
**Action**: After the second run, call `awslocal cognito-idp list-user-pools --max-results 60` and count pools named `racephotos-users-local`.
**Expected**: Exactly one pool with that name exists.
**Why it matters**: The Cognito block uses a conditional create guarded by `list-user-pools`. The guard compares pool name with a JMESPath query. If LocalStack returns pools in a paginated response and the `--max-results 10` cap is hit, the guard will return `None` even if the pool already exists, creating a duplicate. The hardcoded `--max-results 10` is a potential off-by-one: if more than 10 pools exist in LocalStack (possible if a developer runs the script many times without cleaning up), the target pool could be on page 2 and get created again.

---

### TC-019: seed-local.sh is idempotent — SQS queue attribute update on existing queue

**Category**: Idempotency
**Setup**: Run `bash scripts/seed-local.sh` once. Manually verify `racephotos-processing` exists with `VisibilityTimeout=300`. Run the script a second time.
**Action**: After the second run, call `awslocal sqs get-queue-attributes --queue-url <url> --attribute-names VisibilityTimeout RedrivePolicy`.
**Expected**: `VisibilityTimeout` is still `300` and `RedrivePolicy.maxReceiveCount` is still `3`.
**Why it matters**: SQS `create-queue` with `|| true` skips without error, but the attributes from the first creation remain. This is correct. The risk is the inverse: if a developer changes `VisibilityTimeout` in the script and re-runs it, the existing queue will NOT be updated — the developer will be silently running the old configuration. The script should ideally call `set-queue-attributes` after `create-queue` to enforce the current desired state.

---

### TC-020: seed-local.sh TTL update-time-to-live idempotency

**Category**: Idempotency
**Setup**: Run `bash scripts/seed-local.sh` twice.
**Action**: On the second run, observe whether the `dynamodb update-time-to-live` call on `racephotos-rate-limits` silently succeeds or emits a non-fatal error before the `|| true` swallows it.
**Expected**: Script exits 0. LocalStack may return a validation error on the second call (TTL already enabled with the same attribute name). The `|| true` guard handles this.
**Why it matters**: If LocalStack returns a non-zero exit for re-enabling an already-enabled TTL with the same attribute and the `|| true` is missing or conditional, `set -e` will abort the script. This would be a regression if the guard were accidentally removed during future script edits.

---

### TC-021: seed-local.sh does not create S3 notification wiring

**Category**: Boundary
**Setup**: Run `bash scripts/seed-local.sh` against LocalStack.
**Action**: After seeding, call `awslocal s3api get-bucket-notification-configuration --bucket racephotos-raw-local`.
**Expected**: The response contains no `QueueConfigurations` — the script does not attempt to wire S3 ObjectCreated → SQS.
**Why it matters**: The seed script correctly omits the S3-to-SQS notification (LocalStack notification wiring adds complexity and the processing Lambda is not deployed locally at RS-001 stage). However, if a future contributor adds a seed step that wires the notification, they must also ensure the processing queue URL format matches LocalStack's internal routing, otherwise the notification will fire but fail to deliver silently. This test case documents the known gap for future reference.

---

### TC-022: prodConfig generates bucket names ending in '-prod', not '-dev'

**Category**: Boundary
**Setup**: `prodConfig`.
**Action**: Assert `racephotos-raw-prod` and `racephotos-processed-prod` exist in the template; also assert `racephotos-raw-dev` and `racephotos-processed-dev` are ABSENT.
**Expected**: Only prod-suffixed bucket names appear.
**Why it matters**: The existing tests only check dev bucket names. A regression where `envName` was not propagated to the `PhotoStorageConstruct` (e.g. a hardcoded string in the construct) would not be caught by the existing prod-config tests, which only check `DeletionPolicy`.

---

### TC-023: EnvConfig 'local' exclusion from type is consistent with seed script ENV_NAME

**Category**: Boundary
**Setup**: Inspect `types.ts` EnvConfig union and `seed-local.sh` ENV_NAME variable.
**Action**: Verify that `'local'` is absent from `EnvConfig.envName` union AND that seed-local.sh hardcodes `ENV_NAME="local"` — intentionally diverging from CDK.
**Expected**: The divergence is intentional and documented (seed-local uses `local`; CDK does not). No CDK construct must ever be instantiated with `envName: 'local'`.
**Why it matters**: The test fixture in `storage-stack.test.ts` uses `domainName: 'none'` and `certificateArn: 'none'`, which are valid for the `EnvConfig` type but do not exist on the CLAUDE.md-described `EnvConfig` (CLAUDE.md shows the interface without those fields). This inconsistency between CLAUDE.md and actual `types.ts` could confuse contributors. The test fixture should be the canonical reference — confirm the test file's `EnvConfig` fixture matches `types.ts`.

---

### TC-024: HTTPS-only enforcement on the raw bucket (no public GET via S3 URL)

**Category**: Boundary
**Setup**: `devConfig`.
**Action**: Assert that no `AWS::S3::BucketPolicy` resource exists with a principal of `*` or allows `s3:GetObject` without a condition requiring `aws:SecureTransport` or limiting to the OAI principal.
**Expected**: Raw bucket policy either does not exist (relying on BlockPublicAccess alone) or contains no wildcard `s3:GetObject` grants.
**Why it matters**: Domain rule 7 states the raw bucket is never publicly accessible. `blockPublicAccess: BLOCK_ALL` prevents public-access policies, but an IAM-authenticated wildcard principal grant (e.g. `Principal: { AWS: '*' }`) would still be blocked at the policy level. The test confirms no such policy is emitted.

---

### TC-025: OAI is created and attached to the processed bucket, not the raw bucket

**Category**: Boundary
**Setup**: `devConfig`.
**Action**: Find the `AWS::CloudFront::CloudFrontOriginAccessIdentity` resource and trace its reference into the `AWS::S3::BucketPolicy` to confirm it is attached to the processed bucket, not the raw bucket.
**Expected**: OAI grants `s3:GetObject` on the processed bucket only. Raw bucket has no OAI-based policy.
**Why it matters**: CDK's `S3Origin` automatically creates both an OAI and a bucket policy. If `S3Origin` were accidentally given the raw bucket, the raw bucket would receive a policy granting the CloudFront OAI read access — directly contradicting domain rule 7 (raw bucket is Lambda execution role only).

---

### TC-026: No hardcoded account ID or region appears in synthesized template

**Category**: Boundary
**Setup**: `devConfig` (account: '123456789012', region: 'us-east-1').
**Action**: Convert the template to JSON and assert that the string `'123456789012'` does not appear in any resource property value (only in `Fn::AccountId`-style pseudo-parameters). Also assert `'us-east-1'` does not appear as a hardcoded string in resource names or ARN strings.
**Expected**: No hardcoded account IDs or region strings in resource properties.
**Why it matters**: CLAUDE.md prohibits hardcoded infrastructure values. CDK normally resolves account and region via tokens, but a developer who writes an explicit ARN string (e.g. for an SQS policy) could accidentally embed the test account ID `123456789012` into the template. This test is a lint-level guard.

---

### TC-027: storageStack.photoStorage.cdnDomainName is a non-empty string after construction

**Category**: Boundary
**Setup**: Instantiate `StorageStack` with `devConfig`.
**Action**: Assert `stack.photoStorage.cdnDomainName` is a non-empty string (it will be a CloudFormation token in tests, but it must not be undefined or empty string).
**Expected**: `cdnDomainName` is a token string like `${Token[CloudFront.DomainName.0]}`.
**Why it matters**: Downstream Lambda constructs (RS-003+) will pass `stack.photoStorage.cdnDomainName` as a Lambda environment variable value. If the property were undefined, the Lambda env var would be set to the string `"undefined"` — a silent misconfiguration that would not be caught until runtime.

---

## Risk areas

### Risk 1: seed-local.sh SQS `create-queue` does not update existing queue attributes

The script calls `sqs create-queue` with attributes (`VisibilityTimeout`, `RedrivePolicy`) but suppresses errors with `|| true`. If the queue already exists, the create is silently skipped and the existing attributes are NOT updated. A developer who changes the `VisibilityTimeout` from 300 to a different value in the script and re-runs it will not see the update take effect. This gap is not detectable by the CDK unit tests (which test CloudFormation synthesis, not LocalStack state). Needs developer attention: consider adding a `sqs set-queue-attributes` call after each `create-queue` to enforce current desired state on subsequent runs.

### Risk 2: S3 ObjectCreated notification bucket identity is not verified by any existing test

TC-008 and TC-009 above flag this: the existing test (`TC` in the test file) confirms a `QueueConfiguration` with `s3:ObjectCreated:*` exists but does not verify which bucket the notification is attached to or which queue ARN is the target. Since `StorageStack` wires the notification with a direct object reference (`rawBucket.addEventNotification(..., processingQueue)`), a refactor that swaps the queue reference would not be caught by the existing assertions. This is the highest-impact regression scenario: raw uploads would silently be routed to the watermark queue, bypassing Rekognition for every photo.

### Risk 3: EnvConfig 'local' exclusion is enforced only at the TypeScript type level, not at runtime

`EnvConfig.envName` is a union of `'dev' | 'qa' | 'staging' | 'prod'`. There is no runtime guard. A contributor using a JavaScript-based CDK invocation (no type checking) or a CDK Pipeline that loads config from SSM and passes an unexpected string could instantiate constructs with `envName: 'local'`, producing bucket names like `racephotos-raw-local` that collide with LocalStack seed resources on a real AWS account. An explicit `if (!['dev','qa','staging','prod'].includes(config.envName)) throw new Error(...)` guard in the construct constructor would catch this at synth time regardless of the calling language.
