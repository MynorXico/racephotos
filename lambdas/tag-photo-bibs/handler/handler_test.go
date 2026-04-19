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

	"github.com/racephotos/tag-photo-bibs/handler"
	"github.com/racephotos/tag-photo-bibs/handler/mocks"
	"github.com/racephotos/shared/models"
)

const (
	testPhotoID  = "550e8400-e29b-41d4-a716-446655440001"
	testEventID  = "550e8400-e29b-41d4-a716-446655440002"
	testOwnerSub = "photographer-sub-abc"
	testOtherSub = "photographer-sub-xyz"
)

func makeReq(sub, photoID, body string) events.APIGatewayV2HTTPRequest {
	req := events.APIGatewayV2HTTPRequest{
		PathParameters: map[string]string{"id": photoID},
		Body:           body,
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

func reviewPhoto(bibNumbers []string) *models.Photo {
	return &models.Photo{
		ID:      testPhotoID,
		EventID: testEventID,
		Status:  models.PhotoStatusReviewRequired,
		BibNumbers: bibNumbers,
	}
}

func TestHandler_Handle(t *testing.T) {
	tests := []struct {
		name       string
		sub        string
		photoID    string
		body       string
		mockPhotos func(*mocks.MockPhotoStore)
		mockBibs   func(*mocks.MockBibIndexStore)
		mockEvents func(*mocks.MockEventStore)
		wantCode   int
		assertBody func(t *testing.T, body string)
	}{
		{
			name:    "happy path — tags two bibs, sets status indexed",
			sub:     testOwnerSub,
			photoID: testPhotoID,
			body:    `{"bibNumbers":["101","102"]}`,
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(reviewPhoto(nil), nil)
				m.EXPECT().UpdatePhotoBibs(gomock.Any(), testPhotoID, []string{"101", "102"}, models.PhotoStatusIndexed).Return(nil)
			},
			mockBibs: func(m *mocks.MockBibIndexStore) {
				m.EXPECT().DeleteBibEntriesByPhoto(gomock.Any(), testPhotoID).Return(nil)
				m.EXPECT().WriteBibEntries(gomock.Any(), gomock.InAnyOrder([]models.BibEntry{
					{BibKey: testEventID + "#101", PhotoID: testPhotoID},
					{BibKey: testEventID + "#102", PhotoID: testPhotoID},
				})).Return(nil)
			},
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(&models.Event{
					ID:             testEventID,
					PhotographerID: testOwnerSub,
				}, nil)
			},
			wantCode: 200,
			assertBody: func(t *testing.T, body string) {
				var resp struct {
					ID         string   `json:"id"`
					BibNumbers []string `json:"bibNumbers"`
					Status     string   `json:"status"`
				}
				require.NoError(t, json.Unmarshal([]byte(body), &resp))
				assert.Equal(t, testPhotoID, resp.ID)
				assert.Equal(t, []string{"101", "102"}, resp.BibNumbers)
				assert.Equal(t, models.PhotoStatusIndexed, resp.Status)
			},
		},
		{
			name:    "empty bibNumbers — keeps status review_required",
			sub:     testOwnerSub,
			photoID: testPhotoID,
			body:    `{"bibNumbers":[]}`,
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(reviewPhoto(nil), nil)
				m.EXPECT().UpdatePhotoBibs(gomock.Any(), testPhotoID, []string{}, models.PhotoStatusReviewRequired).Return(nil)
			},
			mockBibs: func(m *mocks.MockBibIndexStore) {
				m.EXPECT().DeleteBibEntriesByPhoto(gomock.Any(), testPhotoID).Return(nil)
				m.EXPECT().WriteBibEntries(gomock.Any(), []models.BibEntry{}).Return(nil)
			},
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(&models.Event{
					ID:             testEventID,
					PhotographerID: testOwnerSub,
				}, nil)
			},
			wantCode: 200,
		},
		{
			name:    "missing JWT — returns 401",
			sub:     "",
			photoID: testPhotoID,
			body:    `{"bibNumbers":["101"]}`,
			mockPhotos: func(m *mocks.MockPhotoStore) {},
			mockBibs:   func(m *mocks.MockBibIndexStore) {},
			mockEvents: func(m *mocks.MockEventStore) {},
			wantCode:   401,
		},
		{
			name:    "missing photo ID — returns 400",
			sub:     testOwnerSub,
			photoID: "",
			body:    `{"bibNumbers":["101"]}`,
			mockPhotos: func(m *mocks.MockPhotoStore) {},
			mockBibs:   func(m *mocks.MockBibIndexStore) {},
			mockEvents: func(m *mocks.MockEventStore) {},
			wantCode:   400,
		},
		{
			name:    "invalid UUID — returns 400",
			sub:     testOwnerSub,
			photoID: "not-a-uuid",
			body:    `{"bibNumbers":["101"]}`,
			mockPhotos: func(m *mocks.MockPhotoStore) {},
			mockBibs:   func(m *mocks.MockBibIndexStore) {},
			mockEvents: func(m *mocks.MockEventStore) {},
			wantCode:   400,
		},
		{
			name:    "whitespace-only bib — returns 400",
			sub:     testOwnerSub,
			photoID: testPhotoID,
			body:    `{"bibNumbers":["  "]}`,
			mockPhotos: func(m *mocks.MockPhotoStore) {},
			mockBibs:   func(m *mocks.MockBibIndexStore) {},
			mockEvents: func(m *mocks.MockEventStore) {},
			wantCode:   400,
		},
		{
			name:    "empty string bib — returns 400",
			sub:     testOwnerSub,
			photoID: testPhotoID,
			body:    `{"bibNumbers":[""]}`,
			mockPhotos: func(m *mocks.MockPhotoStore) {},
			mockBibs:   func(m *mocks.MockBibIndexStore) {},
			mockEvents: func(m *mocks.MockEventStore) {},
			wantCode:   400,
		},
		{
			name:    "malformed JSON — returns 400",
			sub:     testOwnerSub,
			photoID: testPhotoID,
			body:    `not json`,
			mockPhotos: func(m *mocks.MockPhotoStore) {},
			mockBibs:   func(m *mocks.MockBibIndexStore) {},
			mockEvents: func(m *mocks.MockEventStore) {},
			wantCode:   400,
		},
		{
			name:    "photo not found — returns 404",
			sub:     testOwnerSub,
			photoID: testPhotoID,
			body:    `{"bibNumbers":["101"]}`,
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(nil, handler.ErrPhotoNotFound)
			},
			mockBibs:   func(m *mocks.MockBibIndexStore) {},
			mockEvents: func(m *mocks.MockEventStore) {},
			wantCode:   404,
		},
		{
			name:    "caller does not own event — returns 403",
			sub:     testOtherSub,
			photoID: testPhotoID,
			body:    `{"bibNumbers":["101"]}`,
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(reviewPhoto(nil), nil)
			},
			mockBibs: func(m *mocks.MockBibIndexStore) {},
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(&models.Event{
					ID:             testEventID,
					PhotographerID: testOwnerSub,
				}, nil)
			},
			wantCode: 403,
		},
		{
			name:    "photo store error on get — returns 500",
			sub:     testOwnerSub,
			photoID: testPhotoID,
			body:    `{"bibNumbers":["101"]}`,
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(nil, errors.New("ddb failure"))
			},
			mockBibs:   func(m *mocks.MockBibIndexStore) {},
			mockEvents: func(m *mocks.MockEventStore) {},
			wantCode:   500,
		},
		{
			name:    "event store error — returns 500",
			sub:     testOwnerSub,
			photoID: testPhotoID,
			body:    `{"bibNumbers":["101"]}`,
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(reviewPhoto(nil), nil)
			},
			mockBibs: func(m *mocks.MockBibIndexStore) {},
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(nil, errors.New("ddb failure"))
			},
			wantCode: 500,
		},
		{
			name:    "bib delete error — returns 500",
			sub:     testOwnerSub,
			photoID: testPhotoID,
			body:    `{"bibNumbers":["101"]}`,
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(reviewPhoto(nil), nil)
			},
			mockBibs: func(m *mocks.MockBibIndexStore) {
				m.EXPECT().DeleteBibEntriesByPhoto(gomock.Any(), testPhotoID).Return(errors.New("ddb failure"))
			},
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(&models.Event{
					ID:             testEventID,
					PhotographerID: testOwnerSub,
				}, nil)
			},
			wantCode: 500,
		},
		{
			name:    "bib write error — returns 500",
			sub:     testOwnerSub,
			photoID: testPhotoID,
			body:    `{"bibNumbers":["101"]}`,
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(reviewPhoto(nil), nil)
			},
			mockBibs: func(m *mocks.MockBibIndexStore) {
				m.EXPECT().DeleteBibEntriesByPhoto(gomock.Any(), testPhotoID).Return(nil)
				m.EXPECT().WriteBibEntries(gomock.Any(), gomock.Any()).Return(errors.New("ddb failure"))
			},
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(&models.Event{
					ID:             testEventID,
					PhotographerID: testOwnerSub,
				}, nil)
			},
			wantCode: 500,
		},
		{
			name:    "photo update error — returns 500",
			sub:     testOwnerSub,
			photoID: testPhotoID,
			body:    `{"bibNumbers":["101"]}`,
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(reviewPhoto(nil), nil)
				m.EXPECT().UpdatePhotoBibs(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(errors.New("ddb failure"))
			},
			mockBibs: func(m *mocks.MockBibIndexStore) {
				m.EXPECT().DeleteBibEntriesByPhoto(gomock.Any(), testPhotoID).Return(nil)
				m.EXPECT().WriteBibEntries(gomock.Any(), gomock.Any()).Return(nil)
			},
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(&models.Event{
					ID:             testEventID,
					PhotographerID: testOwnerSub,
				}, nil)
			},
			wantCode: 500,
		},
		{
			name:    "concurrent retag (photo no longer taggable) — returns 409",
			sub:     testOwnerSub,
			photoID: testPhotoID,
			body:    `{"bibNumbers":["101"]}`,
			mockPhotos: func(m *mocks.MockPhotoStore) {
				m.EXPECT().GetPhoto(gomock.Any(), testPhotoID).Return(reviewPhoto(nil), nil)
				m.EXPECT().UpdatePhotoBibs(gomock.Any(), testPhotoID, []string{"101"}, models.PhotoStatusIndexed).Return(handler.ErrPhotoNotTaggable)
			},
			mockBibs: func(m *mocks.MockBibIndexStore) {
				m.EXPECT().DeleteBibEntriesByPhoto(gomock.Any(), testPhotoID).Return(nil)
				m.EXPECT().WriteBibEntries(gomock.Any(), gomock.Any()).Return(nil)
			},
			mockEvents: func(m *mocks.MockEventStore) {
				m.EXPECT().GetEvent(gomock.Any(), testEventID).Return(&models.Event{
					ID:             testEventID,
					PhotographerID: testOwnerSub,
				}, nil)
			},
			wantCode: 409,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockPhotos := mocks.NewMockPhotoStore(ctrl)
			mockBibs := mocks.NewMockBibIndexStore(ctrl)
			mockEvents := mocks.NewMockEventStore(ctrl)

			tt.mockPhotos(mockPhotos)
			tt.mockBibs(mockBibs)
			tt.mockEvents(mockEvents)

			h := &handler.Handler{
				Photos:   mockPhotos,
				BibIndex: mockBibs,
				Events:   mockEvents,
			}

			resp, err := h.Handle(context.Background(), makeReq(tt.sub, tt.photoID, tt.body))
			require.NoError(t, err)
			assert.Equal(t, tt.wantCode, resp.StatusCode)
			assert.Equal(t, "application/json", resp.Headers["Content-Type"])

			if tt.assertBody != nil {
				tt.assertBody(t, resp.Body)
			}
		})
	}
}
