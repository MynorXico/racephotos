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

	"github.com/racephotos/get-photographer/handler"
	"github.com/racephotos/get-photographer/handler/mocks"
	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

func makeEvent(sub string) events.APIGatewayV2HTTPRequest {
	if sub == "" {
		return events.APIGatewayV2HTTPRequest{}
	}
	return events.APIGatewayV2HTTPRequest{
		RequestContext: events.APIGatewayV2HTTPRequestContext{
			Authorizer: &events.APIGatewayV2HTTPRequestContextAuthorizerDescription{
				JWT: &events.APIGatewayV2HTTPRequestContextAuthorizerJWTDescription{
					Claims: map[string]string{"sub": sub},
				},
			},
		},
	}
}

func TestHandler_Handle(t *testing.T) {
	tests := []struct {
		name     string
		event    events.APIGatewayV2HTTPRequest
		mockFn   func(*mocks.MockPhotographerGetter)
		wantCode int
		wantID   string
	}{
		{
			name:  "happy path — returns photographer profile",
			event: makeEvent("user-123"),
			mockFn: func(m *mocks.MockPhotographerGetter) {
				m.EXPECT().GetPhotographer(gomock.Any(), "user-123").Return(&models.Photographer{
					ID:          "user-123",
					DisplayName: "Alice",
				}, nil)
			},
			wantCode: 200,
			wantID:   "user-123",
		},
		{
			name:  "not found — returns 404",
			event: makeEvent("user-404"),
			mockFn: func(m *mocks.MockPhotographerGetter) {
				m.EXPECT().GetPhotographer(gomock.Any(), "user-404").Return(nil, apperrors.ErrNotFound)
			},
			wantCode: 404,
		},
		{
			name:     "missing JWT sub — returns 401",
			event:    makeEvent(""),
			mockFn:   func(m *mocks.MockPhotographerGetter) {},
			wantCode: 401,
		},
		{
			name:  "store error — returns 500",
			event: makeEvent("user-500"),
			mockFn: func(m *mocks.MockPhotographerGetter) {
				m.EXPECT().GetPhotographer(gomock.Any(), "user-500").Return(nil, errors.New("ddb failure"))
			},
			wantCode: 500,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockStore := mocks.NewMockPhotographerGetter(ctrl)
			tt.mockFn(mockStore)

			h := &handler.Handler{Store: mockStore}
			resp, err := h.Handle(context.Background(), tt.event)

			require.NoError(t, err)
			assert.Equal(t, tt.wantCode, resp.StatusCode)
			assert.Equal(t, "application/json", resp.Headers["Content-Type"])
			assert.Equal(t, "no-store", resp.Headers["Cache-Control"])

			if tt.wantID != "" {
				var p models.Photographer
				require.NoError(t, json.Unmarshal([]byte(resp.Body), &p))
				assert.Equal(t, tt.wantID, p.ID)
			}
		})
	}
}
