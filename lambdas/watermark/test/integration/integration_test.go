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
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/racephotos/watermark/handler"
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

func TestIntegration_GetWatermarkText(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)

	eventsTable := "racephotos-events"
	store := &handler.DynamoEventStore{Client: client, TableName: eventsTable}

	suffix := time.Now().UTC().Format(time.RFC3339Nano)
	eventID := "integ-wm-evt-" + suffix

	// Seed an event with watermarkText.
	event := models.Event{
		ID:             eventID,
		PhotographerID: "integ-photographer",
		Name:           "Integ Marathon",
		WatermarkText:  "Integ Marathon 2026 · racephotos.example.com",
		Status:         "active",
		CreatedAt:      time.Now().UTC().Format(time.RFC3339),
	}
	item, err := attributevalue.MarshalMap(event)
	require.NoError(t, err)
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(eventsTable),
		Item:      item,
	})
	require.NoError(t, err)

	watermarkText, eventName, err := store.GetWatermarkText(ctx, eventID)
	require.NoError(t, err)
	assert.Equal(t, "Integ Marathon 2026 · racephotos.example.com", watermarkText)
	assert.Equal(t, "Integ Marathon", eventName)
}

// TestIntegration_CompleteWatermark verifies the atomic UpdateItem that sets
// watermarkedS3Key and status in a single expression (RS-017 AC2).
func TestIntegration_CompleteWatermark(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)

	photosTable := "racephotos-photos"
	store := &handler.DynamoPhotoStore{Client: client, TableName: photosTable}

	suffix := time.Now().UTC().Format(time.RFC3339Nano)
	photoID := "integ-wm-photo-" + suffix

	// Seed a photo record in "watermarking" status.
	photo := models.Photo{
		ID:         photoID,
		EventID:    "integ-wm-evt-001",
		Status:     "watermarking",
		RawS3Key:   "local/integ-wm-evt-001/" + photoID + "/test.jpg",
		UploadedAt: time.Now().UTC().Format(time.RFC3339),
	}
	item, err := attributevalue.MarshalMap(photo)
	require.NoError(t, err)
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(photosTable),
		Item:      item,
	})
	require.NoError(t, err)

	wmKey := "integ-wm-evt-001/" + photoID + "/watermarked.jpg"
	err = store.CompleteWatermark(ctx, photoID, wmKey, "indexed")
	require.NoError(t, err)

	// Verify both fields were set atomically.
	key, err := attributevalue.MarshalMap(map[string]string{"id": photoID})
	require.NoError(t, err)
	out, err := client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(photosTable),
		Key:       key,
	})
	require.NoError(t, err)
	require.NotEmpty(t, out.Item)

	var updated models.Photo
	require.NoError(t, attributevalue.UnmarshalMap(out.Item, &updated))
	assert.Equal(t, wmKey, updated.WatermarkedS3Key)
	assert.Equal(t, "indexed", updated.Status)
}

// TestIntegration_CompleteWatermark_PhotoNotFound verifies that CompleteWatermark
// fails fast when the photo does not exist (ConditionExpression: attribute_exists(id)).
func TestIntegration_CompleteWatermark_PhotoNotFound(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)

	photosTable := "racephotos-photos"
	store := &handler.DynamoPhotoStore{Client: client, TableName: photosTable}

	err := store.CompleteWatermark(ctx, "nonexistent-photo-id", "some/key.jpg", "indexed")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "CompleteWatermark")
}
