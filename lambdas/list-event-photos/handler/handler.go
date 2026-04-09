// Package handler implements the GET /events/{id}/photos Lambda business logic.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"

	"github.com/aws/aws-lambda-go/events"

	"github.com/racephotos/shared/models"
)

const defaultPageSize = 50

// PhotoStore abstracts the photo listing query on the photos table GSI.
type PhotoStore interface {
	ListPhotosByEvent(ctx context.Context, eventID, filter, cursor string, limit int) ([]models.Photo, string, error)
}

// EventStore abstracts the event ownership lookup on the events table.
type EventStore interface {
	GetEventPhotographerID(ctx context.Context, eventID string) (string, error)
}

// Handler holds dependencies for GET /events/{id}/photos.
type Handler struct {
	Photos    PhotoStore
	Events    EventStore
	CdnDomain string
}

type photoItem struct {
	ID           string   `json:"id"`
	Status       string   `json:"status"`
	ThumbnailURL *string  `json:"thumbnailUrl"` // nil when watermark not yet applied
	BibNumbers   []string `json:"bibNumbers"`
	UploadedAt   string   `json:"uploadedAt"`
	ErrorReason  string   `json:"errorReason,omitempty"`
}

type listPhotosResponse struct {
	Photos     []photoItem `json:"photos"`
	NextCursor string      `json:"nextCursor"`
}

// Handle processes an API Gateway v2 HTTP request.
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	photographerID, ok := extractSub(event)
	if !ok {
		return errResponse(401, "unauthorized"), nil
	}

	eventID := event.PathParameters["id"]
	if eventID == "" {
		return errResponse(400, "missing event id"), nil
	}

	// Ownership check.
	ownerID, err := h.Events.GetEventPhotographerID(ctx, eventID)
	if err != nil {
		if errors.Is(err, ErrEventNotFound) {
			return errResponse(404, "event not found"), nil
		}
		slog.ErrorContext(ctx, "GetEventPhotographerID failed",
			slog.String("eventID", eventID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}
	if ownerID != photographerID {
		return errResponse(403, "forbidden"), nil
	}

	filter := event.QueryStringParameters["status"]
	cursor := event.QueryStringParameters["cursor"]
	limit := defaultPageSize
	if lStr := event.QueryStringParameters["limit"]; lStr != "" {
		if l, err2 := strconv.Atoi(lStr); err2 == nil && l > 0 && l <= 200 {
			limit = l
		}
	}

	photos, nextCursor, err := h.Photos.ListPhotosByEvent(ctx, eventID, filter, cursor, limit)
	if err != nil {
		if errors.Is(err, ErrInvalidCursor) {
			return errResponse(400, "invalid cursor"), nil
		}
		slog.ErrorContext(ctx, "ListPhotosByEvent failed",
			slog.String("eventID", eventID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	items := make([]photoItem, 0, len(photos))
	for _, p := range photos {
		item := photoItem{
			ID:          p.ID,
			Status:      p.Status,
			BibNumbers:  p.BibNumbers,
			UploadedAt:  p.UploadedAt,
			ErrorReason: p.ErrorReason,
		}
		if p.WatermarkedS3Key != "" {
			url := "https://" + h.CdnDomain + "/" + p.WatermarkedS3Key
			item.ThumbnailURL = &url
		}
		if item.BibNumbers == nil {
			item.BibNumbers = []string{}
		}
		items = append(items, item)
	}

	return jsonResponse(200, listPhotosResponse{
		Photos:     items,
		NextCursor: nextCursor,
	})
}

// extractSub returns the Cognito sub claim from the JWT authorizer context.
func extractSub(event events.APIGatewayV2HTTPRequest) (string, bool) {
	if event.RequestContext.Authorizer == nil {
		return "", false
	}
	if event.RequestContext.Authorizer.JWT == nil {
		return "", false
	}
	sub, ok := event.RequestContext.Authorizer.JWT.Claims["sub"]
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
