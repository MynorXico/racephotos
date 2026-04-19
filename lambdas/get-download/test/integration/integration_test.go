//go:build integration

package integration_test

import (
	"context"
	"os"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/racephotos/get-download/handler"
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

func TestIntegration_GetPurchaseByDownloadToken(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)

	purchasesTable := os.Getenv("RACEPHOTOS_PURCHASES_TABLE")
	if purchasesTable == "" {
		purchasesTable = "racephotos-purchases"
	}

	store := &handler.DynamoPurchaseStore{Client: client, TableName: purchasesTable}

	token := "integ-token-get-download"
	purchaseID := "integ-purchase-get-download"
	photoID := "integ-photo-get-download"

	// Seed a purchase record with downloadToken and status=approved.
	p := models.Purchase{
		ID:            purchaseID,
		OrderID:       "integ-order-get-download",
		PhotoID:       photoID,
		RunnerEmail:   "runner@example.com",
		DownloadToken: &token,
		Status:        models.OrderStatusApproved,
		ClaimedAt:     "2026-04-18T10:00:00Z",
	}
	item, err := attributevalue.MarshalMap(p)
	require.NoError(t, err)
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(purchasesTable),
		Item:      item,
	})
	require.NoError(t, err)
	t.Cleanup(func() {
		client.DeleteItem(ctx, &dynamodb.DeleteItemInput{ //nolint:errcheck
			TableName: aws.String(purchasesTable),
			Key:       map[string]types.AttributeValue{"id": &types.AttributeValueMemberS{Value: purchaseID}},
		})
	})

	got, err := store.GetPurchaseByDownloadToken(ctx, token)
	require.NoError(t, err)
	assert.Equal(t, purchaseID, got.ID)
	assert.Equal(t, photoID, got.PhotoID)
	assert.Equal(t, models.OrderStatusApproved, got.Status)
}

func TestIntegration_GetPhotoByID(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)

	photosTable := os.Getenv("RACEPHOTOS_PHOTOS_TABLE")
	if photosTable == "" {
		photosTable = "racephotos-photos"
	}

	store := &handler.DynamoPhotoStore{Client: client, TableName: photosTable}

	photoID := "integ-photo-get-download-photo"
	ph := models.Photo{
		ID:       photoID,
		EventID:  "integ-event-1",
		RawS3Key: "originals/integ-photo.jpg",
		Status:   models.PhotoStatusIndexed,
		UploadedAt: "2026-04-18T10:00:00Z",
	}
	item, err := attributevalue.MarshalMap(ph)
	require.NoError(t, err)
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(photosTable),
		Item:      item,
	})
	require.NoError(t, err)
	t.Cleanup(func() {
		client.DeleteItem(ctx, &dynamodb.DeleteItemInput{ //nolint:errcheck
			TableName: aws.String(photosTable),
			Key:       map[string]types.AttributeValue{"id": &types.AttributeValueMemberS{Value: photoID}},
		})
	})

	got, err := store.GetPhotoByID(ctx, photoID)
	require.NoError(t, err)
	assert.Equal(t, photoID, got.ID)
	assert.Equal(t, "originals/integ-photo.jpg", got.RawS3Key)
}
