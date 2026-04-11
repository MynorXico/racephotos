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

	"github.com/racephotos/search/handler"
	"github.com/racephotos/search/handler/mocks"
	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

const (
	testCdnDomain  = "d1234.cloudfront.net"
	testEventID    = "550e8400-e29b-41d4-a716-446655440001"
	testMissingID  = "550e8400-e29b-41d4-a716-000000000099"
)

var testEvent = &models.Event{
	ID:            testEventID,
	Name:          "Spring Race 2026",
	Date:          "2026-03-15",
	Location:      "City Park",
	PricePerPhoto: 75.0,
	Currency:      "GTQ",
}

func makeReq(eventID, bib string) events.APIGatewayV2HTTPRequest {
	req := events.APIGatewayV2HTTPRequest{
		PathParameters:        map[string]string{"id": eventID},
		QueryStringParameters: map[string]string{},
	}
	if bib != "" {
		req.QueryStringParameters["bib"] = bib
	}
	return req
}

func TestHandler_Handle(t *testing.T) {
	indexedPhoto := models.Photo{
		ID:               "photo-1",
		EventID:          testEventID,
		Status:           models.PhotoStatusIndexed,
		WatermarkedS3Key: "processed/photo-1.jpg",
		RawS3Key:         "raw/photo-1.jpg",
		CapturedAt:       "2026-03-15T09:00:00Z",
	}
	nonIndexedPhoto := models.Photo{
		ID:       "photo-2",
		EventID:  testEventID,
		Status:   models.PhotoStatusProcessing,
		RawS3Key: "raw/photo-2.jpg",
	}
	noWatermarkPhoto := models.Photo{
		ID:      "photo-3",
		EventID: testEventID,
		Status:  models.PhotoStatusIndexed,
		// WatermarkedS3Key intentionally empty
		RawS3Key: "raw/photo-3.jpg",
	}

	tests := []struct {
		name       string
		eventID    string
		bib        string
		mockBib    func(*mocks.MockBibIndexStore)
		mockPhotos func(*mocks.MockPhotoStore)
		mockEvents func(*mocks.MockEventStore)
		wantCode   int
		assertBody func(t *testing.T, body string)
	}{
		{
			name:    "happy path — returns indexed photos with CloudFront URL",
			eventID: testEventID,
			bib:     "101",
			mockBib: func(m *mocks.MockBibIndexStore) {
				m.EXPECT().GetPhotoIDsByBib(gomock.Any(), testEventID, "101").
					Return([]string{"photo-1"}, nil)
			},
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().BatchGetPhotos(gomock.Any(), []string{"photo-1"}).
					Return([]models.Photo{indexedPhoto}, nil)
			},
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(testEvent, nil)
			},
			wantCode: 200,
			assertBody: func(t *testing.T, body string) {
				var res struct {
					Photos []struct {
						PhotoID        string  `json:"photoId"`
						WatermarkedURL string  `json:"watermarkedUrl"`
						CapturedAt     string  `json:"capturedAt"`
						RawS3Key       *string `json:"rawS3Key"`
					} `json:"photos"`
					EventName     string  `json:"eventName"`
					PricePerPhoto float64 `json:"pricePerPhoto"`
					Currency      string  `json:"currency"`
				}
				require.NoError(t, json.Unmarshal([]byte(body), &res))
				require.Len(t, res.Photos, 1)
				assert.Equal(t, "photo-1", res.Photos[0].PhotoID)
				assert.Equal(t, "https://"+testCdnDomain+"/processed/photo-1.jpg", res.Photos[0].WatermarkedURL)
				assert.Equal(t, "2026-03-15T09:00:00Z", res.Photos[0].CapturedAt)
				assert.Nil(t, res.Photos[0].RawS3Key, "rawS3Key must never appear in response")
				assert.Equal(t, "Spring Race 2026", res.EventName)
				assert.Equal(t, 75.0, res.PricePerPhoto)
				assert.Equal(t, "GTQ", res.Currency)
			},
		},
		{
			name:    "non-indexed photos are excluded from results (AC4)",
			eventID: testEventID,
			bib:     "101",
			mockBib: func(m *mocks.MockBibIndexStore) {
				m.EXPECT().GetPhotoIDsByBib(gomock.Any(), testEventID, "101").
					Return([]string{"photo-1", "photo-2", "photo-3"}, nil)
			},
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().BatchGetPhotos(gomock.Any(), []string{"photo-1", "photo-2", "photo-3"}).
					Return([]models.Photo{indexedPhoto, nonIndexedPhoto, noWatermarkPhoto}, nil)
			},
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(testEvent, nil)
			},
			wantCode: 200,
			assertBody: func(t *testing.T, body string) {
				var res struct {
					Photos []struct {
						PhotoID string `json:"photoId"`
					} `json:"photos"`
				}
				require.NoError(t, json.Unmarshal([]byte(body), &res))
				require.Len(t, res.Photos, 1, "only indexed photos with watermarkedS3Key are included")
				assert.Equal(t, "photo-1", res.Photos[0].PhotoID)
			},
		},
		{
			name:    "no matching bib entries — returns empty photos array (AC2)",
			eventID: testEventID,
			bib:     "999",
			mockBib: func(m *mocks.MockBibIndexStore) {
				m.EXPECT().GetPhotoIDsByBib(gomock.Any(), testEventID, "999").
					Return([]string{}, nil)
			},
			mockPhotos: func(m *mocks.MockPhotoStore) {},
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(testEvent, nil)
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
			name:       "missing bib query param — returns 400 (AC10)",
			eventID:    testEventID,
			bib:        "",
			mockBib:    func(m *mocks.MockBibIndexStore) {},
			mockPhotos: func(m *mocks.MockPhotoStore) {},
			mockEvents: func(m *mocks.MockEventStore) {},
			wantCode:   400,
		},
		{
			name:       "invalid event id format — returns 400",
			eventID:    "not-a-uuid",
			bib:        "101",
			mockBib:    func(m *mocks.MockBibIndexStore) {},
			mockPhotos: func(m *mocks.MockPhotoStore) {},
			mockEvents: func(m *mocks.MockEventStore) {},
			wantCode:   400,
		},
		{
			name:    "event not found — returns 404 (AC3)",
			eventID: testMissingID,
			bib:     "101",
			mockBib: func(m *mocks.MockBibIndexStore) {
				// GetPhotoIDsByBib runs concurrently and may complete before 404
				m.EXPECT().GetPhotoIDsByBib(gomock.Any(), testMissingID, "101").
					Return([]string{}, nil).AnyTimes()
			},
			mockPhotos: func(m *mocks.MockPhotoStore) {},
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEvent(gomock.Any(), testMissingID).Return(nil, apperrors.ErrNotFound)
			},
			wantCode: 404,
		},
		{
			name:    "bib index store error — returns 500",
			eventID: testEventID,
			bib:     "101",
			mockBib: func(m *mocks.MockBibIndexStore) {
				m.EXPECT().GetPhotoIDsByBib(gomock.Any(), testEventID, "101").
					Return(nil, errors.New("ddb failure"))
			},
			mockPhotos: func(m *mocks.MockPhotoStore) {},
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(testEvent, nil).AnyTimes()
			},
			wantCode: 500,
		},
		{
			name:    "photo store error — returns 500",
			eventID: testEventID,
			bib:     "101",
			mockBib: func(m *mocks.MockBibIndexStore) {
				m.EXPECT().GetPhotoIDsByBib(gomock.Any(), testEventID, "101").
					Return([]string{"photo-1"}, nil)
			},
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().BatchGetPhotos(gomock.Any(), []string{"photo-1"}).
					Return(nil, errors.New("ddb failure"))
			},
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(testEvent, nil)
			},
			wantCode: 500,
		},
		{
			name:    "event store error — returns 500",
			eventID: testEventID,
			bib:     "101",
			mockBib: func(m *mocks.MockBibIndexStore) {
				m.EXPECT().GetPhotoIDsByBib(gomock.Any(), testEventID, "101").
					Return([]string{}, nil).AnyTimes()
			},
			mockPhotos: func(m *mocks.MockPhotoStore) {},
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(nil, errors.New("ddb failure"))
			},
			wantCode: 500,
		},
		{
			name:    "capturedAt is omitted from response when empty",
			eventID: testEventID,
			bib:     "101",
			mockBib: func(m *mocks.MockBibIndexStore) {
				m.EXPECT().GetPhotoIDsByBib(gomock.Any(), testEventID, "101").
					Return([]string{"photo-1"}, nil)
			},
			mockPhotos: func(m *mocks.MockPhotoStore) {
				noTimestamp := indexedPhoto
				noTimestamp.CapturedAt = ""
				m.EXPECT().BatchGetPhotos(gomock.Any(), []string{"photo-1"}).
					Return([]models.Photo{noTimestamp}, nil)
			},
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(testEvent, nil)
			},
			wantCode: 200,
			assertBody: func(t *testing.T, body string) {
				var res struct {
					Photos []struct {
						CapturedAt *string `json:"capturedAt"`
					} `json:"photos"`
				}
				require.NoError(t, json.Unmarshal([]byte(body), &res))
				require.Len(t, res.Photos, 1)
				assert.Nil(t, res.Photos[0].CapturedAt)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockBib := mocks.NewMockBibIndexStore(ctrl)
			mockPhotos := mocks.NewMockPhotoStore(ctrl)
			mockEvents := mocks.NewMockEventStore(ctrl)
			tt.mockBib(mockBib)
			tt.mockPhotos(mockPhotos)
			tt.mockEvents(mockEvents)

			h := &handler.Handler{
				BibIndex:  mockBib,
				Photos:    mockPhotos,
				Events:    mockEvents,
				CdnDomain: testCdnDomain,
			}

			resp, err := h.Handle(context.Background(), makeReq(tt.eventID, tt.bib))
			require.NoError(t, err)
			assert.Equal(t, tt.wantCode, resp.StatusCode)
			assert.Equal(t, "application/json", resp.Headers["Content-Type"])

			if tt.assertBody != nil {
				tt.assertBody(t, resp.Body)
			}
		})
	}
}
