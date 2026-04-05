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
		CreatedAt:       "2024-01-01T00:00:00Z",
		UpdatedAt:       "2024-01-01T00:00:00Z",
	}

	require.NoError(t, store.UpsertPhotographer(ctx, p))

	got, err := store.GetPhotographer(ctx, id)
	require.NoError(t, err)
	assert.Equal(t, id, got.ID)
	assert.Equal(t, "USD", got.DefaultCurrency)
}

func TestIntegration_UpsertPhotographer_Update(t *testing.T) {
	ctx := context.Background()
	store := newStore(t)
	id := "integration-test-upsert-update"

	t.Cleanup(func() { _ = store.DeleteForTest(ctx, id) })

	original := models.Photographer{
		ID:        id,
		CreatedAt: "2024-01-01T00:00:00Z",
		UpdatedAt: "2024-01-01T00:00:00Z",
	}
	require.NoError(t, store.UpsertPhotographer(ctx, original))

	updated := original
	updated.DisplayName = "Updated Name"
	updated.UpdatedAt = "2024-06-01T00:00:00Z"
	require.NoError(t, store.UpsertPhotographer(ctx, updated))

	got, err := store.GetPhotographer(ctx, id)
	require.NoError(t, err)
	assert.Equal(t, "Updated Name", got.DisplayName)
	assert.Equal(t, "2024-01-01T00:00:00Z", got.CreatedAt) // preserved
}
