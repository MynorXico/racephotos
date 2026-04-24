package handler_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/golang/mock/gomock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/racephotos/list-public-event-photos/handler"
	"github.com/racephotos/list-public-event-photos/handler/mocks"
	"github.com/racephotos/shared/models"
)

const (
	testEventID = "11111111-2222-3333-4444-555555555555"
	testCDN     = "cdn.example.com"
)

func apiRequest(eventID, cursor, limit string) events.APIGatewayV2HTTPRequest {
	qsp := map[string]string{}
	if cursor != "" {
		qsp["cursor"] = cursor
	}
	if limit != "" {
		qsp["limit"] = limit
	}
	return events.APIGatewayV2HTTPRequest{
		PathParameters:      map[string]string{"id": eventID},
		QueryStringParameters: qsp,
	}
}

func validCursor(eventID string) string {
	m := map[string]map[string]string{
		"id":         {"S": "photo-abc"},
		"eventId":    {"S": eventID},
		"uploadedAt": {"S": "2026-01-01T00:00:00Z"},
	}
	b, _ := json.Marshal(m)
	return base64.RawURLEncoding.EncodeToString(b)
}

func testEvent() *models.Event {
	return &models.Event{
		Name:          "City Marathon 2026",
		PhotoCount:    150,
		PricePerPhoto: 5.00,
		Currency:      "GTQ",
	}
}

func testPhotos(n int) []models.Photo {
	photos := make([]models.Photo, n)
	for i := range photos {
		photos[i] = models.Photo{
			ID:               "photo-" + string(rune('a'+i)),
			EventID:          testEventID,
			Status:           models.PhotoStatusIndexed,
			WatermarkedS3Key: testEventID + "/photo-" + string(rune('a'+i)) + "/watermarked.jpg",
			UploadedAt:       "2026-01-01T00:00:00Z",
		}
	}
	return photos
}

func TestHandler_Handle(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name           string
		eventID        string
		cursor         string
		limit          string
		setupPhotos    func(*mocks.MockEventPhotoLister)
		setupEvents    func(*mocks.MockPublicEventReader)
		wantStatus     int
		wantNextCursor bool   // true if nextCursor should be non-null in response
		wantTotalCount int
		wantPhotoCount int
		wantErrBody    string
	}{
		{
			// AC1: first page load with photos and counter.
			name:    "AC1: happy path — first page, photos returned with totalCount",
			eventID: testEventID,
			setupEvents: func(m *mocks.MockPublicEventReader) {
				m.EXPECT().GetPublicEvent(gomock.Any(), testEventID).Return(testEvent(), nil)
			},
			setupPhotos: func(m *mocks.MockEventPhotoLister) {
				m.EXPECT().ListEventPhotos(gomock.Any(), testEventID, "", 24).
					Return(testPhotos(24), "next-cursor-token", nil)
			},
			wantStatus:     200,
			wantNextCursor: true,
			wantTotalCount: 150,
			wantPhotoCount: 24,
		},
		{
			// AC2: load more appends photos; last page has no nextCursor.
			name:    "AC2: last page — nextCursor is null",
			eventID: testEventID,
			cursor:  validCursor(testEventID),
			setupEvents: func(m *mocks.MockPublicEventReader) {
				m.EXPECT().GetPublicEvent(gomock.Any(), testEventID).Return(testEvent(), nil)
			},
			setupPhotos: func(m *mocks.MockEventPhotoLister) {
				m.EXPECT().ListEventPhotos(gomock.Any(), testEventID, validCursor(testEventID), 24).
					Return(testPhotos(5), "", nil)
			},
			wantStatus:     200,
			wantNextCursor: false,
			wantTotalCount: 150,
			wantPhotoCount: 5,
		},
		{
			// AC7: empty event — no indexed photos yet.
			name:    "AC7: empty event — empty photos array returned",
			eventID: testEventID,
			setupEvents: func(m *mocks.MockPublicEventReader) {
				ev := testEvent()
				ev.PhotoCount = 0
				m.EXPECT().GetPublicEvent(gomock.Any(), testEventID).Return(ev, nil)
			},
			setupPhotos: func(m *mocks.MockEventPhotoLister) {
				m.EXPECT().ListEventPhotos(gomock.Any(), testEventID, "", 24).
					Return(nil, "", nil)
			},
			wantStatus:     200,
			wantNextCursor: false,
			wantTotalCount: 0,
			wantPhotoCount: 0,
		},
		{
			// AC9: invalid cursor → 400.
			name:    "AC9: invalid cursor — 400 returned before DynamoDB call",
			eventID: testEventID,
			cursor:  "not-valid-base64!!!",
			setupEvents: func(m *mocks.MockPublicEventReader) {},
			setupPhotos: func(m *mocks.MockEventPhotoLister) {},
			wantStatus:  400,
			wantErrBody: "invalid cursor",
		},
		{
			// AC10: event not found → 404.
			name:    "AC10: event not found — 404 returned",
			eventID: testEventID,
			setupEvents: func(m *mocks.MockPublicEventReader) {
				m.EXPECT().GetPublicEvent(gomock.Any(), testEventID).Return(nil, handler.ErrEventNotFound)
			},
			setupPhotos: func(m *mocks.MockEventPhotoLister) {
				// Photo listing runs concurrently but event check gates the response.
				m.EXPECT().ListEventPhotos(gomock.Any(), testEventID, "", 24).
					Return(nil, "", nil).AnyTimes()
			},
			wantStatus:  404,
			wantErrBody: "event not found",
		},
		{
			// AC11: DynamoDB error → 500; raw error not in body.
			name:    "AC11: DynamoDB Query error — 500, raw error not exposed",
			eventID: testEventID,
			setupEvents: func(m *mocks.MockPublicEventReader) {
				m.EXPECT().GetPublicEvent(gomock.Any(), testEventID).Return(testEvent(), nil)
			},
			setupPhotos: func(m *mocks.MockEventPhotoLister) {
				m.EXPECT().ListEventPhotos(gomock.Any(), testEventID, "", 24).
					Return(nil, "", errors.New("dynamodb: throttle"))
			},
			wantStatus:  500,
			wantErrBody: "internal error",
		},
		{
			// Bad event ID: non-UUID format.
			name:        "invalid event ID — 400 returned",
			eventID:     "not-a-uuid",
			setupEvents: func(m *mocks.MockPublicEventReader) {},
			setupPhotos: func(m *mocks.MockEventPhotoLister) {},
			wantStatus:  400,
			wantErrBody: "missing or invalid event id",
		},
		{
			// Custom limit within allowed range.
			name:    "custom limit=10 accepted",
			eventID: testEventID,
			limit:   "10",
			setupEvents: func(m *mocks.MockPublicEventReader) {
				m.EXPECT().GetPublicEvent(gomock.Any(), testEventID).Return(testEvent(), nil)
			},
			setupPhotos: func(m *mocks.MockEventPhotoLister) {
				m.EXPECT().ListEventPhotos(gomock.Any(), testEventID, "", 10).
					Return(testPhotos(10), "", nil)
			},
			wantStatus:     200,
			wantPhotoCount: 10,
			wantTotalCount: 150,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			photos := mocks.NewMockEventPhotoLister(ctrl)
			eventsStore := mocks.NewMockPublicEventReader(ctrl)

			tc.setupPhotos(photos)
			tc.setupEvents(eventsStore)

			h := &handler.Handler{
				Photos:    photos,
				Events:    eventsStore,
				CdnDomain: testCDN,
			}

			resp, err := h.Handle(ctx, apiRequest(tc.eventID, tc.cursor, tc.limit))
			require.NoError(t, err)
			assert.Equal(t, tc.wantStatus, resp.StatusCode)

			if tc.wantErrBody != "" {
				var body map[string]string
				require.NoError(t, json.Unmarshal([]byte(resp.Body), &body))
				assert.Equal(t, tc.wantErrBody, body["error"])
				return
			}

			var body struct {
				Photos        []map[string]any `json:"photos"`
				NextCursor    *string          `json:"nextCursor"`
				TotalCount    int              `json:"totalCount"`
				EventName     string           `json:"eventName"`
				PricePerPhoto float64          `json:"pricePerPhoto"`
				Currency      string           `json:"currency"`
			}
			require.NoError(t, json.Unmarshal([]byte(resp.Body), &body))

			assert.Len(t, body.Photos, tc.wantPhotoCount)
			assert.Equal(t, tc.wantTotalCount, body.TotalCount)
			if tc.wantNextCursor {
				assert.NotNil(t, body.NextCursor)
			} else {
				assert.Nil(t, body.NextCursor)
			}
			// Verify CDN URL construction for non-empty results.
			for _, p := range body.Photos {
				url, _ := p["watermarkedUrl"].(string)
				assert.True(t, len(url) > 0, "watermarkedUrl must be non-empty")
				assert.Contains(t, url, "https://"+testCDN+"/")
			}
		})
	}
}
