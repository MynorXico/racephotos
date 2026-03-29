# Story: CDK storage constructs

**ID**: RS-001
**Epic**: Infrastructure
**Status**: ready
**Has UI**: no

## Context

All Lambda functions need S3 buckets, DynamoDB tables, and SQS queues before any product code can run. This story provisions the foundational storage and messaging layer via CDK constructs. Nothing is deployed until `RacePhotosStage` wires these constructs in. This is a pure infrastructure enabler with no business logic.

## Acceptance criteria

- [ ] AC1: Given a CDK synth runs for any environment, when `PhotoStorageConstruct` is instantiated, then two S3 buckets are created: `racephotos-raw-{envName}` (private, block all public access) and `racephotos-processed-{envName}` (private, served via CloudFront OAC), each with a lifecycle rule that expires objects after `config.photoRetentionDays` days and removal policy driven by `config.enableDeletionProtection`.
- [ ] AC2: Given a CDK synth runs, when `DatabaseConstruct` is instantiated, then six DynamoDB tables are created with ON_DEMAND billing, explicit names, and removal policy driven by `config.enableDeletionProtection`:
  - `racephotos-events`: PK=`id`, GSI `photographerId-createdAt-index` (PK: photographerId, SK: createdAt), GSI `status-createdAt-index` (PK: status, SK: createdAt)
  - `racephotos-photos`: PK=`id`, GSI `eventId-uploadedAt-index` (PK: eventId, SK: uploadedAt)
  - `racephotos-bib-index`: PK=`bibKey` (format: `{eventId}#{bibNumber}`), SK=`photoId`, GSI `photoId-index` (PK: photoId) — supports multi-bib lookup and retag cleanup
  - `racephotos-purchases`: PK=`id`, GSI `photoId-claimedAt-index` (PK: photoId, SK: claimedAt), GSI `runnerEmail-claimedAt-index` (PK: runnerEmail, SK: claimedAt), GSI `downloadToken-index` (PK: downloadToken), GSI `photoId-runnerEmail-index` (PK: photoId, SK: runnerEmail) — for purchase idempotency lookup in create-purchase
  - `racephotos-photographers`: PK=`id`
  - `racephotos-rate-limits`: PK=`rateLimitKey` (format: `REDOWNLOAD#{email}`), TTL attribute `expiresAt` — used by redownload-resend Lambda for per-email rate limiting
- [ ] AC3: Given a CDK synth runs, when `ProcessingPipelineConstruct` is instantiated, then two SQS queues are created each with their own DLQ (maxReceiveCount: 3): `racephotos-processing` + `racephotos-processing-dlq` and `racephotos-watermark` + `racephotos-watermark-dlq`. Processing queue visibility timeout is 5 minutes (to allow Rekognition time).
- [ ] AC4: Given an object is PUT to the raw S3 bucket, when the S3 ObjectCreated event fires, then a message is delivered to the processing SQS queue.
- [ ] AC5: Given `cdk synth` runs, then `cdk synth` passes with zero errors and zero warnings.
- [ ] AC6: Given `scripts/seed-local.sh` runs against LocalStack, then all six DynamoDB tables, both S3 buckets, and all four SQS queues (processing + DLQ + watermark + DLQ) are created idempotently.
- [ ] AC7: Given a CDK synth runs, then `PhotoStorageConstruct` creates a CloudFront distribution `racephotos-photos-cdn-{envName}` in front of the processed S3 bucket using OAC. The distribution domain name is exposed as a construct output for Lambda environment variable injection.

## Out of scope

- Lambda functions (added per story from RS-004 onwards)
- Cognito and API Gateway (RS-002)
- SES (RS-003)
- CloudFront distribution for the Angular frontend (already handled by `FrontendConstruct` from PR7 — the processed bucket served by this story's distribution is a separate concern)

## Tech notes

- New construct files:
  - `infra/cdk/constructs/photo-storage-construct.ts`
  - `infra/cdk/constructs/database-construct.ts`
  - `infra/cdk/constructs/processing-pipeline-construct.ts`
- `infra/cdk/stages/racephotos-stage.ts` must wire all three constructs
- S3 ObjectCreated → SQS: use `s3.Bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.SqsDestination(processingQueue))`
- DLQ alarms: use `ObservabilityConstruct` (PR8) on the DLQ queues — pass `dlq` prop
- `seed-local.sh` must be updated to mirror all resources: `aws --endpoint-url=http://localhost:4566 sqs create-queue`, `dynamodb create-table`, `s3 mb`
- No new env vars (infra-only story; env vars added per Lambda story)
- `EnvConfig` does not change in this story

## Definition of Done

### All stories

- [ ] Interface written before implementation
- [ ] Table-driven unit tests written before implementation
- [ ] Unit tests pass (`make test-unit`)
- [ ] Integration test written with `//go:build integration` tag
- [ ] Integration test passes against LocalStack (`make test-integration`)
- [ ] CDK construct updated and `cdk synth` passes
- [ ] `environments.example.ts` updated if new config key added
- [ ] `.env.example` updated if new env var added
- [ ] ADR written for any non-obvious architectural decision
- [ ] Story status set to `done`
