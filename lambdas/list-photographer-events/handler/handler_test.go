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

	"github.com/racephotos/list-photographer-events/handler"
	"github.com/racephotos/list-photographer-events/handler/mocks"
	"github.com/racephotos/shared/models"
)

func makeEvent(sub, cursor string) events.APIGatewayV2HTTPRequest {
	req := events.APIGatewayV2HTTPRequest{
		QueryStringParameters: map[string]string{},
	}
	if cursor != "" {
		req.QueryStringParameters["cursor"] = cursor
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
		name           string
		sub            string
		cursor         string
		mockFn         func(*mocks.MockEventLister)
		wantCode       int
		wantCount      int
		wantNextCursor string
	}{
		{
			name:   "happy path — returns events with no next cursor",
			sub:    "user-1",
			cursor: "",
			mockFn: func(m *mocks.MockEventLister) {
				m.EXPECT().ListEventsByPhotographer(gomock.Any(), "user-1", "", 20).Return([]models.Event{
					{ID: "event-1", Name: "Spring Run"},
					{ID: "event-2", Name: "Summer Run"},
				}, "", nil)
			},
			wantCode:       200,
			wantCount:      2,
			wantNextCursor: "",
		},
		{
			name:   "happy path — returns events with next cursor",
			sub:    "user-1",
			cursor: "",
			mockFn: func(m *mocks.MockEventLister) {
				m.EXPECT().ListEventsByPhotographer(gomock.Any(), "user-1", "", 20).Return([]models.Event{
					{ID: "event-1"},
				}, "next-cursor-abc", nil)
			},
			wantCode:       200,
			wantCount:      1,
			wantNextCursor: "next-cursor-abc",
		},
		{
			name:   "happy path — empty results",
			sub:    "user-1",
			cursor: "",
			mockFn: func(m *mocks.MockEventLister) {
				m.EXPECT().ListEventsByPhotographer(gomock.Any(), "user-1", "", 20).Return(nil, "", nil)
			},
			wantCode:  200,
			wantCount: 0,
		},
		{
			name:   "with cursor — passes cursor to store",
			sub:    "user-1",
			cursor: "cursor-xyz",
			mockFn: func(m *mocks.MockEventLister) {
				m.EXPECT().ListEventsByPhotographer(gomock.Any(), "user-1", "cursor-xyz", 20).Return([]models.Event{}, "", nil)
			},
			wantCode: 200,
		},
		{
			name:     "missing JWT sub — returns 401",
			sub:      "",
			cursor:   "",
			mockFn:   func(m *mocks.MockEventLister) {},
			wantCode: 401,
		},
		{
			name:   "store error — returns 500",
			sub:    "user-1",
			cursor: "",
			mockFn: func(m *mocks.MockEventLister) {
				m.EXPECT().ListEventsByPhotographer(gomock.Any(), "user-1", "", 20).Return(nil, "", errors.New("ddb failure"))
			},
			wantCode: 500,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockStore := mocks.NewMockEventLister(ctrl)
			tt.mockFn(mockStore)

			h := &handler.Handler{Store: mockStore}
			resp, err := h.Handle(context.Background(), makeEvent(tt.sub, tt.cursor))

			require.NoError(t, err)
			assert.Equal(t, tt.wantCode, resp.StatusCode)
			assert.Equal(t, "application/json", resp.Headers["Content-Type"])

			if tt.wantCode == 200 {
				var result struct {
					Events     []models.Event `json:"events"`
					NextCursor string         `json:"nextCursor"`
				}
				require.NoError(t, json.Unmarshal([]byte(resp.Body), &result))
				assert.Len(t, result.Events, tt.wantCount)
				if tt.wantNextCursor != "" {
					assert.Equal(t, tt.wantNextCursor, result.NextCursor)
				}
			}
		})
	}
}
