package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"strconv"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/rekognition"
	"github.com/aws/aws-sdk-go-v2/service/rekognition/types"

	"github.com/racephotos/shared/models"
)

// Handler holds dependencies for the photo-processor Lambda.
type Handler struct {
	Detector      TextDetector
	Photos        PhotoStore
	BibIndex      BibIndexStore
	WatermarkQ    WatermarkQueue
	ConfidenceMin float64
}

// s3EventRecord mirrors the shape of an S3 ObjectCreated notification delivered
// via SQS. Only the fields we use are declared.
type s3EventRecord struct {
	S3 struct {
		Bucket struct{ Name string } `json:"bucket"`
		Object struct{ Key string }  `json:"object"`
	} `json:"s3"`
}

type s3Event struct {
	Records []s3EventRecord `json:"Records"`
}

// Photo status constants used across processing paths.
const (
	statusWatermarking   = "watermarking"
	statusIndexed        = "indexed"
	statusReviewRequired = "review_required"
	statusError          = "error"
)

// finalStatusFromBibs returns "indexed" when bib numbers were detected,
// "review_required" otherwise. Centralises the derivation used on both
// the normal Rekognition path and the SQS redelivery path.
func finalStatusFromBibs(bibs []string) string {
	if len(bibs) > 0 {
		return statusIndexed
	}
	return statusReviewRequired
}

// ProcessBatch handles an SQS batch. Implements partial batch failure (AC4):
// infrastructure errors (DynamoDB, SQS) add the message to batchItemFailures
// so SQS retries it. Rekognition errors are acked (status=error written to
// DynamoDB) to avoid repeated billing on known-bad photos (AC3).
func (h *Handler) ProcessBatch(ctx context.Context, evt events.SQSEvent) (events.SQSEventResponse, error) {
	var resp events.SQSEventResponse

	for _, msg := range evt.Records {
		if err := h.processMessage(ctx, msg); err != nil {
			slog.ErrorContext(ctx, "processMessage failed — adding to batchItemFailures",
				slog.String("messageId", msg.MessageId),
				slog.String("error", err.Error()),
			)
			resp.BatchItemFailures = append(resp.BatchItemFailures, events.SQSBatchItemFailure{
				ItemIdentifier: msg.MessageId,
			})
		}
	}

	return resp, nil
}

// processMessage handles a single SQS message. Returns a non-nil error only for
// infrastructure failures that should trigger a retry (partial batch failure).
// Rekognition errors write status=error and return nil (ack).
//
// S3 event notifications technically allow multiple records per message. We process
// all of them; if any record fails with an infrastructure error the whole SQS message
// is added to batchItemFailures (retried). A Rekognition error on one record does not
// affect the others — it is acked in-place (domain rule 10 / AC3).
func (h *Handler) processMessage(ctx context.Context, msg events.SQSMessage) error {
	var ev s3Event
	if err := json.Unmarshal([]byte(msg.Body), &ev); err != nil {
		return fmt.Errorf("processMessage: unmarshal S3 event: %w", err)
	}
	if len(ev.Records) == 0 {
		return fmt.Errorf("processMessage: S3 event has no records")
	}

	for i, rec := range ev.Records {
		if err := h.processS3Record(ctx, rec); err != nil {
			return fmt.Errorf("processMessage: record[%d]: %w", i, err)
		}
	}
	return nil
}

// processS3Record processes a single S3 ObjectCreated record. Returns a non-nil
// error only for infrastructure failures (DynamoDB, SQS). Rekognition errors are
// acked by writing status=error and returning nil.
func (h *Handler) processS3Record(ctx context.Context, rec s3EventRecord) error {
	// S3 event notifications URL-encode the object key (spaces → "+", special
	// chars → "%XX"). Decode before use so Rekognition and S3 GetObject receive
	// the real key, not the encoded form.
	rawS3Key, err := url.QueryUnescape(rec.S3.Object.Key)
	if err != nil {
		// Malformed encoding is a permanent error — ack rather than retry.
		// rawKey is intentionally omitted — private bucket paths must not be logged (CLAUDE.md).
		slog.ErrorContext(ctx, "processS3Record: failed to decode S3 key",
			slog.String("error", err.Error()),
		)
		return nil
	}

	// Parse photoId from S3 key: {envName}/{eventId}/{photoId}/{filename}
	parts := strings.Split(rawS3Key, "/")
	if len(parts) < 4 {
		return fmt.Errorf("unexpected S3 key format: %q", rawS3Key)
	}
	photoID := parts[2]

	slog.InfoContext(ctx, "processing photo",
		slog.String("photoId", photoID),
	)

	// Fetch the Photo record to get eventId and current status.
	photo, err := h.Photos.GetPhotoById(ctx, photoID)
	if err != nil {
		return fmt.Errorf("GetPhotoById %s: %w", photoID, err)
	}

	// Domain rule 10: Rekognition is called exactly once per photo.
	// SQS provides at-least-once delivery. On redelivery, the photo status may
	// have already advanced past "processing" from a previous (partial) execution.
	//
	// We must NOT skip all downstream steps on redelivery — a Lambda crash between
	// the DynamoDB status write and WriteBibEntries/SendWatermarkMessage would
	// leave the photo indexed in the photos table but missing bib entries or a
	// watermark. Instead:
	//   - "indexed" / "review_required" / "watermarking": skip Rekognition, re-drive
	//     downstream idempotent steps using the bib numbers already stored in the
	//     photo record. finalStatus is re-derived from stored BibNumbers.
	//   - "error": ack — do not retry a known-bad photo.
	//   - any other unexpected status: treat as "processing" (Rekognition not yet run).
	switch photo.Status {
	case statusError:
		slog.InfoContext(ctx, "photo in error state — acking without reprocessing",
			slog.String("photoId", photoID),
		)
		return nil
	case statusIndexed, statusReviewRequired, statusWatermarking:
		slog.InfoContext(ctx, "photo already processed — skipping Rekognition, re-driving downstream steps",
			slog.String("photoId", photoID),
			slog.String("status", photo.Status),
		)
		// Derive finalStatus from stored BibNumbers so Rekognition is not re-called.
		// Use rawS3Key (URL-decoded from the current event) for consistency with
		// the normal processing path — avoids relying on the DynamoDB-stored value.
		return h.driveDownstream(ctx, photo, rawS3Key, finalStatusFromBibs(photo.BibNumbers))
	}

	// Call Rekognition. On error: write status=error and ack (AC3).
	out, rekErr := h.Detector.DetectText(ctx, &rekognition.DetectTextInput{
		Image: &types.Image{
			S3Object: &types.S3Object{
				Bucket: aws.String(rec.S3.Bucket.Name),
				Name:   aws.String(rawS3Key),
			},
		},
	})
	if rekErr != nil {
		slog.ErrorContext(ctx, "Rekognition DetectText failed — writing error status",
			slog.String("photoId", photoID),
			slog.String("error", rekErr.Error()),
		)
		if updateErr := h.Photos.UpdatePhotoStatus(ctx, photoID, models.PhotoStatusUpdate{
			Status: statusError,
		}); updateErr != nil {
			return fmt.Errorf("UpdatePhotoStatus (error) %s: %w", photoID, updateErr)
		}
		return nil // ack — do not retry Rekognition errors
	}

	bibs, maxConfidence := h.extractBibs(out.TextDetections)

	// RS-017: write "watermarking" so the frontend shows a shimmer skeleton until the
	// watermark Lambda completes. The watermark Lambda sets the terminal status atomically.
	finalStatus := finalStatusFromBibs(bibs)
	update := models.PhotoStatusUpdate{
		Status:     statusWatermarking,
		BibNumbers: bibs,
	}
	if len(bibs) > 0 {
		update.RekognitionConfidence = maxConfidence
	}

	if err := h.Photos.UpdatePhotoStatus(ctx, photoID, update); err != nil {
		return fmt.Errorf("UpdatePhotoStatus %s: %w", photoID, err)
	}

	// Propagate the freshly-computed bibs so driveDownstream can build BibEntries.
	photo.BibNumbers = bibs
	return h.driveDownstream(ctx, photo, rawS3Key, finalStatus)
}

// driveDownstream writes bib index entries and queues the watermark message.
// It is called both on the normal processing path and on SQS redelivery when the
// photo record is already in a terminal status (indexed/review_required/watermarking) —
// making these steps safe to re-run if a previous execution crashed partway through.
// WriteBibEntries uses BatchWriteItem (PutRequest = idempotent overwrite).
// SendWatermarkMessage is safe to re-send — the watermark Lambda checks its own state.
//
// finalStatus is the terminal status the watermark Lambda should write once it completes
// ("indexed" or "review_required"). It is carried in the WatermarkMessage so the watermark
// Lambda can set it atomically without a second DynamoDB read (RS-017).
func (h *Handler) driveDownstream(ctx context.Context, photo *models.Photo, rawS3Key, finalStatus string) error {
	bibs := photo.BibNumbers

	// Write one BibEntry per detected bib (fan-out — ADR-0003).
	if len(bibs) > 0 {
		entries := make([]models.BibEntry, len(bibs))
		for i, bib := range bibs {
			entries[i] = models.BibEntry{
				BibKey:  fmt.Sprintf("%s#%s", photo.EventID, bib),
				PhotoID: photo.ID,
			}
		}
		if err := h.BibIndex.WriteBibEntries(ctx, entries); err != nil {
			return fmt.Errorf("WriteBibEntries %s: %w", photo.ID, err)
		}
	}

	// Publish to watermark queue regardless of bib detection outcome (watermark
	// applies event name overlay to every photo, not just indexed ones).
	if err := h.WatermarkQ.SendWatermarkMessage(ctx, models.WatermarkMessage{
		PhotoID:     photo.ID,
		EventID:     photo.EventID,
		RawS3Key:    rawS3Key,
		FinalStatus: finalStatus,
	}); err != nil {
		return fmt.Errorf("SendWatermarkMessage %s: %w", photo.ID, err)
	}

	slog.InfoContext(ctx, "photo queued for watermarking",
		slog.String("photoId", photo.ID),
		slog.String("finalStatus", finalStatus),
		slog.Int("bibCount", len(bibs)),
	)

	return nil
}

// extractBibs filters TextDetections to LINE-type results above the confidence
// threshold that parse as integers (bib numbers are always digits).
// Returns deduplicated bib strings and the highest confidence score.
func (h *Handler) extractBibs(detections []types.TextDetection) ([]string, float64) {
	seen := map[string]struct{}{}
	bibs := make([]string, 0)
	var maxConf float64

	for _, d := range detections {
		if d.Type != types.TextTypesLine {
			continue
		}
		if d.Confidence == nil || float64(*d.Confidence) < h.ConfidenceMin*100 {
			continue
		}
		text := strings.TrimSpace(aws.ToString(d.DetectedText))
		if _, err := strconv.Atoi(text); err != nil {
			continue // not a bib number
		}
		if _, dup := seen[text]; dup {
			continue
		}
		seen[text] = struct{}{}
		bibs = append(bibs, text)
		if float64(*d.Confidence) > maxConf {
			maxConf = float64(*d.Confidence)
		}
	}

	return bibs, maxConf // Rekognition native range 0–100; stored as-is in DynamoDB
}
