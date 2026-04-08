// Package handler implements the POST /events Lambda business logic.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"
	"unicode/utf8"

	"github.com/aws/aws-lambda-go/events"
	"github.com/google/uuid"

	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

const (
	maxNameLen          = 200
	maxLocationLen      = 200
	maxWatermarkTextLen = 200
)

// EventCreator abstracts PutItem for the events table.
type EventCreator interface {
	CreateEvent(ctx context.Context, e models.Event) error
}

// PhotographerReader abstracts GetItem for the photographers table (reads defaultCurrency).
type PhotographerReader interface {
	GetPhotographer(ctx context.Context, id string) (*models.Photographer, error)
}

// Handler holds the dependencies for the POST /events Lambda.
type Handler struct {
	Events        EventCreator
	Photographers PhotographerReader
}

// createEventRequest is the expected JSON body from the caller.
type createEventRequest struct {
	Name          string  `json:"name"`
	Date          string  `json:"date"`
	Location      string  `json:"location"`
	PricePerPhoto float64 `json:"pricePerPhoto"`
	Currency      string  `json:"currency"`
	WatermarkText string  `json:"watermarkText"`
}

// Handle processes an API Gateway v2 HTTP request.
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	photographerID, ok := extractSub(event)
	if !ok {
		return errResponse(401, "unauthorized"), nil
	}

	var req createEventRequest
	if err := json.Unmarshal([]byte(event.Body), &req); err != nil {
		return errResponse(400, "invalid request body"), nil
	}

	if err := validateCreateRequest(req); err != nil {
		return errResponse(400, err.Error()), nil
	}

	// Default currency to photographer.defaultCurrency if not provided.
	currency := req.Currency
	if currency == "" {
		p, err := h.Photographers.GetPhotographer(ctx, photographerID)
		if err != nil {
			if errors.Is(err, apperrors.ErrNotFound) {
				currency = "USD"
			} else {
				slog.ErrorContext(ctx, "GetPhotographer failed",
					slog.String("error", err.Error()),
				)
				return errResponse(500, "internal server error"), nil
			}
		} else {
			currency = p.DefaultCurrency
			if currency == "" {
				currency = "USD"
			}
		}
	}

	// Default watermarkText. Truncate by rune (not byte) to handle multi-byte
	// characters safely — the separator "·" and any non-ASCII name characters
	// are multi-byte in UTF-8.
	watermarkText := req.WatermarkText
	if watermarkText == "" {
		watermarkText = req.Name + " · racephotos.example.com"
		if runes := []rune(watermarkText); len(runes) > maxWatermarkTextLen {
			watermarkText = string(runes[:maxWatermarkTextLen])
		}
	}

	now := time.Now().UTC().Format(time.RFC3339)
	e := models.Event{
		ID:             uuid.New().String(),
		PhotographerID: photographerID,
		Name:           req.Name,
		Date:           req.Date,
		Location:       req.Location,
		PricePerPhoto:  req.PricePerPhoto,
		Currency:       currency,
		WatermarkText:  watermarkText,
		Status:         "active",
		Visibility:     "public",
		ArchivedAt:     "",
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	if err := h.Events.CreateEvent(ctx, e); err != nil {
		if errors.Is(err, apperrors.ErrConflict) {
			return errResponse(409, "event already exists"), nil
		}
		slog.ErrorContext(ctx, "CreateEvent failed",
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	return jsonResponse(201, e)
}

func validateCreateRequest(req createEventRequest) error {
	if req.Name == "" {
		return fmt.Errorf("name is required")
	}
	if utf8.RuneCountInString(req.Name) > maxNameLen {
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
	if utf8.RuneCountInString(req.Location) > maxLocationLen {
		return fmt.Errorf("location must be %d characters or fewer", maxLocationLen)
	}
	if req.PricePerPhoto < 0 {
		return fmt.Errorf("pricePerPhoto must be non-negative")
	}
	if req.WatermarkText != "" && utf8.RuneCountInString(req.WatermarkText) > maxWatermarkTextLen {
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
