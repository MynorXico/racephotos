package handler_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/golang/mock/gomock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/racephotos/create-order/handler"
	"github.com/racephotos/create-order/handler/mocks"
	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

const (
	testPhotographerID = "photographer-1"
	testEventID        = "550e8400-e29b-41d4-a716-446655440001"
	testPhotoID        = "photo-1"
	testPhoto2ID       = "photo-2"
	testRunnerEmail    = "runner@example.com"
	testApprovalsURL   = "https://example.com/approvals"
)

var (
	testPhoto = &models.Photo{
		ID:               testPhotoID,
		EventID:          testEventID,
		Status:           models.PhotoStatusIndexed,
		WatermarkedS3Key: "processed/photo-1.jpg",
	}
	testPhoto2 = &models.Photo{
		ID:               testPhoto2ID,
		EventID:          testEventID,
		Status:           models.PhotoStatusIndexed,
		WatermarkedS3Key: "processed/photo-2.jpg",
	}
	testEvent = &models.Event{
		ID:             testEventID,
		PhotographerID: testPhotographerID,
		Name:           "Spring Race 2026",
		PricePerPhoto:  75.0,
		Currency:       "GTQ",
	}
	testPhotographer = &models.Photographer{
		ID:                testPhotographerID,
		Email:             "photographer@example.com",
		DisplayName:       "Jane Photo",
		BankName:          "Banco Industrial",
		BankAccountNumber: "1234567890",
		BankAccountHolder: "Jane Doe",
		BankInstructions:  "Include payment ref in notes",
	}
)

func makeReq(t *testing.T, photoIDs []string, email string) events.APIGatewayV2HTTPRequest {
	t.Helper()
	return makeReqWithLocale(t, photoIDs, email, "en")
}

func makeReqWithLocale(t *testing.T, photoIDs []string, email string, locale string) events.APIGatewayV2HTTPRequest {
	t.Helper()
	body, err := json.Marshal(map[string]interface{}{
		"photoIds":    photoIDs,
		"runnerEmail": email,
		"locale":      locale,
	})
	require.NoError(t, err)
	return events.APIGatewayV2HTTPRequest{Body: string(body)}
}

func newHandler(ctrl *gomock.Controller) (
	*handler.Handler,
	*mocks.MockOrderStore,
	*mocks.MockPurchaseStore,
	*mocks.MockOrderTransacter,
	*mocks.MockPhotoStore,
	*mocks.MockEventStore,
	*mocks.MockPhotographerStore,
	*mocks.MockEmailSender,
) {
	orders := mocks.NewMockOrderStore(ctrl)
	purchases := mocks.NewMockPurchaseStore(ctrl)
	writer := mocks.NewMockOrderTransacter(ctrl)
	photos := mocks.NewMockPhotoStore(ctrl)
	evStore := mocks.NewMockEventStore(ctrl)
	phStore := mocks.NewMockPhotographerStore(ctrl)
	email := mocks.NewMockEmailSender(ctrl)
	h := &handler.Handler{
		Orders:        orders,
		Purchases:     purchases,
		Writer:        writer,
		Photos:        photos,
		Events:        evStore,
		Photographers: phStore,
		Email:         email,
		ApprovalsURL:  testApprovalsURL,
	}
	return h, orders, purchases, writer, photos, evStore, phStore, email
}

func TestHandle_HappyPath(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, purchases, writer, photos, evStore, phStore, email := newHandler(ctrl)

	photos.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(testPhoto, nil)
	purchases.EXPECT().GetPurchaseByPhotoAndEmail(gomock.Any(), testPhotoID, testRunnerEmail).Return(nil, nil)
	evStore.EXPECT().GetEvent(gomock.Any(), testEventID).Return(testEvent, nil)
	phStore.EXPECT().GetPhotographer(gomock.Any(), testPhotographerID).Return(testPhotographer, nil)
	writer.EXPECT().CreateOrderWithPurchases(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
	email.EXPECT().SendTemplatedEmail(gomock.Any(), testPhotographer.Email, "racephotos-photographer-claim-en", gomock.Any()).Return(nil)
	email.EXPECT().SendTemplatedEmail(gomock.Any(), testRunnerEmail, "racephotos-runner-claim-confirmation-en", gomock.Any()).Return(nil)

	resp, err := h.Handle(context.Background(), makeReq(t, []string{testPhotoID}, testRunnerEmail))
	require.NoError(t, err)
	assert.Equal(t, 201, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(resp.Body), &body))
	assert.NotEmpty(t, body["orderId"])
	assert.NotEmpty(t, body["paymentRef"])
	assert.Equal(t, 75.0, body["totalAmount"])
	assert.Equal(t, "GTQ", body["currency"])
	bd, ok := body["bankDetails"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "Banco Industrial", bd["bankName"])
}

func TestHandle_HappyPath_MultiPhoto(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, purchases, writer, photos, evStore, phStore, email := newHandler(ctrl)

	photos.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(testPhoto, nil)
	photos.EXPECT().GetPhoto(gomock.Any(), testPhoto2ID).Return(testPhoto2, nil)
	// checkIdempotency exits on first nil — only photo-1 is queried before returning allActive=false.
	purchases.EXPECT().GetPurchaseByPhotoAndEmail(gomock.Any(), testPhotoID, testRunnerEmail).Return(nil, nil)
	evStore.EXPECT().GetEvent(gomock.Any(), testEventID).Return(testEvent, nil)
	phStore.EXPECT().GetPhotographer(gomock.Any(), testPhotographerID).Return(testPhotographer, nil)
	writer.EXPECT().CreateOrderWithPurchases(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
	email.EXPECT().SendTemplatedEmail(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).Times(2)

	resp, err := h.Handle(context.Background(), makeReq(t, []string{testPhotoID, testPhoto2ID}, testRunnerEmail))
	require.NoError(t, err)
	assert.Equal(t, 201, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(resp.Body), &body))
	assert.Equal(t, 150.0, body["totalAmount"]) // 2 × 75.0
}

func TestHandle_Idempotent_AllPending_Returns200(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, orders, purchases, _, _, _, phStore, _ := newHandler(ctrl)

	existingOrder := &models.Order{
		ID:             "existing-order-1",
		PaymentRef:     "RS-ABCD1234",
		TotalAmount:    75.0,
		Currency:       "GTQ",
		PhotographerID: testPhotographerID,
		Status:         models.OrderStatusPending,
	}
	existingPurchase := &models.Purchase{
		ID:          "purchase-1",
		OrderID:     "existing-order-1",
		PhotoID:     testPhotoID,
		RunnerEmail: testRunnerEmail,
		Status:      models.OrderStatusPending,
	}

	purchases.EXPECT().GetPurchaseByPhotoAndEmail(gomock.Any(), testPhotoID, testRunnerEmail).Return(existingPurchase, nil)
	orders.EXPECT().GetOrderByID(gomock.Any(), "existing-order-1").Return(existingOrder, nil)
	phStore.EXPECT().GetPhotographer(gomock.Any(), testPhotographerID).Return(testPhotographer, nil)

	resp, err := h.Handle(context.Background(), makeReq(t, []string{testPhotoID}, testRunnerEmail))
	require.NoError(t, err)
	assert.Equal(t, 200, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(resp.Body), &body))
	assert.Equal(t, "existing-order-1", body["orderId"])
	assert.Equal(t, "RS-ABCD1234", body["paymentRef"])
}

func TestHandle_Idempotent_AllApproved_Returns200(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, orders, purchases, _, _, _, phStore, _ := newHandler(ctrl)

	existingPurchase := &models.Purchase{
		ID:      "purchase-1",
		OrderID: "existing-order-2",
		PhotoID: testPhotoID,
		Status:  models.OrderStatusApproved,
	}
	existingOrder := &models.Order{
		ID:             "existing-order-2",
		PaymentRef:     "RS-ZZZZ0000",
		TotalAmount:    75.0,
		Currency:       "GTQ",
		PhotographerID: testPhotographerID,
		Status:         models.OrderStatusApproved,
	}

	purchases.EXPECT().GetPurchaseByPhotoAndEmail(gomock.Any(), testPhotoID, testRunnerEmail).Return(existingPurchase, nil)
	orders.EXPECT().GetOrderByID(gomock.Any(), "existing-order-2").Return(existingOrder, nil)
	phStore.EXPECT().GetPhotographer(gomock.Any(), testPhotographerID).Return(testPhotographer, nil)

	resp, err := h.Handle(context.Background(), makeReq(t, []string{testPhotoID}, testRunnerEmail))
	require.NoError(t, err)
	assert.Equal(t, 200, resp.StatusCode)
}

func TestHandle_Idempotent_RejectedPurchase_CreatesNew201(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, purchases, writer, photos, evStore, phStore, email := newHandler(ctrl)

	rejectedPurchase := &models.Purchase{
		ID:      "purchase-old",
		OrderID: "order-old",
		PhotoID: testPhotoID,
		Status:  models.OrderStatusRejected,
	}

	purchases.EXPECT().GetPurchaseByPhotoAndEmail(gomock.Any(), testPhotoID, testRunnerEmail).Return(rejectedPurchase, nil)
	photos.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(testPhoto, nil)
	evStore.EXPECT().GetEvent(gomock.Any(), testEventID).Return(testEvent, nil)
	phStore.EXPECT().GetPhotographer(gomock.Any(), testPhotographerID).Return(testPhotographer, nil)
	writer.EXPECT().CreateOrderWithPurchases(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
	email.EXPECT().SendTemplatedEmail(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).Times(2)

	resp, err := h.Handle(context.Background(), makeReq(t, []string{testPhotoID}, testRunnerEmail))
	require.NoError(t, err)
	assert.Equal(t, 201, resp.StatusCode)
}

func TestHandle_EmptyPhotoIds_Returns400(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, _, _, _, _, _, _ := newHandler(ctrl)

	resp, err := h.Handle(context.Background(), makeReq(t, []string{}, testRunnerEmail))
	require.NoError(t, err)
	assert.Equal(t, 400, resp.StatusCode)
	assert.Contains(t, resp.Body, "at least one photo is required")
}

func TestHandle_InvalidEmail_Returns400(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, _, _, _, _, _, _ := newHandler(ctrl)

	tests := []struct{ email string }{
		{"not-an-email"},
		{"@nodomain.com"},
		{"no-at-sign"},
		{""},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.email, func(t *testing.T) {
			resp, err := h.Handle(context.Background(), makeReq(t, []string{testPhotoID}, tc.email))
			require.NoError(t, err)
			assert.Equal(t, 400, resp.StatusCode)
			assert.Contains(t, resp.Body, "invalid email address")
		})
	}
}

func TestHandle_PhotoNotFound_Returns404(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, purchases, _, photos, _, _, _ := newHandler(ctrl)

	purchases.EXPECT().GetPurchaseByPhotoAndEmail(gomock.Any(), testPhotoID, testRunnerEmail).Return(nil, nil)
	photos.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(nil, apperrors.ErrNotFound)

	resp, err := h.Handle(context.Background(), makeReq(t, []string{testPhotoID}, testRunnerEmail))
	require.NoError(t, err)
	assert.Equal(t, 404, resp.StatusCode)
	assert.Contains(t, resp.Body, "one or more photos not found")
}

func TestHandle_PhotoNotIndexed_Returns422(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, purchases, _, photos, _, _, _ := newHandler(ctrl)

	processingPhoto := &models.Photo{
		ID:      testPhotoID,
		EventID: testEventID,
		Status:  models.PhotoStatusProcessing,
	}

	purchases.EXPECT().GetPurchaseByPhotoAndEmail(gomock.Any(), testPhotoID, testRunnerEmail).Return(nil, nil)
	photos.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(processingPhoto, nil)

	resp, err := h.Handle(context.Background(), makeReq(t, []string{testPhotoID}, testRunnerEmail))
	require.NoError(t, err)
	assert.Equal(t, 422, resp.StatusCode)
	assert.Contains(t, resp.Body, "not available for purchase")
}

func TestHandle_PhotosDifferentEvents_Returns422(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, purchases, _, photos, _, _, _ := newHandler(ctrl)

	photo2DiffEvent := &models.Photo{
		ID:      testPhoto2ID,
		EventID: "different-event-id",
		Status:  models.PhotoStatusIndexed,
	}

	// checkIdempotency exits on first nil — only photo-1 is queried before returning allActive=false.
	purchases.EXPECT().GetPurchaseByPhotoAndEmail(gomock.Any(), testPhotoID, testRunnerEmail).Return(nil, nil)
	photos.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(testPhoto, nil)
	photos.EXPECT().GetPhoto(gomock.Any(), testPhoto2ID).Return(photo2DiffEvent, nil)

	resp, err := h.Handle(context.Background(), makeReq(t, []string{testPhotoID, testPhoto2ID}, testRunnerEmail))
	require.NoError(t, err)
	assert.Equal(t, 422, resp.StatusCode)
	assert.Contains(t, resp.Body, "same event")
}

func TestHandle_InvalidBody_Returns400(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, _, _, _, _, _, _ := newHandler(ctrl)

	resp, err := h.Handle(context.Background(), events.APIGatewayV2HTTPRequest{Body: "not json {"})
	require.NoError(t, err)
	assert.Equal(t, 400, resp.StatusCode)
}

func TestHandle_CreateOrderFails_Returns500(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, purchases, writer, photos, evStore, phStore, _ := newHandler(ctrl)

	purchases.EXPECT().GetPurchaseByPhotoAndEmail(gomock.Any(), testPhotoID, testRunnerEmail).Return(nil, nil)
	photos.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(testPhoto, nil)
	evStore.EXPECT().GetEvent(gomock.Any(), testEventID).Return(testEvent, nil)
	phStore.EXPECT().GetPhotographer(gomock.Any(), testPhotographerID).Return(testPhotographer, nil)
	writer.EXPECT().CreateOrderWithPurchases(gomock.Any(), gomock.Any(), gomock.Any()).Return(errors.New("dynamo unavailable"))

	resp, err := h.Handle(context.Background(), makeReq(t, []string{testPhotoID}, testRunnerEmail))
	require.NoError(t, err)
	assert.Equal(t, 500, resp.StatusCode)
}

func TestHandle_EmailFailure_OrderStillCreated(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, purchases, writer, photos, evStore, phStore, email := newHandler(ctrl)

	purchases.EXPECT().GetPurchaseByPhotoAndEmail(gomock.Any(), testPhotoID, testRunnerEmail).Return(nil, nil)
	photos.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(testPhoto, nil)
	evStore.EXPECT().GetEvent(gomock.Any(), testEventID).Return(testEvent, nil)
	phStore.EXPECT().GetPhotographer(gomock.Any(), testPhotographerID).Return(testPhotographer, nil)
	writer.EXPECT().CreateOrderWithPurchases(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
	// Both emails fail — order should still return 201.
	email.EXPECT().SendTemplatedEmail(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(errors.New("SES error")).Times(2)

	resp, err := h.Handle(context.Background(), makeReq(t, []string{testPhotoID}, testRunnerEmail))
	require.NoError(t, err)
	assert.Equal(t, 201, resp.StatusCode)
}

func TestHandle_DeduplicatePhotoIds(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, purchases, writer, photos, evStore, phStore, email := newHandler(ctrl)

	// Duplicate photoID in request — should be treated as a single photo.
	purchases.EXPECT().GetPurchaseByPhotoAndEmail(gomock.Any(), testPhotoID, testRunnerEmail).Return(nil, nil).Times(1)
	photos.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(testPhoto, nil).Times(1)
	evStore.EXPECT().GetEvent(gomock.Any(), testEventID).Return(testEvent, nil)
	phStore.EXPECT().GetPhotographer(gomock.Any(), testPhotographerID).Return(testPhotographer, nil)
	writer.EXPECT().CreateOrderWithPurchases(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
	email.EXPECT().SendTemplatedEmail(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).Times(2)

	resp, err := h.Handle(context.Background(), makeReq(t, []string{testPhotoID, testPhotoID}, testRunnerEmail))
	require.NoError(t, err)
	assert.Equal(t, 201, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(resp.Body), &body))
	// totalAmount = 1 × 75.0 (deduplicated)
	assert.Equal(t, 75.0, body["totalAmount"])
}

func TestHandle_TooManyPhotoIds_Returns400(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, _, _, _, _, _, _ := newHandler(ctrl)

	// 21 unique photo IDs — one over the cap.
	photoIDs := make([]string, 21)
	for i := range photoIDs {
		photoIDs[i] = fmt.Sprintf("photo-%d", i+1)
	}

	resp, err := h.Handle(context.Background(), makeReq(t, photoIDs, testRunnerEmail))
	require.NoError(t, err)
	assert.Equal(t, 400, resp.StatusCode)
	assert.Contains(t, resp.Body, "too many photos")
}

func TestHandle_EmptyStringPhotoId_Returns400(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, _, _, _, _, _, _ := newHandler(ctrl)

	resp, err := h.Handle(context.Background(), makeReq(t, []string{""}, testRunnerEmail))
	require.NoError(t, err)
	assert.Equal(t, 400, resp.StatusCode)
	assert.Contains(t, resp.Body, "must not contain empty values")
}

func TestHandle_PaymentRefFormat(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, purchases, writer, photos, evStore, phStore, email := newHandler(ctrl)

	var capturedOrder models.Order
	purchases.EXPECT().GetPurchaseByPhotoAndEmail(gomock.Any(), testPhotoID, testRunnerEmail).Return(nil, nil)
	photos.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(testPhoto, nil)
	evStore.EXPECT().GetEvent(gomock.Any(), testEventID).Return(testEvent, nil)
	phStore.EXPECT().GetPhotographer(gomock.Any(), testPhotographerID).Return(testPhotographer, nil)
	writer.EXPECT().CreateOrderWithPurchases(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, o models.Order, _ []models.Purchase) error {
			capturedOrder = o
			return nil
		})
	email.EXPECT().SendTemplatedEmail(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).Times(2)

	resp, err := h.Handle(context.Background(), makeReq(t, []string{testPhotoID}, testRunnerEmail))
	require.NoError(t, err)
	assert.Equal(t, 201, resp.StatusCode)

	// Verify paymentRef format: RS- followed by 8 uppercase alphanumeric chars.
	assert.Regexp(t, `^RS-[A-Z0-9]{8}$`, capturedOrder.PaymentRef)
}

func TestHandle_LocaleStored(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, purchases, writer, photos, evStore, phStore, email := newHandler(ctrl)

	var capturedOrder models.Order
	purchases.EXPECT().GetPurchaseByPhotoAndEmail(gomock.Any(), testPhotoID, testRunnerEmail).Return(nil, nil)
	photos.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(testPhoto, nil)
	evStore.EXPECT().GetEvent(gomock.Any(), testEventID).Return(testEvent, nil)
	phStore.EXPECT().GetPhotographer(gomock.Any(), testPhotographerID).Return(testPhotographer, nil)
	writer.EXPECT().CreateOrderWithPurchases(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, o models.Order, _ []models.Purchase) error {
			capturedOrder = o
			return nil
		})
	email.EXPECT().SendTemplatedEmail(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).Times(2)

	resp, err := h.Handle(context.Background(), makeReqWithLocale(t, []string{testPhotoID}, testRunnerEmail, "es-419"))
	require.NoError(t, err)
	assert.Equal(t, 201, resp.StatusCode)
	assert.Equal(t, "es-419", capturedOrder.Locale)
}

func TestHandle_SpanishLocale_UsesLocalizedTemplates(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, purchases, writer, photos, evStore, phStore, email := newHandler(ctrl)

	spanishPhotographer := &models.Photographer{
		ID:              testPhotographerID,
		Email:           "photographer@example.com",
		PreferredLocale: "es-419",
	}

	purchases.EXPECT().GetPurchaseByPhotoAndEmail(gomock.Any(), testPhotoID, testRunnerEmail).Return(nil, nil)
	photos.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(testPhoto, nil)
	evStore.EXPECT().GetEvent(gomock.Any(), testEventID).Return(testEvent, nil)
	phStore.EXPECT().GetPhotographer(gomock.Any(), testPhotographerID).Return(spanishPhotographer, nil)
	writer.EXPECT().CreateOrderWithPurchases(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
	// Photographer gets es-419 template (photographer's preference); runner gets es-419 (runner's locale).
	email.EXPECT().SendTemplatedEmail(gomock.Any(), spanishPhotographer.Email, "racephotos-photographer-claim-es-419", gomock.Any()).Return(nil)
	email.EXPECT().SendTemplatedEmail(gomock.Any(), testRunnerEmail, "racephotos-runner-claim-confirmation-es-419", gomock.Any()).Return(nil)

	resp, err := h.Handle(context.Background(), makeReqWithLocale(t, []string{testPhotoID}, testRunnerEmail, "es-419"))
	require.NoError(t, err)
	assert.Equal(t, 201, resp.StatusCode)
}

func TestHandle_MissingLocale_Returns400(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, _, _, _, _, _, _ := newHandler(ctrl)

	body, _ := json.Marshal(map[string]interface{}{
		"photoIds":    []string{testPhotoID},
		"runnerEmail": testRunnerEmail,
		// locale omitted
	})
	resp, err := h.Handle(context.Background(), events.APIGatewayV2HTTPRequest{Body: string(body)})
	require.NoError(t, err)
	assert.Equal(t, 400, resp.StatusCode)
	assert.Contains(t, resp.Body, "locale")
}

func TestHandle_LocaleTooLong_Returns400(t *testing.T) {
	ctrl := gomock.NewController(t)
	h, _, _, _, _, _, _, _ := newHandler(ctrl)

	resp, err := h.Handle(context.Background(), makeReqWithLocale(t, []string{testPhotoID}, testRunnerEmail, "this-locale-tag-is-way-too-long-for-any-bcp47"))
	require.NoError(t, err)
	assert.Equal(t, 400, resp.StatusCode)
	assert.Contains(t, resp.Body, "locale")
}
