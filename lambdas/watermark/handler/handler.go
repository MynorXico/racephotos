package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image/jpeg"
	"log/slog"

	"github.com/aws/aws-lambda-go/events"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/racephotos/shared/models"
)

const (
	// defaultJPEGQuality is the JPEG encoding quality for watermarked output photos.
	defaultJPEGQuality = 85
	// watermarkDefaultDomain is the placeholder domain used in the default watermark
	// text when the photographer has not set a custom watermarkText on the event.
	watermarkDefaultDomain = "racephotos.example.com"
	// watermarkMaxChars is the maximum number of characters allowed in the rendered
	// watermark string. Text longer than this is truncated with "…" to prevent
	// overflow on narrow images.
	watermarkMaxChars = 60
)

// Handler holds dependencies for the watermark Lambda.
type Handler struct {
	RawReader       RawPhotoReader
	ProcessedWriter ProcessedPhotoWriter
	Watermarker     ImageWatermarker
	Events          EventStore
	Photos          PhotoStore
	ProcessedBucket string // racephotos-processed-{envName}
}

// WatermarkedS3Key returns the key used to store a watermarked photo.
// Format: {eventId}/{photoId}/watermarked.jpg (AC5).
// Exported so tests can assert on it directly.
func WatermarkedS3Key(eventId, photoId string) string {
	return fmt.Sprintf("%s/%s/watermarked.jpg", eventId, photoId)
}

// ProcessBatch handles an SQS batch with partial batch failure support (AC4).
func (h *Handler) ProcessBatch(ctx context.Context, evt events.SQSEvent) (events.SQSEventResponse, error) {
	var resp events.SQSEventResponse

	for _, msg := range evt.Records {
		if err := h.processMessage(ctx, msg); err != nil {
			slog.ErrorContext(ctx, "watermark processMessage failed — adding to batchItemFailures",
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

func (h *Handler) processMessage(ctx context.Context, msg events.SQSMessage) error {
	var wm models.WatermarkMessage
	if err := json.Unmarshal([]byte(msg.Body), &wm); err != nil {
		return fmt.Errorf("processMessage: unmarshal watermark message: %w", err)
	}
	if wm.PhotoID == "" || wm.EventID == "" || wm.RawS3Key == "" || wm.FinalStatus == "" {
		return fmt.Errorf("processMessage: missing required fields in watermark message")
	}
	if wm.FinalStatus != "indexed" && wm.FinalStatus != "review_required" {
		return fmt.Errorf("processMessage: invalid finalStatus %q — must be \"indexed\" or \"review_required\"", wm.FinalStatus)
	}

	slog.InfoContext(ctx, "watermarking photo",
		slog.String("photoId", wm.PhotoID),
		slog.String("eventId", wm.EventID),
	)

	// Fetch watermark text first — fast DynamoDB call; fail before expensive S3 I/O.
	watermarkText, eventName, err := h.Events.GetWatermarkText(ctx, wm.EventID)
	if err != nil {
		return fmt.Errorf("processMessage: GetWatermarkText eventId=%s: %w", wm.EventID, err)
	}
	// Default watermark when photographer has not configured custom text (PRODUCT_CONTEXT.md).
	if watermarkText == "" {
		watermarkText = eventName + " · " + watermarkDefaultDomain
	}
	watermarkText = truncateWatermark(watermarkText, watermarkMaxChars)

	// Download raw photo from private S3 bucket.
	// rawS3Key is never included in log or error strings (CLAUDE.md — private bucket paths must not be logged).
	rawBody, err := h.RawReader.GetObject(ctx, "", wm.RawS3Key)
	if err != nil {
		// If the raw photo no longer exists, retrying will never succeed — ack the
		// message and log a warning so an operator can investigate manually.
		var nsk *s3types.NoSuchKey
		if errors.As(err, &nsk) {
			slog.WarnContext(ctx, "raw photo not found in S3 — acknowledging without retry",
				slog.String("photoId", wm.PhotoID),
				slog.String("eventId", wm.EventID),
				slog.String("messageId", msg.MessageId),
			)
			return nil
		}
		return fmt.Errorf("processMessage: GetObject photoId=%s: %w", wm.PhotoID, err)
	}
	defer rawBody.Close()

	// Decode image and apply watermark (both owned by the ImageWatermarker implementation).
	watermarked, err := h.Watermarker.ApplyTextWatermark(rawBody, watermarkText)
	if err != nil {
		return fmt.Errorf("processMessage: ApplyTextWatermark: %w", err)
	}

	// Encode watermarked image to JPEG.
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, watermarked, &jpeg.Options{Quality: defaultJPEGQuality}); err != nil {
		return fmt.Errorf("processMessage: jpeg.Encode: %w", err)
	}

	// Upload to processed bucket.
	// bytes.NewReader is an io.ReadSeeker — S3PhotoWriter can seek to determine the
	// content length without a second io.ReadAll copy.
	destKey := WatermarkedS3Key(wm.EventID, wm.PhotoID)
	if err := h.ProcessedWriter.PutObject(ctx, h.ProcessedBucket, destKey, bytes.NewReader(buf.Bytes()), "image/jpeg"); err != nil {
		return fmt.Errorf("processMessage: PutObject %s: %w", destKey, err)
	}

	// Atomically set watermarkedS3Key and the final status in a single DynamoDB
	// UpdateItem. Using one expression prevents a partial state (key written but
	// status still "watermarking") if the Lambda crashes mid-update (RS-017).
	if err := h.Photos.CompleteWatermark(ctx, wm.PhotoID, destKey, wm.FinalStatus); err != nil {
		return fmt.Errorf("processMessage: CompleteWatermark: %w", err)
	}

	slog.InfoContext(ctx, "watermark applied",
		slog.String("photoId", wm.PhotoID),
		slog.String("eventId", wm.EventID),
		slog.String("finalStatus", wm.FinalStatus),
	)

	return nil
}

// truncateWatermark truncates text to at most maxChars runes, appending "…" if cut.
// Prevents long event names from overflowing the image width in DrawStringAnchored.
func truncateWatermark(text string, maxChars int) string {
	runes := []rune(text)
	if len(runes) <= maxChars {
		return text
	}
	return string(runes[:maxChars-1]) + "…"
}
