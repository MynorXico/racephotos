// Package handler implements the PUT /photographer/me Lambda business logic.
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aws/aws-lambda-go/events"

	"github.com/racephotos/shared/models"
)

const (
	maxDisplayNameLength      = 100
	maxBankNameLength         = 100
	maxBankAccountHolderLen   = 100
	maxBankAccountNumberLen   = 50
	maxBankInstructionsLength = 500
)

// validCurrencies is the curated list of supported ISO 4217 currency codes.
var validCurrencies = map[string]bool{
	"USD": true, "EUR": true, "GBP": true, "GTQ": true,
	"MXN": true, "CAD": true, "AUD": true, "BRL": true,
}

// validCurrencyList is a sorted, comma-separated string of validCurrencies keys,
// built once at startup for use in validation error messages.
var validCurrencyList = func() string {
	codes := make([]string, 0, len(validCurrencies))
	for k := range validCurrencies {
		codes = append(codes, k)
	}
	sort.Strings(codes)
	return strings.Join(codes, ", ")
}()

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

	// email is sourced from the Cognito JWT claim — it is not part of the request
	// body, so the caller cannot spoof it. It may be absent on older accounts.
	photographerEmail := extractClaim(event, "email")

	// Reject null or empty body before attempting to parse; json.Unmarshal
	// accepts "null" without error, leaving req at zero values.
	if event.Body == "" || event.Body == "null" {
		return errResponse(400, "invalid request body"), nil
	}

	var req updateRequest
	if err := json.Unmarshal([]byte(event.Body), &req); err != nil {
		return errResponse(400, "invalid request body"), nil
	}

	// Normalise before validation so the canonical values are stored.
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	req.DefaultCurrency = strings.ToUpper(strings.TrimSpace(req.DefaultCurrency))
	req.BankName = strings.TrimSpace(req.BankName)
	req.BankAccountHolder = strings.TrimSpace(req.BankAccountHolder)
	req.BankAccountNumber = strings.TrimSpace(req.BankAccountNumber)
	req.BankInstructions = strings.TrimSpace(req.BankInstructions)

	if err := validate(req); err != nil {
		return errResponse(400, err.Error()), nil
	}

	now := time.Now().UTC().Format(time.RFC3339)

	p := models.Photographer{
		ID:                photographerID,
		Email:             photographerEmail,
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
	if req.DisplayName == "" {
		return fmt.Errorf("displayName is required")
	}
	if utf8.RuneCountInString(req.DisplayName) > maxDisplayNameLength {
		return fmt.Errorf("displayName must not exceed %d characters", maxDisplayNameLength)
	}
	if req.DefaultCurrency == "" {
		return fmt.Errorf("defaultCurrency is required")
	}
	if !validCurrencies[req.DefaultCurrency] {
		return fmt.Errorf("unsupported currency code %q — must be one of %s",
			req.DefaultCurrency, validCurrencyList)
	}
	if utf8.RuneCountInString(req.BankName) > maxBankNameLength {
		return fmt.Errorf("bankName must not exceed %d characters", maxBankNameLength)
	}
	if utf8.RuneCountInString(req.BankAccountHolder) > maxBankAccountHolderLen {
		return fmt.Errorf("bankAccountHolder must not exceed %d characters", maxBankAccountHolderLen)
	}
	if utf8.RuneCountInString(req.BankAccountNumber) > maxBankAccountNumberLen {
		return fmt.Errorf("bankAccountNumber must not exceed %d characters", maxBankAccountNumberLen)
	}
	if utf8.RuneCountInString(req.BankInstructions) > maxBankInstructionsLength {
		return fmt.Errorf("bankInstructions must not exceed %d characters", maxBankInstructionsLength)
	}
	return nil
}

// extractSub returns the Cognito sub claim from the JWT authorizer context.
func extractSub(event events.APIGatewayV2HTTPRequest) (string, bool) {
	sub := extractClaim(event, "sub")
	return sub, sub != ""
}

// extractClaim returns a JWT claim value, or "" if absent.
func extractClaim(event events.APIGatewayV2HTTPRequest, claim string) string {
	if event.RequestContext.Authorizer == nil || event.RequestContext.Authorizer.JWT == nil {
		return ""
	}
	return event.RequestContext.Authorizer.JWT.Claims[claim]
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
