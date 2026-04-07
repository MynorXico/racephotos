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

	"github.com/racephotos/get-event/handler"
	"github.com/racephotos/get-event/handler/mocks"
	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

func makeEvent(id string) events.APIGatewayV2HTTPRequest {
	return events.APIGatewayV2HTTPRequest{
		PathParameters: map[string]string{"id": id},
	}
}

func TestHandler_Handle(t *testing.T) {
	tests := []struct {
		name     string
		id       string
		mockFn   func(*mocks.MockEventGetter)
		wantCode int
		wantID   string
	}{
		{
			name: "happy path — returns event",
			id:   "event-123",
			mockFn: func(m *mocks.MockEventGetter) {
				m.EXPECT().GetEvent(gomock.Any(), "event-123").Return(&models.Event{
					ID:     "event-123",
					Name:   "Spring Run",
					Status: "active",
				}, nil)
			},
			wantCode: 200,
			wantID:   "event-123",
		},
		{
			name: "event not found — returns 404",
			id:   "nonexistent",
			mockFn: func(m *mocks.MockEventGetter) {
				m.EXPECT().GetEvent(gomock.Any(), "nonexistent").Return(nil, apperrors.ErrNotFound)
			},
			wantCode: 404,
		},
		{
			name:     "missing id path parameter — returns 400",
			id:       "",
			mockFn:   func(m *mocks.MockEventGetter) {},
			wantCode: 400,
		},
		{
			name: "store error — returns 500",
			id:   "event-err",
			mockFn: func(m *mocks.MockEventGetter) {
				m.EXPECT().GetEvent(gomock.Any(), "event-err").Return(nil, errors.New("ddb failure"))
			},
			wantCode: 500,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockStore := mocks.NewMockEventGetter(ctrl)
			tt.mockFn(mockStore)

			h := &handler.Handler{Store: mockStore}
			resp, err := h.Handle(context.Background(), makeEvent(tt.id))

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
