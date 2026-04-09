// Package handler implements the GET /events/{id}/photos Lambda business logic.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"

	"github.com/aws/aws-lambda-go/events"

	"github.com/racephotos/shared/models"
)

const defaultPageSize = 50

// uuidRE validates that an event ID is a standard UUID (case-insensitive).
// This prevents pathological strings from reaching DynamoDB key lookups.
var uuidRE = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// validStatuses is the allowlist of accepted ?status= filter values.
// Arbitrary strings are rejected with 400 to prevent enum probing and exposure
// of internal states (e.g. "uploading") not intended for the gallery view.
var validStatuses = map[string]bool{
	"uploading":       true,
	"processing":      true,
	"indexed":         true,
	"review_required": true,
	"error":           true,
}

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

type ownerResult struct {
	id  string
	err error
}

type listResult struct {
	photos     []models.Photo
	nextCursor string
	err        error
}

// Handle processes an API Gateway v2 HTTP request.
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	photographerID, ok := extractSub(event)
	if !ok {
		return errResponse(401, "unauthorized"), nil
	}

	eventID := event.PathParameters["id"]
	if eventID == "" || !uuidRE.MatchString(eventID) {
		return errResponse(400, "missing or invalid event id"), nil
	}

	filter := event.QueryStringParameters["status"]
	if filter != "" && !validStatuses[filter] {
		return errResponse(400, "invalid status filter"), nil
	}
	cursor := event.QueryStringParameters["cursor"]
	limit := defaultPageSize
	if lStr := event.QueryStringParameters["limit"]; lStr != "" {
		if l, err2 := strconv.Atoi(lStr); err2 == nil && l > 0 && l <= 200 {
			limit = l
		}
	}

	// Launch both DynamoDB calls concurrently. The listing goroutine uses a
	// cancellable child context so it can be aborted early when ownership fails,
	// avoiding a wasted DynamoDB Query on unauthorised requests.
	listCtx, cancelList := context.WithCancel(ctx)
	defer cancelList()

	ownerCh := make(chan ownerResult, 1)
	listCh := make(chan listResult, 1)

	go func() {
		id, err := h.Events.GetEventPhotographerID(ctx, eventID)
		ownerCh <- ownerResult{id: id, err: err}
	}()

	go func() {
		photos, nc, err := h.Photos.ListPhotosByEvent(listCtx, eventID, filter, cursor, limit)
		listCh <- listResult{photos: photos, nextCursor: nc, err: err}
	}()

	// Evaluate ownership first; cancel and drain the listing goroutine if unauthorised.
	ownerRes := <-ownerCh
	if ownerRes.err != nil {
		cancelList() // abort in-flight DynamoDB Query
		<-listCh    // drain to prevent goroutine leak
		if errors.Is(ownerRes.err, ErrEventNotFound) {
			return errResponse(404, "event not found"), nil
		}
		slog.ErrorContext(ctx, "GetEventPhotographerID failed",
			slog.String("eventID", eventID),
			slog.String("error", ownerRes.err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}
	if ownerRes.id != photographerID {
		cancelList() // abort in-flight DynamoDB Query
		<-listCh    // drain to prevent goroutine leak
		return errResponse(403, "forbidden"), nil
	}

	listRes := <-listCh
	if listRes.err != nil {
		if errors.Is(listRes.err, ErrInvalidCursor) {
			return errResponse(400, "invalid cursor"), nil
		}
		slog.ErrorContext(ctx, "ListPhotosByEvent failed",
			slog.String("eventID", eventID),
			slog.String("error", listRes.err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	items := make([]photoItem, 0, len(listRes.photos))
	for _, p := range listRes.photos {
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
		NextCursor: listRes.nextCursor,
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
			"Content-Type": "application/json",
			// private: browser may cache; no-transform: disallow proxy modification.
			// 5-second TTL absorbs rapid refreshes during upload bursts without serving stale data.
			// no-store is intentionally NOT set on success responses — only on errors.
			"Cache-Control": "private, max-age=5, no-transform",
		},
		Body: string(b),
	}, nil
}
