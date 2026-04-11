// Package handler implements GET /events/{id}/photos/search business logic.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"regexp"
	"strings"

	"github.com/aws/aws-lambda-go/events"

	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

// uuidRE validates that an event ID is a standard UUID (case-insensitive).
// This prevents pathological strings from reaching DynamoDB key lookups.
var uuidRE = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// bibRE validates a bib number: 1–8 alphanumeric characters.
// Road-race bibs are typically 1–5 digits; 8 chars accommodates letter suffixes.
// This prevents log injection (newlines, control chars) and unbounded DynamoDB key construction.
var bibRE = regexp.MustCompile(`^[0-9A-Za-z]{1,8}$`)

// safeS3KeyRE accepts only the characters that a well-formed watermarked S3 key may contain.
// This guards against a tampered DynamoDB record injecting an open-redirect URL into the
// watermarkedUrl field returned to runners.
var safeS3KeyRE = regexp.MustCompile(`^[A-Za-z0-9/_.\-]+$`)

// Handler holds dependencies for GET /events/{id}/photos/search.
type Handler struct {
	BibIndex  BibIndexStore
	Photos    PhotoStore
	Events    EventStore
	CdnDomain string
}

// photoItem is the per-photo shape returned to the runner.
// rawS3Key is deliberately omitted — never exposed to the client (domain rule 7).
type photoItem struct {
	PhotoID        string  `json:"photoId"`
	WatermarkedURL string  `json:"watermarkedUrl"`
	CapturedAt     *string `json:"capturedAt,omitempty"`
}

type searchResponse struct {
	Photos        []photoItem `json:"photos"`
	EventName     string      `json:"eventName"`
	PricePerPhoto float64     `json:"pricePerPhoto"`
	Currency      string      `json:"currency"`
}

type eventResult struct {
	event *models.Event
	err   error
}

type bibResult struct {
	photoIDs []string
	err      error
}

// Handle processes an API Gateway v2 HTTP request.
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	// Normalise to lowercase — UUIDs are case-insensitive but DynamoDB PKs are
	// case-sensitive; events are stored with lowercase IDs.
	eventID := strings.ToLower(event.PathParameters["id"])
	if eventID == "" || !uuidRE.MatchString(eventID) {
		return errResponse(400, "missing or invalid event id"), nil
	}

	bib := event.QueryStringParameters["bib"]
	if bib == "" || !bibRE.MatchString(bib) {
		return errResponse(400, "missing or invalid bib number"), nil
	}

	// Run GetEvent and GetPhotoIDsByBib concurrently — both are independent reads.
	evCh := make(chan eventResult, 1)
	bibCh := make(chan bibResult, 1)

	go func() {
		ev, err := h.Events.GetEvent(ctx, eventID)
		evCh <- eventResult{event: ev, err: err}
	}()

	go func() {
		ids, err := h.BibIndex.GetPhotoIDsByBib(ctx, eventID, bib)
		bibCh <- bibResult{photoIDs: ids, err: err}
	}()

	evRes := <-evCh
	if evRes.err != nil {
		if errors.Is(evRes.err, apperrors.ErrNotFound) {
			// Drain the bib goroutine to prevent a goroutine leak; log any
			// secondary error at WARN so concurrent failures are observable.
			if bibRes := <-bibCh; bibRes.err != nil {
				slog.WarnContext(ctx, "GetPhotoIDsByBib also failed during event 404",
					slog.String("eventID", eventID),
					slog.String("error", bibRes.err.Error()),
				)
			}
			return errResponse(404, "event not found"), nil
		}
		slog.ErrorContext(ctx, "GetEvent failed",
			slog.String("eventID", eventID),
			slog.String("error", evRes.err.Error()),
		)
		// Drain the bib goroutine to prevent a goroutine leak; log any
		// secondary error at WARN so concurrent failures are observable.
		if bibRes := <-bibCh; bibRes.err != nil {
			slog.WarnContext(ctx, "GetPhotoIDsByBib also failed during GetEvent error",
				slog.String("eventID", eventID),
				slog.String("error", bibRes.err.Error()),
			)
		}
		return errResponse(500, "internal server error"), nil
	}

	bibRes := <-bibCh
	if bibRes.err != nil {
		slog.ErrorContext(ctx, "GetPhotoIDsByBib failed",
			slog.String("eventID", eventID),
			slog.String("error", bibRes.err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	// No bib entries — return empty result with event metadata.
	if len(bibRes.photoIDs) == 0 {
		return jsonResponse(200, searchResponse{
			Photos:        []photoItem{},
			EventName:     evRes.event.Name,
			PricePerPhoto: evRes.event.PricePerPhoto,
			Currency:      evRes.event.Currency,
		})
	}

	photos, err := h.Photos.BatchGetPhotos(ctx, bibRes.photoIDs)
	if err != nil {
		slog.ErrorContext(ctx, "BatchGetPhotos failed",
			slog.String("eventID", eventID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	// Filter: only indexed photos with a valid watermark key (AC4).
	// WatermarkedS3Key is validated against safeS3KeyRE before URL construction
	// to prevent a tampered DynamoDB record from injecting an arbitrary URL.
	items := make([]photoItem, 0, len(photos))
	for _, p := range photos {
		if p.Status != models.PhotoStatusIndexed || p.WatermarkedS3Key == "" {
			continue
		}
		if !safeS3KeyRE.MatchString(p.WatermarkedS3Key) {
			slog.WarnContext(ctx, "skipping photo with malformed WatermarkedS3Key",
				slog.String("photoID", p.ID),
			)
			continue
		}
		item := photoItem{
			PhotoID:        p.ID,
			// TrimPrefix guards against an S3 key with a leading slash, which
			// would produce a double-slash URL (https://domain.com//path).
			WatermarkedURL: "https://" + h.CdnDomain + "/" + strings.TrimPrefix(p.WatermarkedS3Key, "/"),
		}
		if p.CapturedAt != "" {
			item.CapturedAt = &p.CapturedAt
		}
		items = append(items, item)
	}

	return jsonResponse(200, searchResponse{
		Photos:        items,
		EventName:     evRes.event.Name,
		PricePerPhoto: evRes.event.PricePerPhoto,
		Currency:      evRes.event.Currency,
	})
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
		slog.Error("jsonResponse: marshal failed", slog.String("error", err.Error()))
		return errResponse(500, "internal server error"), nil
	}
	// no-store: search results change as photos finish processing; caching would
	// cause runners to see a stale empty result when photos become available.
	return events.APIGatewayV2HTTPResponse{
		StatusCode: statusCode,
		Headers: map[string]string{
			"Content-Type":  "application/json",
			"Cache-Control": "no-store",
		},
		Body: string(b),
	}, nil
}
