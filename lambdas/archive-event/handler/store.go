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
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	UpdateItem(ctx context.Context, params *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
}

// DynamoEventArchiver implements EventArchiver using DynamoDB.
type DynamoEventArchiver struct {
	Client    DynamoArchiver
	TableName string
}

// ArchiveEvent sets status="archived" and archivedAt=now on the event.
// If the event is already archived it returns the current item unchanged (no-op, 200).
// Returns apperrors.ErrForbidden if the caller does not own the event.
// Returns apperrors.ErrNotFound if the item does not exist.
func (s *DynamoEventArchiver) ArchiveEvent(ctx context.Context, id, callerID string) (*models.Event, error) {
	// Check current state first.
	key, err := attributevalue.MarshalMap(map[string]string{"id": id})
	if err != nil {
		return nil, fmt.Errorf("ArchiveEvent: marshal key: %w", err)
	}
	getOut, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      aws.String(s.TableName),
		Key:            key,
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("ArchiveEvent: dynamodb.GetItem: %w", err)
	}
	if len(getOut.Item) == 0 {
		return nil, apperrors.ErrNotFound
	}

	var existing models.Event
	if err := attributevalue.UnmarshalMap(getOut.Item, &existing); err != nil {
		return nil, fmt.Errorf("ArchiveEvent: unmarshal existing: %w", err)
	}

	// Ownership check.
	if existing.PhotographerID != callerID {
		return nil, apperrors.ErrForbidden
	}

	// No-op if already archived.
	if existing.Status == "archived" {
		return &existing, nil
	}

	now := time.Now().UTC().Format(time.RFC3339)
	updateOut, err := s.Client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(s.TableName),
		Key:       key,
		UpdateExpression: aws.String(
			"SET #status = :archived, archivedAt = :now, updatedAt = :now",
		),
		ConditionExpression: aws.String("photographerId = :callerId AND #status = :active"),
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
			// Condition failed — could be another concurrent archive; treat as success.
			existing.Status = "archived"
			existing.ArchivedAt = now
			return &existing, nil
		}
		return nil, fmt.Errorf("ArchiveEvent: dynamodb.UpdateItem: %w", err)
	}

	var archived models.Event
	if err := attributevalue.UnmarshalMap(updateOut.Attributes, &archived); err != nil {
		return nil, fmt.Errorf("ArchiveEvent: unmarshal result: %w", err)
	}
	return &archived, nil
}
