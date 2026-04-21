package handler_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/golang/mock/gomock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/racephotos/list-events/handler"
	"github.com/racephotos/list-events/handler/mocks"
	"github.com/racephotos/shared/models"
)

func makeReq(cursor, limit string) events.APIGatewayV2HTTPRequest {
	params := map[string]string{}
	if cursor != "" {
		params["cursor"] = cursor
	}
	if limit != "" {
		params["limit"] = limit
	}
	return events.APIGatewayV2HTTPRequest{QueryStringParameters: params}
}

type respBody struct {
	Events []struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Date      string `json:"date"`
		Location  string `json:"location"`
		CreatedAt string `json:"createdAt"`
	} `json:"events"`
	NextCursor *string `json:"nextCursor"`
}

func TestHandler_Handle(t *testing.T) {
	tests := []struct {
		name           string
		cursor         string
		limit          string
		mockFn         func(*mocks.MockEventStore)
		wantCode       int
		wantCount      int
		wantNextCursor *string
	}{
		{
			name:   "AC1 — happy path, events returned, nextCursor null",
			cursor: "",
			mockFn: func(m *mocks.MockEventStore) {
				m.EXPECT().ListActiveEvents(gomock.Any(), "", 20).Return([]models.Event{
					{ID: "e1", Name: "Spring Run", Date: "2026-05-01", Location: "City A", CreatedAt: "2026-05-01T10:00:00Z"},
					{ID: "e2", Name: "Summer Run", Date: "2026-06-01", Location: "City B", CreatedAt: "2026-04-01T10:00:00Z"},
				}, "", nil)
			},
			wantCode:       200,
			wantCount:      2,
			wantNextCursor: nil,
		},
		{
			name:   "AC1 — sensitive fields not exposed in response",
			cursor: "",
			mockFn: func(m *mocks.MockEventStore) {
				m.EXPECT().ListActiveEvents(gomock.Any(), "", 20).Return([]models.Event{
					{ID: "e1", Name: "Run", PhotographerID: "secret-phot-id", PricePerPhoto: 75, Currency: "GTQ", Status: "active"},
				}, "", nil)
			},
			wantCode:  200,
			wantCount: 1,
		},
		{
			name:   "AC1 — nextCursor is non-null when more pages exist",
			cursor: "",
			mockFn: func(m *mocks.MockEventStore) {
				m.EXPECT().ListActiveEvents(gomock.Any(), "", 20).Return([]models.Event{
					{ID: "e1"},
				}, "cursor-abc", nil)
			},
			wantCode:       200,
			wantCount:      1,
			wantNextCursor: strPtr("cursor-abc"),
		},
		{
			name:   "AC2 — cursor forwarded to store",
			cursor: "cursor-xyz",
			mockFn: func(m *mocks.MockEventStore) {
				m.EXPECT().ListActiveEvents(gomock.Any(), "cursor-xyz", 20).Return([]models.Event{}, "", nil)
			},
			wantCode: 200,
		},
		{
			name:   "AC4 — empty events list returns empty array and null nextCursor",
			cursor: "",
			mockFn: func(m *mocks.MockEventStore) {
				m.EXPECT().ListActiveEvents(gomock.Any(), "", 20).Return(nil, "", nil)
			},
			wantCode:       200,
			wantCount:      0,
			wantNextCursor: nil,
		},
		{
			name:   "limit param parsed and forwarded",
			cursor: "",
			limit:  "10",
			mockFn: func(m *mocks.MockEventStore) {
				m.EXPECT().ListActiveEvents(gomock.Any(), "", 10).Return([]models.Event{}, "", nil)
			},
			wantCode: 200,
		},
		{
			name:   "limit > max clamped to default",
			cursor: "",
			limit:  "200",
			mockFn: func(m *mocks.MockEventStore) {
				m.EXPECT().ListActiveEvents(gomock.Any(), "", 20).Return([]models.Event{}, "", nil)
			},
			wantCode: 200,
		},
		{
			name:   "limit = max boundary (50) accepted",
			cursor: "",
			limit:  "50",
			mockFn: func(m *mocks.MockEventStore) {
				m.EXPECT().ListActiveEvents(gomock.Any(), "", 50).Return([]models.Event{}, "", nil)
			},
			wantCode: 200,
		},
		{
			name:   "AC9 — invalid cursor returns 400",
			cursor: "not-base64!!!",
			mockFn: func(m *mocks.MockEventStore) {
				m.EXPECT().ListActiveEvents(gomock.Any(), "not-base64!!!", 20).Return(nil, "", fmt.Errorf("%w: bad", handler.ErrInvalidCursor))
			},
			wantCode: 400,
		},
		{
			name:   "AC10 — DynamoDB error returns 500, raw error not exposed",
			cursor: "",
			mockFn: func(m *mocks.MockEventStore) {
				m.EXPECT().ListActiveEvents(gomock.Any(), "", 20).Return(nil, "", errors.New("connection refused"))
			},
			wantCode: 500,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockStore := mocks.NewMockEventStore(ctrl)
			tt.mockFn(mockStore)

			h := &handler.Handler{Store: mockStore}
			resp, err := h.Handle(context.Background(), makeReq(tt.cursor, tt.limit))

			require.NoError(t, err)
			assert.Equal(t, tt.wantCode, resp.StatusCode)
			assert.Equal(t, "application/json", resp.Headers["Content-Type"])

			if tt.wantCode == 200 {
				var body respBody
				require.NoError(t, json.Unmarshal([]byte(resp.Body), &body))
				assert.Len(t, body.Events, tt.wantCount)
				if tt.wantNextCursor != nil {
					require.NotNil(t, body.NextCursor)
					assert.Equal(t, *tt.wantNextCursor, *body.NextCursor)
				} else if tt.wantCount >= 0 {
					assert.Nil(t, body.NextCursor)
				}

				// AC1 — verify sensitive fields are not in the JSON.
				if tt.wantCount > 0 {
					assert.NotContains(t, resp.Body, "photographerId")
					assert.NotContains(t, resp.Body, "pricePerPhoto")
					assert.NotContains(t, resp.Body, "currency")
				}
			}

			if tt.wantCode == 500 {
				assert.NotContains(t, resp.Body, "connection refused")
			}
		})
	}
}

func strPtr(s string) *string { return &s }
