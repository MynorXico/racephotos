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

// BibIndexStore abstracts the bib-index fan-out table query.
type BibIndexStore interface {
	GetPhotoIDsByBib(ctx context.Context, eventID, bibNumber string) ([]string, error)
}

// PhotoStore abstracts the photos table batch read.
type PhotoStore interface {
	BatchGetPhotos(ctx context.Context, ids []string) ([]models.Photo, error)
}

// EventStore abstracts the events table single-item read.
type EventStore interface {
	GetEvent(ctx context.Context, id string) (*models.Event, error)
}

// ── DynamoDB client interfaces ────────────────────────────────────────────────

// DynamoBibQuerier wraps the DynamoDB Query method for bib-index lookups.
type DynamoBibQuerier interface {
	Query(ctx context.Context, params *dynamodb.QueryInput, optFns ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
}

// DynamoBatchGetter wraps the DynamoDB BatchGetItem method for photos lookups.
type DynamoBatchGetter interface {
	BatchGetItem(ctx context.Context, params *dynamodb.BatchGetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.BatchGetItemOutput, error)
}

// DynamoItemGetter wraps the DynamoDB GetItem method for event lookups.
type DynamoItemGetter interface {
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// ── DynamoDB implementations ──────────────────────────────────────────────────

// DynamoBibIndexReader implements BibIndexStore using the racephotos-bib-index table.
//
// Access pattern: PK="{eventID}#{bibNumber}" — returns all photoId SK values.
// One item per (event, bib, photo) written by the photo-processor Lambda (RS-007).
type DynamoBibIndexReader struct {
	Client    DynamoBibQuerier
	TableName string
}

// GetPhotoIDsByBib returns all photoId values associated with the given
// eventID + bibNumber pair.  The result may be empty when no photos have been
// tagged with that bib in the event.
func (s *DynamoBibIndexReader) GetPhotoIDsByBib(ctx context.Context, eventID, bibNumber string) ([]string, error) {
	bibKey := eventID + "#" + bibNumber
	var photoIDs []string
	var lastKey map[string]types.AttributeValue

	for {
		input := &dynamodb.QueryInput{
			TableName:              aws.String(s.TableName),
			KeyConditionExpression: aws.String("bibKey = :bk"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":bk": &types.AttributeValueMemberS{Value: bibKey},
			},
		}
		if len(lastKey) > 0 {
			input.ExclusiveStartKey = lastKey
		}

		out, err := s.Client.Query(ctx, input)
		if err != nil {
			return nil, fmt.Errorf("GetPhotoIDsByBib: dynamodb Query: %w", err)
		}
		for _, item := range out.Items {
			av, ok := item["photoId"]
			if !ok {
				continue
			}
			sv, ok := av.(*types.AttributeValueMemberS)
			if !ok || sv.Value == "" {
				continue
			}
			photoIDs = append(photoIDs, sv.Value)
		}
		lastKey = out.LastEvaluatedKey
		if len(lastKey) == 0 {
			break
		}
	}

	return photoIDs, nil
}

// DynamoPhotoBatchGetter implements PhotoStore using DynamoDB BatchGetItem.
//
// BatchGetItem is limited to 100 items per call. For v1 (typically 5–20 photos
// per bib per event) this is never exceeded. Unprocessed keys are logged but
// not retried — the caller receives whatever photos were returned.
type DynamoPhotoBatchGetter struct {
	Client    DynamoBatchGetter
	TableName string
}

// BatchGetPhotos fetches photo records for the given IDs.  IDs not found in
// DynamoDB are silently omitted from the result (caller filters by status).
func (s *DynamoPhotoBatchGetter) BatchGetPhotos(ctx context.Context, ids []string) ([]models.Photo, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	keys := make([]map[string]types.AttributeValue, 0, len(ids))
	for _, id := range ids {
		keys = append(keys, map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		})
	}

	out, err := s.Client.BatchGetItem(ctx, &dynamodb.BatchGetItemInput{
		RequestItems: map[string]types.KeysAndAttributes{
			s.TableName: {Keys: keys},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("BatchGetPhotos: dynamodb BatchGetItem: %w", err)
	}

	items, ok := out.Responses[s.TableName]
	if !ok {
		return nil, nil
	}

	photos := make([]models.Photo, 0, len(items))
	for _, item := range items {
		var p models.Photo
		if err := attributevalue.UnmarshalMap(item, &p); err != nil {
			return nil, fmt.Errorf("BatchGetPhotos: unmarshal: %w", err)
		}
		photos = append(photos, p)
	}
	return photos, nil
}

// DynamoEventGetter implements EventStore using DynamoDB GetItem.
type DynamoEventGetter struct {
	Client    DynamoItemGetter
	TableName string
}

// GetEvent returns the event record for the given id.
// Returns apperrors.ErrNotFound when no item exists.
func (s *DynamoEventGetter) GetEvent(ctx context.Context, id string) (*models.Event, error) {
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.TableName),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("GetEvent: dynamodb GetItem: %w", err)
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

