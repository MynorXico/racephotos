// Package handler implements POST /orders business logic.
package handler

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

// ── Business-logic interfaces ─────────────────────────────────────────────────

// OrderStore abstracts reads from the racephotos-orders table.
type OrderStore interface {
	GetOrderByID(ctx context.Context, id string) (*models.Order, error)
}

// PurchaseStore abstracts reads from the racephotos-purchases table.
type PurchaseStore interface {
	// GetPurchaseByPhotoAndEmail returns the purchase for the given (photoID, runnerEmail)
	// pair, or nil if no matching record exists.
	GetPurchaseByPhotoAndEmail(ctx context.Context, photoID, runnerEmail string) (*models.Purchase, error)
}

// OrderTransacter atomically writes an Order and all its Purchase line items in
// a single DynamoDB TransactWriteItems call. This guarantees that a persisted
// Order always has its full set of Purchase records — no orphaned Orders on
// mid-loop failure, and correct idempotency on retries.
type OrderTransacter interface {
	CreateOrderWithPurchases(ctx context.Context, order models.Order, purchases []models.Purchase) error
}

// PhotoStore abstracts single-item reads from the racephotos-photos table.
type PhotoStore interface {
	GetPhoto(ctx context.Context, id string) (*models.Photo, error)
}

// EventStore abstracts single-item reads from the racephotos-events table.
type EventStore interface {
	GetEvent(ctx context.Context, id string) (*models.Event, error)
}

// PhotographerStore abstracts single-item reads from the racephotos-photographers table.
type PhotographerStore interface {
	GetPhotographer(ctx context.Context, id string) (*models.Photographer, error)
}

// ── DynamoDB client interfaces ────────────────────────────────────────────────

// DynamoItemGetter wraps the DynamoDB GetItem method for single-item reads.
type DynamoItemGetter interface {
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// DynamoOrderClient wraps DynamoDB methods needed for order reads.
type DynamoOrderClient interface {
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// DynamoPurchaseClient wraps DynamoDB methods needed for purchase reads.
// Includes Query for the photoId-runnerEmail-index GSI idempotency check.
type DynamoPurchaseClient interface {
	Query(ctx context.Context, params *dynamodb.QueryInput, optFns ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// DynamoTransactClient wraps the DynamoDB TransactWriteItems method.
type DynamoTransactClient interface {
	TransactWriteItems(ctx context.Context, params *dynamodb.TransactWriteItemsInput, optFns ...func(*dynamodb.Options)) (*dynamodb.TransactWriteItemsOutput, error)
}

// ── DynamoDB implementations ──────────────────────────────────────────────────

// DynamoOrderStore implements OrderStore using the racephotos-orders table.
type DynamoOrderStore struct {
	Client    DynamoOrderClient
	TableName string
}

// GetOrderByID retrieves an Order by its primary key.
// Returns apperrors.ErrNotFound when no item exists.
func (s *DynamoOrderStore) GetOrderByID(ctx context.Context, id string) (*models.Order, error) {
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.TableName),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("GetOrderByID: GetItem: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, apperrors.ErrNotFound
	}
	var o models.Order
	if err := attributevalue.UnmarshalMap(out.Item, &o); err != nil {
		return nil, fmt.Errorf("GetOrderByID: unmarshal: %w", err)
	}
	return &o, nil
}

// DynamoPurchaseStore implements PurchaseStore using the racephotos-purchases table.
type DynamoPurchaseStore struct {
	Client    DynamoPurchaseClient
	TableName string
}

// GetPurchaseByPhotoAndEmail returns the purchase for the given (photoID, runnerEmail) pair.
// Returns nil (no error) when no matching purchase exists.
//
// Implementation: queries the photoId-runnerEmail-index GSI (KEYS_ONLY projection) to
// resolve the purchase's PK, then fetches the full item from the base table. Two reads
// per lookup; correct because the GSI projection does not include status or orderId.
func (s *DynamoPurchaseStore) GetPurchaseByPhotoAndEmail(ctx context.Context, photoID, runnerEmail string) (*models.Purchase, error) {
	out, err := s.Client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.TableName),
		IndexName:              aws.String("photoId-runnerEmail-index"),
		KeyConditionExpression: aws.String("#pk = :photoId AND #sk = :email"),
		ExpressionAttributeNames: map[string]string{
			"#pk": "photoId",
			"#sk": "runnerEmail",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":photoId": &types.AttributeValueMemberS{Value: photoID},
			":email":   &types.AttributeValueMemberS{Value: runnerEmail},
		},
		Limit: aws.Int32(1),
	})
	if err != nil {
		return nil, fmt.Errorf("GetPurchaseByPhotoAndEmail: Query: %w", err)
	}
	if len(out.Items) == 0 {
		return nil, nil
	}

	// Resolve the purchase ID from the GSI item (KEYS_ONLY — only PK + GSI keys projected).
	idAV, ok := out.Items[0]["id"]
	if !ok {
		return nil, fmt.Errorf("GetPurchaseByPhotoAndEmail: GSI item missing 'id' key")
	}
	idSV, ok := idAV.(*types.AttributeValueMemberS)
	if !ok || idSV.Value == "" {
		return nil, fmt.Errorf("GetPurchaseByPhotoAndEmail: GSI item has non-string 'id'")
	}

	// Fetch the full purchase record from the base table.
	itemOut, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.TableName),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: idSV.Value},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("GetPurchaseByPhotoAndEmail: GetItem: %w", err)
	}
	if len(itemOut.Item) == 0 {
		// Race condition: GSI returned the item but it was deleted from the base table.
		return nil, nil
	}

	var p models.Purchase
	if err := attributevalue.UnmarshalMap(itemOut.Item, &p); err != nil {
		return nil, fmt.Errorf("GetPurchaseByPhotoAndEmail: unmarshal: %w", err)
	}
	return &p, nil
}

// DynamoOrderTransacter implements OrderTransacter using DynamoDB TransactWriteItems.
// It holds references to both the orders and purchases table names because a single
// transaction spans two tables.
type DynamoOrderTransacter struct {
	Client         DynamoTransactClient
	OrdersTable    string
	PurchasesTable string
}

// CreateOrderWithPurchases atomically writes an Order and all its Purchase line
// items in a single TransactWriteItems call. If any write fails the entire
// transaction is rolled back — no orphaned Orders with missing Purchases.
//
// Each item carries attribute_not_exists(id) to guard against silent overwrites
// in the event of a UUID collision or a retry with a reused ID.
//
// DynamoDB TransactWriteItems limit is 25 items. The handler caps photoIds at 20,
// so the maximum transaction size is 1 Order + 20 Purchases = 21 items.
func (s *DynamoOrderTransacter) CreateOrderWithPurchases(ctx context.Context, order models.Order, purchases []models.Purchase) error {
	transactItems := make([]types.TransactWriteItem, 0, 1+len(purchases))

	orderItem, err := attributevalue.MarshalMap(order)
	if err != nil {
		return fmt.Errorf("CreateOrderWithPurchases: marshal order: %w", err)
	}
	transactItems = append(transactItems, types.TransactWriteItem{
		Put: &types.Put{
			TableName:           aws.String(s.OrdersTable),
			Item:                orderItem,
			ConditionExpression: aws.String("attribute_not_exists(id)"),
		},
	})

	for i, p := range purchases {
		purchaseItem, err := attributevalue.MarshalMap(p)
		if err != nil {
			return fmt.Errorf("CreateOrderWithPurchases: marshal purchase[%d]: %w", i, err)
		}
		transactItems = append(transactItems, types.TransactWriteItem{
			Put: &types.Put{
				TableName:           aws.String(s.PurchasesTable),
				Item:                purchaseItem,
				ConditionExpression: aws.String("attribute_not_exists(id)"),
			},
		})
	}

	_, err = s.Client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: transactItems,
	})
	if err != nil {
		return fmt.Errorf("CreateOrderWithPurchases: TransactWriteItems: %w", err)
	}
	return nil
}

// DynamoPhotoStore implements PhotoStore using the racephotos-photos table.
type DynamoPhotoStore struct {
	Client    DynamoItemGetter
	TableName string
}

// GetPhoto retrieves a Photo by its primary key.
// Returns apperrors.ErrNotFound when no item exists.
func (s *DynamoPhotoStore) GetPhoto(ctx context.Context, id string) (*models.Photo, error) {
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.TableName),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("GetPhoto: GetItem: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, apperrors.ErrNotFound
	}
	var p models.Photo
	if err := attributevalue.UnmarshalMap(out.Item, &p); err != nil {
		return nil, fmt.Errorf("GetPhoto: unmarshal: %w", err)
	}
	return &p, nil
}

// DynamoEventStore implements EventStore using the racephotos-events table.
type DynamoEventStore struct {
	Client    DynamoItemGetter
	TableName string
}

// GetEvent retrieves an Event by its primary key.
// Returns apperrors.ErrNotFound when no item exists.
func (s *DynamoEventStore) GetEvent(ctx context.Context, id string) (*models.Event, error) {
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.TableName),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("GetEvent: GetItem: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, apperrors.ErrNotFound
	}
	var ev models.Event
	if err := attributevalue.UnmarshalMap(out.Item, &ev); err != nil {
		return nil, fmt.Errorf("GetEvent: unmarshal: %w", err)
	}
	return &ev, nil
}

// DynamoPhotographerStore implements PhotographerStore using the racephotos-photographers table.
type DynamoPhotographerStore struct {
	Client    DynamoItemGetter
	TableName string
}

// GetPhotographer retrieves a Photographer by its primary key.
// Returns apperrors.ErrNotFound when no item exists.
func (s *DynamoPhotographerStore) GetPhotographer(ctx context.Context, id string) (*models.Photographer, error) {
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.TableName),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("GetPhotographer: GetItem: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, apperrors.ErrNotFound
	}
	var ph models.Photographer
	if err := attributevalue.UnmarshalMap(out.Item, &ph); err != nil {
		return nil, fmt.Errorf("GetPhotographer: unmarshal: %w", err)
	}
	return &ph, nil
}
