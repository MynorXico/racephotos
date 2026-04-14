package handler

import (
	"context"
	"fmt"
	"sync"

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
// (the DynamoDB BatchWriteItem limit) and writes all chunks concurrently to
// minimise latency on max-batch requests.
// Unprocessed items returned by DynamoDB are retried once per chunk.
func (s *DynamoPhotoStore) BatchCreatePhotos(ctx context.Context, photos []models.Photo) error {
	var chunks [][]models.Photo
	for i := 0; i < len(photos); i += dynamoBatchSize {
		end := i + dynamoBatchSize
		if end > len(photos) {
			end = len(photos)
		}
		chunks = append(chunks, photos[i:end])
	}

	// Write all chunks concurrently; collect the first error encountered.
	var (
		mu       sync.Mutex
		firstErr error
		wg       sync.WaitGroup
	)
	for _, chunk := range chunks {
		wg.Add(1)
		go func(c []models.Photo) {
			defer wg.Done()
			if err := s.writeChunk(ctx, c); err != nil {
				mu.Lock()
				if firstErr == nil {
					firstErr = err
				}
				mu.Unlock()
			}
		}(chunk)
	}
	wg.Wait()
	return firstErr
}

// writeChunk performs a single BatchWriteItem call for up to 25 items, retrying
// unprocessed items once and returning an error if any remain after the retry.
func (s *DynamoPhotoStore) writeChunk(ctx context.Context, chunk []models.Photo) error {
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
		retryOut, err := s.Client.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
			RequestItems: out.UnprocessedItems,
		})
		if err != nil {
			return fmt.Errorf("BatchCreatePhotos: retry unprocessed items: %w", err)
		}
		if len(retryOut.UnprocessedItems) > 0 {
			return fmt.Errorf("BatchCreatePhotos: %d items still unprocessed after retry", countUnprocessed(retryOut.UnprocessedItems))
		}
	}
	return nil
}

// countUnprocessed sums the total number of unprocessed WriteRequests across all tables.
func countUnprocessed(items map[string][]types.WriteRequest) int {
	n := 0
	for _, reqs := range items {
		n += len(reqs)
	}
	return n
}

// DynamoEventReader implements EventReader using DynamoDB GetItem.
type DynamoEventReader struct {
	Client    DynamoAPI
	TableName string
}

// GetEvent retrieves an event by ID.
// Uses consistent read (required for an authorization-gate path) and projects
// only the photographerId attribute to minimise read cost and payload size.
// Returns apperrors.ErrNotFound if no record exists.
func (s *DynamoEventReader) GetEvent(ctx context.Context, id string) (*models.Event, error) {
	key, err := attributevalue.MarshalMap(map[string]string{"id": id})
	if err != nil {
		return nil, fmt.Errorf("GetEvent: marshal key: %w", err)
	}
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:            aws.String(s.TableName),
		Key:                  key,
		ConsistentRead:       aws.Bool(true),
		ProjectionExpression: aws.String("photographerId"),
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
