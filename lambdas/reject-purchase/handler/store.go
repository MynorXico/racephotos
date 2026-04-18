// Package handler implements PUT /purchases/{id}/reject business logic.
package handler

import (
	"context"
	"errors"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

// ── Business-logic interfaces ─────────────────────────────────────────────────

// PurchaseStore abstracts reads and writes on the racephotos-purchases table.
type PurchaseStore interface {
	GetPurchase(ctx context.Context, id string) (*models.Purchase, error)
	QueryPurchasesByOrder(ctx context.Context, orderID string) ([]*models.Purchase, error)
	UpdatePurchaseRejected(ctx context.Context, id string) error
}

// OrderStore abstracts reads and writes on the racephotos-orders table.
type OrderStore interface {
	GetOrder(ctx context.Context, id string) (*models.Order, error)
	UpdateOrderStatus(ctx context.Context, id, status, updatedAt string) error
}

// ── DynamoDB client interfaces ────────────────────────────────────────────────

// DynamoPurchaseClient wraps DynamoDB methods used by DynamoPurchaseStore.
type DynamoPurchaseClient interface {
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	Query(ctx context.Context, params *dynamodb.QueryInput, optFns ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
	UpdateItem(ctx context.Context, params *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
}

// DynamoOrderClient wraps DynamoDB methods used by DynamoOrderStore.
type DynamoOrderClient interface {
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	UpdateItem(ctx context.Context, params *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
}

// ── DynamoDB implementations ──────────────────────────────────────────────────

// DynamoPurchaseStore implements PurchaseStore.
type DynamoPurchaseStore struct {
	Client    DynamoPurchaseClient
	TableName string
}

func (s *DynamoPurchaseStore) GetPurchase(ctx context.Context, id string) (*models.Purchase, error) {
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.TableName),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("GetPurchase: GetItem: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, apperrors.ErrNotFound
	}
	var p models.Purchase
	if err := attributevalue.UnmarshalMap(out.Item, &p); err != nil {
		return nil, fmt.Errorf("GetPurchase: unmarshal: %w", err)
	}
	return &p, nil
}

// QueryPurchasesByOrder returns all Purchase line items for the given orderId.
// Paginates through all DynamoDB pages to ensure the order-status rollup sees
// every purchase, even for orders with large numbers of line items.
func (s *DynamoPurchaseStore) QueryPurchasesByOrder(ctx context.Context, orderID string) ([]*models.Purchase, error) {
	var purchases []*models.Purchase
	var lastKey map[string]types.AttributeValue

	for {
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
			ExclusiveStartKey: lastKey,
		})
		if err != nil {
			return nil, fmt.Errorf("QueryPurchasesByOrder: Query: %w", err)
		}
		for i, item := range out.Items {
			var p models.Purchase
			if err := attributevalue.UnmarshalMap(item, &p); err != nil {
				return nil, fmt.Errorf("QueryPurchasesByOrder: unmarshal[%d]: %w", i, err)
			}
			purchases = append(purchases, &p)
		}
		if len(out.LastEvaluatedKey) == 0 {
			break
		}
		lastKey = out.LastEvaluatedKey
	}
	return purchases, nil
}

// UpdatePurchaseRejected atomically sets status=rejected only when the current
// status is pending. Returns apperrors.ErrConflict if the DynamoDB condition
// fails (concurrent approve or reject already landed).
func (s *DynamoPurchaseStore) UpdatePurchaseRejected(ctx context.Context, id string) error {
	_, err := s.Client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(s.TableName),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
		ConditionExpression:      aws.String("#status = :pending"),
		UpdateExpression:         aws.String("SET #status = :rejected"),
		ExpressionAttributeNames: map[string]string{
			"#status": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":rejected": &types.AttributeValueMemberS{Value: models.OrderStatusRejected},
			":pending":  &types.AttributeValueMemberS{Value: models.OrderStatusPending},
		},
	})
	if err != nil {
		var ccf *types.ConditionalCheckFailedException
		if errors.As(err, &ccf) {
			return apperrors.ErrConflict
		}
		return fmt.Errorf("UpdatePurchaseRejected: UpdateItem: %w", err)
	}
	return nil
}

// DynamoOrderStore implements OrderStore.
type DynamoOrderStore struct {
	Client    DynamoOrderClient
	TableName string
}

func (s *DynamoOrderStore) GetOrder(ctx context.Context, id string) (*models.Order, error) {
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.TableName),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("GetOrder: GetItem: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, apperrors.ErrNotFound
	}
	var o models.Order
	if err := attributevalue.UnmarshalMap(out.Item, &o); err != nil {
		return nil, fmt.Errorf("GetOrder: unmarshal: %w", err)
	}
	return &o, nil
}

func (s *DynamoOrderStore) UpdateOrderStatus(ctx context.Context, id, status, updatedAt string) error {
	expr := "SET #status = :status"
	exprVals := map[string]types.AttributeValue{
		":status": &types.AttributeValueMemberS{Value: status},
	}
	exprNames := map[string]string{"#status": "status"}

	var conditionExpr *string
	// When the derived status is approved (e.g. rejecting the last pending purchase
	// while all siblings are already approved), also write approvedAt so the Order
	// record is consistent with the approve-purchase code path.
	// if_not_exists preserves the original approvedAt; retries must not overwrite it.
	if status == models.OrderStatusApproved {
		expr += ", #approvedAt = if_not_exists(#approvedAt, :approvedAt)"
		exprVals[":approvedAt"] = &types.AttributeValueMemberS{Value: updatedAt}
		exprNames["#approvedAt"] = "approvedAt"
	} else if status == models.OrderStatusPending {
		// Guard against a stale "pending" rollup overwriting a terminal state written by a
		// concurrent Lambda that processed the last purchase in this order simultaneously.
		// ConditionalCheckFailedException here means the terminal state is already correct.
		conditionExpr = aws.String("attribute_not_exists(#status) OR #status = :pending")
		exprVals[":pending"] = &types.AttributeValueMemberS{Value: models.OrderStatusPending}
	}

	_, err := s.Client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(s.TableName),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
		UpdateExpression:          aws.String(expr),
		ConditionExpression:       conditionExpr,
		ExpressionAttributeNames:  exprNames,
		ExpressionAttributeValues: exprVals,
	})
	if err != nil {
		var ccf *types.ConditionalCheckFailedException
		if errors.As(err, &ccf) {
			// Another Lambda already set the order to a terminal state; nothing to do.
			return nil
		}
		return fmt.Errorf("UpdateOrderStatus: UpdateItem: %w", err)
	}
	return nil
}
