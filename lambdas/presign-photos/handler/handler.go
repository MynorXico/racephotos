// Package handler implements the POST /events/{eventId}/photos/presign Lambda.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/google/uuid"

	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

const (
	maxPresignBatch = 100
	presignTTL      = 60 * time.Minute
	maxPhotoBytes   = 50 * 1024 * 1024 // 50 MB
)

// allowedContentTypes is the set of accepted MIME types for RS-006.
// RS-015 extends this list to include RAW/HEIC/TIFF formats.
var allowedContentTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
}

// safeFilename accepts filenames containing only alphanumerics, dots, hyphens, and
// underscores, spaces, and parentheses (max 255 chars).
// Specifically blocks path-traversal sequences (/, ..) and null bytes while
// allowing common camera-generated names like "Finish Line.jpg" or "IMG_001 (1).jpg".
var safeFilename = regexp.MustCompile(`^[a-zA-Z0-9._\- ()]{1,255}$`)

// S3Presigner generates presigned S3 PUT URLs.
type S3Presigner interface {
	PresignPutObject(ctx context.Context, bucket, key, contentType string, ttl time.Duration) (string, error)
}

// PhotoStore persists Photo records to DynamoDB.
type PhotoStore interface {
	// BatchCreatePhotos writes up to 100 Photo records. The implementation is
	// responsible for chunking into BatchWriteItem calls of 25 (the DynamoDB limit).
	BatchCreatePhotos(ctx context.Context, photos []models.Photo) error
}

// EventReader reads a single Event record from DynamoDB.
type EventReader interface {
	GetEvent(ctx context.Context, id string) (*models.Event, error)
}

// Handler holds the dependencies for POST /events/{eventId}/photos/presign.
type Handler struct {
	Events    EventReader
	Photos    PhotoStore
	Presigner S3Presigner
	RawBucket string
	Env       string
}

// presignPhotoInput is one item in the request body array.
type presignPhotoInput struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}

// presignRequest is the expected JSON body.
type presignRequest struct {
	Photos []presignPhotoInput `json:"photos"`
}

// photoPresignResult is one item in the response array.
type photoPresignResult struct {
	PhotoID      string `json:"photoId"`
	PresignedURL string `json:"presignedUrl"`
}

// Handle processes an API Gateway v2 HTTP request.
func (h *Handler) Handle(ctx context.Context, req events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	photographerID, ok := extractSub(req)
	if !ok {
		return errResponse(401, "unauthorized"), nil
	}

	eventID := req.PathParameters["eventId"]
	if eventID == "" {
		return errResponse(400, "missing eventId"), nil
	}
	// Validate eventId is a UUID to prevent enumeration probing and enforce the
	// project's input-validation contract (CLAUDE.md).
	if _, err := uuid.Parse(eventID); err != nil {
		return errResponse(400, "invalid eventId"), nil
	}

	var body presignRequest
	if err := json.Unmarshal([]byte(req.Body), &body); err != nil {
		return errResponse(400, "invalid request body"), nil
	}

	// Reject empty batches — no business value and wastes a DynamoDB consistent read.
	if len(body.Photos) == 0 {
		return errResponse(400, "no photos provided"), nil
	}
	// AC2: enforce batch limit.
	if len(body.Photos) > maxPresignBatch {
		return errResponse(400, fmt.Sprintf("batch exceeds maximum of %d items", maxPresignBatch)), nil
	}

	// Validate each photo entry: filename, size, and content type.
	for i, p := range body.Photos {
		if !safeFilename.MatchString(p.Filename) {
			return errResponse(400, fmt.Sprintf("photos[%d]: invalid filename", i)), nil
		}
		if p.Size <= 0 || p.Size > maxPhotoBytes {
			return errResponse(400, fmt.Sprintf("photos[%d]: size must be between 1 and %d bytes", i, maxPhotoBytes)), nil
		}
		// AC10: validate content types (case-insensitive — some clients send "image/JPEG").
		if !allowedContentTypes[strings.ToLower(p.ContentType)] {
			return errResponse(400, fmt.Sprintf("photos[%d]: unsupported contentType %q; accepted: image/jpeg, image/png", i, p.ContentType)), nil
		}
	}

	// AC9: check event exists; AC3: check ownership.
	ev, err := h.Events.GetEvent(ctx, eventID)
	if err != nil {
		if errors.Is(err, apperrors.ErrNotFound) {
			return errResponse(404, "event not found"), nil
		}
		slog.ErrorContext(ctx, "GetEvent failed",
			slog.String("eventId", eventID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}
	if ev.PhotographerID != photographerID {
		return errResponse(403, "forbidden"), nil
	}

	// Build photo IDs and S3 keys. Presigning happens before the DynamoDB write so
	// that a PresignPutObject failure leaves no ghost records.
	now := time.Now().UTC().Format(time.RFC3339)
	type photoWork struct {
		photo       models.Photo
		contentType string
	}
	work := make([]photoWork, len(body.Photos))
	for i, p := range body.Photos {
		id := uuid.New().String()
		work[i] = photoWork{
			photo: models.Photo{
				ID:         id,
				EventID:    eventID,
				Status:     "uploading",
				RawS3Key:   fmt.Sprintf("%s/%s/%s/%s", h.Env, eventID, id, p.Filename),
				UploadedAt: now,
			},
			// Normalize to lowercase so the presigned URL's Content-Type header
			// matches what XHR sends (e.g. "image/JPEG" → "image/jpeg").
			contentType: strings.ToLower(p.ContentType),
		}
	}

	// Generate presigned PUT URLs before any DynamoDB writes.
	// PresignPutObject is pure local crypto (no network I/O); errors here are fatal
	// but leave the database in a consistent state.
	results := make([]photoPresignResult, len(work))
	photos := make([]models.Photo, len(work))
	for i, w := range work {
		url, err := h.Presigner.PresignPutObject(ctx, h.RawBucket, w.photo.RawS3Key, w.contentType, presignTTL)
		if err != nil {
			slog.ErrorContext(ctx, "PresignPutObject failed",
				slog.String("photoId", w.photo.ID),
				slog.String("error", err.Error()),
			)
			return errResponse(500, "internal server error"), nil
		}
		results[i] = photoPresignResult{
			PhotoID:      w.photo.ID,
			PresignedURL: url,
		}
		photos[i] = w.photo
	}

	// Persist photos (store handles chunking into BatchWriteItem calls of 25).
	if err := h.Photos.BatchCreatePhotos(ctx, photos); err != nil {
		slog.ErrorContext(ctx, "BatchCreatePhotos failed",
			slog.String("eventId", eventID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	return jsonResponse(200, map[string]any{"photos": results})
}

// extractSub returns the Cognito sub claim from the JWT authorizer context.
func extractSub(req events.APIGatewayV2HTTPRequest) (string, bool) {
	if req.RequestContext.Authorizer == nil {
		return "", false
	}
	if req.RequestContext.Authorizer.JWT == nil {
		return "", false
	}
	sub, ok := req.RequestContext.Authorizer.JWT.Claims["sub"]
	return sub, ok && sub != ""
}

type errorBody struct {
	Error string `json:"error"`
}

func errResponse(statusCode int, message string) events.APIGatewayV2HTTPResponse {
	b, err := json.Marshal(errorBody{Error: message})
	if err != nil {
		b = []byte(`{"error":"internal server error"}`)
	}
	return events.APIGatewayV2HTTPResponse{
		StatusCode: statusCode,
		Headers: map[string]string{
			"Content-Type":  "application/json",
			"Cache-Control": "no-store",
		},
		Body: string(b),
	}
}

func jsonResponse(statusCode int, body any) (events.APIGatewayV2HTTPResponse, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return errResponse(500, "internal server error"), fmt.Errorf("jsonResponse: marshal: %w", err)
	}
	return events.APIGatewayV2HTTPResponse{
		StatusCode: statusCode,
		Headers: map[string]string{
			"Content-Type":  "application/json",
			"Cache-Control": "no-store",
		},
		Body: string(b),
	}, nil
}
