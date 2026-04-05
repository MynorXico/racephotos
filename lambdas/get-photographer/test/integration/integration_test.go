//go:build integration

// Package integration tests the get-photographer DynamoStore against LocalStack.
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

	"github.com/racephotos/get-photographer/handler"
	"github.com/racephotos/shared/apperrors"
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

func TestIntegration_GetPhotographer_NotFound(t *testing.T) {
	store := newStore(t)
	_, err := store.GetPhotographer(context.Background(), "integration-test-missing-id-get")
	assert.ErrorIs(t, err, apperrors.ErrNotFound)
}
