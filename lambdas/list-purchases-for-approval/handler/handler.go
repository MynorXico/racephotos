package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/aws/aws-lambda-go/events"
)

// Handler holds dependencies for GET /photographer/me/purchases.
type Handler struct {
	Orders     OrderStore
	Purchases  PurchaseStore
	Photos     PhotoStore
	CDNBaseURL string // no trailing slash
}

// pendingPurchaseResponse is one item in the list response.
// runnerEmail is always returned in masked form (r***@domain.com).
type pendingPurchaseResponse struct {
	PurchaseID    string `json:"purchaseId"`
	PhotoID       string `json:"photoId"`
	EventID       string `json:"eventId"`
	EventName     string `json:"eventName"`
	RunnerEmail   string `json:"runnerEmail"`   // masked
	PaymentRef    string `json:"paymentRef"`
	ClaimedAt     string `json:"claimedAt"`
	WatermarkedURL string `json:"watermarkedUrl"`
}

// Handle processes an API Gateway v2 HTTP GET /photographer/me/purchases request.
// AC1, AC12, AC13 (RS-011).
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	// AC12: status query param is required and must be "pending".
	statusParam := event.QueryStringParameters["status"]
	if statusParam != "pending" {
		return errResponse(400, `status query param is required and must be "pending"`), nil
	}

	// Extract the Cognito JWT sub from the request context (API Gateway JWT authorizer).
	photographerID, ok := jwtSub(event)
	if !ok {
		return errResponse(401, "unauthorized"), nil
	}

	// Step 1: query pending orders for this photographer.
	orders, err := h.Orders.QueryPendingOrdersByPhotographer(ctx, photographerID)
	if err != nil {
		slog.ErrorContext(ctx, "QueryPendingOrdersByPhotographer failed",
			slog.String("service", "list-purchases-for-approval"),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	// AC13: return empty array when no pending orders.
	if len(orders) == 0 {
		return jsonResponse(200, []pendingPurchaseResponse{})
	}

	// Step 2: for each order query its purchase line items.
	// Build order lookup map for later metadata join.
	orderByID := make(map[string]*orderMeta, len(orders))
	for _, o := range orders {
		orderByID[o.ID] = &orderMeta{
			eventID:    o.EventID,
			eventName:  o.EventName,
			paymentRef: o.PaymentRef,
		}
	}

	// Collect all purchases across all orders, and collect unique photoIds.
	type purchaseEntry struct {
		purchase *purchaseRow
		orderID  string
	}
	var entries []purchaseEntry
	photoIDSet := make(map[string]bool)

	for _, o := range orders {
		purchases, err := h.Purchases.QueryPurchasesByOrder(ctx, o.ID)
		if err != nil {
			slog.ErrorContext(ctx, "QueryPurchasesByOrder failed",
				slog.String("service", "list-purchases-for-approval"),
				slog.String("orderID", o.ID),
				slog.String("error", err.Error()),
			)
			return errResponse(500, "internal server error"), nil
		}
		for _, p := range purchases {
			entries = append(entries, purchaseEntry{
				purchase: &purchaseRow{
					id:          p.ID,
					photoID:     p.PhotoID,
					runnerEmail: p.RunnerEmail,
					claimedAt:   p.ClaimedAt,
				},
				orderID: o.ID,
			})
			photoIDSet[p.PhotoID] = true
		}
	}

	// Deduplicate photoIds.
	photoIDs := make([]string, 0, len(photoIDSet))
	for id := range photoIDSet {
		photoIDs = append(photoIDs, id)
	}

	// Step 3: batch get photos to resolve watermarkedS3Key.
	photoByID := make(map[string]string) // photoID → watermarkedUrl
	if len(photoIDs) > 0 {
		photos, err := h.Photos.BatchGetPhotos(ctx, photoIDs)
		if err != nil {
			slog.ErrorContext(ctx, "BatchGetPhotos failed",
				slog.String("service", "list-purchases-for-approval"),
				slog.String("error", err.Error()),
			)
			return errResponse(500, "internal server error"), nil
		}
		for _, p := range photos {
			if p.WatermarkedS3Key != "" {
				photoByID[p.ID] = fmt.Sprintf("%s/%s", h.CDNBaseURL, p.WatermarkedS3Key)
			}
		}
	}

	// Build response items.
	result := make([]pendingPurchaseResponse, 0, len(entries))
	for _, e := range entries {
		meta, ok := orderByID[e.orderID]
		if !ok {
			continue
		}
		result = append(result, pendingPurchaseResponse{
			PurchaseID:    e.purchase.id,
			PhotoID:       e.purchase.photoID,
			EventID:       meta.eventID,
			EventName:     meta.eventName,
			RunnerEmail:   maskEmail(e.purchase.runnerEmail),
			PaymentRef:    meta.paymentRef,
			ClaimedAt:     e.purchase.claimedAt,
			WatermarkedURL: photoByID[e.purchase.photoID], // empty string if photo not found
		})
	}

	return jsonResponse(200, result)
}

// orderMeta holds denormalised Order fields needed to build the response.
type orderMeta struct {
	eventID    string
	eventName  string
	paymentRef string
}

// purchaseRow holds the Purchase fields extracted per line item.
type purchaseRow struct {
	id          string
	photoID     string
	runnerEmail string
	claimedAt   string
}

// jwtSub extracts the Cognito JWT sub from the API Gateway v2 request context.
// Returns (sub, true) on success, ("", false) when the JWT authorizer context is absent.
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

// maskEmail returns a privacy-safe version of the email address.
// e.g. "runner@example.com" → "r***@example.com".
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
