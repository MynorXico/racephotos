package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/google/uuid"

	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

// Handler holds dependencies for PUT /purchases/{id}/approve.
type Handler struct {
	Purchases  PurchaseStore
	Orders     OrderStore
	Email      EmailSender
	AppBaseURL string // no trailing slash
}

type purchaseResponse struct {
	ID         string `json:"id"`
	OrderID    string `json:"orderId"`
	PhotoID    string `json:"photoId"`
	Status     string `json:"status"`
	ApprovedAt string `json:"approvedAt,omitempty"`
	ClaimedAt  string `json:"claimedAt"`
	// DownloadToken deliberately omitted — the token is the runner's credential,
	// delivered via SES. Returning it to the photographer's browser is unnecessary
	// and exposes a permanent download link to an unintended party.
}

// Handle processes PUT /purchases/{id}/approve.
// AC2, AC3, AC6, AC7, AC8 (RS-011).
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	purchaseID := event.PathParameters["id"]
	if purchaseID == "" {
		return errResponse(400, "purchase id is required"), nil
	}

	photographerID, ok := jwtSub(event)
	if !ok {
		return errResponse(401, "unauthorized"), nil
	}

	// Load the purchase.
	purchase, err := h.Purchases.GetPurchase(ctx, purchaseID)
	if err != nil {
		if errors.Is(err, apperrors.ErrNotFound) {
			return errResponse(404, "purchase not found"), nil
		}
		slog.ErrorContext(ctx, "GetPurchase failed",
			slog.String("service", "approve-purchase"),
			slog.String("purchaseID", purchaseID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	// Load the parent order to resolve ownership.
	order, err := h.Orders.GetOrder(ctx, purchase.OrderID)
	if err != nil {
		if errors.Is(err, apperrors.ErrNotFound) {
			slog.ErrorContext(ctx, "parent order not found",
				slog.String("service", "approve-purchase"),
				slog.String("purchaseID", purchaseID),
				slog.String("orderID", purchase.OrderID),
			)
			return errResponse(500, "internal server error"), nil
		}
		slog.ErrorContext(ctx, "GetOrder failed",
			slog.String("service", "approve-purchase"),
			slog.String("purchaseID", purchaseID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	// AC6: ownership check.
	if order.PhotographerID != photographerID {
		return errResponse(403, "forbidden"), nil
	}

	// AC3: idempotent — already approved.
	// Still run updateOrderStatus to repair any prior partial failure where the Purchase
	// was written but the Order rollup failed (e.g., Lambda timeout between the two writes).
	// The ConditionExpression guard in UpdateOrderStatus makes this a safe no-op if the
	// Order is already in a terminal state.
	if purchase.Status == models.OrderStatusApproved {
		if err := h.updateOrderStatus(ctx, order.ID, time.Now().UTC().Format(time.RFC3339)); err != nil {
			slog.ErrorContext(ctx, "updateOrderStatus failed on idempotent retry",
				slog.String("service", "approve-purchase"),
				slog.String("orderID", order.ID),
				slog.String("error", err.Error()),
			)
			// Log but do not fail — the Purchase is already persisted.
		}
		return jsonResponse(200, toResponse(purchase))
	}

	// AC8: terminal-state conflict — cannot approve a rejected purchase.
	if purchase.Status == models.OrderStatusRejected {
		return errResponse(409, "purchase is rejected and cannot be approved; the runner must resubmit"), nil
	}

	// Generate downloadToken (UUID v4) — ADR-0002.
	// uuid.NewRandom returns an error rather than panicking if crypto/rand fails.
	token, err := uuid.NewRandom()
	if err != nil {
		slog.ErrorContext(ctx, "failed to generate download token",
			slog.String("service", "approve-purchase"),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}
	downloadToken := token.String()
	now := time.Now().UTC().Format(time.RFC3339)

	// Update the purchase to approved (conditional — fails if concurrent write landed).
	if err := h.Purchases.UpdatePurchaseApproved(ctx, purchaseID, downloadToken, now); err != nil {
		if errors.Is(err, apperrors.ErrConflict) {
			// A concurrent approve or reject landed between our status read and this write.
			return errResponse(409, "purchase status changed concurrently; please refresh and retry"), nil
		}
		slog.ErrorContext(ctx, "UpdatePurchaseApproved failed",
			slog.String("service", "approve-purchase"),
			slog.String("purchaseID", purchaseID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	// Reload all purchases for the order and update Order.status.
	if err := h.updateOrderStatus(ctx, order.ID, now); err != nil {
		// Log but do not fail the request — the Purchase is already updated.
		slog.ErrorContext(ctx, "updateOrderStatus failed",
			slog.String("service", "approve-purchase"),
			slog.String("orderID", order.ID),
			slog.String("error", err.Error()),
		)
	}

	// AC2: send approval email to runner — fire and forget (Purchase already persisted).
	// runnerEmail is PII — never log it.
	downloadLink := fmt.Sprintf("%s/download/%s", h.AppBaseURL, downloadToken)
	h.sendApprovalEmail(ctx, purchase.RunnerEmail, order.EventName, downloadLink)

	slog.InfoContext(ctx, "purchase approved",
		slog.String("service", "approve-purchase"),
		slog.String("purchaseID", purchaseID),
		slog.String("orderID", order.ID),
	)

	// Build response with updated fields (downloadToken not included — delivered via SES).
	purchase.Status = models.OrderStatusApproved
	purchase.ApprovedAt = now
	return jsonResponse(200, toResponse(purchase))
}

// updateOrderStatus reloads all purchases for the order and sets Order.status accordingly.
func (h *Handler) updateOrderStatus(ctx context.Context, orderID, now string) error {
	purchases, err := h.Purchases.QueryPurchasesByOrder(ctx, orderID)
	if err != nil {
		return fmt.Errorf("updateOrderStatus: QueryPurchasesByOrder: %w", err)
	}

	newStatus := models.DeriveOrderStatus(purchases)
	if err := h.Orders.UpdateOrderStatus(ctx, orderID, newStatus, now); err != nil {
		return fmt.Errorf("updateOrderStatus: UpdateOrderStatus: %w", err)
	}
	return nil
}

// sendApprovalEmail sends the runner approval email (ADR-0002).
// Failures are logged but not surfaced — the Purchase is already persisted.
func (h *Handler) sendApprovalEmail(ctx context.Context, runnerEmail, eventName, downloadLink string) {
	if err := h.Email.SendTemplatedEmail(ctx, runnerEmail, "racephotos-runner-purchase-approved", map[string]string{
		"eventName":    eventName,
		"downloadLink": downloadLink,
	}); err != nil {
		// runnerEmail is PII — never include it in log output.
		slog.ErrorContext(ctx, "SendTemplatedEmail to runner failed",
			slog.String("service", "approve-purchase"),
			slog.String("error", err.Error()),
		)
	}
}

func toResponse(p *models.Purchase) purchaseResponse {
	return purchaseResponse{
		ID:         p.ID,
		OrderID:    p.OrderID,
		PhotoID:    p.PhotoID,
		Status:     p.Status,
		ApprovedAt: p.ApprovedAt,
		ClaimedAt:  p.ClaimedAt,
	}
}

func jwtSub(event events.APIGatewayV2HTTPRequest) (string, bool) {
	if event.RequestContext.Authorizer == nil || event.RequestContext.Authorizer.JWT == nil {
		return "", false
	}
	claims, ok := event.RequestContext.Authorizer.JWT.Claims["sub"]
	if !ok || claims == "" {
		return "", false
	}
	return claims, true
}

func maskEmail(email string) string {
	at := strings.IndexByte(email, '@')
	if at <= 0 {
		return "***"
	}
	return email[:1] + "***" + email[at:]
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

// maskEmail is used only for log entries in email-related errors — kept here as a
// reminder that runnerEmail must never appear unmasked in any log statement.
var _ = maskEmail
