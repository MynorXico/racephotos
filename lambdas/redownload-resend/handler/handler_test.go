package handler_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/golang/mock/gomock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/racephotos/redownload-resend/handler"
	"github.com/racephotos/redownload-resend/handler/mocks"
	"github.com/racephotos/shared/models"
)

const (
	testEmail      = "runner@example.com"
	testAppBaseURL = "https://app.example.com"
)

func makeEvent(email string) events.APIGatewayV2HTTPRequest {
	body, _ := json.Marshal(map[string]string{"email": email})
	return events.APIGatewayV2HTTPRequest{Body: string(body)}
}

func makeEmptyEvent() events.APIGatewayV2HTTPRequest {
	return events.APIGatewayV2HTTPRequest{Body: "{}"}
}

func purchaseWithToken(token string) models.Purchase {
	return models.Purchase{
		ID:            "purchase-1",
		PhotoID:       "photo-1",
		RunnerEmail:   testEmail,
		DownloadToken: &token,
		Status:        models.OrderStatusApproved,
	}
}

func TestHandle(t *testing.T) {
	tests := []struct {
		name       string
		event      events.APIGatewayV2HTTPRequest
		setup      func(p *mocks.MockPurchaseStore, r *mocks.MockRateLimitStore, e *mocks.MockEmailSender)
		wantStatus int
		check      func(t *testing.T, body string)
	}{
		{
			name:  "AC3: happy path — within rate limit, purchases found, sends email, returns 200",
			event: makeEvent(testEmail),
			setup: func(p *mocks.MockPurchaseStore, r *mocks.MockRateLimitStore, e *mocks.MockEmailSender) {
				r.EXPECT().IncrementAndCheck(gomock.Any(), "REDOWNLOAD#"+testEmail, 3600, 3).Return(true, nil)
				p.EXPECT().GetApprovedPurchasesByEmail(gomock.Any(), testEmail).Return(
					[]models.Purchase{purchaseWithToken("tok-abc")}, nil,
				)
				e.EXPECT().SendTemplatedEmail(gomock.Any(), testEmail, "racephotos-runner-redownload-resend", gomock.Any()).Return(nil)
			},
			wantStatus: 200,
			check: func(t *testing.T, body string) {
				var resp map[string]any
				require.NoError(t, json.Unmarshal([]byte(body), &resp))
				assert.Contains(t, resp["message"], "If we have purchases")
			},
		},
		{
			name:  "AC3: no purchases for email still returns 200 (no enumeration)",
			event: makeEvent(testEmail),
			setup: func(p *mocks.MockPurchaseStore, r *mocks.MockRateLimitStore, e *mocks.MockEmailSender) {
				r.EXPECT().IncrementAndCheck(gomock.Any(), "REDOWNLOAD#"+testEmail, 3600, 3).Return(true, nil)
				p.EXPECT().GetApprovedPurchasesByEmail(gomock.Any(), testEmail).Return(nil, nil)
				// No email sent when no purchases exist.
			},
			wantStatus: 200,
		},
		{
			name:  "AC4: rate limit exceeded returns 429",
			event: makeEvent(testEmail),
			setup: func(p *mocks.MockPurchaseStore, r *mocks.MockRateLimitStore, e *mocks.MockEmailSender) {
				r.EXPECT().IncrementAndCheck(gomock.Any(), "REDOWNLOAD#"+testEmail, 3600, 3).Return(false, nil)
			},
			wantStatus: 429,
			check: func(t *testing.T, body string) {
				var resp map[string]any
				require.NoError(t, json.Unmarshal([]byte(body), &resp))
				assert.Contains(t, resp["error"], "Too many requests")
			},
		},
		{
			name:       "missing email returns 400",
			event:      makeEmptyEvent(),
			setup:      func(p *mocks.MockPurchaseStore, r *mocks.MockRateLimitStore, e *mocks.MockEmailSender) {},
			wantStatus: 400,
		},
		{
			name:       "invalid email format returns 400 without hitting rate-limit store",
			event:      makeEvent("notanemail"),
			setup:      func(p *mocks.MockPurchaseStore, r *mocks.MockRateLimitStore, e *mocks.MockEmailSender) {},
			wantStatus: 400,
		},
		{
			name:  "display-name email is normalized to bare address for rate-limit key",
			event: makeEvent("Runner Name <" + testEmail + ">"),
			setup: func(p *mocks.MockPurchaseStore, r *mocks.MockRateLimitStore, e *mocks.MockEmailSender) {
				r.EXPECT().IncrementAndCheck(gomock.Any(), "REDOWNLOAD#"+testEmail, 3600, 3).Return(true, nil)
				p.EXPECT().GetApprovedPurchasesByEmail(gomock.Any(), testEmail).Return(nil, nil)
			},
			wantStatus: 200,
		},
		{
			name:  "rate limit store error returns 500",
			event: makeEvent(testEmail),
			setup: func(p *mocks.MockPurchaseStore, r *mocks.MockRateLimitStore, e *mocks.MockEmailSender) {
				r.EXPECT().IncrementAndCheck(gomock.Any(), "REDOWNLOAD#"+testEmail, 3600, 3).Return(false, assert.AnError)
			},
			wantStatus: 500,
		},
		{
			name:  "purchase store error returns 500",
			event: makeEvent(testEmail),
			setup: func(p *mocks.MockPurchaseStore, r *mocks.MockRateLimitStore, e *mocks.MockEmailSender) {
				r.EXPECT().IncrementAndCheck(gomock.Any(), "REDOWNLOAD#"+testEmail, 3600, 3).Return(true, nil)
				p.EXPECT().GetApprovedPurchasesByEmail(gomock.Any(), testEmail).Return(nil, assert.AnError)
			},
			wantStatus: 500,
		},
		{
			name:  "SES error is logged but response is still 200",
			event: makeEvent(testEmail),
			setup: func(p *mocks.MockPurchaseStore, r *mocks.MockRateLimitStore, e *mocks.MockEmailSender) {
				r.EXPECT().IncrementAndCheck(gomock.Any(), "REDOWNLOAD#"+testEmail, 3600, 3).Return(true, nil)
				p.EXPECT().GetApprovedPurchasesByEmail(gomock.Any(), testEmail).Return(
					[]models.Purchase{purchaseWithToken("tok-abc")}, nil,
				)
				e.EXPECT().SendTemplatedEmail(gomock.Any(), testEmail, gomock.Any(), gomock.Any()).Return(assert.AnError)
			},
			wantStatus: 200,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockPurchases := mocks.NewMockPurchaseStore(ctrl)
			mockRateLimit := mocks.NewMockRateLimitStore(ctrl)
			mockEmail := mocks.NewMockEmailSender(ctrl)

			tc.setup(mockPurchases, mockRateLimit, mockEmail)

			h := &handler.Handler{
				Purchases:  mockPurchases,
				RateLimit:  mockRateLimit,
				Email:      mockEmail,
				AppBaseURL: testAppBaseURL,
			}

			resp, err := h.Handle(context.Background(), tc.event)
			require.NoError(t, err)
			assert.Equal(t, tc.wantStatus, resp.StatusCode)
			if tc.check != nil {
				tc.check(t, resp.Body)
			}
		})
	}
}
