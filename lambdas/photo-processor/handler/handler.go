package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
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
func (h *Handler) processMessage(ctx context.Context, msg events.SQSMessage) error {
	// Parse the S3 notification envelope.
	var ev s3Event
	if err := json.Unmarshal([]byte(msg.Body), &ev); err != nil {
		return fmt.Errorf("processMessage: unmarshal S3 event: %w", err)
	}
	if len(ev.Records) == 0 {
		return fmt.Errorf("processMessage: S3 event has no records")
	}
	rec := ev.Records[0]
	rawS3Key := rec.S3.Object.Key

	// Parse photoId from S3 key: {envName}/{eventId}/{photoId}/{filename}
	parts := strings.Split(rawS3Key, "/")
	if len(parts) < 4 {
		return fmt.Errorf("processMessage: unexpected S3 key format: %q", rawS3Key)
	}
	photoID := parts[2]

	slog.InfoContext(ctx, "processing photo",
		slog.String("photoId", photoID),
		slog.String("rawS3Key", rawS3Key),
	)

	// Fetch the Photo record to get eventId and RawS3Key.
	photo, err := h.Photos.GetPhotoById(ctx, photoID)
	if err != nil {
		return fmt.Errorf("processMessage: GetPhotoById %s: %w", photoID, err)
	}

	// Call Rekognition. On error: write status=error and ack (domain rule 10 / AC3).
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
			Status: "error",
		}); updateErr != nil {
			return fmt.Errorf("processMessage: UpdatePhotoStatus (error): %w", updateErr)
		}
		return nil // ack — do not retry Rekognition errors
	}

	bibs, maxConfidence := h.extractBibs(out.TextDetections)

	update := models.PhotoStatusUpdate{
		BibNumbers: bibs,
	}
	if len(bibs) > 0 {
		update.Status = "indexed"
		update.RekognitionConfidence = maxConfidence
	} else {
		update.Status = "review_required"
	}

	if err := h.Photos.UpdatePhotoStatus(ctx, photoID, update); err != nil {
		return fmt.Errorf("processMessage: UpdatePhotoStatus: %w", err)
	}

	// Write one BibEntry per detected bib (fan-out — ADR-0003).
	if len(bibs) > 0 {
		entries := make([]models.BibEntry, len(bibs))
		for i, bib := range bibs {
			entries[i] = models.BibEntry{
				BibKey:  fmt.Sprintf("%s#%s", photo.EventID, bib),
				PhotoID: photoID,
			}
		}
		if err := h.BibIndex.WriteBibEntries(ctx, entries); err != nil {
			return fmt.Errorf("processMessage: WriteBibEntries: %w", err)
		}
	}

	// Publish to watermark queue regardless of bib detection outcome (watermark
	// applies event name overlay to every photo, not just indexed ones).
	if err := h.WatermarkQ.SendWatermarkMessage(ctx, models.WatermarkMessage{
		PhotoID:  photoID,
		EventID:  photo.EventID,
		RawS3Key: rawS3Key,
	}); err != nil {
		return fmt.Errorf("processMessage: SendWatermarkMessage: %w", err)
	}

	slog.InfoContext(ctx, "photo processed",
		slog.String("photoId", photoID),
		slog.String("status", update.Status),
		slog.Int("bibCount", len(bibs)),
	)

	return nil
}

// extractBibs filters TextDetections to LINE-type results above the confidence
// threshold that parse as integers (bib numbers are always digits).
// Returns deduplicated bib strings and the highest confidence score.
func (h *Handler) extractBibs(detections []types.TextDetection) ([]string, float64) {
	seen := map[string]struct{}{}
	var bibs []string
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

	if bibs == nil {
		bibs = []string{}
	}
	return bibs, maxConf // Rekognition native range 0–100; stored as-is in DynamoDB
}
