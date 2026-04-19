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

	"github.com/racephotos/redownload-resend/handler"
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

func TestIntegration_GetApprovedPurchasesByEmail(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)

	purchasesTable := os.Getenv("RACEPHOTOS_PURCHASES_TABLE")
	if purchasesTable == "" {
		purchasesTable = "racephotos-purchases"
	}

	store := &handler.DynamoPurchaseStore{Client: client, TableName: purchasesTable}

	email := "integ-redownload@example.com"
	token := "integ-tok-resend"
	purchaseID := "integ-purchase-resend"

	p := models.Purchase{
		ID:            purchaseID,
		OrderID:       "integ-order-resend",
		PhotoID:       "integ-photo-resend",
		RunnerEmail:   email,
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

	purchases, err := store.GetApprovedPurchasesByEmail(ctx, email)
	require.NoError(t, err)
	require.Len(t, purchases, 1)
	assert.Equal(t, purchaseID, purchases[0].ID)
	assert.Equal(t, models.OrderStatusApproved, purchases[0].Status)
}

func TestIntegration_IncrementAndCheck_RateLimit(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)

	rateLimitsTable := os.Getenv("RACEPHOTOS_RATE_LIMITS_TABLE")
	if rateLimitsTable == "" {
		rateLimitsTable = "racephotos-rate-limits"
	}

	store := &handler.DynamoRateLimitStore{Client: client, TableName: rateLimitsTable}

	key := "REDOWNLOAD#integ-ratelimit@example.com"
	t.Cleanup(func() {
		client.DeleteItem(ctx, &dynamodb.DeleteItemInput{ //nolint:errcheck
			TableName: aws.String(rateLimitsTable),
			Key: map[string]types.AttributeValue{
				"rateLimitKey": &types.AttributeValueMemberS{Value: key},
			},
		})
	})

	// First 3 requests: allowed.
	for i := 1; i <= 3; i++ {
		allowed, err := store.IncrementAndCheck(ctx, key, 3600, 3)
		require.NoError(t, err)
		assert.True(t, allowed, "request %d should be allowed", i)
	}

	// 4th request: exceeds limit.
	allowed, err := store.IncrementAndCheck(ctx, key, 3600, 3)
	require.NoError(t, err)
	assert.False(t, allowed, "4th request should be rate-limited")
}
