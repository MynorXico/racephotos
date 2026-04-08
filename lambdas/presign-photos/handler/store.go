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

const dynamoBatchSize = 25

// DynamoAPI is the minimal DynamoDB API surface used by the stores.
type DynamoAPI interface {
	BatchWriteItem(ctx context.Context, params *dynamodb.BatchWriteItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.BatchWriteItemOutput, error)
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// DynamoPhotoStore implements PhotoStore using DynamoDB BatchWriteItem.
type DynamoPhotoStore struct {
	Client    DynamoAPI
	TableName string
}

// BatchCreatePhotos writes up to 100 Photo records. It chunks into groups of 25
// (the DynamoDB BatchWriteItem limit) and processes them sequentially.
// Unprocessed items returned by DynamoDB are retried once.
func (s *DynamoPhotoStore) BatchCreatePhotos(ctx context.Context, photos []models.Photo) error {
	for i := 0; i < len(photos); i += dynamoBatchSize {
		end := i + dynamoBatchSize
		if end > len(photos) {
			end = len(photos)
		}
		chunk := photos[i:end]

		requests := make([]types.WriteRequest, len(chunk))
		for j, p := range chunk {
			item, err := attributevalue.MarshalMap(p)
			if err != nil {
				return fmt.Errorf("BatchCreatePhotos: marshal photo %s: %w", p.ID, err)
			}
			requests[j] = types.WriteRequest{
				PutRequest: &types.PutRequest{Item: item},
			}
		}

		out, err := s.Client.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
			RequestItems: map[string][]types.WriteRequest{
				s.TableName: requests,
			},
		})
		if err != nil {
			return fmt.Errorf("BatchCreatePhotos: dynamodb.BatchWriteItem: %w", err)
		}

		// Retry unprocessed items once (handles transient throttling).
		if len(out.UnprocessedItems) > 0 {
			if _, err := s.Client.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
				RequestItems: out.UnprocessedItems,
			}); err != nil {
				return fmt.Errorf("BatchCreatePhotos: retry unprocessed items: %w", err)
			}
		}
	}
	return nil
}

// DynamoEventReader implements EventReader using DynamoDB GetItem.
type DynamoEventReader struct {
	Client    DynamoAPI
	TableName string
}

// GetEvent retrieves an event by ID.
// Returns apperrors.ErrNotFound if no record exists.
func (s *DynamoEventReader) GetEvent(ctx context.Context, id string) (*models.Event, error) {
	key, err := attributevalue.MarshalMap(map[string]string{"id": id})
	if err != nil {
		return nil, fmt.Errorf("GetEvent: marshal key: %w", err)
	}
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.TableName),
		Key:       key,
	})
	if err != nil {
		return nil, fmt.Errorf("GetEvent: dynamodb.GetItem: %w", err)
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
