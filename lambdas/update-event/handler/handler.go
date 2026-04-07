// Package handler implements the PUT /events/{id} Lambda business logic.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/aws/aws-lambda-go/events"

	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

const (
	maxNameLen          = 200
	maxLocationLen      = 200
	maxWatermarkTextLen = 200
)

// EventUpdater abstracts UpdateItem for the events table.
type EventUpdater interface {
	UpdateEvent(ctx context.Context, id, callerID string, fields UpdateFields) (*models.Event, error)
}

// UpdateFields holds the mutable fields that can be changed by the caller.
type UpdateFields struct {
	Name          string
	Date          string
	Location      string
	PricePerPhoto float64
	Currency      string
	WatermarkText string
}

// Handler holds the dependencies for the PUT /events/{id} Lambda.
type Handler struct {
	Store EventUpdater
}

type updateEventRequest struct {
	Name          string  `json:"name"`
	Date          string  `json:"date"`
	Location      string  `json:"location"`
	PricePerPhoto float64 `json:"pricePerPhoto"`
	Currency      string  `json:"currency"`
	WatermarkText string  `json:"watermarkText"`
}

// Handle processes an API Gateway v2 HTTP request.
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	callerID, ok := extractSub(event)
	if !ok {
		return errResponse(401, "unauthorized"), nil
	}

	id := event.PathParameters["id"]
	if id == "" {
		return errResponse(400, "id path parameter is required"), nil
	}

	var req updateEventRequest
	if err := json.Unmarshal([]byte(event.Body), &req); err != nil {
		return errResponse(400, "invalid request body"), nil
	}

	if err := validateUpdateRequest(req); err != nil {
		return errResponse(400, err.Error()), nil
	}

	fields := UpdateFields{
		Name:          req.Name,
		Date:          req.Date,
		Location:      req.Location,
		PricePerPhoto: req.PricePerPhoto,
		Currency:      req.Currency,
		WatermarkText: req.WatermarkText,
	}

	updated, err := h.Store.UpdateEvent(ctx, id, callerID, fields)
	if err != nil {
		if errors.Is(err, apperrors.ErrForbidden) {
			return errResponse(403, "forbidden"), nil
		}
		if errors.Is(err, apperrors.ErrNotFound) {
			return errResponse(404, "event not found"), nil
		}
		slog.ErrorContext(ctx, "UpdateEvent failed",
			slog.String("error", err.Error()),
			slog.String("id", id),
			slog.String("callerId", callerID),
		)
		return errResponse(500, "internal server error"), nil
	}

	return jsonResponse(200, updated)
}

func validateUpdateRequest(req updateEventRequest) error {
	if req.Name == "" {
		return fmt.Errorf("name is required")
	}
	if len(req.Name) > maxNameLen {
		return fmt.Errorf("name must be %d characters or fewer", maxNameLen)
	}
	if req.Date == "" {
		return fmt.Errorf("date is required")
	}
	if _, err := time.Parse("2006-01-02", req.Date); err != nil {
		return fmt.Errorf("date must be a valid ISO 8601 date (YYYY-MM-DD)")
	}
	if req.Location == "" {
		return fmt.Errorf("location is required")
	}
	if len(req.Location) > maxLocationLen {
		return fmt.Errorf("location must be %d characters or fewer", maxLocationLen)
	}
	if req.PricePerPhoto < 0 {
		return fmt.Errorf("pricePerPhoto must be non-negative")
	}
	if req.WatermarkText != "" && len(req.WatermarkText) > maxWatermarkTextLen {
		return fmt.Errorf("watermarkText must be %d characters or fewer", maxWatermarkTextLen)
	}
	return nil
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
