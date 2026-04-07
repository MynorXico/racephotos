package handler

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

// DynamoGetter is the minimal DynamoDB API surface used by DynamoEventGetter.
type DynamoGetter interface {
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// DynamoEventGetter implements EventGetter using DynamoDB GetItem.
type DynamoEventGetter struct {
	Client    DynamoGetter
	TableName string
}

// GetEvent retrieves an event by its ID.
// Returns apperrors.ErrNotFound if no record exists.
func (s *DynamoEventGetter) GetEvent(ctx context.Context, id string) (*models.Event, error) {
	key, err := attributevalue.MarshalMap(map[string]string{"id": id})
	if err != nil {
		return nil, fmt.Errorf("GetEvent: marshal key: %w", err)
	}
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      aws.String(s.TableName),
		Key:            key,
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("GetEvent: dynamodb.GetItem: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, apperrors.ErrNotFound
	}
	var e models.Event
	if err := attributevalue.UnmarshalMap(out.Item, &e); err != nil {
		return nil, fmt.Errorf("GetEvent: unmarshal: %w", err)
	}
	return &e, nil
}
