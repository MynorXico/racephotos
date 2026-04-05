//go:build integration

// Package integration tests the update-photographer DynamoStore against LocalStack.
// Requires: docker-compose up -d && make seed-local
package integration

import (
	"context"
	"os"
	"testing"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/racephotos/shared/models"
	"github.com/racephotos/update-photographer/handler"
)

func newStore(t *testing.T) *handler.DynamoStore {
	t.Helper()
	tbl := os.Getenv("RACEPHOTOS_PHOTOGRAPHERS_TABLE")
	if tbl == "" {
		tbl = "racephotos-photographers"
	}
	cfg, err := awsconfig.LoadDefaultConfig(context.Background(),
		awsconfig.WithRegion("us-east-1"),
	)
	require.NoError(t, err)
	return &handler.DynamoStore{
		Client:    dynamodb.NewFromConfig(cfg),
		TableName: tbl,
	}
}

func TestIntegration_UpsertPhotographer_Create(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)
	id := "integration-test-upsert-create"

	t.Cleanup(func() { _ = store.DeleteForTest(ctx, id) })

	p := models.Photographer{
		ID:              id,
		DisplayName:     "Integration Create User",
		DefaultCurrency: "USD",
		UpdatedAt:       "2024-01-01T00:00:00Z",
	}

	result, err := store.UpsertPhotographer(ctx, p)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, id, result.ID)
	assert.Equal(t, "USD", result.DefaultCurrency)
	// createdAt is set by if_not_exists to UpdatedAt value on first write
	assert.Equal(t, p.UpdatedAt, result.CreatedAt)
}

func TestIntegration_UpsertPhotographer_Update(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)
	id := "integration-test-upsert-update"

	t.Cleanup(func() { _ = store.DeleteForTest(ctx, id) })

	original := models.Photographer{
		ID:        id,
		UpdatedAt: "2024-01-01T00:00:00Z",
	}
	first, err := store.UpsertPhotographer(ctx, original)
	require.NoError(t, err)
	require.NotNil(t, first)
	originalCreatedAt := first.CreatedAt

	updated := models.Photographer{
		ID:          id,
		DisplayName: "Updated Name",
		UpdatedAt:   "2024-06-01T00:00:00Z",
	}
	second, err := store.UpsertPhotographer(ctx, updated)
	require.NoError(t, err)
	require.NotNil(t, second)
	assert.Equal(t, "Updated Name", second.DisplayName)
	assert.Equal(t, originalCreatedAt, second.CreatedAt) // if_not_exists preserves it
}
