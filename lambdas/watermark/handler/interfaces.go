// Package handler implements the watermark SQS-triggered Lambda.
package handler

import (
	"context"
	"image"
	"io"
)

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
	GetWatermarkText(ctx context.Context, eventId string) (string, error)
}

// PhotoStore updates the watermarkedS3Key on a Photo record (racephotos-photos).
type PhotoStore interface {
	UpdateWatermarkedKey(ctx context.Context, photoId, watermarkedS3Key string) error
}
