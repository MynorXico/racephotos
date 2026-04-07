// Package handler implements the GET /events/{id} Lambda business logic.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/aws/aws-lambda-go/events"
	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

// EventGetter abstracts GetItem for the events table.
type EventGetter interface {
	GetEvent(ctx context.Context, id string) (*models.Event, error)
}

// Handler holds the dependencies for the GET /events/{id} Lambda.
type Handler struct {
	Store EventGetter
}

// publicEventResponse is the response shape for the unauthenticated GET /events/{id}
// endpoint. It deliberately omits photographerId (Cognito sub) and other internal
// fields not needed by runners. Matches the AC3 response shape exactly.
type publicEventResponse struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Date          string  `json:"date"`
	Location      string  `json:"location"`
	PricePerPhoto float64 `json:"pricePerPhoto"`
	Currency      string  `json:"currency"`
	WatermarkText string  `json:"watermarkText"`
	Status        string  `json:"status"`
	CreatedAt     string  `json:"createdAt"`
}

// Handle processes an API Gateway v2 HTTP request.
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	id := event.PathParameters["id"]
	if id == "" {
		return errResponse(400, "id path parameter is required"), nil
	}

	e, err := h.Store.GetEvent(ctx, id)
	if err != nil {
		if errors.Is(err, apperrors.ErrNotFound) {
			return errResponse(404, "event not found"), nil
		}
		slog.ErrorContext(ctx, "GetEvent failed",
			slog.String("error", err.Error()),
			slog.String("id", id),
		)
		return errResponse(500, "internal server error"), nil
	}

	resp := publicEventResponse{
		ID:            e.ID,
		Name:          e.Name,
		Date:          e.Date,
		Location:      e.Location,
		PricePerPhoto: e.PricePerPhoto,
		Currency:      e.Currency,
		WatermarkText: e.WatermarkText,
		Status:        e.Status,
		CreatedAt:     e.CreatedAt,
	}

	b, err := json.Marshal(resp)
	if err != nil {
		return errResponse(500, "internal server error"), fmt.Errorf("Handle: marshal: %w", err)
	}
	// Public cacheable response: event data is stable; allow CDN and browser caching.
	// s-maxage=300 lets CloudFront absorb QR-code burst traffic at race finish lines.
	return events.APIGatewayV2HTTPResponse{
		StatusCode: 200,
		Headers: map[string]string{
			"Content-Type":  "application/json",
			"Cache-Control": "public, max-age=60, s-maxage=300",
		},
		Body: string(b),
	}, nil
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
