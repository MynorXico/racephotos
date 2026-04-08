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

	"github.com/racephotos/create-event/handler"
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

func TestIntegration_CreateEvent(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)
	tableName := "racephotos-events"

	store := &handler.DynamoEventCreator{Client: client, TableName: tableName}

	now := time.Now().UTC().Format(time.RFC3339)
	e := models.Event{
		ID:             "test-create-" + now,
		PhotographerID: "integration-test-user",
		Name:           "Integration Test Event",
		Date:           "2026-06-01",
		Location:       "Test City",
		PricePerPhoto:  9.99,
		Currency:       "USD",
		WatermarkText:  "Integration Test",
		Status:         "active",
		Visibility:     "public",
		ArchivedAt:     "",
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	err := store.CreateEvent(ctx, e)
	require.NoError(t, err)

	// Read back and verify.
	key, _ := attributevalue.MarshalMap(map[string]string{"id": e.ID})
	out, err := client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key:       key,
	})
	require.NoError(t, err)
	require.NotEmpty(t, out.Item)

	var got models.Event
	require.NoError(t, attributevalue.UnmarshalMap(out.Item, &got))
	assert.Equal(t, e.ID, got.ID)
	assert.Equal(t, "active", got.Status)

	// Cleanup.
	_, _ = client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(tableName),
		Key:       key,
	})
}

func TestIntegration_GetPhotographer(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)
	photographersTable := "racephotos-photographers"

	store := &handler.DynamoPhotographerReader{Client: client, TableName: photographersTable}

	// Seed a photographer.
	photographerID := "integ-photographer-read"
	item, _ := attributevalue.MarshalMap(map[string]interface{}{
		"id":              photographerID,
		"defaultCurrency": "GTQ",
	})
	_, err := client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(photographersTable),
		Item:      item,
	})
	require.NoError(t, err)

	p, err := store.GetPhotographer(ctx, photographerID)
	require.NoError(t, err)
	assert.Equal(t, "GTQ", p.DefaultCurrency)

	// Cleanup.
	key := map[string]types.AttributeValue{
		"id": &types.AttributeValueMemberS{Value: photographerID},
	}
	_, _ = client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(photographersTable),
		Key:       key,
	})
}
