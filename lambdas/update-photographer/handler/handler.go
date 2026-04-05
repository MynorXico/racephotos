// Package handler implements the PUT /photographer/me Lambda business logic.
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/racephotos/shared/models"
)

// validCurrencies is the curated list of supported ISO 4217 currency codes.
var validCurrencies = map[string]bool{
	"USD": true, "EUR": true, "GBP": true, "GTQ": true,
	"MXN": true, "CAD": true, "AUD": true, "BRL": true,
}

// PhotographerUpserter abstracts the DynamoDB write for the photographers table.
// A single UpdateItem call handles both create and update, preserving CreatedAt
// via if_not_exists — no pre-fetch required.
type PhotographerUpserter interface {
	UpsertPhotographer(ctx context.Context, p models.Photographer) (*models.Photographer, error)
}

// Handler holds the dependencies for the PUT /photographer/me Lambda.
type Handler struct {
	Store PhotographerUpserter
}

// updateRequest is the accepted request body shape.
type updateRequest struct {
	DisplayName       string `json:"displayName"`
	DefaultCurrency   string `json:"defaultCurrency"`
	BankName          string `json:"bankName"`
	BankAccountNumber string `json:"bankAccountNumber"`
	BankAccountHolder string `json:"bankAccountHolder"`
	BankInstructions  string `json:"bankInstructions"`
}

// Handle processes an API Gateway v2 HTTP request.
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	photographerID, ok := extractSub(event)
	if !ok {
		return errResponse(401, "unauthorized"), nil
	}

	var req updateRequest
	if err := json.Unmarshal([]byte(event.Body), &req); err != nil {
		return errResponse(400, "invalid request body"), nil
	}

	if err := validate(req); err != nil {
		return errResponse(400, err.Error()), nil
	}

	now := time.Now().UTC().Format(time.RFC3339)

	p := models.Photographer{
		ID:                photographerID,
		DisplayName:       req.DisplayName,
		DefaultCurrency:   req.DefaultCurrency,
		BankName:          req.BankName,
		BankAccountNumber: req.BankAccountNumber,
		BankAccountHolder: req.BankAccountHolder,
		BankInstructions:  req.BankInstructions,
		UpdatedAt:         now,
		// CreatedAt is managed by the UpdateItem if_not_exists expression.
	}

	result, err := h.Store.UpsertPhotographer(ctx, p)
	if err != nil {
		slog.ErrorContext(ctx, "UpsertPhotographer failed",
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	return jsonResponse(200, result)
}

// validate returns an error for invalid fields.
func validate(req updateRequest) error {
	if req.DefaultCurrency != "" && !validCurrencies[req.DefaultCurrency] {
		return fmt.Errorf("unsupported currency code %q — must be one of USD, EUR, GBP, GTQ, MXN, CAD, AUD, BRL",
			req.DefaultCurrency)
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
