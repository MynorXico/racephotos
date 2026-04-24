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

	"github.com/racephotos/list-public-event-photos/handler"
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

func TestIntegration_ListEventPhotos(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)

	photosTable := "racephotos-photos"
	eventsTable := "racephotos-events"
	eventID := "integ-pub-" + time.Now().Format("20060102150405")

	photos := []models.Photo{
		{
			ID:               "integ-pub-photo-1-" + eventID,
			EventID:          eventID,
			Status:           models.PhotoStatusIndexed,
			RawS3Key:         "raw/" + eventID + "/1.jpg",
			WatermarkedS3Key: eventID + "/photo-1/watermarked.jpg",
			UploadedAt:       time.Now().UTC().Add(-3 * time.Second).Format(time.RFC3339),
		},
		{
			ID:               "integ-pub-photo-2-" + eventID,
			EventID:          eventID,
			Status:           models.PhotoStatusIndexed,
			RawS3Key:         "raw/" + eventID + "/2.jpg",
			WatermarkedS3Key: eventID + "/photo-2/watermarked.jpg",
			UploadedAt:       time.Now().UTC().Add(-2 * time.Second).Format(time.RFC3339),
		},
		{
			// Non-indexed photo — must NOT appear in public results.
			ID:         "integ-pub-photo-3-" + eventID,
			EventID:    eventID,
			Status:     models.PhotoStatusReviewRequired,
			RawS3Key:   "raw/" + eventID + "/3.jpg",
			UploadedAt: time.Now().UTC().Add(-1 * time.Second).Format(time.RFC3339),
		},
	}

	for _, p := range photos {
		item, err := attributevalue.MarshalMap(p)
		require.NoError(t, err)
		_, err = client.PutItem(ctx, &dynamodb.PutItemInput{
			TableName: aws.String(photosTable),
			Item:      item,
		})
		require.NoError(t, err)
	}

	event := models.Event{
		ID:            eventID,
		Name:          "Integration Test Marathon",
		PhotoCount:    2,
		PricePerPhoto: 5.00,
		Currency:      "GTQ",
	}
	evItem, err := attributevalue.MarshalMap(event)
	require.NoError(t, err)
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(eventsTable),
		Item:      evItem,
	})
	require.NoError(t, err)

	t.Cleanup(func() {
		for _, p := range photos {
			_, _ = client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
				TableName: aws.String(photosTable),
				Key: map[string]types.AttributeValue{
					"id": &types.AttributeValueMemberS{Value: p.ID},
				},
			})
		}
		_, _ = client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: aws.String(eventsTable),
			Key: map[string]types.AttributeValue{
				"id": &types.AttributeValueMemberS{Value: eventID},
			},
		})
	})

	// ListEventPhotos should return only indexed photos.
	lister := &handler.DynamoEventPhotoLister{Client: client, TableName: photosTable}
	result, nextCursor, err := lister.ListEventPhotos(ctx, eventID, "", 50)
	require.NoError(t, err)
	assert.Len(t, result, 2)
	assert.Empty(t, nextCursor)
	for _, p := range result {
		assert.Equal(t, models.PhotoStatusIndexed, p.Status)
	}

	// Pagination: limit=1 should produce a cursor.
	page1, cursor1, err := lister.ListEventPhotos(ctx, eventID, "", 1)
	require.NoError(t, err)
	assert.Len(t, page1, 1)
	assert.NotEmpty(t, cursor1)

	page2, cursor2, err := lister.ListEventPhotos(ctx, eventID, cursor1, 1)
	require.NoError(t, err)
	assert.Len(t, page2, 1)
	assert.Empty(t, cursor2)
	assert.NotEqual(t, page1[0].ID, page2[0].ID)

	// Invalid cursor returns ErrInvalidCursor.
	_, _, err = lister.ListEventPhotos(ctx, eventID, "bad-cursor!!!", 10)
	assert.ErrorIs(t, err, handler.ErrInvalidCursor)

	// GetPublicEvent returns event metadata.
	reader := &handler.DynamoPublicEventReader{Client: client, TableName: eventsTable}
	ev, err := reader.GetPublicEvent(ctx, eventID)
	require.NoError(t, err)
	assert.Equal(t, "Integration Test Marathon", ev.Name)
	assert.Equal(t, 2, ev.PhotoCount)

	// GetPublicEvent returns ErrEventNotFound for unknown ID.
	_, err = reader.GetPublicEvent(ctx, "does-not-exist")
	assert.ErrorIs(t, err, handler.ErrEventNotFound)
}
