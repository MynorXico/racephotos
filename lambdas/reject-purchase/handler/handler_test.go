package handler_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/golang/mock/gomock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/racephotos/reject-purchase/handler"
	"github.com/racephotos/reject-purchase/handler/mocks"
	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

const (
	testPhotographerID = "photographer-sub-123"
	testOtherPhotogID  = "other-photographer-789"
	testPurchaseID     = "purchase-abc"
	testOrderID        = "order-xyz"
)

func makeEvent(purchaseID, photographerID string) events.APIGatewayV2HTTPRequest {
	e := events.APIGatewayV2HTTPRequest{
		PathParameters: map[string]string{"id": purchaseID},
	}
	e.RequestContext.Authorizer = &events.APIGatewayV2HTTPRequestContextAuthorizerDescription{
		JWT: &events.APIGatewayV2HTTPRequestContextAuthorizerJWTDescription{
			Claims: map[string]string{"sub": photographerID},
		},
	}
	return e
}

func pendingPurchase() *models.Purchase {
	return &models.Purchase{
		ID:          testPurchaseID,
		OrderID:     testOrderID,
		PhotoID:     "photo-1",
		RunnerEmail: "runner@example.com",
		Status:      models.OrderStatusPending,
		ClaimedAt:   "2026-04-17T10:00:00Z",
	}
}

func ownerOrder() *models.Order {
	return &models.Order{
		ID:             testOrderID,
		PhotographerID: testPhotographerID,
		EventName:      "City 10K",
		Status:         models.OrderStatusPending,
	}
}

func TestHandle(t *testing.T) {
	tests := []struct {
		name           string
		purchaseID     string
		photographerID string
		setup          func(p *mocks.MockPurchaseStore, o *mocks.MockOrderStore)
		wantStatus     int
		check          func(t *testing.T, body string)
	}{
		{
			name:           "AC7: purchase not found returns 404",
			purchaseID:     testPurchaseID,
			photographerID: testPhotographerID,
			setup: func(p *mocks.MockPurchaseStore, o *mocks.MockOrderStore) {
				p.EXPECT().GetPurchase(gomock.Any(), testPurchaseID).Return(nil, apperrors.ErrNotFound)
			},
			wantStatus: 404,
		},
		{
			name:           "AC6: wrong photographer returns 403",
			purchaseID:     testPurchaseID,
			photographerID: testOtherPhotogID,
			setup: func(p *mocks.MockPurchaseStore, o *mocks.MockOrderStore) {
				p.EXPECT().GetPurchase(gomock.Any(), testPurchaseID).Return(pendingPurchase(), nil)
				o.EXPECT().GetOrder(gomock.Any(), testOrderID).Return(ownerOrder(), nil)
			},
			wantStatus: 403,
		},
		{
			name:           "AC8: rejecting approved purchase returns 409",
			purchaseID:     testPurchaseID,
			photographerID: testPhotographerID,
			setup: func(p *mocks.MockPurchaseStore, o *mocks.MockOrderStore) {
				pur := pendingPurchase()
				pur.Status = models.OrderStatusApproved
				p.EXPECT().GetPurchase(gomock.Any(), testPurchaseID).Return(pur, nil)
				o.EXPECT().GetOrder(gomock.Any(), testOrderID).Return(ownerOrder(), nil)
			},
			wantStatus: 409,
		},
		{
			name:           "AC5: already rejected is idempotent — returns 200 and repairs order status",
			purchaseID:     testPurchaseID,
			photographerID: testPhotographerID,
			setup: func(p *mocks.MockPurchaseStore, o *mocks.MockOrderStore) {
				pur := pendingPurchase()
				pur.Status = models.OrderStatusRejected
				p.EXPECT().GetPurchase(gomock.Any(), testPurchaseID).Return(pur, nil)
				o.EXPECT().GetOrder(gomock.Any(), testOrderID).Return(ownerOrder(), nil)
				// Idempotent path still runs updateOrderStatus to repair partial failures.
				p.EXPECT().QueryPurchasesByOrder(gomock.Any(), testOrderID).Return([]*models.Purchase{
					{ID: testPurchaseID, Status: models.OrderStatusRejected},
				}, nil)
				o.EXPECT().UpdateOrderStatus(gomock.Any(), testOrderID, models.OrderStatusRejected, gomock.Any()).Return(nil)
			},
			wantStatus: 200,
			check: func(t *testing.T, body string) {
				var resp map[string]any
				require.NoError(t, json.Unmarshal([]byte(body), &resp))
				assert.Equal(t, models.OrderStatusRejected, resp["status"])
			},
		},
		{
			name:           "concurrent reject race returns 409",
			purchaseID:     testPurchaseID,
			photographerID: testPhotographerID,
			setup: func(p *mocks.MockPurchaseStore, o *mocks.MockOrderStore) {
				p.EXPECT().GetPurchase(gomock.Any(), testPurchaseID).Return(pendingPurchase(), nil)
				o.EXPECT().GetOrder(gomock.Any(), testOrderID).Return(ownerOrder(), nil)
				// ConditionalCheckFailedException mapped to ErrConflict by the store.
				p.EXPECT().UpdatePurchaseRejected(gomock.Any(), testPurchaseID).Return(apperrors.ErrConflict)
			},
			wantStatus: 409,
		},
		{
			name:           "AC4: happy path — rejects purchase, no email, returns 200",
			purchaseID:     testPurchaseID,
			photographerID: testPhotographerID,
			setup: func(p *mocks.MockPurchaseStore, o *mocks.MockOrderStore) {
				p.EXPECT().GetPurchase(gomock.Any(), testPurchaseID).Return(pendingPurchase(), nil)
				o.EXPECT().GetOrder(gomock.Any(), testOrderID).Return(ownerOrder(), nil)
				p.EXPECT().UpdatePurchaseRejected(gomock.Any(), testPurchaseID).Return(nil)
				p.EXPECT().QueryPurchasesByOrder(gomock.Any(), testOrderID).Return([]*models.Purchase{
					{ID: testPurchaseID, Status: models.OrderStatusRejected},
				}, nil)
				o.EXPECT().UpdateOrderStatus(gomock.Any(), testOrderID, models.OrderStatusRejected, gomock.Any()).Return(nil)
			},
			wantStatus: 200,
			check: func(t *testing.T, body string) {
				var resp map[string]any
				require.NoError(t, json.Unmarshal([]byte(body), &resp))
				assert.Equal(t, models.OrderStatusRejected, resp["status"])
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockPurchases := mocks.NewMockPurchaseStore(ctrl)
			mockOrders := mocks.NewMockOrderStore(ctrl)

			tc.setup(mockPurchases, mockOrders)

			h := &handler.Handler{
				Purchases: mockPurchases,
				Orders:    mockOrders,
			}

			resp, err := h.Handle(context.Background(), makeEvent(tc.purchaseID, tc.photographerID))
			require.NoError(t, err)
			assert.Equal(t, tc.wantStatus, resp.StatusCode)
			if tc.check != nil {
				tc.check(t, resp.Body)
			}
		})
	}
}
