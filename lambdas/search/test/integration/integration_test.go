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

	"github.com/racephotos/search/handler"
	"github.com/racephotos/shared/apperrors"
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

func TestIntegration_GetPhotoIDsByBib(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)

	bibTableName := "racephotos-bib-index"
	eventID := "integ-search-event-" + time.Now().Format("20060102150405")
	bib := "101"
	bibKey := eventID + "#" + bib

	entries := []models.BibEntry{
		{BibKey: bibKey, PhotoID: "photo-a-" + eventID},
		{BibKey: bibKey, PhotoID: "photo-b-" + eventID},
	}

	for _, e := range entries {
		item, err := attributevalue.MarshalMap(e)
		require.NoError(t, err)
		_, err = client.PutItem(ctx, &dynamodb.PutItemInput{
			TableName: aws.String(bibTableName),
			Item:      item,
		})
		require.NoError(t, err)
	}

	t.Cleanup(func() {
		for _, e := range entries {
			_, _ = client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
				TableName: aws.String(bibTableName),
				Key: map[string]types.AttributeValue{
					"bibKey":  &types.AttributeValueMemberS{Value: e.BibKey},
					"photoId": &types.AttributeValueMemberS{Value: e.PhotoID},
				},
			})
		}
	})

	store := &handler.DynamoBibIndexReader{Client: client, TableName: bibTableName}
	ids, err := store.GetPhotoIDsByBib(ctx, eventID, bib)
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"photo-a-" + eventID, "photo-b-" + eventID}, ids)

	// Unknown bib returns empty slice — not an error.
	empty, err := store.GetPhotoIDsByBib(ctx, eventID, "9999")
	require.NoError(t, err)
	assert.Empty(t, empty)
}

func TestIntegration_BatchGetPhotos(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)

	photosTableName := "racephotos-photos"
	eventID := "integ-search-batch-" + time.Now().Format("20060102150405")

	photos := []models.Photo{
		{
			ID:               "integ-search-photo-1-" + eventID,
			EventID:          eventID,
			Status:           models.PhotoStatusIndexed,
			RawS3Key:         "raw/" + eventID + "/1.jpg",
			WatermarkedS3Key: "processed/" + eventID + "/1.jpg",
			UploadedAt:       time.Now().UTC().Format(time.RFC3339),
		},
		{
			ID:         "integ-search-photo-2-" + eventID,
			EventID:    eventID,
			Status:     models.PhotoStatusProcessing,
			RawS3Key:   "raw/" + eventID + "/2.jpg",
			UploadedAt: time.Now().UTC().Add(time.Second).Format(time.RFC3339),
		},
	}

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
			_, _ = client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
				TableName: aws.String(photosTableName),
				Key: map[string]types.AttributeValue{
					"id": &types.AttributeValueMemberS{Value: p.ID},
				},
			})
		}
	})

	store := &handler.DynamoPhotoBatchGetter{Client: client, TableName: photosTableName}
	ids := []string{photos[0].ID, photos[1].ID}
	result, err := store.BatchGetPhotos(ctx, ids)
	require.NoError(t, err)
	assert.Len(t, result, 2)

	// Empty id list returns nil without error.
	empty, err := store.BatchGetPhotos(ctx, nil)
	require.NoError(t, err)
	assert.Nil(t, empty)
}

func TestIntegration_GetEvent(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)

	eventsTableName := "racephotos-events"
	ev := models.Event{
		ID:            "integ-search-event-get-" + time.Now().Format("20060102150405"),
		Name:          "Integration Test Race",
		Date:          "2026-03-15",
		Location:      "City Park",
		PricePerPhoto: 75.0,
		Currency:      "GTQ",
		Status:        "active",
		CreatedAt:     time.Now().UTC().Format(time.RFC3339),
		UpdatedAt:     time.Now().UTC().Format(time.RFC3339),
	}

	item, err := attributevalue.MarshalMap(ev)
	require.NoError(t, err)
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(eventsTableName),
		Item:      item,
	})
	require.NoError(t, err)

	t.Cleanup(func() {
		_, _ = client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: aws.String(eventsTableName),
			Key: map[string]types.AttributeValue{
				"id": &types.AttributeValueMemberS{Value: ev.ID},
			},
		})
	})

	store := &handler.DynamoEventGetter{Client: client, TableName: eventsTableName}

	got, err := store.GetEvent(ctx, ev.ID)
	require.NoError(t, err)
	assert.Equal(t, ev.Name, got.Name)
	assert.Equal(t, ev.PricePerPhoto, got.PricePerPhoto)
	assert.Equal(t, ev.Currency, got.Currency)

	// Missing event returns apperrors.ErrNotFound.
	_, err = store.GetEvent(ctx, "does-not-exist")
	assert.ErrorIs(t, err, apperrors.ErrNotFound)
}
