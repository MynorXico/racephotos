package handler

import (
	"context"
	"errors"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/racephotos/shared/models"
)

// ErrPhotoNotFound is returned when the requested photo does not exist.
var ErrPhotoNotFound = errors.New("photo not found")

// ErrEventNotFound is returned when the photo's event does not exist.
var ErrEventNotFound = errors.New("event not found")

// PhotoStore abstracts DynamoDB operations on the racephotos-photos table.
type PhotoStore interface {
	GetPhoto(ctx context.Context, id string) (*models.Photo, error)
	UpdatePhotoBibs(ctx context.Context, id string, bibNumbers []string, status string) error
}

// BibIndexStore abstracts retag operations on the racephotos-bib-index table.
type BibIndexStore interface {
	DeleteBibEntriesByPhoto(ctx context.Context, photoID string) error
	WriteBibEntries(ctx context.Context, entries []models.BibEntry) error
}

// EventStore abstracts the ownership lookup on the racephotos-events table.
type EventStore interface {
	GetEvent(ctx context.Context, id string) (*models.Event, error)
}

// DynamoClient is the minimal DynamoDB surface needed by this package.
type DynamoClient interface {
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	UpdateItem(ctx context.Context, params *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
	Query(ctx context.Context, params *dynamodb.QueryInput, optFns ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
	BatchWriteItem(ctx context.Context, params *dynamodb.BatchWriteItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.BatchWriteItemOutput, error)
}

// ── PhotoStore implementation ─────────────────────────────────────────────────

// DynamoPhotoStore implements PhotoStore against the racephotos-photos table.
type DynamoPhotoStore struct {
	Client    DynamoClient
	TableName string
}

// GetPhoto retrieves a photo by ID. Returns ErrPhotoNotFound if the item does
// not exist. Uses a strongly consistent read so that ownership checks following
// a recent event creation see the latest data.
func (s *DynamoPhotoStore) GetPhoto(ctx context.Context, id string) (*models.Photo, error) {
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      aws.String(s.TableName),
		ConsistentRead: aws.Bool(true),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("GetPhoto: dynamodb.GetItem: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, ErrPhotoNotFound
	}
	var p models.Photo
	if err := attributevalue.UnmarshalMap(out.Item, &p); err != nil {
		return nil, fmt.Errorf("GetPhoto: unmarshal: %w", err)
	}
	return &p, nil
}

// ErrPhotoNotTaggable is returned when the photo's status does not allow manual
// bib tagging (only review_required and error photos may be retagged).
var ErrPhotoNotTaggable = errors.New("photo status does not allow manual tagging")

// UpdatePhotoBibs overwrites the photo's bibNumbers and status in DynamoDB.
// The ConditionExpression ensures the write only succeeds if the photo is still
// in a taggable state (review_required or error), guarding against concurrent
// retag requests clobbering each other: if two requests race, the second write
// will fail with ConditionalCheckFailedException → ErrPhotoNotTaggable → 409.
func (s *DynamoPhotoStore) UpdatePhotoBibs(ctx context.Context, id string, bibNumbers []string, status string) error {
	bibsAV, err := attributevalue.Marshal(bibNumbers)
	if err != nil {
		return fmt.Errorf("UpdatePhotoBibs: marshal bibNumbers: %w", err)
	}
	_, err = s.Client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(s.TableName),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
		UpdateExpression:    aws.String("SET bibNumbers = :bibs, #st = :status"),
		ConditionExpression: aws.String("#st = :sr OR #st = :err"),
		ExpressionAttributeNames: map[string]string{
			"#st": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":bibs":   bibsAV,
			":status": &types.AttributeValueMemberS{Value: status},
			":sr":     &types.AttributeValueMemberS{Value: models.PhotoStatusReviewRequired},
			":err":    &types.AttributeValueMemberS{Value: models.PhotoStatusError},
		},
	})
	if err != nil {
		var condFailed *types.ConditionalCheckFailedException
		if errors.As(err, &condFailed) {
			return ErrPhotoNotTaggable
		}
		return fmt.Errorf("UpdatePhotoBibs: dynamodb.UpdateItem: %w", err)
	}
	return nil
}

// ── BibIndexStore implementation ──────────────────────────────────────────────

// DynamoBibIndexStore implements BibIndexStore against the racephotos-bib-index table.
type DynamoBibIndexStore struct {
	Client    DynamoClient
	TableName string
}

const bibIndexGSIName = "photoId-index"

// maxBatchSize is the DynamoDB BatchWriteItem limit per call.
const maxBatchSize = 25

// DeleteBibEntriesByPhoto queries the photoId-index GSI for all bib entries
// belonging to photoID and batch-deletes them. No-ops if there are none.
// Paginates via LastEvaluatedKey to handle photos with more than one GSI result
// page (unlikely at current bib counts, but required for correctness).
func (s *DynamoBibIndexStore) DeleteBibEntriesByPhoto(ctx context.Context, photoID string) error {
	queryInput := &dynamodb.QueryInput{
		TableName:              aws.String(s.TableName),
		IndexName:              aws.String(bibIndexGSIName),
		KeyConditionExpression: aws.String("photoId = :pid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pid": &types.AttributeValueMemberS{Value: photoID},
		},
		ProjectionExpression: aws.String("bibKey, photoId"),
	}

	var reqs []types.WriteRequest
	for {
		out, err := s.Client.Query(ctx, queryInput)
		if err != nil {
			return fmt.Errorf("DeleteBibEntriesByPhoto: query: %w", err)
		}
		for _, item := range out.Items {
			reqs = append(reqs, types.WriteRequest{
				DeleteRequest: &types.DeleteRequest{
					Key: map[string]types.AttributeValue{
						"bibKey":  item["bibKey"],
						"photoId": item["photoId"],
					},
				},
			})
		}
		if len(out.LastEvaluatedKey) == 0 {
			break
		}
		queryInput.ExclusiveStartKey = out.LastEvaluatedKey
	}

	for i := 0; i < len(reqs); i += maxBatchSize {
		end := i + maxBatchSize
		if end > len(reqs) {
			end = len(reqs)
		}
		if err := batchWriteWithRetry(ctx, s.Client, s.TableName, reqs[i:end]); err != nil {
			return fmt.Errorf("DeleteBibEntriesByPhoto: batch delete: %w", err)
		}
	}
	return nil
}

// WriteBibEntries batch-puts BibEntry items into the bib-index table.
func (s *DynamoBibIndexStore) WriteBibEntries(ctx context.Context, entries []models.BibEntry) error {
	if len(entries) == 0 {
		return nil
	}
	for i := 0; i < len(entries); i += maxBatchSize {
		end := i + maxBatchSize
		if end > len(entries) {
			end = len(entries)
		}
		var reqs []types.WriteRequest
		for _, e := range entries[i:end] {
			item, err := attributevalue.MarshalMap(e)
			if err != nil {
				return fmt.Errorf("WriteBibEntries: marshal: %w", err)
			}
			reqs = append(reqs, types.WriteRequest{
				PutRequest: &types.PutRequest{Item: item},
			})
		}
		if err := batchWriteWithRetry(ctx, s.Client, s.TableName, reqs); err != nil {
			return fmt.Errorf("WriteBibEntries: batch write: %w", err)
		}
	}
	return nil
}

// batchWriteWithRetry calls BatchWriteItem and retries UnprocessedItems until
// all items are processed or the context is cancelled. DynamoDB may return
// HTTP 200 with a non-empty UnprocessedItems map under throughput pressure —
// treating that as success would silently drop writes (domain rule 12 violation).
func batchWriteWithRetry(ctx context.Context, client DynamoClient, tableName string, reqs []types.WriteRequest) error {
	remaining := map[string][]types.WriteRequest{tableName: reqs}
	for len(remaining) > 0 {
		out, err := client.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
			RequestItems: remaining,
		})
		if err != nil {
			return fmt.Errorf("BatchWriteItem: %w", err)
		}
		remaining = out.UnprocessedItems
	}
	return nil
}

// ── EventStore implementation ─────────────────────────────────────────────────

// DynamoEventStore implements EventStore against the racephotos-events table.
type DynamoEventStore struct {
	Client    DynamoClient
	TableName string
}

// GetEvent retrieves an event by ID. Returns ErrEventNotFound if the item does
// not exist. Uses a strongly consistent read so that ownership checks following
// a recent event creation see the latest data.
func (s *DynamoEventStore) GetEvent(ctx context.Context, id string) (*models.Event, error) {
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      aws.String(s.TableName),
		ConsistentRead: aws.Bool(true),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
		ProjectionExpression: aws.String("id, photographerId"),
	})
	if err != nil {
		return nil, fmt.Errorf("GetEvent: dynamodb.GetItem: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, ErrEventNotFound
	}
	var ev models.Event
	if err := attributevalue.UnmarshalMap(out.Item, &ev); err != nil {
		return nil, fmt.Errorf("GetEvent: unmarshal: %w", err)
	}
	return &ev, nil
}
