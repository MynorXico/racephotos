// Package handler implements the watermark SQS-triggered Lambda.
package handler

import (
	"context"
	"errors"
	"image"
	"io"
)

// ErrAlreadyCompleted is returned by CompleteWatermark when the DynamoDB
// condition check fails because the photo was already watermarked in a prior
// attempt. The caller should treat this as a successful idempotent no-op.
var ErrAlreadyCompleted = errors.New("watermark already completed")

// RawPhotoReader downloads a photo from the private raw S3 bucket.
type RawPhotoReader interface {
	GetObject(ctx context.Context, bucket, key string) (io.ReadCloser, error)
}

// ProcessedPhotoWriter uploads a watermarked photo to the processed S3 bucket.
type ProcessedPhotoWriter interface {
	PutObject(ctx context.Context, bucket, key string, body io.Reader, contentType string) error
}

// ImageWatermarker decodes a raw image from src and applies a text watermark.
// Accepting io.Reader keeps image decoding inside the implementation so unit
// tests can mock the full watermark step without providing a real encoded image.
// Implementations wrap github.com/fogleman/gg (see ADR-0009).
type ImageWatermarker interface {
	ApplyTextWatermark(src io.Reader, text string) (image.Image, error)
}

// EventStore reads event configuration from DynamoDB (racephotos-events).
type EventStore interface {
	// GetWatermarkText returns the photographer-configured watermark text and the
	// event name. If watermarkText is empty, the handler falls back to the default:
	// "{eventName} · racephotos.example.com".
	GetWatermarkText(ctx context.Context, eventId string) (watermarkText, eventName string, err error)
}

// PhotoStore finalises a watermarked Photo record (racephotos-photos).
type PhotoStore interface {
	// CompleteWatermark atomically sets watermarkedS3Key and status in a single
	// DynamoDB UpdateItem. finalStatus must be "indexed" or "review_required".
	// Uses ConditionExpression: attribute_exists(id) AND #st = :watermarking so
	// that SQS retries that arrive after a successful write return ErrAlreadyCompleted
	// rather than double-incrementing the photo counter (RS-019 idempotency guard).
	CompleteWatermark(ctx context.Context, photoId, watermarkedS3Key, finalStatus string) error
}

// EventCountUpdater increments the denormalised photoCount on an Event record.
// Called after CompleteWatermark succeeds when finalStatus is "indexed" (RS-019).
type EventCountUpdater interface {
	// IncrementPhotoCount atomically increments photoCount by 1 using a DynamoDB
	// ADD expression. ADD is safe for concurrent Lambda invocations — no condition
	// is needed since over-count on failure is guarded by the PhotoStore.CompleteWatermark
	// idempotency condition.
	IncrementPhotoCount(ctx context.Context, eventID string) error
}
