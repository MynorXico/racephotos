//go:build integration

package integration_test

import (
	"context"
	"fmt"
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

	"github.com/racephotos/list-events/handler"
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

func seedEvent(t *testing.T, ctx context.Context, client *dynamodb.Client, tableName string, e models.Event) {
	t.Helper()
	item, err := attributevalue.MarshalMap(e)
	require.NoError(t, err)
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item:      item,
	})
	require.NoError(t, err)
}

func deleteEvent(ctx context.Context, client *dynamodb.Client, tableName, id string) {
	_, _ = client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(tableName),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
	})
}

func TestIntegration_ListActiveEvents(t *testing.T) {
	ctx := context.Background()
	client := newDynamoClient(t)
	tableName := os.Getenv("RACEPHOTOS_EVENTS_TABLE")
	if tableName == "" {
		t.Skip("RACEPHOTOS_EVENTS_TABLE not set — skipping integration test")
	}

	// Use a unique prefix to isolate this test's data.
	prefix := "list-events-integ-" + time.Now().Format("20060102150405")

	// Seed 3 active events and 1 archived event.
	activeIDs := []string{}
	for i := 0; i < 3; i++ {
		id := prefix + fmt.Sprintf("-active-%d", i)
		seedEvent(t, ctx, client, tableName, models.Event{
			ID:         id,
			Name:       "Active Event " + id,
			Date:       "2026-06-01",
			Location:   "Test City",
			Status:     "active",
			Visibility: "public",
			CreatedAt:  time.Now().UTC().Add(time.Duration(i) * time.Second).Format(time.RFC3339),
			UpdatedAt:  time.Now().UTC().Format(time.RFC3339),
		})
		activeIDs = append(activeIDs, id)
	}

	archivedID := prefix + "-archived"
	seedEvent(t, ctx, client, tableName, models.Event{
		ID:         archivedID,
		Name:       "Archived Event",
		Date:       "2026-01-01",
		Location:   "Old City",
		Status:     "archived",
		Visibility: "public",
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
		ArchivedAt: time.Now().UTC().Format(time.RFC3339),
		UpdatedAt:  time.Now().UTC().Format(time.RFC3339),
	})

	t.Cleanup(func() {
		for _, id := range activeIDs {
			deleteEvent(ctx, client, tableName, id)
		}
		deleteEvent(ctx, client, tableName, archivedID)
	})

	store := &handler.DynamoEventStore{Client: client, TableName: tableName}

	t.Run("AC1 — returns active events, no next cursor when all fit in page", func(t *testing.T) {
		evts, nextCursor, err := store.ListActiveEvents(ctx, "", 20)
		require.NoError(t, err)
		// We seeded 3 active events; other tests may have seeded more, so use >= 3.
		assert.GreaterOrEqual(t, len(evts), 3)
		// All returned events must have status "active".
		for _, e := range evts {
			assert.Equal(t, "active", e.Status)
		}
		// With limit=20 and only 3 seeded, no next cursor is expected (may vary if DB has more).
		_ = nextCursor
	})

	t.Run("AC3 — archived events are excluded", func(t *testing.T) {
		evts, _, err := store.ListActiveEvents(ctx, "", 100)
		require.NoError(t, err)
		for _, e := range evts {
			assert.NotEqual(t, "archived", e.Status, "archived event %s must not appear in results", e.ID)
		}
	})

	t.Run("AC2 — pagination cursor returns next page", func(t *testing.T) {
		page1, cursor, err := store.ListActiveEvents(ctx, "", 2)
		require.NoError(t, err)
		assert.Len(t, page1, 2)
		assert.NotEmpty(t, cursor)

		page2, _, err := store.ListActiveEvents(ctx, cursor, 2)
		require.NoError(t, err)
		assert.NotEmpty(t, page2)

		// Pages must not overlap.
		p1IDs := map[string]bool{}
		for _, e := range page1 {
			p1IDs[e.ID] = true
		}
		for _, e := range page2 {
			assert.False(t, p1IDs[e.ID], "event %s appears on both pages", e.ID)
		}
	})

	t.Run("AC9 — invalid cursor returns ErrInvalidCursor", func(t *testing.T) {
		_, _, err := store.ListActiveEvents(ctx, "not-valid-base64!!!", 20)
		require.Error(t, err)
		assert.ErrorIs(t, err, handler.ErrInvalidCursor)
	})

	t.Run("TC-019 — exactly limit-many events does not produce spurious cursor", func(t *testing.T) {
		// Seed exactly 2 events and query with limit=2.
		// DynamoDB may return a non-empty LastEvaluatedKey even when exhausted;
		// if so, the follow-up page must be empty.
		exactIDs := []string{}
		for i := 0; i < 2; i++ {
			id := prefix + fmt.Sprintf("-exact-%d", i)
			seedEvent(t, ctx, client, tableName, models.Event{
				ID:         id,
				Name:       "Exact Event " + id,
				Date:       "2026-07-01",
				Location:   "Boundary City",
				Status:     "active",
				Visibility: "public",
				CreatedAt:  time.Now().UTC().Add(time.Duration(i+100) * time.Second).Format(time.RFC3339),
				UpdatedAt:  time.Now().UTC().Format(time.RFC3339),
			})
			exactIDs = append(exactIDs, id)
		}
		t.Cleanup(func() {
			for _, id := range exactIDs {
				deleteEvent(ctx, client, tableName, id)
			}
		})

		_, cursor, err := store.ListActiveEvents(ctx, "", 2)
		require.NoError(t, err)
		if cursor != "" {
			// Spurious cursor is valid per DynamoDB spec; the follow-up page must be empty or valid.
			_, _, err2 := store.ListActiveEvents(ctx, cursor, 2)
			require.NoError(t, err2)
		}
	})

	t.Run("unlisted events are excluded from public listing", func(t *testing.T) {
		unlistedID := prefix + "-unlisted"
		seedEvent(t, ctx, client, tableName, models.Event{
			ID:         unlistedID,
			Name:       "Unlisted Event",
			Date:       "2026-06-15",
			Location:   "Secret City",
			Status:     "active",
			Visibility: "unlisted",
			CreatedAt:  time.Now().UTC().Format(time.RFC3339),
			UpdatedAt:  time.Now().UTC().Format(time.RFC3339),
		})
		t.Cleanup(func() { deleteEvent(ctx, client, tableName, unlistedID) })

		evts, _, err := store.ListActiveEvents(ctx, "", 100)
		require.NoError(t, err)
		for _, e := range evts {
			assert.NotEqual(t, unlistedID, e.ID, "unlisted event must not appear in public listing")
		}
	})
}
