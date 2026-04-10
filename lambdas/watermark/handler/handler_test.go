package handler_test

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"io"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/golang/mock/gomock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/racephotos/watermark/handler"
	"github.com/racephotos/watermark/handler/mocks"
)

const (
	testEventID  = "evt-ccc"
	testPhotoID  = "photo-ddd"
	testRawS3Key = "local/evt-ccc/photo-ddd/race.jpg"
)

// testImg returns a minimal 1×1 RGBA image for use as a stand-in.
func testImg() image.Image {
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.Set(0, 0, color.White)
	return img
}

// nopReader returns a non-nil ReadCloser wrapping an empty buffer.
func nopReader() io.ReadCloser {
	return io.NopCloser(&bytes.Buffer{})
}

func watermarkMsg(photoID, eventID, rawKey, finalStatus string) string {
	return `{"photoId":"` + photoID + `","eventId":"` + eventID + `","rawS3Key":"` + rawKey + `","finalStatus":"` + finalStatus + `"}`
}

func sqsEvent(body string) events.SQSEvent {
	return events.SQSEvent{
		Records: []events.SQSMessage{
			{MessageId: "msg-wm-1", Body: body},
		},
	}
}

func TestHandler_ProcessBatch(t *testing.T) {
	ctx := context.Background()

	expectedKey := "evt-ccc/photo-ddd/watermarked.jpg"

	tests := []struct {
		name            string
		sqsBody         string
		setupReader     func(*mocks.MockRawPhotoReader)
		setupWriter     func(*mocks.MockProcessedPhotoWriter)
		setupWatermark  func(*mocks.MockImageWatermarker)
		setupEventStore func(*mocks.MockEventStore)
		setupPhotoStore func(*mocks.MockPhotoStore)
		wantFailures    int
	}{
		{
			// Handler order: GetWatermarkText → GetObject → ApplyTextWatermark → PutObject → CompleteWatermark
			// RS-017: CompleteWatermark atomically sets watermarkedS3Key + finalStatus in one UpdateItem.
			name:    "AC5: happy path — watermark applied, photo completed with finalStatus=indexed",
			sqsBody: watermarkMsg(testPhotoID, testEventID, testRawS3Key, "indexed"),
			setupEventStore: func(m *mocks.MockEventStore) {
				m.EXPECT().GetWatermarkText(gomock.Any(), testEventID).Return("Marathon 2026 · racephotos.example.com", "Marathon 2026", nil)
			},
			setupReader: func(m *mocks.MockRawPhotoReader) {
				m.EXPECT().GetObject(gomock.Any(), gomock.Any(), testRawS3Key).
					Return(nopReader(), nil)
			},
			setupWatermark: func(m *mocks.MockImageWatermarker) {
				m.EXPECT().ApplyTextWatermark(gomock.Any(), "Marathon 2026 · racephotos.example.com").Return(testImg(), nil)
			},
			setupWriter: func(m *mocks.MockProcessedPhotoWriter) {
				m.EXPECT().PutObject(gomock.Any(), gomock.Any(), expectedKey, gomock.Any(), "image/jpeg").Return(nil)
			},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {
				m.EXPECT().CompleteWatermark(gomock.Any(), testPhotoID, expectedKey, "indexed").Return(nil)
			},
			wantFailures: 0,
		},
		{
			// TC-019: when watermarkText is empty, default to "{eventName} · racephotos.example.com".
			name:    "TC-019: empty watermarkText — default applied, finalStatus=review_required",
			sqsBody: watermarkMsg(testPhotoID, testEventID, testRawS3Key, "review_required"),
			setupEventStore: func(m *mocks.MockEventStore) {
				m.EXPECT().GetWatermarkText(gomock.Any(), testEventID).Return("", "City Marathon 2026", nil)
			},
			setupReader: func(m *mocks.MockRawPhotoReader) {
				m.EXPECT().GetObject(gomock.Any(), gomock.Any(), testRawS3Key).Return(nopReader(), nil)
			},
			setupWatermark: func(m *mocks.MockImageWatermarker) {
				m.EXPECT().ApplyTextWatermark(gomock.Any(), "City Marathon 2026 · racephotos.example.com").Return(testImg(), nil)
			},
			setupWriter: func(m *mocks.MockProcessedPhotoWriter) {
				m.EXPECT().PutObject(gomock.Any(), gomock.Any(), expectedKey, gomock.Any(), "image/jpeg").Return(nil)
			},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {
				m.EXPECT().CompleteWatermark(gomock.Any(), testPhotoID, expectedKey, "review_required").Return(nil)
			},
			wantFailures: 0,
		},
		{
			// EventStore is called first — a DynamoDB failure goes to batchItemFailures
			// before any S3 I/O is attempted.
			name:    "EventStore error — message in batchItemFailures",
			sqsBody: watermarkMsg(testPhotoID, testEventID, testRawS3Key, "indexed"),
			setupEventStore: func(m *mocks.MockEventStore) {
				m.EXPECT().GetWatermarkText(gomock.Any(), testEventID).
					Return("", "", errors.New("dynamodb: timeout"))
			},
			setupReader:     func(m *mocks.MockRawPhotoReader) {},
			setupWriter:     func(m *mocks.MockProcessedPhotoWriter) {},
			setupWatermark:  func(m *mocks.MockImageWatermarker) {},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {},
			wantFailures:    1,
		},
		{
			// S3 GetObject error goes to batchItemFailures.
			name:    "S3 GetObject error — message in batchItemFailures",
			sqsBody: watermarkMsg(testPhotoID, testEventID, testRawS3Key, "indexed"),
			setupEventStore: func(m *mocks.MockEventStore) {
				m.EXPECT().GetWatermarkText(gomock.Any(), testEventID).Return("text", "Event", nil)
			},
			setupReader: func(m *mocks.MockRawPhotoReader) {
				m.EXPECT().GetObject(gomock.Any(), gomock.Any(), testRawS3Key).
					Return(nil, errors.New("s3: access denied"))
			},
			setupWriter:     func(m *mocks.MockProcessedPhotoWriter) {},
			setupWatermark:  func(m *mocks.MockImageWatermarker) {},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {},
			wantFailures:    1,
		},
		{
			// RS-017: missing finalStatus in message is treated as malformed — message goes to batchItemFailures.
			name:    "missing finalStatus — message in batchItemFailures",
			sqsBody: `{"photoId":"` + testPhotoID + `","eventId":"` + testEventID + `","rawS3Key":"` + testRawS3Key + `"}`,
			setupReader:     func(m *mocks.MockRawPhotoReader) {},
			setupWriter:     func(m *mocks.MockProcessedPhotoWriter) {},
			setupWatermark:  func(m *mocks.MockImageWatermarker) {},
			setupEventStore: func(m *mocks.MockEventStore) {},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {},
			wantFailures:    1,
		},
		{
			name:    "malformed SQS body — message in batchItemFailures",
			sqsBody: "not-json",
			setupReader:     func(m *mocks.MockRawPhotoReader) {},
			setupWriter:     func(m *mocks.MockProcessedPhotoWriter) {},
			setupWatermark:  func(m *mocks.MockImageWatermarker) {},
			setupEventStore: func(m *mocks.MockEventStore) {},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {},
			wantFailures:    1,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			reader := mocks.NewMockRawPhotoReader(ctrl)
			writer := mocks.NewMockProcessedPhotoWriter(ctrl)
			wm := mocks.NewMockImageWatermarker(ctrl)
			es := mocks.NewMockEventStore(ctrl)
			ps := mocks.NewMockPhotoStore(ctrl)

			tc.setupReader(reader)
			tc.setupWriter(writer)
			tc.setupWatermark(wm)
			tc.setupEventStore(es)
			tc.setupPhotoStore(ps)

			h := &handler.Handler{
				RawReader:       reader,
				ProcessedWriter: writer,
				Watermarker:     wm,
				Events:          es,
				Photos:          ps,
				ProcessedBucket: "racephotos-processed-local",
			}

			resp, err := h.ProcessBatch(ctx, sqsEvent(tc.sqsBody))
			require.NoError(t, err)
			assert.Len(t, resp.BatchItemFailures, tc.wantFailures)
		})
	}
}

func TestHandler_WatermarkedS3Key(t *testing.T) {
	// Verify the S3 key format matches AC5: {eventId}/{photoId}/watermarked.jpg
	key := handler.WatermarkedS3Key("evt-abc", "photo-xyz")
	assert.Equal(t, "evt-abc/photo-xyz/watermarked.jpg", key)
}
