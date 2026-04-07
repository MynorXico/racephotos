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

// DynamoGetter is the minimal DynamoDB API surface used by DynamoStore.
type DynamoGetter interface {
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// DynamoStore implements PhotographerGetter using DynamoDB.
type DynamoStore struct {
	Client    DynamoGetter
	TableName string
}

// GetPhotographer retrieves the photographer profile by Cognito sub (ID).
// Returns apperrors.ErrNotFound if no record exists.
func (s *DynamoStore) GetPhotographer(ctx context.Context, id string) (*models.Photographer, error) {
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
