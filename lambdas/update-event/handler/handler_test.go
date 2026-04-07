package handler_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/golang/mock/gomock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/racephotos/update-event/handler"
	"github.com/racephotos/update-event/handler/mocks"
	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

func makeEvent(sub, id, body string) events.APIGatewayV2HTTPRequest {
	req := events.APIGatewayV2HTTPRequest{
		Body:           body,
		PathParameters: map[string]string{"id": id},
	}
	if sub != "" {
		req.RequestContext = events.APIGatewayV2HTTPRequestContext{
			Authorizer: &events.APIGatewayV2HTTPRequestContextAuthorizerDescription{
				JWT: &events.APIGatewayV2HTTPRequestContextAuthorizerJWTDescription{
					Claims: map[string]string{"sub": sub},
				},
			},
		}
	}
	return req
}

const validBody = `{"name":"Spring Run","date":"2026-06-01","location":"Central Park","pricePerPhoto":5.00,"currency":"USD","watermarkText":"Spring Run · example.com"}`

func TestHandler_Handle(t *testing.T) {
	tests := []struct {
		name     string
		sub      string
		id       string
		body     string
		mockFn   func(*mocks.MockEventUpdater)
		wantCode int
		wantID   string
	}{
		{
			name: "happy path — updates event and returns 200",
			sub:  "user-1",
			id:   "event-1",
			body: validBody,
			mockFn: func(m *mocks.MockEventUpdater) {
				m.EXPECT().UpdateEvent(gomock.Any(), "event-1", "user-1", gomock.Any()).Return(&models.Event{
					ID:   "event-1",
					Name: "Spring Run",
				}, nil)
			},
			wantCode: 200,
			wantID:   "event-1",
		},
		{
			name:     "missing JWT sub — returns 401",
			sub:      "",
			id:       "event-1",
			body:     validBody,
			mockFn:   func(m *mocks.MockEventUpdater) {},
			wantCode: 401,
		},
		{
			name:     "missing id path param — returns 400",
			sub:      "user-1",
			id:       "",
			body:     validBody,
			mockFn:   func(m *mocks.MockEventUpdater) {},
			wantCode: 400,
		},
		{
			name:     "invalid JSON body — returns 400",
			sub:      "user-1",
			id:       "event-1",
			body:     `not-json`,
			mockFn:   func(m *mocks.MockEventUpdater) {},
			wantCode: 400,
		},
		{
			name:     "empty name — returns 400",
			sub:      "user-1",
			id:       "event-1",
			body:     `{"name":"","date":"2026-06-01","location":"Central Park","pricePerPhoto":5.00}`,
			mockFn:   func(m *mocks.MockEventUpdater) {},
			wantCode: 400,
		},
		{
			name: "forbidden — caller not owner — returns 403",
			sub:  "user-2",
			id:   "event-1",
			body: validBody,
			mockFn: func(m *mocks.MockEventUpdater) {
				m.EXPECT().UpdateEvent(gomock.Any(), "event-1", "user-2", gomock.Any()).Return(nil, apperrors.ErrForbidden)
			},
			wantCode: 403,
		},
		{
			name: "event not found — returns 404",
			sub:  "user-1",
			id:   "nonexistent",
			body: validBody,
			mockFn: func(m *mocks.MockEventUpdater) {
				m.EXPECT().UpdateEvent(gomock.Any(), "nonexistent", "user-1", gomock.Any()).Return(nil, apperrors.ErrNotFound)
			},
			wantCode: 404,
		},
		{
			name: "store error — returns 500",
			sub:  "user-1",
			id:   "event-1",
			body: validBody,
			mockFn: func(m *mocks.MockEventUpdater) {
				m.EXPECT().UpdateEvent(gomock.Any(), "event-1", "user-1", gomock.Any()).Return(nil, errors.New("ddb failure"))
			},
			wantCode: 500,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockStore := mocks.NewMockEventUpdater(ctrl)
			tt.mockFn(mockStore)

			h := &handler.Handler{Store: mockStore}
			resp, err := h.Handle(context.Background(), makeEvent(tt.sub, tt.id, tt.body))

			require.NoError(t, err)
			assert.Equal(t, tt.wantCode, resp.StatusCode)
			assert.Equal(t, "application/json", resp.Headers["Content-Type"])

			if tt.wantID != "" {
				var e models.Event
				require.NoError(t, json.Unmarshal([]byte(resp.Body), &e))
				assert.Equal(t, tt.wantID, e.ID)
			}
		})
	}
}
