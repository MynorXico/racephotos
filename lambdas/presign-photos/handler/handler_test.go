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

	"github.com/racephotos/presign-photos/handler"
	"github.com/racephotos/presign-photos/handler/mocks"
	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

// testEventID is a valid UUID used as the event ID across test cases.
const testEventID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"

// missingEventID is a valid UUID used for "event not found" test cases.
const missingEventID = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"

func makeReq(sub, eventID, body string) events.APIGatewayV2HTTPRequest {
	req := events.APIGatewayV2HTTPRequest{
		Body:           body,
		PathParameters: map[string]string{"eventId": eventID},
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

func ownerEvent() *models.Event {
	return &models.Event{ID: testEventID, PhotographerID: "user-1"}
}

func TestHandler_Handle(t *testing.T) {
	tests := []struct {
		name           string
		sub            string
		eventID        string
		body           string
		mockEventsFn   func(*mocks.MockEventReader)
		mockPhotosFn   func(*mocks.MockPhotoStore)
		mockPresignFn  func(*mocks.MockS3Presigner)
		wantCode       int
		wantPhotoCount int
	}{
		{
			// AC1, AC4, AC5, AC6: authenticated photographer uploads 3 photos.
			// PresignPutObject runs before BatchCreatePhotos (ghost-record prevention).
			name:    "happy path — 3 photos, returns presigned URLs",
			sub:     "user-1",
			eventID: testEventID,
			body:    `{"photos":[{"filename":"a.jpg","contentType":"image/jpeg","size":100},{"filename":"b.jpg","contentType":"image/jpeg","size":200},{"filename":"c.png","contentType":"image/png","size":300}]}`,
			mockEventsFn: func(m *mocks.MockEventReader) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(ownerEvent(), nil)
			},
			mockPresignFn: func(m *mocks.MockS3Presigner) {
				m.EXPECT().PresignPutObject(gomock.Any(), "raw-bucket", gomock.Any(), "image/jpeg", gomock.Any()).Return("https://s3.example.com/a", nil)
				m.EXPECT().PresignPutObject(gomock.Any(), "raw-bucket", gomock.Any(), "image/jpeg", gomock.Any()).Return("https://s3.example.com/b", nil)
				m.EXPECT().PresignPutObject(gomock.Any(), "raw-bucket", gomock.Any(), "image/png", gomock.Any()).Return("https://s3.example.com/c", nil)
			},
			mockPhotosFn: func(m *mocks.MockPhotoStore) {
				m.EXPECT().BatchCreatePhotos(gomock.Any(), gomock.Len(3)).Return(nil)
			},
			wantCode:       200,
			wantPhotoCount: 3,
		},
		{
			name:    "happy path — PNG contentType accepted",
			sub:     "user-1",
			eventID: testEventID,
			body:    `{"photos":[{"filename":"shot.png","contentType":"image/png","size":500}]}`,
			mockEventsFn: func(m *mocks.MockEventReader) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(ownerEvent(), nil)
			},
			mockPresignFn: func(m *mocks.MockS3Presigner) {
				m.EXPECT().PresignPutObject(gomock.Any(), "raw-bucket", gomock.Any(), "image/png", gomock.Any()).Return("https://s3.example.com/shot", nil)
			},
			mockPhotosFn: func(m *mocks.MockPhotoStore) {
				m.EXPECT().BatchCreatePhotos(gomock.Any(), gomock.Len(1)).Return(nil)
			},
			wantCode:       200,
			wantPhotoCount: 1,
		},
		{
			// AC2: batch size > 100 rejected before any store calls.
			name:          "AC2 — 101 items exceeds maximum",
			sub:           "user-1",
			eventID:       testEventID,
			body:          buildBatchBody(101),
			mockEventsFn:  func(m *mocks.MockEventReader) {},
			mockPhotosFn:  func(m *mocks.MockPhotoStore) {},
			mockPresignFn: func(m *mocks.MockS3Presigner) {},
			wantCode:      400,
		},
		{
			// AC3: wrong photographer sub → 403.
			name:    "AC3 — caller does not own the event",
			sub:     "other-user",
			eventID: testEventID,
			body:    `{"photos":[{"filename":"a.jpg","contentType":"image/jpeg","size":100}]}`,
			mockEventsFn: func(m *mocks.MockEventReader) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(ownerEvent(), nil)
			},
			mockPhotosFn:  func(m *mocks.MockPhotoStore) {},
			mockPresignFn: func(m *mocks.MockS3Presigner) {},
			wantCode:      403,
		},
		{
			// AC9: event not found → 404.
			name:    "AC9 — event not found",
			sub:     "user-1",
			eventID: missingEventID,
			body:    `{"photos":[{"filename":"a.jpg","contentType":"image/jpeg","size":100}]}`,
			mockEventsFn: func(m *mocks.MockEventReader) {
				m.EXPECT().GetEvent(gomock.Any(), missingEventID).Return(nil, apperrors.ErrNotFound)
			},
			mockPhotosFn:  func(m *mocks.MockPhotoStore) {},
			mockPresignFn: func(m *mocks.MockS3Presigner) {},
			wantCode:      404,
		},
		{
			// AC10: unsupported contentType rejected before any store calls.
			name:          "AC10 — unsupported contentType video/mp4",
			sub:           "user-1",
			eventID:       testEventID,
			body:          `{"photos":[{"filename":"vid.mp4","contentType":"video/mp4","size":1000}]}`,
			mockEventsFn:  func(m *mocks.MockEventReader) {},
			mockPhotosFn:  func(m *mocks.MockPhotoStore) {},
			mockPresignFn: func(m *mocks.MockS3Presigner) {},
			wantCode:      400,
		},
		{
			// Non-UUID eventId → 400 before any store calls.
			name:          "non-UUID eventId — returns 400",
			sub:           "user-1",
			eventID:       "not-a-uuid",
			body:          `{"photos":[{"filename":"a.jpg","contentType":"image/jpeg","size":100}]}`,
			mockEventsFn:  func(m *mocks.MockEventReader) {},
			mockPhotosFn:  func(m *mocks.MockPhotoStore) {},
			mockPresignFn: func(m *mocks.MockS3Presigner) {},
			wantCode:      400,
		},
		{
			// Invalid filename (path traversal attempt) → 400.
			name:          "invalid filename path traversal — returns 400",
			sub:           "user-1",
			eventID:       testEventID,
			body:          `{"photos":[{"filename":"../../etc/passwd","contentType":"image/jpeg","size":100}]}`,
			mockEventsFn:  func(m *mocks.MockEventReader) {},
			mockPhotosFn:  func(m *mocks.MockPhotoStore) {},
			mockPresignFn: func(m *mocks.MockS3Presigner) {},
			wantCode:      400,
		},
		{
			// Zero size → 400.
			name:          "zero size — returns 400",
			sub:           "user-1",
			eventID:       testEventID,
			body:          `{"photos":[{"filename":"a.jpg","contentType":"image/jpeg","size":0}]}`,
			mockEventsFn:  func(m *mocks.MockEventReader) {},
			mockPhotosFn:  func(m *mocks.MockPhotoStore) {},
			mockPresignFn: func(m *mocks.MockS3Presigner) {},
			wantCode:      400,
		},
		{
			// Size exceeding 50 MB → 400.
			name:          "size exceeds 50 MB — returns 400",
			sub:           "user-1",
			eventID:       testEventID,
			body:          `{"photos":[{"filename":"a.jpg","contentType":"image/jpeg","size":52428801}]}`,
			mockEventsFn:  func(m *mocks.MockEventReader) {},
			mockPhotosFn:  func(m *mocks.MockPhotoStore) {},
			mockPresignFn: func(m *mocks.MockS3Presigner) {},
			wantCode:      400,
		},
		{
			name:          "missing JWT — returns 401",
			sub:           "",
			eventID:       testEventID,
			body:          `{"photos":[{"filename":"a.jpg","contentType":"image/jpeg","size":100}]}`,
			mockEventsFn:  func(m *mocks.MockEventReader) {},
			mockPhotosFn:  func(m *mocks.MockPhotoStore) {},
			mockPresignFn: func(m *mocks.MockS3Presigner) {},
			wantCode:      401,
		},
		{
			name:          "invalid JSON body — returns 400",
			sub:           "user-1",
			eventID:       testEventID,
			body:          `not-json`,
			mockEventsFn:  func(m *mocks.MockEventReader) {},
			mockPhotosFn:  func(m *mocks.MockPhotoStore) {},
			mockPresignFn: func(m *mocks.MockS3Presigner) {},
			wantCode:      400,
		},
		{
			name:    "GetEvent store error — returns 500",
			sub:     "user-1",
			eventID: testEventID,
			body:    `{"photos":[{"filename":"a.jpg","contentType":"image/jpeg","size":100}]}`,
			mockEventsFn: func(m *mocks.MockEventReader) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(nil, errors.New("ddb timeout"))
			},
			mockPhotosFn:  func(m *mocks.MockPhotoStore) {},
			mockPresignFn: func(m *mocks.MockS3Presigner) {},
			wantCode:      500,
		},
		{
			// With presign-before-DDB order: PresignPutObject runs before BatchCreatePhotos.
			name:    "BatchCreatePhotos error — returns 500",
			sub:     "user-1",
			eventID: testEventID,
			body:    `{"photos":[{"filename":"a.jpg","contentType":"image/jpeg","size":100}]}`,
			mockEventsFn: func(m *mocks.MockEventReader) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(ownerEvent(), nil)
			},
			mockPresignFn: func(m *mocks.MockS3Presigner) {
				m.EXPECT().PresignPutObject(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return("https://s3.example.com/a", nil)
			},
			mockPhotosFn: func(m *mocks.MockPhotoStore) {
				m.EXPECT().BatchCreatePhotos(gomock.Any(), gomock.Any()).Return(errors.New("ddb error"))
			},
			wantCode: 500,
		},
		{
			// PresignPutObject fails before DynamoDB write — no ghost records.
			name:    "PresignPutObject error — returns 500, no DDB write",
			sub:     "user-1",
			eventID: testEventID,
			body:    `{"photos":[{"filename":"a.jpg","contentType":"image/jpeg","size":100}]}`,
			mockEventsFn: func(m *mocks.MockEventReader) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(ownerEvent(), nil)
			},
			mockPresignFn: func(m *mocks.MockS3Presigner) {
				m.EXPECT().PresignPutObject(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return("", errors.New("sign error"))
			},
			mockPhotosFn: func(m *mocks.MockPhotoStore) {
				// BatchCreatePhotos must NOT be called — no ghost records.
			},
			wantCode: 500,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockEvents := mocks.NewMockEventReader(ctrl)
			mockPhotos := mocks.NewMockPhotoStore(ctrl)
			mockPresigner := mocks.NewMockS3Presigner(ctrl)

			tt.mockEventsFn(mockEvents)
			tt.mockPhotosFn(mockPhotos)
			tt.mockPresignFn(mockPresigner)

			h := &handler.Handler{
				Events:    mockEvents,
				Photos:    mockPhotos,
				Presigner: mockPresigner,
				RawBucket: "raw-bucket",
				Env:       "local",
			}

			resp, err := h.Handle(context.Background(), makeReq(tt.sub, tt.eventID, tt.body))
			require.NoError(t, err)
			assert.Equal(t, tt.wantCode, resp.StatusCode)
			assert.Equal(t, "application/json", resp.Headers["Content-Type"])

			if tt.wantPhotoCount > 0 {
				var body struct {
					Photos []struct {
						PhotoID      string `json:"photoId"`
						PresignedURL string `json:"presignedUrl"`
					} `json:"photos"`
				}
				require.NoError(t, json.Unmarshal([]byte(resp.Body), &body))
				assert.Len(t, body.Photos, tt.wantPhotoCount)
				for _, p := range body.Photos {
					assert.NotEmpty(t, p.PhotoID)
					assert.NotEmpty(t, p.PresignedURL)
				}
			}
		})
	}
}

// buildBatchBody builds a presign request body with n JPEG items.
func buildBatchBody(n int) string {
	type item struct {
		Filename    string `json:"filename"`
		ContentType string `json:"contentType"`
		Size        int    `json:"size"`
	}
	items := make([]item, n)
	for i := range items {
		items[i] = item{Filename: "photo.jpg", ContentType: "image/jpeg", Size: 1024}
	}
	b, _ := json.Marshal(map[string]any{"photos": items})
	return string(b)
}
