//go:build integration

package integration_test

import (
	"context"
	"fmt"
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

	"github.com/racephotos/tag-photo-bibs/handler"
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

func TestIntegration_TagPhotoBibs(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)

	photosTable := "racephotos-photos"
	bibIndexTable := "racephotos-bib-index"
	eventsTable := "racephotos-events"

	suffix := time.Now().Format("20060102150405")
	eventID := "integ-event-" + suffix
	photoID := "integ-photo-" + suffix

	// Seed photo.
	photo := models.Photo{
		ID:         photoID,
		EventID:    eventID,
		Status:     models.PhotoStatusReviewRequired,
		RawS3Key:   "raw/" + photoID + ".jpg",
		UploadedAt: time.Now().UTC().Format(time.RFC3339),
	}
	photoItem, err := attributevalue.MarshalMap(photo)
	require.NoError(t, err)
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(photosTable),
		Item:      photoItem,
	})
	require.NoError(t, err)

	t.Cleanup(func() {
		_, _ = client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: aws.String(photosTable),
			Key: map[string]types.AttributeValue{
				"id": &types.AttributeValueMemberS{Value: photoID},
			},
		})
		// Clean up any bib entries.
		out, _ := client.Query(ctx, &dynamodb.QueryInput{
			TableName:              aws.String(bibIndexTable),
			IndexName:              aws.String("photoId-index"),
			KeyConditionExpression: aws.String("photoId = :pid"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":pid": &types.AttributeValueMemberS{Value: photoID},
			},
			ProjectionExpression: aws.String("bibKey, photoId"),
		})
		if out != nil {
			for _, item := range out.Items {
				_, _ = client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
					TableName: aws.String(bibIndexTable),
					Key: map[string]types.AttributeValue{
						"bibKey":  item["bibKey"],
						"photoId": item["photoId"],
					},
				})
			}
		}
	})

	photoStore := &handler.DynamoPhotoStore{Client: client, TableName: photosTable}
	bibStore := &handler.DynamoBibIndexStore{Client: client, TableName: bibIndexTable}
	eventStore := &handler.DynamoEventStore{Client: client, TableName: eventsTable}

	// ── WriteBibEntries / DeleteBibEntriesByPhoto ─────────────────────────────

	entries := []models.BibEntry{
		{BibKey: fmt.Sprintf("%s#101", eventID), PhotoID: photoID},
		{BibKey: fmt.Sprintf("%s#102", eventID), PhotoID: photoID},
	}

	err = bibStore.WriteBibEntries(ctx, entries)
	require.NoError(t, err)

	// Verify two entries exist via GSI query.
	out, err := client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(bibIndexTable),
		IndexName:              aws.String("photoId-index"),
		KeyConditionExpression: aws.String("photoId = :pid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pid": &types.AttributeValueMemberS{Value: photoID},
		},
	})
	require.NoError(t, err)
	assert.Len(t, out.Items, 2)

	// Delete and verify gone.
	err = bibStore.DeleteBibEntriesByPhoto(ctx, photoID)
	require.NoError(t, err)

	out2, err := client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(bibIndexTable),
		IndexName:              aws.String("photoId-index"),
		KeyConditionExpression: aws.String("photoId = :pid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pid": &types.AttributeValueMemberS{Value: photoID},
		},
	})
	require.NoError(t, err)
	assert.Len(t, out2.Items, 0)

	// ── GetPhoto ─────────────────────────────────────────────────────────────

	got, err := photoStore.GetPhoto(ctx, photoID)
	require.NoError(t, err)
	assert.Equal(t, photoID, got.ID)
	assert.Equal(t, eventID, got.EventID)

	// Non-existent photo returns ErrPhotoNotFound.
	_, err = photoStore.GetPhoto(ctx, "non-existent-id")
	assert.ErrorIs(t, err, handler.ErrPhotoNotFound)

	// ── UpdatePhotoBibs ───────────────────────────────────────────────────────

	err = photoStore.UpdatePhotoBibs(ctx, photoID, []string{"101", "102"}, models.PhotoStatusIndexed)
	require.NoError(t, err)

	updated, err := photoStore.GetPhoto(ctx, photoID)
	require.NoError(t, err)
	assert.Equal(t, []string{"101", "102"}, updated.BibNumbers)
	assert.Equal(t, models.PhotoStatusIndexed, updated.Status)

	// ── GetEvent ─────────────────────────────────────────────────────────────

	// Non-existent event returns ErrEventNotFound.
	_, err = eventStore.GetEvent(ctx, "non-existent-event-id")
	assert.ErrorIs(t, err, handler.ErrEventNotFound)
}
