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

// DynamoAPI is the minimal DynamoDB API surface used by the event stores.
type DynamoAPI interface {
	PutItem(ctx context.Context, params *dynamodb.PutItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// DynamoEventCreator implements EventCreator using DynamoDB PutItem.
type DynamoEventCreator struct {
	Client    DynamoAPI
	TableName string
}

// CreateEvent writes the event to DynamoDB.
func (s *DynamoEventCreator) CreateEvent(ctx context.Context, e models.Event) error {
	item, err := attributevalue.MarshalMap(e)
	if err != nil {
		return fmt.Errorf("CreateEvent: marshal: %w", err)
	}
	if _, err := s.Client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.TableName),
		Item:      item,
	}); err != nil {
		return fmt.Errorf("CreateEvent: dynamodb.PutItem: %w", err)
	}
	return nil
}

// DynamoPhotographerReader implements PhotographerReader using DynamoDB GetItem.
type DynamoPhotographerReader struct {
	Client    DynamoAPI
	TableName string
}

// GetPhotographer retrieves the photographer profile by ID.
// Returns apperrors.ErrNotFound if no record exists.
func (s *DynamoPhotographerReader) GetPhotographer(ctx context.Context, id string) (*models.Photographer, error) {
	key, err := attributevalue.MarshalMap(map[string]string{"id": id})
	if err != nil {
		return nil, fmt.Errorf("GetPhotographer: marshal key: %w", err)
	}
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      aws.String(s.TableName),
		Key:            key,
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("GetPhotographer: dynamodb.GetItem: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, apperrors.ErrNotFound
	}
	var p models.Photographer
	if err := attributevalue.UnmarshalMap(out.Item, &p); err != nil {
		return nil, fmt.Errorf("GetPhotographer: unmarshal: %w", err)
	}
	return &p, nil
}
