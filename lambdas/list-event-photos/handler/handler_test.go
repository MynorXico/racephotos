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

	"github.com/racephotos/list-event-photos/handler"
	"github.com/racephotos/list-event-photos/handler/mocks"
	"github.com/racephotos/shared/models"
)

const testCdnDomain = "d1234.cloudfront.net"

// testEventID and testEventMissingID are valid UUIDs — the handler validates
// eventID format before any DynamoDB call.
const testEventID = "550e8400-e29b-41d4-a716-446655440001"
const testEventMissingID = "550e8400-e29b-41d4-a716-000000000099"

func makeEvent(sub, eventID, status, cursor string) events.APIGatewayV2HTTPRequest {
	req := events.APIGatewayV2HTTPRequest{
		PathParameters:        map[string]string{"id": eventID},
		QueryStringParameters: map[string]string{},
	}
	if status != "" {
		req.QueryStringParameters["status"] = status
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
	indexedPhoto := models.Photo{
		ID:               "photo-1",
		EventID:          testEventID,
		Status:           "indexed",
		WatermarkedS3Key: "processed/photo-1.jpg",
		BibNumbers:       []string{"101"},
		UploadedAt:       "2026-04-01T10:00:00Z",
	}
	errorPhoto := models.Photo{
		ID:          "photo-2",
		EventID:     testEventID,
		Status:      "error",
		BibNumbers:  nil,
		UploadedAt:  "2026-04-01T09:00:00Z",
		ErrorReason: "Rekognition timeout",
	}
	processingPhoto := models.Photo{
		ID:         "photo-3",
		EventID:    testEventID,
		Status:     "processing",
		BibNumbers: nil,
		UploadedAt: "2026-04-01T08:00:00Z",
	}

	tests := []struct {
		name       string
		sub        string
		eventID    string
		status     string
		cursor     string
		mockEvents func(*mocks.MockEventStore)
		mockPhotos func(*mocks.MockPhotoStore)
		wantCode   int
		assertBody func(t *testing.T, body string)
	}{
		{
			name:    "happy path — returns photos with thumbnailUrl",
			sub:     "photographer-1",
			eventID: testEventID,
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEventPhotographerID(gomock.Any(), testEventID).Return("photographer-1", nil)
			},
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().ListPhotosByEvent(gomock.Any(), testEventID, "", "", 50).
					Return([]models.Photo{indexedPhoto}, "next-cursor", nil)
			},
			wantCode: 200,
			assertBody: func(t *testing.T, body string) {
				var res struct {
					Photos []struct {
						ID           string   `json:"id"`
						Status       string   `json:"status"`
						ThumbnailURL *string  `json:"thumbnailUrl"`
						BibNumbers   []string `json:"bibNumbers"`
						UploadedAt   string   `json:"uploadedAt"`
					} `json:"photos"`
					NextCursor string `json:"nextCursor"`
				}
				require.NoError(t, json.Unmarshal([]byte(body), &res))
				require.Len(t, res.Photos, 1)
				assert.Equal(t, "photo-1", res.Photos[0].ID)
				assert.Equal(t, "indexed", res.Photos[0].Status)
				require.NotNil(t, res.Photos[0].ThumbnailURL)
				assert.Equal(t, "https://"+testCdnDomain+"/processed/photo-1.jpg", *res.Photos[0].ThumbnailURL)
				assert.Equal(t, []string{"101"}, res.Photos[0].BibNumbers)
				assert.Equal(t, "next-cursor", res.NextCursor)
			},
		},
		{
			name:    "photo with no watermark — thumbnailUrl is null",
			sub:     "photographer-1",
			eventID: testEventID,
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEventPhotographerID(gomock.Any(), testEventID).Return("photographer-1", nil)
			},
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().ListPhotosByEvent(gomock.Any(), testEventID, "", "", 50).
					Return([]models.Photo{processingPhoto}, "", nil)
			},
			wantCode: 200,
			assertBody: func(t *testing.T, body string) {
				var res struct {
					Photos []struct {
						ThumbnailURL *string `json:"thumbnailUrl"`
					} `json:"photos"`
				}
				require.NoError(t, json.Unmarshal([]byte(body), &res))
				require.Len(t, res.Photos, 1)
				assert.Nil(t, res.Photos[0].ThumbnailURL)
			},
		},
		{
			name:    "error photo — includes errorReason",
			sub:     "photographer-1",
			eventID: testEventID,
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEventPhotographerID(gomock.Any(), testEventID).Return("photographer-1", nil)
			},
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().ListPhotosByEvent(gomock.Any(), testEventID, "", "", 50).
					Return([]models.Photo{errorPhoto}, "", nil)
			},
			wantCode: 200,
			assertBody: func(t *testing.T, body string) {
				var res struct {
					Photos []struct {
						ErrorReason string `json:"errorReason"`
					} `json:"photos"`
				}
				require.NoError(t, json.Unmarshal([]byte(body), &res))
				require.Len(t, res.Photos, 1)
				assert.Equal(t, "Rekognition timeout", res.Photos[0].ErrorReason)
			},
		},
		{
			name:    "with status filter — passes filter to store",
			sub:     "photographer-1",
			eventID: testEventID,
			status:  "error",
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEventPhotographerID(gomock.Any(), testEventID).Return("photographer-1", nil)
			},
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().ListPhotosByEvent(gomock.Any(), testEventID, "error", "", 50).
					Return([]models.Photo{errorPhoto}, "", nil)
			},
			wantCode: 200,
		},
		{
			name:    "in_progress filter — passes in_progress to store and returns mixed photos",
			sub:     "photographer-1",
			eventID: testEventID,
			status:  "in_progress",
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEventPhotographerID(gomock.Any(), testEventID).Return("photographer-1", nil)
			},
			mockPhotos: func(m *mocks.MockPhotoStore) {
				watermarkingPhoto := models.Photo{
					ID:         "photo-4",
					EventID:    testEventID,
					Status:     "watermarking",
					BibNumbers: nil,
					UploadedAt: "2026-04-01T07:00:00Z",
				}
				m.EXPECT().ListPhotosByEvent(gomock.Any(), testEventID, "in_progress", "", 50).
					Return([]models.Photo{processingPhoto, watermarkingPhoto}, "", nil)
			},
			wantCode: 200,
			assertBody: func(t *testing.T, body string) {
				var res struct {
					Photos []struct {
						Status string `json:"status"`
					} `json:"photos"`
				}
				require.NoError(t, json.Unmarshal([]byte(body), &res))
				require.Len(t, res.Photos, 2)
				assert.Equal(t, "processing", res.Photos[0].Status)
				assert.Equal(t, "watermarking", res.Photos[1].Status)
			},
		},
		{
			name:    "with cursor — passes cursor to store",
			sub:     "photographer-1",
			eventID: testEventID,
			cursor:  "cursor-xyz",
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEventPhotographerID(gomock.Any(), testEventID).Return("photographer-1", nil)
			},
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().ListPhotosByEvent(gomock.Any(), testEventID, "", "cursor-xyz", 50).
					Return([]models.Photo{}, "", nil)
			},
			wantCode: 200,
		},
		{
			name:    "empty results — returns empty array not null",
			sub:     "photographer-1",
			eventID: testEventID,
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEventPhotographerID(gomock.Any(), testEventID).Return("photographer-1", nil)
			},
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().ListPhotosByEvent(gomock.Any(), testEventID, "", "", 50).
					Return(nil, "", nil)
			},
			wantCode: 200,
			assertBody: func(t *testing.T, body string) {
				var res struct {
					Photos []interface{} `json:"photos"`
				}
				require.NoError(t, json.Unmarshal([]byte(body), &res))
				assert.NotNil(t, res.Photos)
				assert.Len(t, res.Photos, 0)
			},
		},
		{
			name:       "missing JWT sub — returns 401",
			sub:        "",
			eventID:    testEventID,
			mockEvents: func(m *mocks.MockEventStore) {},
			mockPhotos: func(m *mocks.MockPhotoStore) {},
			wantCode:   401,
		},
		{
			name:       "unknown status value — returns 400",
			sub:        "photographer-1",
			eventID:    "550e8400-e29b-41d4-a716-446655440000",
			status:     "unknown_status",
			mockEvents: func(m *mocks.MockEventStore) {},
			mockPhotos: func(m *mocks.MockPhotoStore) {},
			wantCode:   400,
		},
		{
			name:       "non-UUID event id — returns 400",
			sub:        "photographer-1",
			eventID:    "not-a-uuid",
			mockEvents: func(m *mocks.MockEventStore) {},
			mockPhotos: func(m *mocks.MockPhotoStore) {},
			wantCode:   400,
		},
		{
			name:    "event not found — returns 404",
			sub:     "photographer-1",
			eventID: testEventMissingID,
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEventPhotographerID(gomock.Any(), testEventMissingID).Return("", handler.ErrEventNotFound)
			},
			// ListPhotosByEvent is launched concurrently with the ownership check;
			// its result is discarded when ownership fails. Allow any call.
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().ListPhotosByEvent(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
					Return(nil, "", nil).AnyTimes()
			},
			wantCode: 404,
		},
		{
			name:    "caller does not own event — returns 403",
			sub:     "photographer-1",
			eventID: testEventID,
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEventPhotographerID(gomock.Any(), testEventID).Return("photographer-2", nil)
			},
			// ListPhotosByEvent is launched concurrently; result discarded after 403.
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().ListPhotosByEvent(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
					Return(nil, "", nil).AnyTimes()
			},
			wantCode: 403,
		},
		{
			name:    "event store error — returns 500",
			sub:     "photographer-1",
			eventID: testEventID,
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEventPhotographerID(gomock.Any(), testEventID).Return("", errors.New("ddb failure"))
			},
			// ListPhotosByEvent is launched concurrently; result discarded after 500.
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().ListPhotosByEvent(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
					Return(nil, "", nil).AnyTimes()
			},
			wantCode: 500,
		},
		{
			name:    "photo store error — returns 500",
			sub:     "photographer-1",
			eventID: testEventID,
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEventPhotographerID(gomock.Any(), testEventID).Return("photographer-1", nil)
			},
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().ListPhotosByEvent(gomock.Any(), testEventID, "", "", 50).
					Return(nil, "", errors.New("ddb failure"))
			},
			wantCode: 500,
		},
		{
			name:    "invalid cursor — returns 400",
			sub:     "photographer-1",
			eventID: testEventID,
			cursor:  "bad-cursor",
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEventPhotographerID(gomock.Any(), testEventID).Return("photographer-1", nil)
			},
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().ListPhotosByEvent(gomock.Any(), testEventID, "", "bad-cursor", 50).
					Return(nil, "", handler.ErrInvalidCursor)
			},
			wantCode: 400,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockPhotos := mocks.NewMockPhotoStore(ctrl)
			mockEvents := mocks.NewMockEventStore(ctrl)
			tt.mockEvents(mockEvents)
			tt.mockPhotos(mockPhotos)

			h := &handler.Handler{
				Photos:    mockPhotos,
				Events:    mockEvents,
				CdnDomain: testCdnDomain,
			}

			resp, err := h.Handle(context.Background(), makeEvent(tt.sub, tt.eventID, tt.status, tt.cursor))
			require.NoError(t, err)
			assert.Equal(t, tt.wantCode, resp.StatusCode)
			assert.Equal(t, "application/json", resp.Headers["Content-Type"])

			if tt.assertBody != nil {
				tt.assertBody(t, resp.Body)
			}
		})
	}
}
