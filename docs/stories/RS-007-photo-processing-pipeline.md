# Story: Photo processing pipeline — Rekognition + watermark

**ID**: RS-007
**Epic**: Photo Processing
**Status**: ready
**Has UI**: no

## Context

When a photo lands in the raw S3 bucket, it triggers an async processing pipeline (Journey 1, step 5). The photo-processor Lambda reads bib numbers via Rekognition and indexes them in DynamoDB. It then publishes to the watermark queue where the watermark Lambda applies a text overlay and stores the processed copy. Processing errors surface in DynamoDB (never silently dropped — domain rule 9). Rekognition is called exactly once per photo (domain rule 10).

## Acceptance criteria

- [ ] AC1: Given a photo is PUT to the raw S3 bucket, when the S3 ObjectCreated notification fires, then a message is delivered to the processing SQS queue within 5 seconds.
- [ ] AC2: Given the photo-processor Lambda receives a message, when it runs successfully, then: Rekognition `DetectText` is called once; detected bib numbers above `RACEPHOTOS_CONFIDENCE_MIN` are extracted; the Photo record is updated with `status="indexed"` (bibs found) or `status="review_required"` (no bibs), `bibNumbers`, `rekognitionConfidence`; one BibIndex record per detected bib is written to the bib-index table; a message is published to the watermark SQS queue.
- [ ] AC3: Given Rekognition returns an error, when the Lambda processes the message, then the Photo record is updated with `status="error"` and the error is logged. The message is NOT retried (returned as successfully processed) to prevent billing for known-bad photos.
- [ ] AC4: Given multiple photos are in the SQS batch, when one fails, then only that message is returned in `batchItemFailures` — other messages are processed successfully (partial batch failure pattern).
- [ ] AC5: Given the watermark Lambda receives a message `{ photoId, eventId, rawS3Key, watermarkText }`, when it runs successfully, then: the raw photo is downloaded from the private S3 bucket; a text watermark is drawn onto the image using `github.com/fogleman/gg`; the watermarked copy is stored at `racephotos-processed-{envName}/{envName}/{eventId}/{photoId}/watermarked.jpg`; the Photo record is updated with `watermarkedS3Key`.
- [ ] AC6: Given `RACEPHOTOS_ENV=local`, when the photo-processor Lambda initialises, then a file-backed Rekognition mock is used instead of the real service, reading responses from `testdata/rekognition-responses/{photoId}.json` if present, otherwise returning zero detections.
- [ ] AC7: Given a message exceeds the DLQ `maxReceiveCount` (3), then it moves to the appropriate DLQ and the DLQ CloudWatch alarm fires.

## Out of scope

- Manual bib tagging (RS-013)
- Watermark logo (text-only in v1 — decided: watermark is text overlay only)
- Re-running Rekognition (called exactly once per photo — domain rule 10)

## Tech notes

- New Lambda modules:
  - `lambdas/photo-processor/` — SQS-triggered, event source: processing queue
  - `lambdas/watermark/` — SQS-triggered, event source: watermark queue
- photo-processor parses photoId from S3 key: key format is `{envName}/{eventId}/{photoId}/{filename}` — split on `/` to extract photoId at index 2
- Interfaces (photo-processor):
  ```go
  type TextDetector interface {
      DetectText(ctx context.Context, input *rekognition.DetectTextInput, optFns ...func(*rekognition.Options)) (*rekognition.DetectTextOutput, error)
  }
  type PhotoStore interface {
      GetPhotoByS3Key(ctx context.Context, rawS3Key string) (*models.Photo, error)
      UpdatePhotoStatus(ctx context.Context, id string, update models.PhotoStatusUpdate) error
  }
  type BibIndexStore interface {
      WriteBibEntries(ctx context.Context, entries []models.BibEntry) error
  }
  type WatermarkQueue interface {
      SendWatermarkMessage(ctx context.Context, msg models.WatermarkMessage) error
  }
  ```
- Interfaces (watermark):
  ```go
  type RawPhotoReader interface {
      GetObject(ctx context.Context, bucket, key string) (io.ReadCloser, error)
  }
  type ProcessedPhotoWriter interface {
      PutObject(ctx context.Context, bucket, key string, body io.Reader, contentType string) error
  }
  type ImageWatermarker interface {
      ApplyTextWatermark(img image.Image, text string) (image.Image, error)
  }
  ```
- New model: `shared/models/bib_entry.go`
  ```go
  type BibEntry struct {
      BibKey  string `dynamodbav:"bibKey"`  // "{eventId}#{bibNumber}"
      PhotoID string `dynamodbav:"photoId"`
  }
  ```
- BibIndex table access pattern: `PK={eventId}#{bibNumber}`, `SK=photoId` — supports multi-bib photos (one BibEntry per detected bib per photo)
- Local Rekognition mock: `lambdas/photo-processor/internal/rekmock/` — implements `TextDetector`; reads `testdata/rekognition-responses/{photoId}.json` if the file exists, otherwise returns an empty `DetectTextOutput`; wired in `main.go` when `RACEPHOTOS_ENV=local`
- New env vars (photo-processor):
  ```
  RACEPHOTOS_ENV                  required — "local"|"dev"|"qa"|"staging"|"prod"
  RACEPHOTOS_RAW_BUCKET           required — S3 bucket for original uploads
  RACEPHOTOS_PHOTOS_TABLE         required — DynamoDB photos table name
  RACEPHOTOS_BIB_INDEX_TABLE      required — DynamoDB bib-index table name
  RACEPHOTOS_WATERMARK_QUEUE_URL  required — SQS URL for watermark queue
  RACEPHOTOS_CONFIDENCE_MIN       optional — float, default 0.80
  ```
- New env vars (watermark):
  ```
  RACEPHOTOS_ENV                  required — "local"|"dev"|"qa"|"staging"|"prod"
  RACEPHOTOS_RAW_BUCKET           required — S3 bucket for original uploads
  RACEPHOTOS_PROCESSED_BUCKET     required — S3 bucket for watermarked photos
  RACEPHOTOS_PHOTOS_TABLE         required — DynamoDB photos table name
  RACEPHOTOS_EVENTS_TABLE         required — DynamoDB events table name (read watermarkText)
  ```
- CDK: `ProcessingPipelineConstruct` (from RS-001) wires both Lambda event source mappings; each Lambda wrapped with `ObservabilityConstruct`; DLQ + CloudWatch alarm (`ApproximateNumberOfMessagesVisible > 0`) required on both queues
- IAM: photo-processor needs `rekognition:DetectText`, `s3:GetObject` (raw bucket), `dynamodb:UpdateItem` (photos table), `dynamodb:BatchWriteItem` (bib-index table), `sqs:SendMessage` (watermark queue); watermark Lambda needs `s3:GetObject` (raw bucket), `s3:PutObject` (processed bucket), `dynamodb:UpdateItem` (photos table), `dynamodb:GetItem` (events table)
- `.env.example`: add `RACEPHOTOS_BIB_INDEX_TABLE`, `RACEPHOTOS_WATERMARK_QUEUE_URL`, `RACEPHOTOS_PROCESSED_BUCKET`, `RACEPHOTOS_CONFIDENCE_MIN`

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
