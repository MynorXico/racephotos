// Package handler implements the PUT /photos/{id}/bibs Lambda business logic.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"

	"github.com/aws/aws-lambda-go/events"

	"github.com/racephotos/shared/models"
)

// uuidRE validates that a photo ID is a standard UUID (case-insensitive).
var uuidRE = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// Handler holds dependencies for PUT /photos/{id}/bibs.
type Handler struct {
	Photos   PhotoStore
	BibIndex BibIndexStore
	Events   EventStore
}

type tagBibsRequest struct {
	BibNumbers []string `json:"bibNumbers"`
}

type tagBibsResponse struct {
	ID         string   `json:"id"`
	EventID    string   `json:"eventId"`
	BibNumbers []string `json:"bibNumbers"`
	Status     string   `json:"status"`
	UploadedAt string   `json:"uploadedAt"`
}

// Handle processes an API Gateway v2 HTTP request for PUT /photos/{id}/bibs.
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	sub, ok := extractSub(event)
	if !ok {
		return errResponse(401, "unauthorized"), nil
	}

	photoID := event.PathParameters["id"]
	if photoID == "" || !uuidRE.MatchString(photoID) {
		return errResponse(400, "missing or invalid photo id"), nil
	}

	var req tagBibsRequest
	if err := json.Unmarshal([]byte(event.Body), &req); err != nil {
		return errResponse(400, "invalid request body"), nil
	}

	// Validate: reject any empty or whitespace-only bib string (AC4).
	for _, bib := range req.BibNumbers {
		if strings.TrimSpace(bib) == "" {
			return errResponse(400, "bibNumbers must not contain empty or whitespace-only values"), nil
		}
	}

	// Fetch the photo — needed for EventID and existence check.
	photo, err := h.Photos.GetPhoto(ctx, photoID)
	if err != nil {
		if errors.Is(err, ErrPhotoNotFound) {
			return errResponse(404, "photo not found"), nil
		}
		slog.ErrorContext(ctx, "GetPhoto failed",
			slog.String("photoID", photoID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	// Ownership: fetch event to check photographerId against JWT sub.
	ev, err := h.Events.GetEvent(ctx, photo.EventID)
	if err != nil {
		if errors.Is(err, ErrEventNotFound) {
			slog.ErrorContext(ctx, "photo references missing event",
				slog.String("photoID", photoID),
				slog.String("eventID", photo.EventID),
			)
			return errResponse(500, "internal server error"), nil
		}
		slog.ErrorContext(ctx, "GetEvent failed",
			slog.String("eventID", photo.EventID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}
	if ev.PhotographerID != sub {
		return errResponse(403, "forbidden"), nil
	}

	// Determine new status: indexed if bibs provided, else keep review_required.
	newStatus := models.PhotoStatusReviewRequired
	if len(req.BibNumbers) > 0 {
		newStatus = models.PhotoStatusIndexed
	}

	// BibIndex retag sequence — idempotent: a retry re-runs all four steps.
	if err := h.BibIndex.DeleteBibEntriesByPhoto(ctx, photoID); err != nil {
		slog.ErrorContext(ctx, "DeleteBibEntriesByPhoto failed",
			slog.String("photoID", photoID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	entries := buildBibEntries(photo.EventID, photoID, req.BibNumbers)
	if err := h.BibIndex.WriteBibEntries(ctx, entries); err != nil {
		slog.ErrorContext(ctx, "WriteBibEntries failed",
			slog.String("photoID", photoID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	if err := h.Photos.UpdatePhotoBibs(ctx, photoID, req.BibNumbers, newStatus); err != nil {
		if errors.Is(err, ErrPhotoNotTaggable) {
			return errResponse(409, "photo is no longer in a taggable state — refresh and try again"), nil
		}
		slog.ErrorContext(ctx, "UpdatePhotoBibs failed",
			slog.String("photoID", photoID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	bibs := req.BibNumbers
	if bibs == nil {
		bibs = []string{}
	}

	return jsonResponse(200, tagBibsResponse{
		ID:         photo.ID,
		EventID:    photo.EventID,
		BibNumbers: bibs,
		Status:     newStatus,
		UploadedAt: photo.UploadedAt,
	})
}

// buildBibEntries creates a BibEntry for each bib number using the composite
// key format {eventId}#{bibNumber} (ADR-0003).
func buildBibEntries(eventID, photoID string, bibs []string) []models.BibEntry {
	entries := make([]models.BibEntry, 0, len(bibs))
	for _, bib := range bibs {
		entries = append(entries, models.BibEntry{
			BibKey:  fmt.Sprintf("%s#%s", eventID, bib),
			PhotoID: photoID,
		})
	}
	return entries
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
		slog.Error("jsonResponse: marshal failed", slog.String("error", err.Error()))
		return errResponse(500, "internal server error"), nil
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
