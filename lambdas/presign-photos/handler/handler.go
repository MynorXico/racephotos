// Package handler implements the POST /events/{eventId}/photos/presign Lambda.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/google/uuid"

	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

const (
	maxPresignBatch = 100
	presignTTL      = 15 * time.Minute
)

// allowedContentTypes is the set of accepted MIME types for RS-006.
// RS-015 extends this list to include RAW/HEIC/TIFF formats.
var allowedContentTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
}

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

	var body presignRequest
	if err := json.Unmarshal([]byte(req.Body), &body); err != nil {
		return errResponse(400, "invalid request body"), nil
	}

	// AC2: enforce batch limit.
	if len(body.Photos) > maxPresignBatch {
		return errResponse(400, fmt.Sprintf("batch exceeds maximum of %d items", maxPresignBatch)), nil
	}

	// AC10: validate content types.
	for i, p := range body.Photos {
		if !allowedContentTypes[p.ContentType] {
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

	// Build Photo records (status="uploading", RS-006 note: RS-007 transitions to "processing").
	now := time.Now().UTC().Format(time.RFC3339)
	photos := make([]models.Photo, len(body.Photos))
	for i, p := range body.Photos {
		id := uuid.New().String()
		photos[i] = models.Photo{
			ID:         id,
			EventID:    eventID,
			BibNumbers: []string{},
			Status:     "uploading",
			RawS3Key:   fmt.Sprintf("%s/%s/%s/%s", h.Env, eventID, id, p.Filename),
			UploadedAt: now,
		}
	}

	// Persist photos (store handles chunking into BatchWriteItem calls of 25).
	if err := h.Photos.BatchCreatePhotos(ctx, photos); err != nil {
		slog.ErrorContext(ctx, "BatchCreatePhotos failed",
			slog.String("eventId", eventID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	// Generate presigned PUT URLs.
	results := make([]photoPresignResult, len(photos))
	for i, photo := range photos {
		url, err := h.Presigner.PresignPutObject(ctx, h.RawBucket, photo.RawS3Key, body.Photos[i].ContentType, presignTTL)
		if err != nil {
			slog.ErrorContext(ctx, "PresignPutObject failed",
				slog.String("photoId", photo.ID),
				slog.String("error", err.Error()),
			)
			return errResponse(500, "internal server error"), nil
		}
		results[i] = photoPresignResult{
			PhotoID:      photo.ID,
			PresignedURL: url,
		}
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
	b, _ := json.Marshal(errorBody{Error: message})
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
