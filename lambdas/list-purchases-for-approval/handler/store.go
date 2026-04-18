// Package handler implements GET /photographer/me/purchases business logic.
package handler

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/racephotos/shared/models"
)

// ── Business-logic interfaces ─────────────────────────────────────────────────

// OrderStore abstracts queries against the racephotos-orders table.
type OrderStore interface {
	// QueryPendingOrdersByPhotographer returns all Orders with status=pending for
	// the given photographerId, ordered by claimedAt descending.
	QueryPendingOrdersByPhotographer(ctx context.Context, photographerID string) ([]*models.Order, error)
}

// PurchaseStore abstracts queries against the racephotos-purchases table.
type PurchaseStore interface {
	// QueryPurchasesByOrder returns all Purchase line items for the given orderId
	// using the orderId-index GSI.
	QueryPurchasesByOrder(ctx context.Context, orderID string) ([]*models.Purchase, error)
}

// PhotoStore abstracts batch reads from the racephotos-photos table.
type PhotoStore interface {
	// BatchGetPhotos returns Photos for the given IDs. Missing IDs are silently
	// omitted from the result — callers should handle absent photos gracefully.
	BatchGetPhotos(ctx context.Context, photoIDs []string) ([]*models.Photo, error)
}

// ── DynamoDB client interfaces ────────────────────────────────────────────────

// DynamoQueryClient wraps the DynamoDB Query method.
type DynamoQueryClient interface {
	Query(ctx context.Context, params *dynamodb.QueryInput, optFns ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
}

// DynamoBatchGetClient wraps the DynamoDB BatchGetItem method.
type DynamoBatchGetClient interface {
	BatchGetItem(ctx context.Context, params *dynamodb.BatchGetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.BatchGetItemOutput, error)
}

// ── DynamoDB implementations ──────────────────────────────────────────────────

// DynamoOrderStore implements OrderStore using the racephotos-orders table.
type DynamoOrderStore struct {
	Client    DynamoQueryClient
	TableName string
}

// QueryPendingOrdersByPhotographer queries the photographerId-claimedAt-index GSI
// with a filter expression on status=pending. Paginates through all pages using
// LastEvaluatedKey to ensure complete results for photographers with large order histories.
func (s *DynamoOrderStore) QueryPendingOrdersByPhotographer(ctx context.Context, photographerID string) ([]*models.Order, error) {
	var orders []*models.Order
	var lastKey map[string]types.AttributeValue

	for {
		input := &dynamodb.QueryInput{
			TableName:              aws.String(s.TableName),
			IndexName:              aws.String("photographerId-claimedAt-index"),
			KeyConditionExpression: aws.String("#pk = :photographerId"),
			FilterExpression:       aws.String("#status = :pending"),
			ExpressionAttributeNames: map[string]string{
				"#pk":     "photographerId",
				"#status": "status",
			},
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":photographerId": &types.AttributeValueMemberS{Value: photographerID},
				":pending":        &types.AttributeValueMemberS{Value: models.OrderStatusPending},
			},
			// ScanIndexForward: false — most recent first.
			ScanIndexForward:          aws.Bool(false),
			ExclusiveStartKey:         lastKey,
		}

		out, err := s.Client.Query(ctx, input)
		if err != nil {
			return nil, fmt.Errorf("QueryPendingOrdersByPhotographer: Query: %w", err)
		}

		for i, item := range out.Items {
			var o models.Order
			if err := attributevalue.UnmarshalMap(item, &o); err != nil {
				return nil, fmt.Errorf("QueryPendingOrdersByPhotographer: unmarshal[%d]: %w", i, err)
			}
			orders = append(orders, &o)
		}

		if len(out.LastEvaluatedKey) == 0 {
			break
		}
		lastKey = out.LastEvaluatedKey
	}

	return orders, nil
}

// DynamoPurchaseStore implements PurchaseStore using the racephotos-purchases table.
type DynamoPurchaseStore struct {
	Client    DynamoQueryClient
	TableName string
}

// QueryPurchasesByOrder queries the orderId-index GSI to return all Purchase
// line items for the given orderId.
func (s *DynamoPurchaseStore) QueryPurchasesByOrder(ctx context.Context, orderID string) ([]*models.Purchase, error) {
	out, err := s.Client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.TableName),
		IndexName:              aws.String("orderId-index"),
		KeyConditionExpression: aws.String("#pk = :orderId"),
		ExpressionAttributeNames: map[string]string{
			"#pk": "orderId",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":orderId": &types.AttributeValueMemberS{Value: orderID},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("QueryPurchasesByOrder: Query: %w", err)
	}

	purchases := make([]*models.Purchase, 0, len(out.Items))
	for i, item := range out.Items {
		var p models.Purchase
		if err := attributevalue.UnmarshalMap(item, &p); err != nil {
			return nil, fmt.Errorf("QueryPurchasesByOrder: unmarshal[%d]: %w", i, err)
		}
		purchases = append(purchases, &p)
	}
	return purchases, nil
}

// DynamoPhotoStore implements PhotoStore using the racephotos-photos table.
type DynamoPhotoStore struct {
	Client    DynamoBatchGetClient
	TableName string
}

// batchGetChunkSize is the DynamoDB BatchGetItem hard limit per call.
const batchGetChunkSize = 100

// BatchGetPhotos fetches photos by ID in chunks of up to 100 (DynamoDB limit).
// Automatically retries UnprocessedKeys until all items are retrieved.
// Missing IDs are silently omitted — callers handle absent photos gracefully.
func (s *DynamoPhotoStore) BatchGetPhotos(ctx context.Context, photoIDs []string) ([]*models.Photo, error) {
	if len(photoIDs) == 0 {
		return nil, nil
	}

	var photos []*models.Photo

	// Process in chunks of up to batchGetChunkSize.
	for start := 0; start < len(photoIDs); start += batchGetChunkSize {
		end := start + batchGetChunkSize
		if end > len(photoIDs) {
			end = len(photoIDs)
		}

		keys := make([]map[string]types.AttributeValue, 0, end-start)
		for _, id := range photoIDs[start:end] {
			keys = append(keys, map[string]types.AttributeValue{
				"id": &types.AttributeValueMemberS{Value: id},
			})
		}

		// Retry loop for UnprocessedKeys (throttling back-pressure).
		pending := map[string]types.KeysAndAttributes{
			s.TableName: {Keys: keys},
		}
		for len(pending) > 0 {
			out, err := s.Client.BatchGetItem(ctx, &dynamodb.BatchGetItemInput{
				RequestItems: pending,
			})
			if err != nil {
				return nil, fmt.Errorf("BatchGetPhotos: BatchGetItem: %w", err)
			}

			for i, item := range out.Responses[s.TableName] {
				var p models.Photo
				if err := attributevalue.UnmarshalMap(item, &p); err != nil {
					return nil, fmt.Errorf("BatchGetPhotos: unmarshal[%d]: %w", i, err)
				}
				photos = append(photos, &p)
			}

			pending = out.UnprocessedKeys
		}
	}

	return photos, nil
}
