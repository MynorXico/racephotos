// Package handler implements the GET /events Lambda business logic.
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

const (
	defaultPageSize = 20
	maxPageSize     = 50
)

// EventStore abstracts the public active-events query on the events table.
type EventStore interface {
	ListActiveEvents(ctx context.Context, cursor string, limit int) ([]models.Event, string, error)
}

// Handler holds the dependencies for the GET /events Lambda.
type Handler struct {
	Store EventStore
}

// publicEvent is the response shape for a single event in the public listing.
// Only the fields required by AC1 are exposed — sensitive fields are omitted.
type publicEvent struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Date      string `json:"date"`
	Location  string `json:"location"`
	CreatedAt string `json:"createdAt"`
}

type listEventsResponse struct {
	Events     []publicEvent `json:"events"`
	NextCursor *string       `json:"nextCursor"`
}

// Handle processes an API Gateway v2 HTTP request.
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	cursor := event.QueryStringParameters["cursor"]
	limit := parseLimit(event.QueryStringParameters["limit"])

	result, nextCursor, err := h.Store.ListActiveEvents(ctx, cursor, limit)
	if err != nil {
		if errors.Is(err, ErrInvalidCursor) {
			return errResponse(400, "invalid cursor"), nil
		}
		slog.ErrorContext(ctx, "ListActiveEvents failed",
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal error"), nil
	}

	public := make([]publicEvent, len(result))
	for i, e := range result {
		public[i] = publicEvent{
			ID:        e.ID,
			Name:      e.Name,
			Date:      e.Date,
			Location:  e.Location,
			CreatedAt: e.CreatedAt,
		}
	}

	var nc *string
	if nextCursor != "" {
		nc = &nextCursor
	}

	return jsonResponse(200, listEventsResponse{
		Events:     public,
		NextCursor: nc,
	})
}

func parseLimit(raw string) int {
	if raw == "" {
		return defaultPageSize
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 || n > maxPageSize {
		return defaultPageSize
	}
	return n
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
			"Content-Type":                "application/json",
			"Cache-Control":               "no-store",
			"Access-Control-Allow-Origin": "*",
		},
		Body: string(b),
	}
}

func jsonResponse(statusCode int, body any) (events.APIGatewayV2HTTPResponse, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return errResponse(500, "internal error"), fmt.Errorf("jsonResponse: marshal: %w", err)
	}
	return events.APIGatewayV2HTTPResponse{
		StatusCode: statusCode,
		Headers: map[string]string{
			"Content-Type":                "application/json",
			"Cache-Control":               "private, max-age=30",
			"Access-Control-Allow-Origin": "*",
		},
		Body: string(b),
	}, nil
}
