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

	"github.com/racephotos/create-event/handler"
	"github.com/racephotos/create-event/handler/mocks"
	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

func makeEvent(sub, body string) events.APIGatewayV2HTTPRequest {
	req := events.APIGatewayV2HTTPRequest{Body: body}
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

func validBody() string {
	return `{"name":"Spring Run","date":"2026-06-01","location":"Central Park","pricePerPhoto":5.00}`
}

func TestHandler_Handle(t *testing.T) {
	tests := []struct {
		name         string
		sub          string
		body         string
		mockEventsFn func(*mocks.MockEventCreator)
		mockPhotosFn func(*mocks.MockPhotographerReader)
		wantCode     int
		wantStatus   string
	}{
		{
			name: "happy path — creates event with provided currency",
			sub:  "user-1",
			body: `{"name":"Spring Run","date":"2026-06-01","location":"Central Park","pricePerPhoto":5.00,"currency":"EUR"}`,
			mockEventsFn: func(m *mocks.MockEventCreator) {
				m.EXPECT().CreateEvent(gomock.Any(), gomock.Any()).Return(nil)
			},
			mockPhotosFn: func(m *mocks.MockPhotographerReader) {},
			wantCode:     201,
			wantStatus:   "active",
		},
		{
			name: "happy path — defaults currency from photographer profile",
			sub:  "user-1",
			body: `{"name":"Spring Run","date":"2026-06-01","location":"Central Park","pricePerPhoto":5.00}`,
			mockEventsFn: func(m *mocks.MockEventCreator) {
				m.EXPECT().CreateEvent(gomock.Any(), gomock.Any()).Return(nil)
			},
			mockPhotosFn: func(m *mocks.MockPhotographerReader) {
				m.EXPECT().GetPhotographer(gomock.Any(), "user-1").Return(&models.Photographer{
					ID:              "user-1",
					DefaultCurrency: "GTQ",
				}, nil)
			},
			wantCode:   201,
			wantStatus: "active",
		},
		{
			name: "happy path — photographer not found defaults currency to USD",
			sub:  "user-new",
			body: validBody(),
			mockEventsFn: func(m *mocks.MockEventCreator) {
				m.EXPECT().CreateEvent(gomock.Any(), gomock.Any()).Return(nil)
			},
			mockPhotosFn: func(m *mocks.MockPhotographerReader) {
				m.EXPECT().GetPhotographer(gomock.Any(), "user-new").Return(nil, apperrors.ErrNotFound)
			},
			wantCode:   201,
			wantStatus: "active",
		},
		{
			name:         "missing JWT sub — returns 401",
			sub:          "",
			body:         validBody(),
			mockEventsFn: func(m *mocks.MockEventCreator) {},
			mockPhotosFn: func(m *mocks.MockPhotographerReader) {},
			wantCode:     401,
		},
		{
			name:         "empty name — returns 400",
			sub:          "user-1",
			body:         `{"name":"","date":"2026-06-01","location":"Central Park","pricePerPhoto":5.00}`,
			mockEventsFn: func(m *mocks.MockEventCreator) {},
			mockPhotosFn: func(m *mocks.MockPhotographerReader) {},
			wantCode:     400,
		},
		{
			name:         "invalid date format — returns 400",
			sub:          "user-1",
			body:         `{"name":"Spring Run","date":"06-01-2026","location":"Central Park","pricePerPhoto":5.00}`,
			mockEventsFn: func(m *mocks.MockEventCreator) {},
			mockPhotosFn: func(m *mocks.MockPhotographerReader) {},
			wantCode:     400,
		},
		{
			name:         "negative price — returns 400",
			sub:          "user-1",
			body:         `{"name":"Spring Run","date":"2026-06-01","location":"Central Park","pricePerPhoto":-1}`,
			mockEventsFn: func(m *mocks.MockEventCreator) {},
			mockPhotosFn: func(m *mocks.MockPhotographerReader) {},
			wantCode:     400,
		},
		{
			name:         "missing location — returns 400",
			sub:          "user-1",
			body:         `{"name":"Spring Run","date":"2026-06-01","pricePerPhoto":5.00}`,
			mockEventsFn: func(m *mocks.MockEventCreator) {},
			mockPhotosFn: func(m *mocks.MockPhotographerReader) {},
			wantCode:     400,
		},
		{
			name:         "invalid JSON body — returns 400",
			sub:          "user-1",
			body:         `not-json`,
			mockEventsFn: func(m *mocks.MockEventCreator) {},
			mockPhotosFn: func(m *mocks.MockPhotographerReader) {},
			wantCode:     400,
		},
		{
			name: "store error on CreateEvent — returns 500",
			sub:  "user-1",
			body: `{"name":"Spring Run","date":"2026-06-01","location":"Central Park","pricePerPhoto":5.00,"currency":"USD"}`,
			mockEventsFn: func(m *mocks.MockEventCreator) {
				m.EXPECT().CreateEvent(gomock.Any(), gomock.Any()).Return(errors.New("ddb error"))
			},
			mockPhotosFn: func(m *mocks.MockPhotographerReader) {},
			wantCode:     500,
		},
		{
			name: "photographer store error — returns 500",
			sub:  "user-1",
			body: validBody(),
			mockEventsFn: func(m *mocks.MockEventCreator) {},
			mockPhotosFn: func(m *mocks.MockPhotographerReader) {
				m.EXPECT().GetPhotographer(gomock.Any(), "user-1").Return(nil, errors.New("ddb failure"))
			},
			wantCode: 500,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockEvents := mocks.NewMockEventCreator(ctrl)
			mockPhotographers := mocks.NewMockPhotographerReader(ctrl)
			tt.mockEventsFn(mockEvents)
			tt.mockPhotosFn(mockPhotographers)

			h := &handler.Handler{
				Events:        mockEvents,
				Photographers: mockPhotographers,
			}
			resp, err := h.Handle(context.Background(), makeEvent(tt.sub, tt.body))

			require.NoError(t, err)
			assert.Equal(t, tt.wantCode, resp.StatusCode)
			assert.Equal(t, "application/json", resp.Headers["Content-Type"])

			if tt.wantStatus != "" {
				var e models.Event
				require.NoError(t, json.Unmarshal([]byte(resp.Body), &e))
				assert.Equal(t, tt.wantStatus, e.Status)
				assert.NotEmpty(t, e.ID)
				assert.Equal(t, "public", e.Visibility)
				assert.Empty(t, e.ArchivedAt)
			}
		})
	}
}
