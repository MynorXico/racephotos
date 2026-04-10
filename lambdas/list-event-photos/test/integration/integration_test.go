//go:build integration

package integration_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/racephotos/list-event-photos/handler"
	"github.com/racephotos/shared/models"
)

func newDynamoClient(t *testing.T) *dynamodb.Client {
	t.Helper()
	endpoint := os.Getenv("AWS_ENDPOINT_URL")
	if endpoint == "" {
		t.Skip("AWS_ENDPOINT_URL not set — skipping integration test")
	}
	cfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithEndpointResolverWithOptions(aws.EndpointResolverWithOptionsFunc(
			func(service, region string, options ...interface{}) (aws.Endpoint, error) {
				return aws.Endpoint{URL: endpoint, HostnameImmutable: true}, nil
			},
		)),
	)
	require.NoError(t, err)
	return dynamodb.NewFromConfig(cfg)
}

func TestIntegration_ListPhotosByEvent(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)

	photosTableName := "racephotos-photos"
	eventID := "integ-event-" + time.Now().Format("20060102150405")

	photos := []models.Photo{
		{
			ID:               "integ-photo-1-" + eventID,
			EventID:          eventID,
			Status:           "indexed",
			RawS3Key:         "raw/" + eventID + "/1.jpg",
			WatermarkedS3Key: "processed/" + eventID + "/1.jpg",
			BibNumbers:       []string{"101"},
			UploadedAt:       time.Now().UTC().Add(-3 * time.Second).Format(time.RFC3339),
		},
		{
			ID:          "integ-photo-2-" + eventID,
			EventID:     eventID,
			Status:      "error",
			RawS3Key:    "raw/" + eventID + "/2.jpg",
			BibNumbers:  nil,
			UploadedAt:  time.Now().UTC().Add(-2 * time.Second).Format(time.RFC3339),
			ErrorReason: "Rekognition timeout",
		},
		{
			ID:         "integ-photo-3-" + eventID,
			EventID:    eventID,
			Status:     "review_required",
			RawS3Key:   "raw/" + eventID + "/3.jpg",
			BibNumbers: []string{},
			UploadedAt: time.Now().UTC().Add(-1 * time.Second).Format(time.RFC3339),
		},
		{
			ID:         "integ-photo-4-" + eventID,
			EventID:    eventID,
			Status:     "processing",
			RawS3Key:   "raw/" + eventID + "/4.jpg",
			BibNumbers: nil,
			UploadedAt: time.Now().UTC().Format(time.RFC3339),
		},
		{
			ID:         "integ-photo-5-" + eventID,
			EventID:    eventID,
			Status:     "watermarking",
			RawS3Key:   "raw/" + eventID + "/5.jpg",
			BibNumbers: nil,
			UploadedAt: time.Now().UTC().Add(1 * time.Second).Format(time.RFC3339),
		},
	}

	// Seed photos.
	for _, p := range photos {
		item, err := attributevalue.MarshalMap(p)
		require.NoError(t, err)
		_, err = client.PutItem(ctx, &dynamodb.PutItemInput{
			TableName: aws.String(photosTableName),
			Item:      item,
		})
		require.NoError(t, err)
	}

	t.Cleanup(func() {
		for _, p := range photos {
			key := map[string]types.AttributeValue{
				"id": &types.AttributeValueMemberS{Value: p.ID},
			}
			_, _ = client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
				TableName: aws.String(photosTableName),
				Key:       key,
			})
		}
	})

	store := &handler.DynamoPhotoLister{Client: client, TableName: photosTableName}

	// List all — should return 5 photos.
	result, nextCursor, err := store.ListPhotosByEvent(ctx, eventID, "", "", 50)
	require.NoError(t, err)
	assert.Len(t, result, 5)
	assert.Empty(t, nextCursor)

	// List with status filter — should return only error photos.
	filtered, _, err := store.ListPhotosByEvent(ctx, eventID, "error", "", 50)
	require.NoError(t, err)
	require.Len(t, filtered, 1)
	assert.Equal(t, "error", filtered[0].Status)
	assert.Equal(t, "Rekognition timeout", filtered[0].ErrorReason)

	// in_progress filter — should return both "processing" and "watermarking" photos.
	inProgress, _, err := store.ListPhotosByEvent(ctx, eventID, "in_progress", "", 50)
	require.NoError(t, err)
	require.Len(t, inProgress, 2)
	statuses := []string{inProgress[0].Status, inProgress[1].Status}
	assert.ElementsMatch(t, []string{"processing", "watermarking"}, statuses)

	// in_progress pagination — limit=1 should page through both in-flight photos
	// using the cursor re-anchoring path. This verifies that the cursor returned
	// after page 1 resumes from the last returned photo (not from DynamoDB's
	// LastEvaluatedKey, which may have advanced past non-matching items).
	ipPage1, ipCursor, err := store.ListPhotosByEvent(ctx, eventID, "in_progress", "", 1)
	require.NoError(t, err)
	require.Len(t, ipPage1, 1)
	assert.NotEmpty(t, ipCursor, "expected a cursor after first in_progress page")
	assert.Contains(t, []string{"processing", "watermarking"}, ipPage1[0].Status)

	ipPage2, ipCursor2, err := store.ListPhotosByEvent(ctx, eventID, "in_progress", ipCursor, 1)
	require.NoError(t, err)
	require.Len(t, ipPage2, 1)
	assert.Contains(t, []string{"processing", "watermarking"}, ipPage2[0].Status)
	assert.NotEqual(t, ipPage1[0].ID, ipPage2[0].ID, "page 2 must not repeat page 1 photo")

	// There are exactly 2 in_progress photos — page 3 must be empty with no cursor.
	ipPage3, ipCursor3, err := store.ListPhotosByEvent(ctx, eventID, "in_progress", ipCursor2, 1)
	require.NoError(t, err)
	assert.Empty(t, ipPage3)
	assert.Empty(t, ipCursor3)

	// Pagination — limit=2 should give cursor.
	page1, cursor, err := store.ListPhotosByEvent(ctx, eventID, "", "", 2)
	require.NoError(t, err)
	assert.Len(t, page1, 2)
	assert.NotEmpty(t, cursor)

	// Second page.
	page2, cursor2, err := store.ListPhotosByEvent(ctx, eventID, "", cursor, 2)
	require.NoError(t, err)
	assert.Len(t, page2, 2)
	assert.NotEmpty(t, cursor2)

	// Third page.
	page3, cursor3, err := store.ListPhotosByEvent(ctx, eventID, "", cursor2, 2)
	require.NoError(t, err)
	assert.Len(t, page3, 1)
	assert.Empty(t, cursor3)

	// Invalid cursor returns ErrInvalidCursor.
	_, _, err = store.ListPhotosByEvent(ctx, eventID, "", "not-valid-base64!!!", 50)
	assert.ErrorIs(t, err, handler.ErrInvalidCursor)
}
