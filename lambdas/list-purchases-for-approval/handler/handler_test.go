package handler_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/golang/mock/gomock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/racephotos/list-purchases-for-approval/handler"
	"github.com/racephotos/list-purchases-for-approval/handler/mocks"
	"github.com/racephotos/shared/models"
)

const testPhotographerID = "photographer-sub-123"
const testCDNBase = "https://cdn.example.com"

func makeEvent(statusParam string, photographerID string) events.APIGatewayV2HTTPRequest {
	e := events.APIGatewayV2HTTPRequest{}
	if statusParam != "" {
		e.QueryStringParameters = map[string]string{"status": statusParam}
	}
	e.RequestContext.Authorizer = &events.APIGatewayV2HTTPRequestContextAuthorizerDescription{
		JWT: &events.APIGatewayV2HTTPRequestContextAuthorizerJWTDescription{
			Claims: map[string]string{"sub": photographerID},
		},
	}
	return e
}

func TestHandle(t *testing.T) {
	tests := []struct {
		name       string
		statusParam string
		setup      func(orders *mocks.MockOrderStore, purchases *mocks.MockPurchaseStore, photos *mocks.MockPhotoStore)
		wantStatus int
		check      func(t *testing.T, body string)
	}{
		{
			name:        "AC12: missing status param returns 400",
			statusParam: "",
			setup:       func(o *mocks.MockOrderStore, p *mocks.MockPurchaseStore, ph *mocks.MockPhotoStore) {},
			wantStatus:  400,
		},
		{
			name:        "AC12: status=approved returns 400",
			statusParam: "approved",
			setup:       func(o *mocks.MockOrderStore, p *mocks.MockPurchaseStore, ph *mocks.MockPhotoStore) {},
			wantStatus:  400,
		},
		{
			name:        "AC13: no pending orders returns 200 empty array",
			statusParam: "pending",
			setup: func(o *mocks.MockOrderStore, p *mocks.MockPurchaseStore, ph *mocks.MockPhotoStore) {
				o.EXPECT().QueryPendingOrdersByPhotographer(gomock.Any(), testPhotographerID).Return([]*models.Order{}, nil)
			},
			wantStatus: 200,
			check: func(t *testing.T, body string) {
				var result []any
				require.NoError(t, json.Unmarshal([]byte(body), &result))
				assert.Empty(t, result)
			},
		},
		{
			name:        "AC1: returns pending purchases with masked email and watermarked URL",
			statusParam: "pending",
			setup: func(o *mocks.MockOrderStore, p *mocks.MockPurchaseStore, ph *mocks.MockPhotoStore) {
				order := &models.Order{
					ID:             "order-1",
					PhotographerID: testPhotographerID,
					EventID:        "event-1",
					EventName:      "City 10K",
					PaymentRef:     "RS-ABCD1234",
					Status:         models.OrderStatusPending,
					ClaimedAt:      "2026-04-17T10:00:00Z",
				}
				purchase := &models.Purchase{
					ID:          "purchase-1",
					OrderID:     "order-1",
					PhotoID:     "photo-1",
					RunnerEmail: "runner@example.com",
					Status:      models.OrderStatusPending,
					ClaimedAt:   "2026-04-17T10:00:00Z",
				}
				photo := &models.Photo{
					ID:               "photo-1",
					WatermarkedS3Key: "events/event-1/photo-1-wm.jpg",
				}
				o.EXPECT().QueryPendingOrdersByPhotographer(gomock.Any(), testPhotographerID).Return([]*models.Order{order}, nil)
				p.EXPECT().QueryPurchasesByOrder(gomock.Any(), "order-1").Return([]*models.Purchase{purchase}, nil)
				ph.EXPECT().BatchGetPhotos(gomock.Any(), gomock.Any()).Return([]*models.Photo{photo}, nil)
			},
			wantStatus: 200,
			check: func(t *testing.T, body string) {
				var result []map[string]any
				require.NoError(t, json.Unmarshal([]byte(body), &result))
				require.Len(t, result, 1)
				assert.Equal(t, "purchase-1", result[0]["purchaseId"])
				assert.Equal(t, "r***@example.com", result[0]["runnerEmail"])
				assert.Equal(t, "RS-ABCD1234", result[0]["paymentRef"])
				assert.Equal(t, testCDNBase+"/events/event-1/photo-1-wm.jpg", result[0]["watermarkedUrl"])
			},
		},
		{
			name:        "same photo appears twice for two different runners (ADR-0003)",
			statusParam: "pending",
			setup: func(o *mocks.MockOrderStore, p *mocks.MockPurchaseStore, ph *mocks.MockPhotoStore) {
				orders := []*models.Order{
					{ID: "order-1", PhotographerID: testPhotographerID, EventID: "event-1", EventName: "City 10K", PaymentRef: "RS-AAAA0001", Status: models.OrderStatusPending, ClaimedAt: "2026-04-17T10:00:00Z"},
					{ID: "order-2", PhotographerID: testPhotographerID, EventID: "event-1", EventName: "City 10K", PaymentRef: "RS-BBBB0002", Status: models.OrderStatusPending, ClaimedAt: "2026-04-17T11:00:00Z"},
				}
				purchases1 := []*models.Purchase{
					{ID: "p-1", OrderID: "order-1", PhotoID: "photo-1", RunnerEmail: "alice@example.com", Status: models.OrderStatusPending, ClaimedAt: "2026-04-17T10:00:00Z"},
				}
				purchases2 := []*models.Purchase{
					{ID: "p-2", OrderID: "order-2", PhotoID: "photo-1", RunnerEmail: "bob@example.com", Status: models.OrderStatusPending, ClaimedAt: "2026-04-17T11:00:00Z"},
				}
				photo := &models.Photo{ID: "photo-1", WatermarkedS3Key: "events/event-1/photo-1-wm.jpg"}
				o.EXPECT().QueryPendingOrdersByPhotographer(gomock.Any(), testPhotographerID).Return(orders, nil)
				p.EXPECT().QueryPurchasesByOrder(gomock.Any(), "order-1").Return(purchases1, nil)
				p.EXPECT().QueryPurchasesByOrder(gomock.Any(), "order-2").Return(purchases2, nil)
				ph.EXPECT().BatchGetPhotos(gomock.Any(), gomock.Any()).Return([]*models.Photo{photo}, nil)
			},
			wantStatus: 200,
			check: func(t *testing.T, body string) {
				var result []map[string]any
				require.NoError(t, json.Unmarshal([]byte(body), &result))
				assert.Len(t, result, 2, "both runners should appear as separate rows")
				emails := []string{result[0]["runnerEmail"].(string), result[1]["runnerEmail"].(string)}
				assert.Contains(t, emails, "a***@example.com")
				assert.Contains(t, emails, "b***@example.com")
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockOrders := mocks.NewMockOrderStore(ctrl)
			mockPurchases := mocks.NewMockPurchaseStore(ctrl)
			mockPhotos := mocks.NewMockPhotoStore(ctrl)

			tc.setup(mockOrders, mockPurchases, mockPhotos)

			h := &handler.Handler{
				Orders:     mockOrders,
				Purchases:  mockPurchases,
				Photos:     mockPhotos,
				CDNBaseURL: testCDNBase,
			}

			resp, err := h.Handle(context.Background(), makeEvent(tc.statusParam, testPhotographerID))
			require.NoError(t, err)
			assert.Equal(t, tc.wantStatus, resp.StatusCode)
			if tc.check != nil {
				tc.check(t, resp.Body)
			}
		})
	}
}
