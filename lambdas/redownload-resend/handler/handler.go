package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/aws/aws-lambda-go/events"

	"github.com/racephotos/shared/models"
)

const (
	rateLimitWindow = 3600 // 1 hour in seconds
	rateLimitMax    = 3
	sesTemplateName = "racephotos-runner-redownload-resend"
)

// Handler holds dependencies for POST /purchases/redownload-resend.
type Handler struct {
	Purchases  PurchaseStore
	RateLimit  RateLimitStore
	Email      EmailSender
	AppBaseURL string // no trailing slash
}

type resendRequest struct {
	Email string `json:"email"`
}

// Handle processes POST /purchases/redownload-resend.
// AC3: allowed request → 200 (always, regardless of purchases found)
// AC4: rate limit exceeded → 429
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	var req resendRequest
	if err := json.Unmarshal([]byte(event.Body), &req); err != nil || req.Email == "" {
		return errResponse(400, "email is required"), nil
	}

	rateLimitKey := fmt.Sprintf("REDOWNLOAD#%s", req.Email)
	allowed, err := h.RateLimit.IncrementAndCheck(ctx, rateLimitKey, rateLimitWindow, rateLimitMax)
	if err != nil {
		slog.ErrorContext(ctx, "RateLimit.IncrementAndCheck failed",
			slog.String("service", "redownload-resend"),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}
	if !allowed {
		return errResponse(429, "Too many requests. Please try again in an hour."), nil
	}

	// Fetch approved purchases — runnerEmail is PII, never log it.
	purchases, err := h.Purchases.GetApprovedPurchasesByEmail(ctx, req.Email)
	if err != nil {
		slog.ErrorContext(ctx, "GetApprovedPurchasesByEmail failed",
			slog.String("service", "redownload-resend"),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	// Send resend email only when there are approved purchases; always return 200
	// to avoid revealing whether an email address has purchases (AC3: no enumeration).
	if len(purchases) > 0 {
		h.sendResendEmail(ctx, req.Email, purchases)
	}

	return jsonResponse(200, map[string]string{
		"message": "If we have purchases for that email, you'll receive a link shortly.",
	})
}

// sendResendEmail sends the redownload-resend SES email.
// Failures are logged but not surfaced — the 200 is already committed.
func (h *Handler) sendResendEmail(ctx context.Context, email string, purchases []models.Purchase) {
	// Build a newline-separated list of download links for the template.
	links := ""
	for i, p := range purchases {
		if p.DownloadToken == nil {
			continue
		}
		if i > 0 {
			links += "\n"
		}
		links += fmt.Sprintf("%s/download/%s", h.AppBaseURL, *p.DownloadToken)
	}
	if links == "" {
		return
	}
	if err := h.Email.SendTemplatedEmail(ctx, email, sesTemplateName, map[string]string{
		"downloadLinks": links,
	}); err != nil {
		// runnerEmail is PII — never include it in log output.
		slog.ErrorContext(ctx, "SendTemplatedEmail failed",
			slog.String("service", "redownload-resend"),
			slog.String("error", err.Error()),
		)
	}
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
