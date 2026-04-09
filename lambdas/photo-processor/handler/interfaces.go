// Package handler implements the photo-processor SQS-triggered Lambda.
package handler

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/service/rekognition"

	"github.com/racephotos/shared/models"
)

// TextDetector wraps the Rekognition DetectText API.
// Injected as a real SDK client in prod; replaced with a file-backed mock when
// RACEPHOTOS_ENV=local (see internal/rekmock/).
type TextDetector interface {
	DetectText(ctx context.Context, input *rekognition.DetectTextInput, optFns ...func(*rekognition.Options)) (*rekognition.DetectTextOutput, error)
}

// PhotoStore reads and updates Photo records in DynamoDB (racephotos-photos).
type PhotoStore interface {
	GetPhotoById(ctx context.Context, id string) (*models.Photo, error)
	UpdatePhotoStatus(ctx context.Context, id string, update models.PhotoStatusUpdate) error
}

// BibIndexStore writes fan-out bib lookup entries to DynamoDB (racephotos-bib-index).
// One entry per detected bib per photo (ADR-0003).
type BibIndexStore interface {
	WriteBibEntries(ctx context.Context, entries []models.BibEntry) error
}

// WatermarkQueue publishes messages to the racephotos-watermark SQS queue.
type WatermarkQueue interface {
	SendWatermarkMessage(ctx context.Context, msg models.WatermarkMessage) error
}
