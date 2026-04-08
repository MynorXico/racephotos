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

	"github.com/racephotos/archive-event/handler"
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

func TestIntegration_ArchiveEvent(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)
	tableName := "racephotos-events"

	// Seed an active event.
	now := time.Now().UTC().Format(time.RFC3339)
	eventID := "test-archive-" + now
	e := models.Event{
		ID:             eventID,
		PhotographerID: "archive-owner",
		Name:           "Archive Integration Test",
		Date:           "2026-06-01",
		Location:       "Test City",
		Status:         "active",
		Visibility:     "public",
		ArchivedAt:     "",
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	item, _ := attributevalue.MarshalMap(e)
	_, err := client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item:      item,
	})
	require.NoError(t, err)

	store := &handler.DynamoEventArchiver{Client: client, TableName: tableName}

	// Non-owner is forbidden.
	_, err = store.ArchiveEvent(ctx, eventID, "other-user")
	assert.ErrorIs(t, err, apperrors.ErrForbidden)

	// Owner can archive.
	archived, err := store.ArchiveEvent(ctx, eventID, "archive-owner")
	require.NoError(t, err)
	assert.Equal(t, "archived", archived.Status)
	assert.NotEmpty(t, archived.ArchivedAt)

	// Already archived — no-op (200).
	archived2, err := store.ArchiveEvent(ctx, eventID, "archive-owner")
	require.NoError(t, err)
	assert.Equal(t, "archived", archived2.Status)

	// Non-existent event.
	_, err = store.ArchiveEvent(ctx, "nonexistent-event", "archive-owner")
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
