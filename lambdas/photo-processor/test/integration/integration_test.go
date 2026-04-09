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

	"github.com/racephotos/photo-processor/handler"
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

func TestIntegration_GetPhotoById(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)

	photosTable := "racephotos-photos"
	store := &handler.DynamoPhotoStore{Client: client, TableName: photosTable}

	suffix := time.Now().UTC().Format(time.RFC3339Nano)
	photoID := "integ-proc-photo-" + suffix

	// Seed a photo record directly.
	photo := models.Photo{
		ID:         photoID,
		EventID:    "integ-evt-001",
		Status:     "uploading",
		RawS3Key:   "local/integ-evt-001/" + photoID + "/test.jpg",
		UploadedAt: time.Now().UTC().Format(time.RFC3339),
	}
	item, err := attributevalue.MarshalMap(photo)
	require.NoError(t, err)
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(photosTable),
		Item:      item,
	})
	require.NoError(t, err)

	got, err := store.GetPhotoById(ctx, photoID)
	require.NoError(t, err)
	assert.Equal(t, photoID, got.ID)
	assert.Equal(t, "integ-evt-001", got.EventID)
}

func TestIntegration_UpdatePhotoStatus_Indexed(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)

	photosTable := "racephotos-photos"
	store := &handler.DynamoPhotoStore{Client: client, TableName: photosTable}

	suffix := time.Now().UTC().Format(time.RFC3339Nano)
	photoID := "integ-proc-update-" + suffix

	// Seed a photo record.
	photo := models.Photo{
		ID:         photoID,
		EventID:    "integ-evt-002",
		Status:     "uploading",
		RawS3Key:   "local/integ-evt-002/" + photoID + "/test.jpg",
		UploadedAt: time.Now().UTC().Format(time.RFC3339),
	}
	item, err := attributevalue.MarshalMap(photo)
	require.NoError(t, err)
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(photosTable),
		Item:      item,
	})
	require.NoError(t, err)

	err = store.UpdatePhotoStatus(ctx, photoID, models.PhotoStatusUpdate{
		Status:                "indexed",
		BibNumbers:            []string{"101"},
		RekognitionConfidence: 0.95,
	})
	require.NoError(t, err)

	// Verify the update.
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
	assert.Equal(t, "indexed", updated.Status)
	assert.Equal(t, []string{"101"}, updated.BibNumbers)
	assert.InDelta(t, 0.95, updated.RekognitionConfidence, 0.001)
}

func TestIntegration_WriteBibEntries(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)

	bibTable := "racephotos-bib-index"
	store := &handler.DynamoBibIndexStore{Client: client, TableName: bibTable}

	suffix := time.Now().UTC().Format(time.RFC3339Nano)
	photoID := "integ-bib-photo-" + suffix
	eventID := "integ-evt-003"

	entries := []models.BibEntry{
		{BibKey: eventID + "#101", PhotoID: photoID},
		{BibKey: eventID + "#102", PhotoID: photoID},
	}
	err := store.WriteBibEntries(ctx, entries)
	require.NoError(t, err)

	// Verify both entries exist.
	for _, e := range entries {
		key, err := attributevalue.MarshalMap(map[string]interface{}{
			"bibKey":  e.BibKey,
			"photoId": e.PhotoID,
		})
		require.NoError(t, err)
		out, err := client.GetItem(ctx, &dynamodb.GetItemInput{
			TableName: aws.String(bibTable),
			Key:       key,
		})
		require.NoError(t, err)
		assert.NotEmpty(t, out.Item, "expected bib entry %s", e.BibKey)
	}
}

func TestIntegration_GetPhotoById_NotFound(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)

	store := &handler.DynamoPhotoStore{Client: client, TableName: "racephotos-photos"}

	_, err := store.GetPhotoById(ctx, "nonexistent-photo-id-xyz")
	require.Error(t, err)

	// Verify DynamoDB schema — bibKey and photoId must be defined as key attributes.
	descOut, err := client.DescribeTable(ctx, &dynamodb.DescribeTableInput{
		TableName: aws.String("racephotos-bib-index"),
	})
	require.NoError(t, err)
	keyNames := make([]string, 0, len(descOut.Table.KeySchema))
	for _, k := range descOut.Table.KeySchema {
		keyNames = append(keyNames, aws.ToString(k.AttributeName))
	}
	assert.Contains(t, keyNames, "bibKey")
	assert.Contains(t, keyNames, "photoId")

	_ = types.KeySchemaElement{} // import used
}
