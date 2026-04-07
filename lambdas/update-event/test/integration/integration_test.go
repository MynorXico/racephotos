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

	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
	"github.com/racephotos/update-event/handler"
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

func TestIntegration_UpdateEvent(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)
	tableName := "racephotos-events"

	// Seed an event owned by owner-1.
	now := time.Now().UTC().Format(time.RFC3339)
	eventID := "test-update-" + now
	e := models.Event{
		ID:             eventID,
		PhotographerID: "owner-1",
		Name:           "Original Name",
		Date:           "2026-06-01",
		Location:       "Original City",
		PricePerPhoto:  5.00,
		Currency:       "USD",
		WatermarkText:  "Original Watermark",
		Status:         "active",
		Visibility:     "public",
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	item, _ := attributevalue.MarshalMap(e)
	_, err := client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item:      item,
	})
	require.NoError(t, err)

	store := &handler.DynamoEventUpdater{Client: client, TableName: tableName}

	// Owner can update.
	fields := handler.UpdateFields{
		Name:          "Updated Name",
		Date:          "2026-07-01",
		Location:      "New City",
		PricePerPhoto: 10.00,
		Currency:      "EUR",
		WatermarkText: "Updated Watermark",
	}
	updated, err := store.UpdateEvent(ctx, eventID, "owner-1", fields)
	require.NoError(t, err)
	assert.Equal(t, "Updated Name", updated.Name)
	assert.Equal(t, "EUR", updated.Currency)

	// Non-owner is forbidden.
	_, err = store.UpdateEvent(ctx, eventID, "other-user", fields)
	assert.ErrorIs(t, err, apperrors.ErrForbidden)

	// Nonexistent event returns not found.
	_, err = store.UpdateEvent(ctx, "nonexistent-event", "owner-1", fields)
	assert.ErrorIs(t, err, apperrors.ErrNotFound)

	// Cleanup.
	key := map[string]types.AttributeValue{
		"id": &types.AttributeValueMemberS{Value: eventID},
	}
	_, _ = client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(tableName),
		Key:       key,
	})
}
