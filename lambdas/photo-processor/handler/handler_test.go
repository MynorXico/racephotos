package handler_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/rekognition"
	"github.com/aws/aws-sdk-go-v2/service/rekognition/types"
	"github.com/golang/mock/gomock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/racephotos/photo-processor/handler"
	"github.com/racephotos/photo-processor/handler/mocks"
	"github.com/racephotos/shared/models"
)

const (
	testEventID  = "evt-aaa"
	testPhotoID  = "photo-bbb"
	testRawS3Key = "local/evt-aaa/photo-bbb/race.jpg"
)

func testPhoto() *models.Photo {
	return &models.Photo{
		ID:       testPhotoID,
		EventID:  testEventID,
		Status:   "processing",
		RawS3Key: testRawS3Key,
	}
}

func sqsEvent(body string) events.SQSEvent {
	return events.SQSEvent{
		Records: []events.SQSMessage{
			{MessageId: "msg-1", Body: body},
		},
	}
}

func s3NotifBody(bucket, key string) string {
	return fmt.Sprintf(`{"Records":[{"s3":{"bucket":{"name":%q},"object":{"key":%q}}}]}`, bucket, key)
}

func bibDetection(text string, confidence float32, detType types.TextTypes) types.TextDetection {
	return types.TextDetection{
		DetectedText: aws.String(text),
		Confidence:   aws.Float32(confidence),
		Type:         detType,
	}
}

func TestHandler_ProcessBatch(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name            string
		sqsBody         string
		setupDetector   func(*mocks.MockTextDetector)
		setupPhotoStore func(*mocks.MockPhotoStore)
		setupBibIndex   func(*mocks.MockBibIndexStore)
		setupWmQueue    func(*mocks.MockWatermarkQueue)
		wantFailures    int
	}{
		{
			// RS-017: photo-processor now writes "watermarking" (not "indexed") so that
			// "indexed" always means the watermarked copy is ready. FinalStatus="indexed"
			// is carried in the WatermarkMessage so the watermark Lambda can write the
			// terminal status atomically with watermarkedS3Key.
			name:    "AC2: bibs detected — watermarking status written, watermark queued with finalStatus=indexed",
			sqsBody: s3NotifBody("racephotos-raw-local", testRawS3Key),
			setupDetector: func(m *mocks.MockTextDetector) {
				m.EXPECT().DetectText(gomock.Any(), gomock.Any()).Return(&rekognition.DetectTextOutput{
					TextDetections: []types.TextDetection{
						bibDetection("101", 95.0, types.TextTypesLine),
						bibDetection("101", 95.0, types.TextTypesWord),
					},
				}, nil)
			},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {
				m.EXPECT().GetPhotoById(gomock.Any(), testPhotoID).Return(testPhoto(), nil)
				m.EXPECT().UpdatePhotoStatus(gomock.Any(), testPhotoID, models.PhotoStatusUpdate{
					Status:                "watermarking",
					BibNumbers:            []string{"101"},
					RekognitionConfidence: 95.0,
				}).Return(nil)
			},
			setupBibIndex: func(m *mocks.MockBibIndexStore) {
				m.EXPECT().WriteBibEntries(gomock.Any(), []models.BibEntry{
					{BibKey: "evt-aaa#101", PhotoID: testPhotoID},
				}).Return(nil)
			},
			setupWmQueue: func(m *mocks.MockWatermarkQueue) {
				m.EXPECT().SendWatermarkMessage(gomock.Any(), models.WatermarkMessage{
					PhotoID:     testPhotoID,
					EventID:     testEventID,
					RawS3Key:    testRawS3Key,
					FinalStatus: "indexed",
				}).Return(nil)
			},
			wantFailures: 0,
		},
		{
			// RS-017: no-bib path also writes "watermarking" first; finalStatus="review_required"
			// is carried in the WatermarkMessage.
			name:    "AC2: no bibs above threshold — watermarking status, finalStatus=review_required",
			sqsBody: s3NotifBody("racephotos-raw-local", testRawS3Key),
			setupDetector: func(m *mocks.MockTextDetector) {
				m.EXPECT().DetectText(gomock.Any(), gomock.Any()).Return(&rekognition.DetectTextOutput{
					TextDetections: []types.TextDetection{
						bibDetection("HELLO", 40.0, types.TextTypesLine),
					},
				}, nil)
			},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {
				m.EXPECT().GetPhotoById(gomock.Any(), testPhotoID).Return(testPhoto(), nil)
				m.EXPECT().UpdatePhotoStatus(gomock.Any(), testPhotoID, models.PhotoStatusUpdate{
					Status:     "watermarking",
					BibNumbers: []string{},
				}).Return(nil)
			},
			setupBibIndex: func(m *mocks.MockBibIndexStore) {
				// no entries written — no bibs above threshold
			},
			setupWmQueue: func(m *mocks.MockWatermarkQueue) {
				m.EXPECT().SendWatermarkMessage(gomock.Any(), models.WatermarkMessage{
					PhotoID:     testPhotoID,
					EventID:     testEventID,
					RawS3Key:    testRawS3Key,
					FinalStatus: "review_required",
				}).Return(nil)
			},
			wantFailures: 0,
		},
		{
			name:    "AC3: Rekognition error — status=error, message acked (not retried)",
			sqsBody: s3NotifBody("racephotos-raw-local", testRawS3Key),
			setupDetector: func(m *mocks.MockTextDetector) {
				m.EXPECT().DetectText(gomock.Any(), gomock.Any()).Return(nil, errors.New("rekognition: throttled"))
			},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {
				m.EXPECT().GetPhotoById(gomock.Any(), testPhotoID).Return(testPhoto(), nil)
				m.EXPECT().UpdatePhotoStatus(gomock.Any(), testPhotoID, models.PhotoStatusUpdate{
					Status: "error",
				}).Return(nil)
			},
			setupBibIndex: func(m *mocks.MockBibIndexStore) {},
			setupWmQueue:  func(m *mocks.MockWatermarkQueue) {},
			wantFailures:  0, // message acked — not added to batchItemFailures
		},
		{
			// GetPhotoById is called before DetectText; a failure there is an
			// infrastructure error that goes to batchItemFailures (retried by SQS).
			name:    "AC4: DynamoDB failure on GetPhotoById — that message in batchItemFailures",
			sqsBody: s3NotifBody("racephotos-raw-local", testRawS3Key),
			setupDetector: func(m *mocks.MockTextDetector) {
				// DetectText is never reached when GetPhotoById fails.
			},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {
				m.EXPECT().GetPhotoById(gomock.Any(), testPhotoID).Return(nil, errors.New("dynamodb: connection refused"))
			},
			setupBibIndex: func(m *mocks.MockBibIndexStore) {},
			setupWmQueue:  func(m *mocks.MockWatermarkQueue) {},
			wantFailures:  1,
		},
		{
			name:            "invalid S3 key format — message failed",
			sqsBody:         s3NotifBody("racephotos-raw-local", "bad-key"),
			setupDetector:   func(m *mocks.MockTextDetector) {},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {},
			setupBibIndex:   func(m *mocks.MockBibIndexStore) {},
			setupWmQueue:    func(m *mocks.MockWatermarkQueue) {},
			wantFailures:    1,
		},
		{
			// S3 event notifications URL-encode the object key; spaces become "+"
			// and special chars become "%XX". The handler must decode the key before
			// passing it to Rekognition/S3, otherwise filenames with spaces (e.g.
			// "photo (copy).jpg") cause InvalidS3ObjectException.
			name: "URL-encoded S3 key with spaces — key decoded before use",
			// "local/evt-aaa/photo-bbb/race photo.jpg" encoded as S3 sends it
			sqsBody: s3NotifBody("racephotos-raw-local", "local/evt-aaa/photo-bbb/race+photo.jpg"),
			setupDetector: func(m *mocks.MockTextDetector) {
				m.EXPECT().DetectText(gomock.Any(), &rekognition.DetectTextInput{
					Image: &types.Image{S3Object: &types.S3Object{
						Bucket: aws.String("racephotos-raw-local"),
						// Rekognition must receive the decoded key (space, not "+").
						Name: aws.String("local/evt-aaa/photo-bbb/race photo.jpg"),
					}},
				}).Return(&rekognition.DetectTextOutput{}, nil)
			},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {
				m.EXPECT().GetPhotoById(gomock.Any(), testPhotoID).Return(testPhoto(), nil)
				m.EXPECT().UpdatePhotoStatus(gomock.Any(), testPhotoID, gomock.Any()).Return(nil)
			},
			setupBibIndex: func(m *mocks.MockBibIndexStore) {},
			setupWmQueue: func(m *mocks.MockWatermarkQueue) {
				m.EXPECT().SendWatermarkMessage(gomock.Any(), models.WatermarkMessage{
					PhotoID:     testPhotoID,
					EventID:     testEventID,
					RawS3Key:    "local/evt-aaa/photo-bbb/race photo.jpg",
					FinalStatus: "review_required", // no bib detections returned
				}).Return(nil)
			},
			wantFailures: 0,
		},
		{
			name:            "malformed SQS body — message failed",
			sqsBody:         "not-json",
			setupDetector:   func(m *mocks.MockTextDetector) {},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {},
			setupBibIndex:   func(m *mocks.MockBibIndexStore) {},
			setupWmQueue:    func(m *mocks.MockWatermarkQueue) {},
			wantFailures:    1,
		},
		{
			// TC-027 / domain rule 10: photo already in terminal "indexed" state means
			// CompleteWatermark already ran — bib entries and watermark are both done.
			// Rekognition must NOT be called and downstream must NOT be re-driven.
			name:    "domain rule 10: already-indexed photo — Rekognition and downstream skipped, acked",
			sqsBody: s3NotifBody("racephotos-raw-local", testRawS3Key),
			setupDetector: func(m *mocks.MockTextDetector) {
				// DetectText must NOT be called
			},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {
				already := testPhoto()
				already.Status = "indexed"
				already.BibNumbers = []string{"101"}
				m.EXPECT().GetPhotoById(gomock.Any(), testPhotoID).Return(already, nil)
			},
			setupBibIndex: func(m *mocks.MockBibIndexStore) {
				// WriteBibEntries must NOT be called — pipeline already complete
			},
			setupWmQueue: func(m *mocks.MockWatermarkQueue) {
				// SendWatermarkMessage must NOT be called — pipeline already complete
			},
			wantFailures: 0,
		},
		{
			// domain rule 10: photo already in terminal "review_required" state —
			// same as indexed: pipeline complete, ack without re-driving.
			name:          "domain rule 10: review_required photo — Rekognition and downstream skipped, acked",
			sqsBody:       s3NotifBody("racephotos-raw-local", testRawS3Key),
			setupDetector: func(m *mocks.MockTextDetector) {},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {
				already := testPhoto()
				already.Status = "review_required"
				already.BibNumbers = []string{}
				m.EXPECT().GetPhotoById(gomock.Any(), testPhotoID).Return(already, nil)
			},
			setupBibIndex: func(m *mocks.MockBibIndexStore) {},
			setupWmQueue:  func(m *mocks.MockWatermarkQueue) {},
			wantFailures:  0,
		},
		{
			// RS-017: SQS redelivery when status is already "watermarking" (photo-processor
			// wrote the status but crashed before sending the watermark queue message).
			// Rekognition must NOT be called again (domain rule 10). FinalStatus is derived
			// from stored BibNumbers: no bibs → "review_required".
			name:    "domain rule 10: watermarking-status photo on redelivery — Rekognition skipped, finalStatus=review_required",
			sqsBody: s3NotifBody("racephotos-raw-local", testRawS3Key),
			setupDetector: func(m *mocks.MockTextDetector) {
				// DetectText must NOT be called
			},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {
				already := testPhoto()
				already.Status = "watermarking"
				already.BibNumbers = []string{} // no bibs detected
				m.EXPECT().GetPhotoById(gomock.Any(), testPhotoID).Return(already, nil)
				// UpdatePhotoStatus must NOT be called
			},
			setupBibIndex: func(m *mocks.MockBibIndexStore) {
				// no bibs to re-write
			},
			setupWmQueue: func(m *mocks.MockWatermarkQueue) {
				m.EXPECT().SendWatermarkMessage(gomock.Any(), models.WatermarkMessage{
					PhotoID:     testPhotoID,
					EventID:     testEventID,
					RawS3Key:    testRawS3Key,
					FinalStatus: "review_required",
				}).Return(nil)
			},
			wantFailures: 0,
		},
		{
			// TC-027b: status=error on redelivery — ack, do not reprocess.
			name:          "domain rule 10: error-status photo — acked without reprocessing",
			sqsBody:       s3NotifBody("racephotos-raw-local", testRawS3Key),
			setupDetector: func(m *mocks.MockTextDetector) {},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {
				already := testPhoto()
				already.Status = "error"
				m.EXPECT().GetPhotoById(gomock.Any(), testPhotoID).Return(already, nil)
			},
			setupBibIndex: func(m *mocks.MockBibIndexStore) {},
			setupWmQueue:  func(m *mocks.MockWatermarkQueue) {},
			wantFailures:  0,
		},
		{
			// TC-003 / domain rule 9: S3 event envelope with two records — both must be
			// processed; neither is silently dropped.
			name: "domain rule 9: two S3 records in one SQS message — both processed",
			sqsBody: func() string {
				key2 := "local/evt-aaa/photo-ccc/race.jpg"
				return fmt.Sprintf(`{"Records":[`+
					`{"s3":{"bucket":{"name":"racephotos-raw-local"},"object":{"key":%q}}},`+
					`{"s3":{"bucket":{"name":"racephotos-raw-local"},"object":{"key":%q}}}`+
					`]}`, testRawS3Key, key2)
			}(),
			setupDetector: func(m *mocks.MockTextDetector) {
				m.EXPECT().DetectText(gomock.Any(), gomock.Any()).Return(&rekognition.DetectTextOutput{}, nil).Times(2)
			},
			setupPhotoStore: func(m *mocks.MockPhotoStore) {
				m.EXPECT().GetPhotoById(gomock.Any(), testPhotoID).Return(testPhoto(), nil)
				m.EXPECT().GetPhotoById(gomock.Any(), "photo-ccc").Return(&models.Photo{
					ID: "photo-ccc", EventID: testEventID, Status: "processing", RawS3Key: "local/evt-aaa/photo-ccc/race.jpg",
				}, nil)
				m.EXPECT().UpdatePhotoStatus(gomock.Any(), testPhotoID, gomock.Any()).Return(nil)
				m.EXPECT().UpdatePhotoStatus(gomock.Any(), "photo-ccc", gomock.Any()).Return(nil)
			},
			setupBibIndex: func(m *mocks.MockBibIndexStore) {},
			setupWmQueue: func(m *mocks.MockWatermarkQueue) {
				m.EXPECT().SendWatermarkMessage(gomock.Any(), gomock.Any()).Return(nil).Times(2)
			},
			wantFailures: 0,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			det := mocks.NewMockTextDetector(ctrl)
			ps := mocks.NewMockPhotoStore(ctrl)
			bi := mocks.NewMockBibIndexStore(ctrl)
			wq := mocks.NewMockWatermarkQueue(ctrl)

			tc.setupDetector(det)
			tc.setupPhotoStore(ps)
			tc.setupBibIndex(bi)
			tc.setupWmQueue(wq)

			h := &handler.Handler{
				Detector:      det,
				Photos:        ps,
				BibIndex:      bi,
				WatermarkQ:    wq,
				ConfidenceMin: 0.80,
			}

			resp, err := h.ProcessBatch(ctx, sqsEvent(tc.sqsBody))
			require.NoError(t, err)
			assert.Len(t, resp.BatchItemFailures, tc.wantFailures)
		})
	}
}

func TestHandler_MultipleMessages_PartialFailure(t *testing.T) {
	ctx := context.Background()
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Two messages: first succeeds (bibs found), second has a DynamoDB error
	goodKey := "local/evt-aaa/photo-good/race.jpg"
	badKey := "local/evt-aaa/photo-bad/race.jpg"

	goodBody := s3NotifBody("racephotos-raw-local", goodKey)
	badBody := s3NotifBody("racephotos-raw-local", badKey)

	sqsEvt := events.SQSEvent{
		Records: []events.SQSMessage{
			{MessageId: "msg-good", Body: goodBody},
			{MessageId: "msg-bad", Body: badBody},
		},
	}

	det := mocks.NewMockTextDetector(ctrl)
	ps := mocks.NewMockPhotoStore(ctrl)
	bi := mocks.NewMockBibIndexStore(ctrl)
	wq := mocks.NewMockWatermarkQueue(ctrl)

	goodPhoto := &models.Photo{ID: "photo-good", EventID: testEventID, Status: "processing", RawS3Key: goodKey}

	det.EXPECT().DetectText(gomock.Any(), gomock.Any()).Return(&rekognition.DetectTextOutput{
		TextDetections: []types.TextDetection{
			bibDetection("202", 91.0, types.TextTypesLine),
			bibDetection("202", 91.0, types.TextTypesWord),
		},
	}, nil)

	ps.EXPECT().GetPhotoById(gomock.Any(), "photo-good").Return(goodPhoto, nil)
	ps.EXPECT().UpdatePhotoStatus(gomock.Any(), "photo-good", gomock.Any()).Return(nil)
	ps.EXPECT().GetPhotoById(gomock.Any(), "photo-bad").Return(nil, errors.New("dynamodb: timeout"))

	bi.EXPECT().WriteBibEntries(gomock.Any(), gomock.Any()).Return(nil)
	wq.EXPECT().SendWatermarkMessage(gomock.Any(), gomock.Any()).Return(nil)

	h := &handler.Handler{
		Detector:      det,
		Photos:        ps,
		BibIndex:      bi,
		WatermarkQ:    wq,
		ConfidenceMin: 0.80,
	}

	resp, err := h.ProcessBatch(ctx, sqsEvt)
	require.NoError(t, err)
	require.Len(t, resp.BatchItemFailures, 1)
	assert.Equal(t, "msg-bad", resp.BatchItemFailures[0].ItemIdentifier)
}
