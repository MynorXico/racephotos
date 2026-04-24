package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"regexp"
	"strconv"
	"strings"

	"github.com/aws/aws-lambda-go/events"
)

const defaultPageSize = 24
const maxPageSize = 50

// uuidRE validates that an event ID is a standard UUID (case-insensitive).
var uuidRE = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// safeS3KeyRE accepts only characters valid in a watermarked S3 key.
// Guards against a tampered DynamoDB record injecting an arbitrary URL.
var safeS3KeyRE = regexp.MustCompile(`^[A-Za-z0-9/_.\-]+$`)

// Handler holds dependencies for GET /events/{id}/public-photos.
type Handler struct {
	Photos    EventPhotoLister
	Events    PublicEventReader
	CdnDomain string
}

type photoItem struct {
	PhotoID        string  `json:"photoId"`
	WatermarkedURL string  `json:"watermarkedUrl"`
	CapturedAt     *string `json:"capturedAt,omitempty"`
}

type listPublicPhotosResponse struct {
	Photos        []photoItem `json:"photos"`
	NextCursor    *string     `json:"nextCursor"`
	TotalCount    int         `json:"totalCount"`
	EventName     string      `json:"eventName"`
	PricePerPhoto float64     `json:"pricePerPhoto"`
	Currency      string      `json:"currency"`
}

// Handle processes an API Gateway v2 HTTP request for GET /events/{id}/public-photos.
// This endpoint requires no authentication — it returns only indexed watermarked photos.
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	eventID := strings.ToLower(event.PathParameters["id"])
	if eventID == "" || !uuidRE.MatchString(eventID) {
		return errResponse(400, "missing or invalid event id"), nil
	}

	cursor := event.QueryStringParameters["cursor"]
	limit := defaultPageSize
	if lStr := event.QueryStringParameters["limit"]; lStr != "" {
		l, err := strconv.Atoi(lStr)
		if err != nil || l < 1 || l > maxPageSize {
			return errResponse(400, "limit must be between 1 and 50"), nil
		}
		limit = l
	}

	// Validate cursor format before hitting DynamoDB (AC9).
	if cursor != "" {
		if _, err := decodeCursor(cursor, eventID); err != nil {
			return errResponse(400, "invalid cursor"), nil
		}
	}

	// Run event metadata fetch and photo listing concurrently — both are independent reads.
	type eventRes struct {
		name          string
		totalCount    int
		pricePerPhoto float64
		currency      string
		err           error
	}
	type photosRes struct {
		photos     []photoItem
		nextCursor string
		err        error
	}

	evCh := make(chan eventRes, 1)
	phCh := make(chan photosRes, 1)

	go func() {
		ev, err := h.Events.GetPublicEvent(ctx, eventID)
		if err != nil {
			evCh <- eventRes{err: err}
			return
		}
		evCh <- eventRes{
			name:          ev.Name,
			totalCount:    ev.PhotoCount,
			pricePerPhoto: ev.PricePerPhoto,
			currency:      ev.Currency,
		}
	}()

	go func() {
		photos, nc, err := h.Photos.ListEventPhotos(ctx, eventID, cursor, limit)
		if err != nil {
			phCh <- photosRes{err: err}
			return
		}
		items := make([]photoItem, 0, len(photos))
		for _, p := range photos {
			if p.WatermarkedS3Key == "" || !safeS3KeyRE.MatchString(p.WatermarkedS3Key) || strings.Contains(p.WatermarkedS3Key, "..") {
				slog.Warn("skipping indexed photo with missing or malformed watermarkedS3Key",
					slog.String("photoId", p.ID),
				)
				continue
			}
			item := photoItem{
				PhotoID:        p.ID,
				WatermarkedURL: "https://" + h.CdnDomain + "/" + strings.TrimLeft(p.WatermarkedS3Key, "/"),
			}
			if p.CapturedAt != "" {
				item.CapturedAt = &p.CapturedAt
			}
			items = append(items, item)
		}
		phCh <- photosRes{photos: items, nextCursor: nc}
	}()

	evRes := <-evCh
	if evRes.err != nil {
		<-phCh // drain
		if errors.Is(evRes.err, ErrEventNotFound) {
			return errResponse(404, "event not found"), nil
		}
		slog.ErrorContext(ctx, "GetPublicEvent failed",
			slog.String("eventID", eventID),
			slog.String("error", evRes.err.Error()),
		)
		return errResponse(500, "internal error"), nil
	}

	phRes := <-phCh
	if phRes.err != nil {
		if errors.Is(phRes.err, ErrInvalidCursor) {
			return errResponse(400, "invalid cursor"), nil
		}
		slog.ErrorContext(ctx, "ListEventPhotos failed",
			slog.String("eventID", eventID),
			slog.String("error", phRes.err.Error()),
		)
		return errResponse(500, "internal error"), nil
	}

	var nextCursorPtr *string
	if phRes.nextCursor != "" {
		nc := phRes.nextCursor
		nextCursorPtr = &nc
	}

	return jsonResponse(200, listPublicPhotosResponse{
		Photos:        phRes.photos,
		NextCursor:    nextCursorPtr,
		TotalCount:    evRes.totalCount,
		EventName:     evRes.name,
		PricePerPhoto: evRes.pricePerPhoto,
		Currency:      evRes.currency,
	})
}

type errorBody struct {
	Error string `json:"error"`
}

func errResponse(statusCode int, message string) events.APIGatewayV2HTTPResponse {
	b, err := json.Marshal(errorBody{Error: message})
	if err != nil {
		b = []byte(`{"error":"internal error"}`)
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
		slog.Error("jsonResponse: marshal failed", slog.String("error", err.Error()))
		return errResponse(500, "internal error"), nil
	}
	return events.APIGatewayV2HTTPResponse{
		StatusCode: statusCode,
		Headers: map[string]string{
			"Content-Type": "application/json",
			// Public data: allow CDN and browser caching for 30 seconds.
			// Short TTL keeps the counter and photo list reasonably fresh as
			// processing completes. no-store is intentionally NOT set — this
			// endpoint is public and benefits from caching (AC8 latency target).
			"Cache-Control": "public, max-age=30, no-transform",
		},
		Body: string(b),
	}, nil
}
