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

	"github.com/racephotos/presign-photos/handler"
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

func TestIntegration_BatchCreatePhotos(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)
	photosTable := "racephotos-photos"

	store := &handler.DynamoPhotoStore{Client: client, TableName: photosTable}

	now := time.Now().UTC().Format(time.RFC3339)
	suffix := now // use timestamp to avoid collisions across test runs

	photos := []models.Photo{
		{
			ID:         "integ-photo-1-" + suffix,
			EventID:    "integ-event-1",
			BibNumbers: []string{},
			Status:     "uploading",
			RawS3Key:   "local/integ-event-1/integ-photo-1/test.jpg",
			UploadedAt: now,
		},
		{
			ID:         "integ-photo-2-" + suffix,
			EventID:    "integ-event-1",
			BibNumbers: []string{},
			Status:     "uploading",
			RawS3Key:   "local/integ-event-1/integ-photo-2/test.jpg",
			UploadedAt: now,
		},
	}

	err := store.BatchCreatePhotos(ctx, photos)
	require.NoError(t, err)

	// Verify both photos were written.
	for _, p := range photos {
		key, _ := attributevalue.MarshalMap(map[string]string{"id": p.ID})
		out, err := client.GetItem(ctx, &dynamodb.GetItemInput{
			TableName: aws.String(photosTable),
			Key:       key,
		})
		require.NoError(t, err)
		require.NotEmpty(t, out.Item, "expected photo %s to be written", p.ID)

		var got models.Photo
		require.NoError(t, attributevalue.UnmarshalMap(out.Item, &got))
		assert.Equal(t, p.ID, got.ID)
		assert.Equal(t, "uploading", got.Status)
	}

	// Cleanup.
	for _, p := range photos {
		key := map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: p.ID},
		}
		_, _ = client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: aws.String(photosTable),
			Key:       key,
		})
	}
}

func TestIntegration_GetEvent(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)
	eventsTable := "racephotos-events"

	store := &handler.DynamoEventReader{Client: client, TableName: eventsTable}

	// Seed an event.
	eventID := "integ-presign-event-" + time.Now().UTC().Format(time.RFC3339)
	photographerID := "integ-photographer-presign"
	item, _ := attributevalue.MarshalMap(map[string]interface{}{
		"id":             eventID,
		"photographerId": photographerID,
		"name":           "Integration Test Event",
		"status":         "active",
	})
	_, err := client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(eventsTable),
		Item:      item,
	})
	require.NoError(t, err)

	ev, err := store.GetEvent(ctx, eventID)
	require.NoError(t, err)
	assert.Equal(t, eventID, ev.ID)
	assert.Equal(t, photographerID, ev.PhotographerID)

	// Cleanup.
	key := map[string]types.AttributeValue{
		"id": &types.AttributeValueMemberS{Value: eventID},
	}
	_, _ = client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(eventsTable),
		Key:       key,
	})
}
