package handler

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

// DynamoArchiver is the minimal DynamoDB API surface used by DynamoEventArchiver.
type DynamoArchiver interface {
	UpdateItem(ctx context.Context, params *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// DynamoEventArchiver implements EventArchiver using DynamoDB.
type DynamoEventArchiver struct {
	Client    DynamoArchiver
	TableName string
}

// ArchiveEvent sets status="archived" and archivedAt=now on the event in a single
// conditional UpdateItem. If the event is already archived it re-reads the current
// item and returns it unchanged (no-op, 200). Ownership and existence are enforced
// atomically by the condition expression — no upfront GetItem round-trip.
//
// Returns apperrors.ErrForbidden if the caller does not own the event.
// Returns apperrors.ErrNotFound if the item does not exist.
func (s *DynamoEventArchiver) ArchiveEvent(ctx context.Context, id, callerID string) (*models.Event, error) {
	key, err := attributevalue.MarshalMap(map[string]string{"id": id})
	if err != nil {
		return nil, fmt.Errorf("ArchiveEvent: marshal key: %w", err)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	out, err := s.Client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(s.TableName),
		Key:       key,
		UpdateExpression: aws.String(
			"SET #status = :archived, archivedAt = :now, updatedAt = :now",
		),
		// attribute_exists(id) distinguishes not-found from forbidden.
		// #status = :active guards against re-archiving an already archived event
		// (the no-op path is handled after ConditionalCheckFailedException below).
		ConditionExpression: aws.String(
			"attribute_exists(id) AND photographerId = :callerId AND #status = :active",
		),
		ExpressionAttributeNames: map[string]string{
			"#status": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":archived": &types.AttributeValueMemberS{Value: "archived"},
			":active":   &types.AttributeValueMemberS{Value: "active"},
			":now":      &types.AttributeValueMemberS{Value: now},
			":callerId": &types.AttributeValueMemberS{Value: callerID},
		},
		ReturnValues: types.ReturnValueAllNew,
	})
	if err != nil {
		var ccfe *types.ConditionalCheckFailedException
		if errors.As(err, &ccfe) {
			// Condition failed — distinguish the three cases by re-reading the item
			// with a consistent GetItem. This is the error path only (not hot path).
			return s.resolveConditionFailure(ctx, id, callerID, key)
		}
		return nil, fmt.Errorf("ArchiveEvent: dynamodb.UpdateItem: %w", err)
	}

	var archived models.Event
	if err := attributevalue.UnmarshalMap(out.Attributes, &archived); err != nil {
		return nil, fmt.Errorf("ArchiveEvent: unmarshal result: %w", err)
	}
	return &archived, nil
}

// resolveConditionFailure is called only when UpdateItem's condition expression fails.
// It re-reads the item with consistent read to determine whether the failure was due
// to: (a) item not existing → ErrNotFound, (b) wrong owner → ErrForbidden,
// (c) event already archived → return the existing item (no-op success).
func (s *DynamoEventArchiver) resolveConditionFailure(
	ctx context.Context,
	id, callerID string,
	key map[string]types.AttributeValue,
) (*models.Event, error) {
	getOut, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:            aws.String(s.TableName),
		Key:                  key,
		ConsistentRead:       aws.Bool(true),
		ProjectionExpression: aws.String("id, photographerId, #status, archivedAt, createdAt, updatedAt, #name, #date, #location, pricePerPhoto, currency, watermarkText, visibility"),
		ExpressionAttributeNames: map[string]string{
			"#status":   "status",
			"#name":     "name",
			"#date":     "date",
			"#location": "location",
		},
	})
	if err != nil {
		return nil, fmt.Errorf("ArchiveEvent: resolveConditionFailure GetItem: %w", err)
	}
	if len(getOut.Item) == 0 {
		return nil, apperrors.ErrNotFound
	}

	var existing models.Event
	if err := attributevalue.UnmarshalMap(getOut.Item, &existing); err != nil {
		return nil, fmt.Errorf("ArchiveEvent: resolveConditionFailure unmarshal: %w", err)
	}

	if existing.PhotographerID != callerID {
		return nil, apperrors.ErrForbidden
	}

	// Event exists, caller owns it, condition failed because status is already
	// "archived" — return the true current state (not a fabricated struct).
	return &existing, nil
}
