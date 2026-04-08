# Story: Photo format conversion — RAW/HEIC/TIFF to JPEG before Rekognition

**ID**: RS-015
**Epic**: Photo Upload
**Status**: ready
**Has UI**: no

## Context

Photographers commonly upload directly from their cameras without exporting to JPEG first — shooting in RAW for post-processing flexibility, or using HEIC/TIFF as their native format. The current pipeline (RS-006, RS-007) rejects anything that is not JPEG or PNG because Amazon Rekognition `DetectText` and the watermark Lambda both require a JPEG or PNG source. This story extends the upload and processing pipeline so that photographers can upload in any common camera format (Journey 1, steps 3–5): the original file is preserved in the raw S3 bucket as the authoritative download source, while a JPEG conversion is produced transparently for Rekognition processing and watermarking.

## Acceptance criteria

- [ ] AC1: Given `POST /events/{eventId}/photos/presign` is called with a `contentType` of `image/heic`, `image/heif`, `image/tiff`, `image/x-tiff`, `image/x-canon-cr2`, `image/x-canon-cr3`, `image/x-nikon-nef`, `image/x-sony-arw`, `image/x-adobe-dng`, `image/x-fuji-raf`, `image/x-olympus-orf`, or `image/x-panasonic-rw2`, then a presigned S3 PUT URL is returned and the Photo record is created with `status="uploading"` and `originalFormat` set to the provided `contentType`.

- [ ] AC2: Given a file with a non-JPEG/PNG extension is PUT to the raw S3 bucket, when the S3 ObjectCreated event fires, then the event is routed to the `racephotos-format-conversion` SQS queue. Files with `.jpg`, `.jpeg`, or `.png` suffixes continue to route to `racephotos-processing` as before.

- [ ] AC3: Given the format-converter Lambda receives a message, when it converts successfully, then: the original file is downloaded from the raw bucket; it is converted to JPEG using ImageMagick; the JPEG is stored in the raw bucket at `{envName}/{eventId}/{photoId}/converted.jpg`; the Photo record is updated with `convertedS3Key` and `status="processing"`; a message is published to the `racephotos-processing` queue so the photo-processor Lambda picks it up.

- [ ] AC4: Given the photo-processor Lambda (RS-007) processes a photo where `convertedS3Key` is non-empty, when it calls Rekognition `DetectText`, then it uses the bytes at `convertedS3Key` as input — not `rawS3Key`.

- [ ] AC5: Given the watermark Lambda (RS-007) processes a photo where `convertedS3Key` is non-empty, when it reads the source image, then it reads from `convertedS3Key` — not `rawS3Key`. The watermarked output is stored in the processed bucket as per RS-007.

- [ ] AC6: Given a runner purchases and downloads a photo that was originally uploaded in a non-JPEG/PNG format, when the signed download URL is generated (RS-012), then the URL points to `rawS3Key` — the original unmodified file, not the JPEG conversion.

- [ ] AC7: Given the format-converter Lambda fails to convert a file (corrupt file, unsupported sub-variant, ImageMagick error), when the error occurs, then the Photo record is updated with `status="error"`, the error is logged with `requestId` and `photoId`, and the message is returned in `batchItemFailures` — not retried at the application level (same pattern as RS-007 AC3).

- [ ] AC8: Given a message exceeds `maxReceiveCount: 3`, then it moves to `racephotos-format-conversion-dlq` and the CloudWatch alarm for that DLQ fires.

## Out of scope

- Color-profile / ICC-profile preservation in the JPEG output (sRGB normalisation only)
- HEIC Live Photos — the video component is silently discarded; still frame is converted
- Automatic format detection by magic bytes — file extension is the contract at upload time; files uploaded without a recognised extension are not routed to either queue and will remain at `status="uploading"` indefinitely (photographer must re-upload with a correct filename)
- Re-running conversion — like Rekognition, conversion runs exactly once and `convertedS3Key` is treated as immutable once written
- Batch conversion of photos already in the pipeline before this story ships

## Tech notes

- New Lambda module: `lambdas/format-converter/`
  - Event source: `racephotos-format-conversion` SQS queue (partial batch failure response — return `batchItemFailures`)
  - Converts via ImageMagick CLI invoked through `os/exec`: `convert <input> -quality 95 <output.jpg>`
  - Binary path read from `RACEPHOTOS_IMAGEMAGICK_PATH` (default `/opt/bin/convert`)
- Updates to existing Lambdas:
  - `lambdas/presign-photos/` (RS-006): extend the content-type allowlist to include the types listed in AC1; store `originalFormat` on the Photo record at creation time
  - `lambdas/photo-processor/` (RS-007): when constructing the Rekognition input bytes, check `photo.ConvertedS3Key`; use it if non-empty, fall back to `photo.RawS3Key`
  - `lambdas/watermark/` (RS-007): same substitution — use `ConvertedS3Key` as the image source if set
- Interfaces (format-converter):
  ```go
  type RawPhotoReader interface {
      GetObject(ctx context.Context, bucket, key string) (io.ReadCloser, error)
  }
  type ConvertedPhotoWriter interface {
      PutObject(ctx context.Context, bucket, key string, body io.Reader, contentType string) error
  }
  type PhotoStore interface {
      GetPhotoByS3Key(ctx context.Context, rawS3Key string) (*models.Photo, error)
      UpdatePhotoConversion(ctx context.Context, id, convertedS3Key, status string) error
  }
  type ProcessingQueue interface {
      SendProcessingMessage(ctx context.Context, msg models.ProcessingMessage) error
  }
  type ImageConverter interface {
      ConvertToJPEG(ctx context.Context, src io.Reader, srcFormat string) (io.Reader, error)
  }
  ```
- Photo model additions (`shared/models/photo.go`):
  ```go
  ConvertedS3Key string `dynamodbav:"convertedS3Key,omitempty"` // absent for native JPEG/PNG
  OriginalFormat  string `dynamodbav:"originalFormat,omitempty"` // MIME type at upload time
  ```
- DynamoDB access patterns:
  - `GetItem` on photos table: look up Photo by `rawS3Key` (existing pattern from RS-007)
  - `UpdateItem` on photos table: set `convertedS3Key`, `originalFormat` (if not already set), `status`
- S3 ObjectCreated routing changes (parent stage where S3 notifications are wired — see RS-001 tech notes):
  - Existing rule gains suffix filter: `.jpg`, `.jpeg`, `.png` → `racephotos-processing`
  - New rule: `.heic`, `.heif`, `.tiff`, `.tif`, `.cr2`, `.cr3`, `.nef`, `.arw`, `.dng`, `.raf`, `.orf`, `.rw2` → `racephotos-format-conversion`
- New SQS queues (add to `ProcessingPipelineConstruct`):
  - `racephotos-format-conversion` — visibility timeout: 5 minutes (ImageMagick on a 40 MB RAW file can take 30–60s; 5 minutes provides cold-start headroom)
  - `racephotos-format-conversion-dlq` — `maxReceiveCount: 3`; CloudWatch alarm `ApproximateNumberOfMessagesVisible > 0` via `ObservabilityConstruct`
- ImageMagick Lambda Layer:
  - Must be compiled for Amazon Linux 2 with libheif, libtiff, and libraw delegates
  - Contributors publish the layer to their own AWS account; the Layer ARN is stored in SSM at `/racephotos/env/{envName}/imagemagick-layer-arn`
  - CDK reads it with `ssm.StringParameter.valueForStringParameter(this, '/racephotos/env/{envName}/imagemagick-layer-arn')` — never `valueFromLookup` (CLAUDE.md)
  - Build + publish instructions added to `docs/setup/imagemagick-layer.md`
- Local development: wire a `localImageConverter` stub in `main.go` when `RACEPHOTOS_ENV=local`; the stub uses `golang.org/x/image/tiff` for TIFF conversion and returns a pre-converted fixture JPEG from `testdata/converted/{photoId}.jpg` for HEIC and RAW inputs (integration tests provide fixtures)
- New env vars (format-converter):
  ```
  RACEPHOTOS_ENV                    required — "local"|"dev"|"qa"|"staging"|"prod"
  RACEPHOTOS_RAW_BUCKET             required — S3 bucket for originals and converted copies
  RACEPHOTOS_PHOTOS_TABLE           required — DynamoDB photos table name
  RACEPHOTOS_PROCESSING_QUEUE_URL   required — SQS URL for racephotos-processing queue
  RACEPHOTOS_IMAGEMAGICK_PATH       optional — path to ImageMagick binary, default "/opt/bin/convert"
  ```
- CDK construct to update: `ProcessingPipelineConstruct` (add format-conversion queue + DLQ); parent stage (add new S3 suffix-filtered notification rule); new Lambda CDK construct for `format-converter`, wrapped with `ObservabilityConstruct`
- IAM grants for format-converter Lambda: `s3:GetObject` and `s3:PutObject` on the raw bucket (reads original, writes `converted.jpg`); `dynamodb:GetItem` and `dynamodb:UpdateItem` on the photos table; `sqs:SendMessage` on the processing queue
- `.env.example`: add `RACEPHOTOS_PROCESSING_QUEUE_URL` and `RACEPHOTOS_IMAGEMAGICK_PATH`
- ADR dependency: none — async pipeline, single-call processing, and original-preservation rules are covered by existing domain rules and ADRs 0001–0008

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
