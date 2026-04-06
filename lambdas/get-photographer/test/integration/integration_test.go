//go:build integration

// Package integration tests the get-photographer DynamoStore against LocalStack.
// Requires: docker-compose up -d && make seed-local
package integration

import (
	"os"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/racephotos/get-photographer/handler"
	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

func newStore(t *testing.T) (*handler.DynamoStore, *dynamodb.Client) {
	t.Helper()
	tbl := os.Getenv("RACEPHOTOS_PHOTOGRAPHERS_TABLE")
	if tbl == "" {
		tbl = "racephotos-photographers"
	}
	cfg, err := awsconfig.LoadDefaultConfig(t.Context(),
		awsconfig.WithRegion("us-east-1"),
	)
	require.NoError(t, err)
	client := dynamodb.NewFromConfig(cfg)
	return &handler.DynamoStore{Client: client, TableName: tbl}, client
}

func seedPhotographer(t *testing.T, client *dynamodb.Client, p models.Photographer) {
	t.Helper()
	tbl := os.Getenv("RACEPHOTOS_PHOTOGRAPHERS_TABLE")
	if tbl == "" {
		tbl = "racephotos-photographers"
	}
	item, err := attributevalue.MarshalMap(p)
	require.NoError(t, err)
	_, err = client.PutItem(t.Context(), &dynamodb.PutItemInput{
		TableName: aws.String(tbl),
		Item:      item,
	})
	require.NoError(t, err)
}

func deletePhotographer(t *testing.T, client *dynamodb.Client, id string) {
	t.Helper()
	tbl := os.Getenv("RACEPHOTOS_PHOTOGRAPHERS_TABLE")
	if tbl == "" {
		tbl = "racephotos-photographers"
	}
	key, err := attributevalue.MarshalMap(map[string]string{"id": id})
	require.NoError(t, err)
	_, _ = client.DeleteItem(t.Context(), &dynamodb.DeleteItemInput{
		TableName: aws.String(tbl),
		Key:       key,
	})
}

func TestIntegration_GetPhotographer_NotFound(t *testing.T) {
	store, _ := newStore(t)
	_, err := store.GetPhotographer(t.Context(), "integration-test-missing-id-get")
	assert.ErrorIs(t, err, apperrors.ErrNotFound)
}

func TestIntegration_GetPhotographer_Found(t *testing.T) {
	store, client := newStore(t)
	id := "integration-test-get-found"

	seed := models.Photographer{
		ID:              id,
		DisplayName:     "Integration Test User",
		DefaultCurrency: "USD",
		CreatedAt:       "2024-01-01T00:00:00Z",
		UpdatedAt:       "2024-01-01T00:00:00Z",
	}
	seedPhotographer(t, client, seed)
	t.Cleanup(func() { deletePhotographer(t, client, id) })

	p, err := store.GetPhotographer(t.Context(), id)
	require.NoError(t, err)
	assert.Equal(t, id, p.ID)
	assert.Equal(t, "Integration Test User", p.DisplayName)
	assert.Equal(t, "USD", p.DefaultCurrency)
	assert.Equal(t, "2024-01-01T00:00:00Z", p.CreatedAt)
}
