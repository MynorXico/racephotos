package handler

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/google/uuid"

	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

// emailRE validates RFC 5321-compatible email addresses for the runner-facing input.
// Deliberately permissive: rejects the most obvious invalid formats without over-validating
// internationalised or unusual-but-valid addresses.
var emailRE = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

// paymentRefChars is the alphabet used for the 8-character random suffix of a paymentRef.
const paymentRefChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// paymentRefRandLen is the length of the random suffix appended to "RS-".
const paymentRefRandLen = 8

// maxPhotoIDs caps the number of photos in a single order to limit DynamoDB cost
// amplification on this unauthenticated endpoint. RS-011 (multi-photo cart) will not
// exceed this limit in its v1 scope.
const maxPhotoIDs = 20

// Handler holds dependencies for POST /orders.
type Handler struct {
	Orders        OrderStore
	Purchases     PurchaseStore
	Writer        OrderTransacter
	Photos        PhotoStore
	Events        EventStore
	Photographers PhotographerStore
	Email         EmailSender
	ApprovalsURL  string
}

type createOrderRequest struct {
	PhotoIDs    []string `json:"photoIds"`
	RunnerEmail string   `json:"runnerEmail"`
}

type bankDetails struct {
	BankName          string `json:"bankName"`
	BankAccountNumber string `json:"bankAccountNumber"`
	BankAccountHolder string `json:"bankAccountHolder"`
	BankInstructions  string `json:"bankInstructions"`
}

type createOrderResponse struct {
	OrderID     string      `json:"orderId"`
	PaymentRef  string      `json:"paymentRef"`
	TotalAmount float64     `json:"totalAmount"`
	Currency    string      `json:"currency"`
	BankDetails bankDetails `json:"bankDetails"`
}

// Handle processes an API Gateway v2 HTTP POST /orders request.
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	var req createOrderRequest
	if err := json.Unmarshal([]byte(event.Body), &req); err != nil {
		return errResponse(400, "invalid request body"), nil
	}

	// AC3: at least one photo is required.
	if len(req.PhotoIDs) == 0 {
		return errResponse(400, "at least one photo is required"), nil
	}

	// Guard against cost-amplification on this unauthenticated endpoint.
	if len(req.PhotoIDs) > maxPhotoIDs {
		return errResponse(400, fmt.Sprintf("too many photos in one order (max %d)", maxPhotoIDs)), nil
	}

	// AC7: validate email format.
	if !emailRE.MatchString(req.RunnerEmail) {
		return errResponse(400, "invalid email address"), nil
	}

	// Deduplicate photoIds preserving order (guards against accidental double-sends).
	photoIDs := deduplicate(req.PhotoIDs)

	// Reject empty-string photoIds that survive deduplication.
	for _, id := range photoIDs {
		if id == "" {
			return errResponse(400, "photoIds must not contain empty values"), nil
		}
	}

	// AC2: Idempotency — check whether all (photoId, runnerEmail) pairs already have
	// an active (pending/approved) Purchase. If so, return the existing Order (HTTP 200).
	existingOrderID, allActive, err := h.checkIdempotency(ctx, photoIDs, req.RunnerEmail)
	if err != nil {
		slog.ErrorContext(ctx, "checkIdempotency failed", slog.String("error", err.Error()))
		return errResponse(500, "internal server error"), nil
	}
	if allActive {
		return h.buildIdempotentResponse(ctx, existingOrderID)
	}

	// Fetch all requested photos.
	photos, httpResp, err := h.fetchAndValidatePhotos(ctx, photoIDs)
	if err != nil {
		slog.ErrorContext(ctx, "fetchAndValidatePhotos failed", slog.String("error", err.Error()))
		return errResponse(500, "internal server error"), nil
	}
	if httpResp != nil {
		return *httpResp, nil
	}

	// Resolve event and photographer via the first photo's eventId.
	eventID := photos[0].EventID
	ev, err := h.Events.GetEvent(ctx, eventID)
	if err != nil {
		if errors.Is(err, apperrors.ErrNotFound) {
			return errResponse(404, "event not found"), nil
		}
		slog.ErrorContext(ctx, "GetEvent failed", slog.String("eventID", eventID), slog.String("error", err.Error()))
		return errResponse(500, "internal server error"), nil
	}

	photographer, err := h.Photographers.GetPhotographer(ctx, ev.PhotographerID)
	if err != nil {
		if errors.Is(err, apperrors.ErrNotFound) {
			slog.ErrorContext(ctx, "photographer record not found", slog.String("photographerID", ev.PhotographerID))
			return errResponse(500, "internal server error"), nil
		}
		slog.ErrorContext(ctx, "GetPhotographer failed", slog.String("error", err.Error()))
		return errResponse(500, "internal server error"), nil
	}

	// Generate IDs.
	orderID := uuid.New().String()
	paymentRef, err := generatePaymentRef()
	if err != nil {
		slog.ErrorContext(ctx, "generatePaymentRef failed", slog.String("error", err.Error()))
		return errResponse(500, "internal server error"), nil
	}

	now := time.Now().UTC().Format(time.RFC3339)
	totalAmount := ev.PricePerPhoto * float64(len(photoIDs))

	// Build Order and Purchase records before any write.
	order := models.Order{
		ID:             orderID,
		RunnerEmail:    req.RunnerEmail,
		PaymentRef:     paymentRef,
		TotalAmount:    totalAmount,
		Currency:       ev.Currency,
		Status:         models.OrderStatusPending,
		PhotographerID: ev.PhotographerID,
		EventID:        eventID,
		EventName:      ev.Name,
		ClaimedAt:      now,
	}
	purchases := make([]models.Purchase, 0, len(photos))
	for _, p := range photos {
		purchases = append(purchases, models.Purchase{
			ID:          uuid.New().String(),
			OrderID:     orderID,
			PhotoID:     p.ID,
			RunnerEmail: req.RunnerEmail,
			Status:      models.OrderStatusPending,
			ClaimedAt:   now,
		})
	}

	// Persist Order and all Purchases atomically. TransactWriteItems guarantees
	// that either all records land or none do — no orphaned Orders with missing
	// Purchases on Lambda timeout or transient DynamoDB error.
	if err := h.Writer.CreateOrderWithPurchases(ctx, order, purchases); err != nil {
		slog.ErrorContext(ctx, "CreateOrderWithPurchases failed", slog.String("error", err.Error()))
		return errResponse(500, "internal server error"), nil
	}

	// AC8: notify photographer with masked runner email.
	h.sendPhotographerEmail(ctx, photographer.Email, ev, orderID, paymentRef, req.RunnerEmail)

	// AC9: confirm to runner.
	h.sendRunnerEmail(ctx, req.RunnerEmail, ev, orderID, paymentRef)

	// paymentRef is a financial identifier — never log it in plain text (CLAUDE.md).
	slog.InfoContext(ctx, "order created",
		slog.String("orderID", orderID),
		slog.Int("photoCount", len(photoIDs)),
	)

	return jsonResponse(201, createOrderResponse{
		OrderID:     orderID,
		PaymentRef:  paymentRef,
		TotalAmount: totalAmount,
		Currency:    ev.Currency,
		BankDetails: bankDetails{
			BankName:          photographer.BankName,
			BankAccountNumber: photographer.BankAccountNumber,
			BankAccountHolder: photographer.BankAccountHolder,
			BankInstructions:  photographer.BankInstructions,
		},
	})
}

// buildIdempotentResponse returns HTTP 200 with the existing Order's response body.
func (h *Handler) buildIdempotentResponse(ctx context.Context, orderID string) (events.APIGatewayV2HTTPResponse, error) {
	order, err := h.Orders.GetOrderByID(ctx, orderID)
	if err != nil {
		slog.ErrorContext(ctx, "GetOrderByID failed (idempotent path)", slog.String("error", err.Error()))
		return errResponse(500, "internal server error"), nil
	}
	photographer, err := h.Photographers.GetPhotographer(ctx, order.PhotographerID)
	if err != nil {
		slog.ErrorContext(ctx, "GetPhotographer failed (idempotent path)", slog.String("error", err.Error()))
		return errResponse(500, "internal server error"), nil
	}
	return jsonResponse(200, createOrderResponse{
		OrderID:     order.ID,
		PaymentRef:  order.PaymentRef,
		TotalAmount: order.TotalAmount,
		Currency:    order.Currency,
		BankDetails: bankDetails{
			BankName:          photographer.BankName,
			BankAccountNumber: photographer.BankAccountNumber,
			BankAccountHolder: photographer.BankAccountHolder,
			BankInstructions:  photographer.BankInstructions,
		},
	})
}

// fetchAndValidatePhotos fetches all photos and validates AC4, AC5, AC6.
// Returns (photos, nil, nil) on success.
// Returns (nil, &errResp, nil) when a validation error produces an HTTP error response.
// Returns (nil, nil, err) on an unexpected internal error.
func (h *Handler) fetchAndValidatePhotos(ctx context.Context, photoIDs []string) ([]*models.Photo, *events.APIGatewayV2HTTPResponse, error) {
	photos := make([]*models.Photo, 0, len(photoIDs))
	for _, id := range photoIDs {
		p, err := h.Photos.GetPhoto(ctx, id)
		if err != nil {
			if errors.Is(err, apperrors.ErrNotFound) {
				r := errResponse(404, "one or more photos not found")
				return nil, &r, nil
			}
			return nil, nil, fmt.Errorf("GetPhoto %s: %w", id, err)
		}
		photos = append(photos, p)
	}

	// AC5: all photos must have status=indexed.
	for _, p := range photos {
		if p.Status != models.PhotoStatusIndexed {
			r := errResponse(422, "one or more photos are not available for purchase")
			return nil, &r, nil
		}
	}

	// AC6: all photos must belong to the same event (and therefore the same photographer).
	eventID := photos[0].EventID
	for _, p := range photos[1:] {
		if p.EventID != eventID {
			r := errResponse(422, "all photos in an order must belong to the same event")
			return nil, &r, nil
		}
	}

	return photos, nil, nil
}

// checkIdempotency checks whether all (photoID, runnerEmail) pairs have an active
// (pending/approved) Purchase. Returns the orderId of the first active purchase found
// and allActive=true if all pairs are active.
func (h *Handler) checkIdempotency(ctx context.Context, photoIDs []string, runnerEmail string) (orderID string, allActive bool, err error) {
	for _, photoID := range photoIDs {
		p, err := h.Purchases.GetPurchaseByPhotoAndEmail(ctx, photoID, runnerEmail)
		if err != nil {
			return "", false, fmt.Errorf("checkIdempotency: %w", err)
		}
		if p == nil || p.Status == models.OrderStatusRejected {
			// Not active — proceed to create a new Order.
			return "", false, nil
		}
		// pending or approved — capture the orderId from the first active pair found.
		if orderID == "" {
			orderID = p.OrderID
		}
	}
	if orderID == "" {
		// Defensive: photoIDs is validated non-empty before this call.
		return "", false, nil
	}
	return orderID, true, nil
}

// sendPhotographerEmail sends the photographer claim notification (AC8).
// Email failures are logged but not returned to the caller — the Order is already persisted.
// Template variables match racephotos-photographer-claim: runnerEmailMasked, eventName, photoReference, paymentReference, dashboardUrl.
// photoReference is the orderID (consistent with runner email); paymentReference is the RS-XXXXX
// bank transfer reference so the photographer can match the incoming transfer to this claim.
func (h *Handler) sendPhotographerEmail(ctx context.Context, to string, ev *models.Event, orderID string, paymentRef string, runnerEmail string) {
	if err := h.Email.SendTemplatedEmail(ctx, to, "racephotos-photographer-claim", map[string]string{
		"runnerEmailMasked": maskEmail(runnerEmail),
		"eventName":         ev.Name,
		"photoReference":    orderID,
		"paymentReference":  paymentRef,
		"dashboardUrl":      h.ApprovalsURL,
	}); err != nil {
		slog.ErrorContext(ctx, "SendTemplatedEmail to photographer failed", slog.String("error", err.Error()))
	}
}

// sendRunnerEmail sends the runner claim confirmation (AC9).
// Email failures are logged but not returned to the caller.
// Template variables match racephotos-runner-claim-confirmation: eventName, photoReference, paymentReference.
func (h *Handler) sendRunnerEmail(ctx context.Context, to string, ev *models.Event, orderID string, paymentRef string) {
	if err := h.Email.SendTemplatedEmail(ctx, to, "racephotos-runner-claim-confirmation", map[string]string{
		"eventName":        ev.Name,
		"photoReference":   orderID,
		"paymentReference": paymentRef,
	}); err != nil {
		slog.ErrorContext(ctx, "SendTemplatedEmail to runner failed", slog.String("error", err.Error()))
	}
}

// maskEmail returns a privacy-safe version of the email address for logging and
// photographer notifications (ADR-0002). e.g. "runner@example.com" → "r***@example.com".
func maskEmail(email string) string {
	at := strings.IndexByte(email, '@')
	if at <= 0 {
		return "***"
	}
	return email[:1] + "***" + email[at:]
}

// generatePaymentRef returns "RS-" followed by paymentRefRandLen uppercase alphanumeric
// characters drawn from crypto/rand. Uses rejection sampling to eliminate modulo bias
// (36 chars is not a power of two).
func generatePaymentRef() (string, error) {
	const threshold = 252 // largest multiple of 36 that fits in a byte (7 × 36)
	result := make([]byte, 0, paymentRefRandLen)
	for len(result) < paymentRefRandLen {
		buf := make([]byte, paymentRefRandLen*2)
		if _, err := rand.Read(buf); err != nil {
			return "", fmt.Errorf("generatePaymentRef: %w", err)
		}
		for _, b := range buf {
			if int(b) >= threshold {
				continue // skip to avoid bias
			}
			result = append(result, paymentRefChars[int(b)%len(paymentRefChars)])
			if len(result) == paymentRefRandLen {
				break
			}
		}
	}
	return "RS-" + string(result), nil
}

// deduplicate returns ids with duplicate values removed, preserving original order.
func deduplicate(ids []string) []string {
	seen := make(map[string]bool, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
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
