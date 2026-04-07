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

	"github.com/racephotos/archive-event/handler"
	"github.com/racephotos/archive-event/handler/mocks"
	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

func makeEvent(sub, id string) events.APIGatewayV2HTTPRequest {
	req := events.APIGatewayV2HTTPRequest{
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

func TestHandler_Handle(t *testing.T) {
	tests := []struct {
		name       string
		sub        string
		id         string
		mockFn     func(*mocks.MockEventArchiver)
		wantCode   int
		wantStatus string
	}{
		{
			name: "happy path — archives active event",
			sub:  "user-1",
			id:   "event-1",
			mockFn: func(m *mocks.MockEventArchiver) {
				m.EXPECT().ArchiveEvent(gomock.Any(), "event-1", "user-1").Return(&models.Event{
					ID:     "event-1",
					Status: "archived",
				}, nil)
			},
			wantCode:   200,
			wantStatus: "archived",
		},
		{
			name: "no-op — already archived",
			sub:  "user-1",
			id:   "event-1",
			mockFn: func(m *mocks.MockEventArchiver) {
				m.EXPECT().ArchiveEvent(gomock.Any(), "event-1", "user-1").Return(&models.Event{
					ID:     "event-1",
					Status: "archived",
				}, nil)
			},
			wantCode:   200,
			wantStatus: "archived",
		},
		{
			name:     "missing JWT sub — returns 401",
			sub:      "",
			id:       "event-1",
			mockFn:   func(m *mocks.MockEventArchiver) {},
			wantCode: 401,
		},
		{
			name:     "missing id path param — returns 400",
			sub:      "user-1",
			id:       "",
			mockFn:   func(m *mocks.MockEventArchiver) {},
			wantCode: 400,
		},
		{
			name: "forbidden — caller not owner — returns 403",
			sub:  "user-2",
			id:   "event-1",
			mockFn: func(m *mocks.MockEventArchiver) {
				m.EXPECT().ArchiveEvent(gomock.Any(), "event-1", "user-2").Return(nil, apperrors.ErrForbidden)
			},
			wantCode: 403,
		},
		{
			name: "event not found — returns 404",
			sub:  "user-1",
			id:   "nonexistent",
			mockFn: func(m *mocks.MockEventArchiver) {
				m.EXPECT().ArchiveEvent(gomock.Any(), "nonexistent", "user-1").Return(nil, apperrors.ErrNotFound)
			},
			wantCode: 404,
		},
		{
			name: "store error — returns 500",
			sub:  "user-1",
			id:   "event-err",
			mockFn: func(m *mocks.MockEventArchiver) {
				m.EXPECT().ArchiveEvent(gomock.Any(), "event-err", "user-1").Return(nil, errors.New("ddb error"))
			},
			wantCode: 500,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockStore := mocks.NewMockEventArchiver(ctrl)
			tt.mockFn(mockStore)

			h := &handler.Handler{Store: mockStore}
			resp, err := h.Handle(context.Background(), makeEvent(tt.sub, tt.id))

			require.NoError(t, err)
			assert.Equal(t, tt.wantCode, resp.StatusCode)
			assert.Equal(t, "application/json", resp.Headers["Content-Type"])

			if tt.wantStatus != "" {
				var e models.Event
				require.NoError(t, json.Unmarshal([]byte(resp.Body), &e))
				assert.Equal(t, tt.wantStatus, e.Status)
			}
		})
	}
}
