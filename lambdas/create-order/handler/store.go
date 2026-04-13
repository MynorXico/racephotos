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

// OrderStore abstracts reads and writes to the racephotos-orders table.
type OrderStore interface {
	CreateOrder(ctx context.Context, o models.Order) error
	GetOrderByID(ctx context.Context, id string) (*models.Order, error)
}

// PurchaseStore abstracts reads and writes to the racephotos-purchases table.
type PurchaseStore interface {
	CreatePurchase(ctx context.Context, p models.Purchase) error
	// GetPurchaseByPhotoAndEmail returns the purchase for the given (photoID, runnerEmail)
	// pair, or nil if no matching record exists.
	GetPurchaseByPhotoAndEmail(ctx context.Context, photoID, runnerEmail string) (*models.Purchase, error)
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

// DynamoOrderClient wraps DynamoDB methods needed for order storage.
type DynamoOrderClient interface {
	PutItem(ctx context.Context, params *dynamodb.PutItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// DynamoPurchaseClient wraps DynamoDB methods needed for purchase storage.
// Includes Query for the photoId-runnerEmail-index GSI idempotency check.
type DynamoPurchaseClient interface {
	PutItem(ctx context.Context, params *dynamodb.PutItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
	Query(ctx context.Context, params *dynamodb.QueryInput, optFns ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// ── DynamoDB implementations ──────────────────────────────────────────────────

// DynamoOrderStore implements OrderStore using the racephotos-orders table.
type DynamoOrderStore struct {
	Client    DynamoOrderClient
	TableName string
}

// CreateOrder writes an Order record to DynamoDB. Uses PutItem (no condition expression)
// so the handler is responsible for idempotency before calling this method.
func (s *DynamoOrderStore) CreateOrder(ctx context.Context, o models.Order) error {
	item, err := attributevalue.MarshalMap(o)
	if err != nil {
		return fmt.Errorf("CreateOrder: marshal: %w", err)
	}
	_, err = s.Client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.TableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("CreateOrder: PutItem: %w", err)
	}
	return nil
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

// CreatePurchase writes a Purchase record to DynamoDB.
func (s *DynamoPurchaseStore) CreatePurchase(ctx context.Context, p models.Purchase) error {
	item, err := attributevalue.MarshalMap(p)
	if err != nil {
		return fmt.Errorf("CreatePurchase: marshal: %w", err)
	}
	_, err = s.Client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.TableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("CreatePurchase: PutItem: %w", err)
	}
	return nil
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
