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

// Handler holds dependencies for PUT /purchases/{id}/reject.
type Handler struct {
	Purchases PurchaseStore
	Orders    OrderStore
}

type purchaseResponse struct {
	ID        string `json:"id"`
	OrderID   string `json:"orderId"`
	PhotoID   string `json:"photoId"`
	Status    string `json:"status"`
	ClaimedAt string `json:"claimedAt"`
}

// Handle processes PUT /purchases/{id}/reject.
// AC4, AC5, AC6, AC7, AC8 (RS-011).
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	purchaseID := event.PathParameters["id"]
	if purchaseID == "" {
		return errResponse(400, "purchase id is required"), nil
	}

	photographerID, ok := jwtSub(event)
	if !ok {
		return errResponse(401, "unauthorized"), nil
	}

	purchase, err := h.Purchases.GetPurchase(ctx, purchaseID)
	if err != nil {
		if errors.Is(err, apperrors.ErrNotFound) {
			return errResponse(404, "purchase not found"), nil
		}
		slog.ErrorContext(ctx, "GetPurchase failed",
			slog.String("service", "reject-purchase"),
			slog.String("purchaseID", purchaseID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	order, err := h.Orders.GetOrder(ctx, purchase.OrderID)
	if err != nil {
		if errors.Is(err, apperrors.ErrNotFound) {
			slog.ErrorContext(ctx, "parent order not found",
				slog.String("service", "reject-purchase"),
				slog.String("purchaseID", purchaseID),
				slog.String("orderID", purchase.OrderID),
			)
			return errResponse(500, "internal server error"), nil
		}
		slog.ErrorContext(ctx, "GetOrder failed",
			slog.String("service", "reject-purchase"),
			slog.String("purchaseID", purchaseID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	// AC6: ownership check.
	if order.PhotographerID != photographerID {
		return errResponse(403, "forbidden"), nil
	}

	// AC5: idempotent — already rejected.
	if purchase.Status == models.OrderStatusRejected {
		return jsonResponse(200, toResponse(purchase))
	}

	// AC8: terminal-state conflict — cannot reject an approved purchase.
	if purchase.Status == models.OrderStatusApproved {
		return errResponse(409, "purchase is approved and cannot be rejected; the runner must resubmit"), nil
	}

	// Update the purchase to rejected (conditional — fails if concurrent write landed).
	// No email is sent to the runner in v1 (Out of scope).
	if err := h.Purchases.UpdatePurchaseRejected(ctx, purchaseID); err != nil {
		if errors.Is(err, apperrors.ErrConflict) {
			// A concurrent approve or reject landed between our status read and this write.
			return errResponse(409, "purchase status changed concurrently; please refresh and retry"), nil
		}
		slog.ErrorContext(ctx, "UpdatePurchaseRejected failed",
			slog.String("service", "reject-purchase"),
			slog.String("purchaseID", purchaseID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	now := time.Now().UTC().Format(time.RFC3339)

	// Reload all purchases for the order and update Order.status.
	if err := h.updateOrderStatus(ctx, order.ID, now); err != nil {
		slog.ErrorContext(ctx, "updateOrderStatus failed",
			slog.String("service", "reject-purchase"),
			slog.String("orderID", order.ID),
			slog.String("error", err.Error()),
		)
	}

	slog.InfoContext(ctx, "purchase rejected",
		slog.String("service", "reject-purchase"),
		slog.String("purchaseID", purchaseID),
		slog.String("orderID", order.ID),
	)

	purchase.Status = models.OrderStatusRejected
	return jsonResponse(200, toResponse(purchase))
}

func (h *Handler) updateOrderStatus(ctx context.Context, orderID, now string) error {
	purchases, err := h.Purchases.QueryPurchasesByOrder(ctx, orderID)
	if err != nil {
		return fmt.Errorf("updateOrderStatus: QueryPurchasesByOrder: %w", err)
	}
	newStatus := deriveOrderStatus(purchases)
	if err := h.Orders.UpdateOrderStatus(ctx, orderID, newStatus, now); err != nil {
		return fmt.Errorf("updateOrderStatus: UpdateOrderStatus: %w", err)
	}
	return nil
}

func deriveOrderStatus(purchases []*models.Purchase) string {
	if len(purchases) == 0 {
		return models.OrderStatusPending
	}
	approved, rejected := 0, 0
	for _, p := range purchases {
		switch p.Status {
		case models.OrderStatusApproved:
			approved++
		case models.OrderStatusRejected:
			rejected++
		}
	}
	switch {
	case approved == len(purchases):
		return models.OrderStatusApproved
	case rejected == len(purchases):
		return models.OrderStatusRejected
	default:
		return models.OrderStatusPending
	}
}

func toResponse(p *models.Purchase) purchaseResponse {
	return purchaseResponse{
		ID:        p.ID,
		OrderID:   p.OrderID,
		PhotoID:   p.PhotoID,
		Status:    p.Status,
		ClaimedAt: p.ClaimedAt,
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
