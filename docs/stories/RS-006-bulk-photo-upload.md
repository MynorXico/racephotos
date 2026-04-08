# Story: Bulk photo upload — batch presign + upload UI

**ID**: RS-006
**Epic**: Photo Upload / Frontend
**Status**: done
**Has UI**: yes

## Context

After creating an event (RS-005), the photographer uploads photos in bulk via drag-and-drop (Journey 1, steps 3–4). Each uploaded photo goes directly to the private S3 raw bucket via a presigned PUT URL — the Lambda generates the URLs but never touches the photo bytes. Upload happens in batches of 100 with 5 concurrent S3 PUTs per batch.

## Acceptance criteria

- [ ] AC1: Given `POST /events/{eventId}/photos/presign` is called with a valid Cognito JWT and `{ photos: [{filename, contentType, size}] }` (max 100 items), when the caller owns the event, then for each photo: a UUID photoId is generated, a Photo record is created in DynamoDB with `status="uploading"`, `rawS3Key="{envName}/{eventId}/{photoId}/{filename}"`, `eventId`, `uploadedAt`, and a presigned S3 PUT URL (15-minute TTL) is returned. Response: `{ photos: [{photoId, presignedUrl}] }`.
- [ ] AC2: Given the request exceeds 100 items, then a 400 error is returned.
- [ ] AC3: Given the caller does not own the event, then a 403 error is returned.
- [ ] AC9: Given the `eventId` does not exist in DynamoDB, then a 404 error is returned.
- [ ] AC4: Given a photographer visits `/photographer/events/{id}/upload`, then a drag-and-drop zone is shown accepting JPEG and PNG files.
- [ ] AC5: Given the photographer drops or selects files, when upload begins, then files are chunked into batches of 100, each batch requests presigned URLs, and S3 PUTs are performed with max 5 concurrent uploads.
- [ ] AC6: Given uploads are in progress, then a progress indicator shows "X of N photos uploaded" updating in real time.
- [ ] AC7: Given all uploads complete successfully, then a success message is shown with a link to "View photos" (→ `/photographer/events/{id}/photos`).
- [ ] AC8: Given one or more uploads fail, then the failed files are listed with a "Retry" button for each.
- [ ] AC10: Given the request contains a photo with a `contentType` that is not `image/jpeg` or `image/png`, then a 400 error is returned. (This allowlist will be extended by RS-015 when RAW/HEIC/TIFF support ships.)

## Out of scope

- Photo processing (triggered automatically by S3 ObjectCreated → SQS — RS-007)
- Duplicate detection (v2)
- Video files

## Tech notes

- New Lambda module: `lambdas/presign-photos/`
  - Route: `POST /events/{eventId}/photos/presign`, Cognito JWT required
- Interfaces:
  ```go
  type S3Presigner interface {
      PresignPutObject(ctx context.Context, bucket, key, contentType string, ttl time.Duration) (string, error)
  }
  type PhotoStore interface {
      BatchCreatePhotos(ctx context.Context, photos []models.Photo) error
  }
  ```
- New model: `shared/models/photo.go`
  ```go
  type Photo struct {
      ID                    string   `dynamodbav:"id"`
      EventID               string   `dynamodbav:"eventId"`
      BibNumbers            []string `dynamodbav:"bibNumbers"`
      Status                string   `dynamodbav:"status"` // "uploading"|"processing"|"indexed"|"review_required"|"error"
      RawS3Key              string   `dynamodbav:"rawS3Key"`
      WatermarkedS3Key      string   `dynamodbav:"watermarkedS3Key"`
      RekognitionConfidence float64  `dynamodbav:"rekognitionConfidence"`
      CapturedAt            string   `dynamodbav:"capturedAt"`
      UploadedAt            string   `dynamodbav:"uploadedAt"`
  }
  ```
- DynamoDB: `BatchWriteItem` for batch-creating Photo records — max 25 items per call, so a batch of 100 requires 4 sequential or parallel calls; the `BatchCreatePhotos` interface implementation is responsible for chunking
- Note: `status="uploading"` is a new state introduced by this story, extending the four states defined in PRODUCT_CONTEXT.md; RS-007 transitions it to `"processing"` when the S3 ObjectCreated message is received
- S3 presigned PUT: use AWS SDK v2 `s3.PresignClient.PresignPutObject` — pure local crypto, no S3 API call at presign time
- New env vars:
  ```
  RACEPHOTOS_ENV              required — "local"|"dev"|"qa"|"staging"|"prod"
  RACEPHOTOS_RAW_BUCKET       required — S3 bucket for original uploads
  RACEPHOTOS_PHOTOS_TABLE     required — DynamoDB photos table name
  RACEPHOTOS_EVENTS_TABLE     required — DynamoDB events table name (ownership check)
  ```
- CDK: add Lambda + route to `PhotoStorageConstruct` or new `PhotoUploadConstruct`; grant `s3:PutObject` on raw bucket and `dynamodb:BatchWriteItem` on photos table; `dynamodb:GetItem` on events table for ownership check; wrap Lambda with `ObservabilityConstruct`
- Angular:
  - `src/app/features/photographer/event-upload/event-upload.component.ts` — drag-and-drop zone using Angular CDK `DragDrop` or native `dragover`/`drop` events; accepts `image/jpeg` and `image/png` only
  - HTTP calls are made inside NgRx Effects (ADR-0005 — component must not call HTTP directly): the presign API call uses `HttpClient` in an Effect; S3 PUT uploads use `XMLHttpRequest` (not `fetch`) inside an Effect to enable `progress` event tracking piped back to the store
  - Concurrency control: semaphore of 5 — never dispatch more than 5 simultaneous S3 PUTs
  - NgRx slice: `store/photo-upload/` (see ADR-0005) — state shape: `{ total: number, uploaded: number, failed: File[], inProgress: boolean }`
  - Storybook: one story per component state — `idle` (empty drop zone), `uploading` (progress bar with X of N), `partial-failure` (failed files listed with Retry), `complete` (success message with View photos link)
- `.env.example`: add `RACEPHOTOS_RAW_BUCKET`, `RACEPHOTOS_PHOTOS_TABLE`, and `RACEPHOTOS_EVENTS_TABLE`

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

### UI stories only

- [ ] Angular component compiles with `ng build --aot` (zero errors, zero warnings)
- [ ] Angular unit tests pass (`ng test --watch=false --code-coverage`)
  - Component logic: >80% line coverage
- [ ] Storybook story written for every new component (`*.stories.ts`)
- [ ] `npx storybook build` passes (no broken renders)
- [ ] Playwright E2E test written covering all acceptance criteria
- [ ] Playwright test passes against local dev server (`npx playwright test`)
- [ ] Playwright screenshot snapshot committed (visual baseline)
- [ ] Responsive layout verified at 375px (mobile) and 1280px (desktop) via Playwright
