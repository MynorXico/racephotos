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

	"github.com/racephotos/list-photographer-events/handler"
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

func TestIntegration_ListEventsByPhotographer(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)
	tableName := "racephotos-events"
	photographerID := "list-integ-photographer-" + time.Now().Format("20060102150405")

	// Seed 3 events.
	seedIDs := []string{}
	for i := 0; i < 3; i++ {
		createdAt := time.Now().UTC().Add(time.Duration(i) * time.Second).Format(time.RFC3339)
		e := models.Event{
			ID:             "list-integ-" + createdAt,
			PhotographerID: photographerID,
			Name:           "Event " + createdAt,
			Date:           "2026-06-01",
			Location:       "Test City",
			Status:         "active",
			Visibility:     "public",
			CreatedAt:      createdAt,
			UpdatedAt:      createdAt,
		}
		item, _ := attributevalue.MarshalMap(e)
		_, err := client.PutItem(ctx, &dynamodb.PutItemInput{
			TableName: aws.String(tableName),
			Item:      item,
		})
		require.NoError(t, err)
		seedIDs = append(seedIDs, e.ID)
	}

	store := &handler.DynamoEventLister{Client: client, TableName: tableName}

	// List all events — limit > count so no cursor.
	events, nextCursor, err := store.ListEventsByPhotographer(ctx, photographerID, "", 20)
	require.NoError(t, err)
	assert.Len(t, events, 3)
	assert.Empty(t, nextCursor)

	// List with page size 2 — should get cursor.
	page1, cursor, err := store.ListEventsByPhotographer(ctx, photographerID, "", 2)
	require.NoError(t, err)
	assert.Len(t, page1, 2)
	assert.NotEmpty(t, cursor)

	// Second page using cursor.
	page2, cursor2, err := store.ListEventsByPhotographer(ctx, photographerID, cursor, 2)
	require.NoError(t, err)
	assert.Len(t, page2, 1)
	assert.Empty(t, cursor2)

	// Cleanup.
	for _, id := range seedIDs {
		key := map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		}
		_, _ = client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: aws.String(tableName),
			Key:       key,
		})
	}
}
