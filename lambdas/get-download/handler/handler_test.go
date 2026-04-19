package handler_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/golang/mock/gomock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/racephotos/get-download/handler"
	"github.com/racephotos/get-download/handler/mocks"
	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

const (
	testToken     = "test-token-uuid-v4"
	testPurchaseID = "purchase-abc"
	testPhotoID   = "photo-xyz"
	testRawBucket = "racephotos-raw-dev"
	testRawKey    = "originals/photo-xyz.jpg"
	testPresignURL = "https://s3.amazonaws.com/presigned-url"
)

func makeEvent(token string) events.APIGatewayV2HTTPRequest {
	return events.APIGatewayV2HTTPRequest{
		PathParameters: map[string]string{"token": token},
	}
}

func approvedPurchase() *models.Purchase {
	tok := testToken
	return &models.Purchase{
		ID:            testPurchaseID,
		PhotoID:       testPhotoID,
		RunnerEmail:   "runner@example.com",
		DownloadToken: &tok,
		Status:        models.OrderStatusApproved,
		ClaimedAt:     "2026-04-17T10:00:00Z",
	}
}

func indexedPhoto() *models.Photo {
	return &models.Photo{
		ID:       testPhotoID,
		EventID:  "event-1",
		RawS3Key: testRawKey,
		Status:   models.PhotoStatusIndexed,
	}
}

func TestHandle(t *testing.T) {
	tests := []struct {
		name       string
		token      string
		setup      func(p *mocks.MockPurchaseStore, ph *mocks.MockPhotoStore, pr *mocks.MockPhotoPresigner)
		wantStatus int
		check      func(t *testing.T, body string)
	}{
		{
			name:  "AC1: approved token returns 200 with presigned URL",
			token: testToken,
			setup: func(p *mocks.MockPurchaseStore, ph *mocks.MockPhotoStore, pr *mocks.MockPhotoPresigner) {
				p.EXPECT().GetPurchaseByDownloadToken(gomock.Any(), testToken).Return(approvedPurchase(), nil)
				ph.EXPECT().GetPhotoByID(gomock.Any(), testPhotoID).Return(indexedPhoto(), nil)
				pr.EXPECT().PresignGetObject(gomock.Any(), testRawBucket, testRawKey, 24*time.Hour).Return(testPresignURL, nil)
			},
			wantStatus: 200,
			check: func(t *testing.T, body string) {
				var resp map[string]any
				require.NoError(t, json.Unmarshal([]byte(body), &resp))
				assert.Equal(t, testPresignURL, resp["url"])
				// rawS3Key must never appear in the response body
				assert.Empty(t, resp["rawS3Key"])
			},
		},
		{
			name:  "AC2: unknown token returns 404",
			token: "unknown-token",
			setup: func(p *mocks.MockPurchaseStore, ph *mocks.MockPhotoStore, pr *mocks.MockPhotoPresigner) {
				p.EXPECT().GetPurchaseByDownloadToken(gomock.Any(), "unknown-token").Return(nil, apperrors.ErrNotFound)
			},
			wantStatus: 404,
		},
		{
			name:  "AC2: pending purchase returns 404",
			token: testToken,
			setup: func(p *mocks.MockPurchaseStore, ph *mocks.MockPhotoStore, pr *mocks.MockPhotoPresigner) {
				pur := approvedPurchase()
				pur.Status = models.OrderStatusPending
				p.EXPECT().GetPurchaseByDownloadToken(gomock.Any(), testToken).Return(pur, nil)
			},
			wantStatus: 404,
		},
		{
			name:  "AC2: rejected purchase returns 404",
			token: testToken,
			setup: func(p *mocks.MockPurchaseStore, ph *mocks.MockPhotoStore, pr *mocks.MockPhotoPresigner) {
				pur := approvedPurchase()
				pur.Status = models.OrderStatusRejected
				p.EXPECT().GetPurchaseByDownloadToken(gomock.Any(), testToken).Return(pur, nil)
			},
			wantStatus: 404,
		},
		{
			name:  "missing token path parameter returns 400",
			token: "",
			setup: func(p *mocks.MockPurchaseStore, ph *mocks.MockPhotoStore, pr *mocks.MockPhotoPresigner) {
			},
			wantStatus: 400,
		},
		{
			name:  "purchase store error returns 500",
			token: testToken,
			setup: func(p *mocks.MockPurchaseStore, ph *mocks.MockPhotoStore, pr *mocks.MockPhotoPresigner) {
				p.EXPECT().GetPurchaseByDownloadToken(gomock.Any(), testToken).Return(nil, assert.AnError)
			},
			wantStatus: 500,
		},
		{
			name:  "photo store error returns 500",
			token: testToken,
			setup: func(p *mocks.MockPurchaseStore, ph *mocks.MockPhotoStore, pr *mocks.MockPhotoPresigner) {
				p.EXPECT().GetPurchaseByDownloadToken(gomock.Any(), testToken).Return(approvedPurchase(), nil)
				ph.EXPECT().GetPhotoByID(gomock.Any(), testPhotoID).Return(nil, assert.AnError)
			},
			wantStatus: 500,
		},
		{
			name:  "presigner error returns 500",
			token: testToken,
			setup: func(p *mocks.MockPurchaseStore, ph *mocks.MockPhotoStore, pr *mocks.MockPhotoPresigner) {
				p.EXPECT().GetPurchaseByDownloadToken(gomock.Any(), testToken).Return(approvedPurchase(), nil)
				ph.EXPECT().GetPhotoByID(gomock.Any(), testPhotoID).Return(indexedPhoto(), nil)
				pr.EXPECT().PresignGetObject(gomock.Any(), testRawBucket, testRawKey, 24*time.Hour).Return("", assert.AnError)
			},
			wantStatus: 500,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockPurchases := mocks.NewMockPurchaseStore(ctrl)
			mockPhotos := mocks.NewMockPhotoStore(ctrl)
			mockPresigner := mocks.NewMockPhotoPresigner(ctrl)

			tc.setup(mockPurchases, mockPhotos, mockPresigner)

			h := &handler.Handler{
				Purchases: mockPurchases,
				Photos:    mockPhotos,
				Presigner: mockPresigner,
				RawBucket: testRawBucket,
			}

			resp, err := h.Handle(context.Background(), makeEvent(tc.token))
			require.NoError(t, err)
			assert.Equal(t, tc.wantStatus, resp.StatusCode)
			if tc.check != nil {
				tc.check(t, resp.Body)
			}
		})
	}
}
