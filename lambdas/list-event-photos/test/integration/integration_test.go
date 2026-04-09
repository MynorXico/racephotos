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
			UploadedAt:       time.Now().UTC().Add(-2 * time.Second).Format(time.RFC3339),
		},
		{
			ID:         "integ-photo-2-" + eventID,
			EventID:    eventID,
			Status:     "error",
			RawS3Key:   "raw/" + eventID + "/2.jpg",
			BibNumbers: nil,
			UploadedAt: time.Now().UTC().Add(-1 * time.Second).Format(time.RFC3339),
			ErrorReason: "Rekognition timeout",
		},
		{
			ID:         "integ-photo-3-" + eventID,
			EventID:    eventID,
			Status:     "review_required",
			RawS3Key:   "raw/" + eventID + "/3.jpg",
			BibNumbers: []string{},
			UploadedAt: time.Now().UTC().Format(time.RFC3339),
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

	// List all — should return 3 photos.
	result, nextCursor, err := store.ListPhotosByEvent(ctx, eventID, "", "", 50)
	require.NoError(t, err)
	assert.Len(t, result, 3)
	assert.Empty(t, nextCursor)

	// List with status filter — should return only error photos.
	filtered, _, err := store.ListPhotosByEvent(ctx, eventID, "error", "", 50)
	require.NoError(t, err)
	require.Len(t, filtered, 1)
	assert.Equal(t, "error", filtered[0].Status)
	assert.Equal(t, "Rekognition timeout", filtered[0].ErrorReason)

	// Pagination — limit=2 should give cursor.
	page1, cursor, err := store.ListPhotosByEvent(ctx, eventID, "", "", 2)
	require.NoError(t, err)
	assert.Len(t, page1, 2)
	assert.NotEmpty(t, cursor)

	// Second page.
	page2, cursor2, err := store.ListPhotosByEvent(ctx, eventID, "", cursor, 2)
	require.NoError(t, err)
	assert.Len(t, page2, 1)
	assert.Empty(t, cursor2)

	// Invalid cursor returns ErrInvalidCursor.
	_, _, err = store.ListPhotosByEvent(ctx, eventID, "", "not-valid-base64!!!", 50)
	assert.ErrorIs(t, err, handler.ErrInvalidCursor)
}
