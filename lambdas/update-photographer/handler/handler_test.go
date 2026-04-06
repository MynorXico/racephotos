package handler_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/golang/mock/gomock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/racephotos/shared/models"
	"github.com/racephotos/update-photographer/handler"
	"github.com/racephotos/update-photographer/handler/mocks"
)

func makeEvent(sub, body string) events.APIGatewayV2HTTPRequest {
	e := events.APIGatewayV2HTTPRequest{Body: body}
	if sub != "" {
		e.RequestContext = events.APIGatewayV2HTTPRequestContext{
			Authorizer: &events.APIGatewayV2HTTPRequestContextAuthorizerDescription{
				JWT: &events.APIGatewayV2HTTPRequestContextAuthorizerJWTDescription{
					Claims: map[string]string{"sub": sub},
				},
			},
		}
	}
	return e
}

func validBody(currency string) string {
	b, _ := json.Marshal(map[string]string{
		"displayName":     "Test Photographer",
		"defaultCurrency": currency,
	})
	return string(b)
}

func bodyWithDisplayName(displayName, currency string) string {
	b, _ := json.Marshal(map[string]string{
		"displayName":     displayName,
		"defaultCurrency": currency,
	})
	return string(b)
}

func stubProfile(id string) *models.Photographer {
	return &models.Photographer{
		ID:              id,
		DisplayName:     "Test Photographer",
		DefaultCurrency: "USD",
		CreatedAt:       "2024-01-01T00:00:00Z",
		UpdatedAt:       "2024-06-01T00:00:00Z",
	}
}

func TestHandler_Handle(t *testing.T) {
	tests := []struct {
		name     string
		event    events.APIGatewayV2HTTPRequest
		mockFn   func(*mocks.MockPhotographerUpserter)
		wantCode int
	}{
		{
			name:  "happy path — creates new profile",
			event: makeEvent("user-1", validBody("USD")),
			mockFn: func(m *mocks.MockPhotographerUpserter) {
				m.EXPECT().UpsertPhotographer(gomock.Any(), gomock.Any()).Return(stubProfile("user-1"), nil)
			},
			wantCode: 200,
		},
		{
			name:  "happy path — lowercase currency normalised",
			event: makeEvent("user-2a", validBody("eur")),
			mockFn: func(m *mocks.MockPhotographerUpserter) {
				m.EXPECT().UpsertPhotographer(gomock.Any(), gomock.Any()).Return(stubProfile("user-2a"), nil)
			},
			wantCode: 200,
		},
		{
			name:  "happy path — updates existing profile",
			event: makeEvent("user-2", validBody("EUR")),
			mockFn: func(m *mocks.MockPhotographerUpserter) {
				m.EXPECT().UpsertPhotographer(gomock.Any(), gomock.Any()).Return(stubProfile("user-2"), nil)
			},
			wantCode: 200,
		},
		{
			name:     "missing JWT sub — returns 401",
			event:    makeEvent("", validBody("USD")),
			mockFn:   func(m *mocks.MockPhotographerUpserter) {},
			wantCode: 401,
		},
		{
			name:     "invalid JSON body — returns 400",
			event:    makeEvent("user-3", "{bad json}"),
			mockFn:   func(m *mocks.MockPhotographerUpserter) {},
			wantCode: 400,
		},
		{
			name:     "empty display name — returns 400",
			event:    makeEvent("user-4", bodyWithDisplayName("", "USD")),
			mockFn:   func(m *mocks.MockPhotographerUpserter) {},
			wantCode: 400,
		},
		{
			name:     "whitespace-only display name — returns 400",
			event:    makeEvent("user-4b", bodyWithDisplayName("   ", "USD")),
			mockFn:   func(m *mocks.MockPhotographerUpserter) {},
			wantCode: 400,
		},
		{
			name:     "display name exceeds 100 chars — returns 400",
			event:    makeEvent("user-5", bodyWithDisplayName(strings.Repeat("a", 101), "USD")),
			mockFn:   func(m *mocks.MockPhotographerUpserter) {},
			wantCode: 400,
		},
		{
			name:     "empty currency code — returns 400",
			event:    makeEvent("user-6", validBody("")),
			mockFn:   func(m *mocks.MockPhotographerUpserter) {},
			wantCode: 400,
		},
		{
			name:     "invalid currency code — returns 400",
			event:    makeEvent("user-7", validBody("XYZ")),
			mockFn:   func(m *mocks.MockPhotographerUpserter) {},
			wantCode: 400,
		},
		{
			name:  "store UpsertPhotographer fails — returns 500",
			event: makeEvent("user-8", validBody("GBP")),
			mockFn: func(m *mocks.MockPhotographerUpserter) {
				m.EXPECT().UpsertPhotographer(gomock.Any(), gomock.Any()).Return(nil, errors.New("write failure"))
			},
			wantCode: 500,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockStore := mocks.NewMockPhotographerUpserter(ctrl)
			tt.mockFn(mockStore)

			h := &handler.Handler{Store: mockStore}
			resp, err := h.Handle(context.Background(), tt.event)

			require.NoError(t, err)
			assert.Equal(t, tt.wantCode, resp.StatusCode)
			assert.Equal(t, "application/json", resp.Headers["Content-Type"])
			assert.Equal(t, "no-store", resp.Headers["Cache-Control"])
		})
	}
}

func TestHandler_Handle_ResponseBody(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	expected := &models.Photographer{
		ID:              "user-7",
		DefaultCurrency: "GTQ",
		CreatedAt:       "2024-01-01T00:00:00Z",
		UpdatedAt:       "2024-06-01T00:00:00Z",
	}

	mockStore := mocks.NewMockPhotographerUpserter(ctrl)
	mockStore.EXPECT().UpsertPhotographer(gomock.Any(), gomock.Any()).Return(expected, nil)

	h := &handler.Handler{Store: mockStore}
	resp, err := h.Handle(context.Background(), makeEvent("user-7", validBody("GTQ")))

	require.NoError(t, err)
	assert.Equal(t, 200, resp.StatusCode)

	var p models.Photographer
	require.NoError(t, json.Unmarshal([]byte(resp.Body), &p))
	assert.Equal(t, "user-7", p.ID)
	assert.Equal(t, "GTQ", p.DefaultCurrency)
	assert.NotEmpty(t, p.CreatedAt)
	assert.NotEmpty(t, p.UpdatedAt)
}

func TestHandler_Handle_PreservesCreatedAt(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	originalCreatedAt := "2024-01-01T00:00:00Z"

	// The mock simulates DynamoDB returning the preserved createdAt via if_not_exists.
	mockStore := mocks.NewMockPhotographerUpserter(ctrl)
	mockStore.EXPECT().UpsertPhotographer(gomock.Any(), gomock.Any()).Return(
		&models.Photographer{
			ID:        "user-8",
			CreatedAt: originalCreatedAt,
			UpdatedAt: "2026-04-05T00:00:00Z",
		}, nil)

	h := &handler.Handler{Store: mockStore}
	resp, err := h.Handle(context.Background(), makeEvent("user-8", validBody("USD")))

	require.NoError(t, err)
	assert.Equal(t, 200, resp.StatusCode)

	var p models.Photographer
	require.NoError(t, json.Unmarshal([]byte(resp.Body), &p))
	assert.Equal(t, originalCreatedAt, p.CreatedAt)
}
