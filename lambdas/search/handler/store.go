package handler

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

// batchGetItemMax is the DynamoDB API hard limit for BatchGetItem key count.
const batchGetItemMax = 100

// bibIndexQueryPageLimit is the maximum number of items fetched per Query page
// on the bib-index table.  Kept well below the 1 MB page limit for predictable
// latency on the hot path.
const bibIndexQueryPageLimit = 500

// bibIndexMaxResults is the total cap on photo IDs returned for a single
// bib+event lookup.  Typical v1 race events produce 5–20 photos per bib;
// 500 is a generous safety limit for pathological data or adversarial input on
// this public endpoint.  A warning is logged when the cap is reached.
const bibIndexMaxResults = 500

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
// Access pattern: PK="{eventID}#{bibNumber}" — returns only the photoId SK attribute.
// One item per (event, bib, photo) written by the photo-processor Lambda (RS-007).
type DynamoBibIndexReader struct {
	Client    DynamoBibQuerier
	TableName string
}

// GetPhotoIDsByBib returns all photoId values associated with the given
// eventID + bibNumber pair.  The result may be empty when no photos have been
// tagged with that bib in the event.
//
// At most bibIndexMaxResults IDs are returned.  A warning is logged when the cap
// is reached so that unusually large result sets can be investigated; the caller
// receives a truncated but usable list.  Each Query page is capped at
// bibIndexQueryPageLimit items for predictable per-page latency.
func (s *DynamoBibIndexReader) GetPhotoIDsByBib(ctx context.Context, eventID, bibNumber string) ([]string, error) {
	bibKey := eventID + "#" + bibNumber
	var photoIDs []string
	var lastKey map[string]types.AttributeValue

	for {
		// KeyConditionExpression uses:
		//   - #bk as a name alias for the "bibKey" attribute — ensures the
		//     expression remains valid even if the attribute is renamed to a
		//     DynamoDB reserved word in the future, and satisfies the project
		//     convention of aliasing all attribute names in expressions.
		//   - :bk as a value placeholder — the user-supplied composite value is
		//     placed exclusively in ExpressionAttributeValues, never concatenated
		//     into the expression string. No injection risk.
		// ProjectionExpression returns only photoId to minimise RCU consumption.
		input := &dynamodb.QueryInput{
			TableName:              aws.String(s.TableName),
			KeyConditionExpression: aws.String("#bk = :bk"),
			ExpressionAttributeNames: map[string]string{
				"#bk": "bibKey",
			},
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":bk": &types.AttributeValueMemberS{Value: bibKey},
			},
			ProjectionExpression: aws.String("photoId"),
			Limit:                aws.Int32(bibIndexQueryPageLimit),
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
			if len(photoIDs) >= bibIndexMaxResults {
				slog.WarnContext(ctx, "GetPhotoIDsByBib: result cap reached; truncating",
					"eventID", eventID,
					"cap", bibIndexMaxResults,
				)
				return photoIDs, nil
			}
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
// Requests are chunked into slices of batchGetItemMax (100) to respect the
// DynamoDB API hard limit. UnprocessedKeys from DynamoDB throttling are retried
// up to 3 times before returning an error — partial results are never silently
// returned to the caller.
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

	var allPhotos []models.Photo

	// Chunk ids into batches of at most batchGetItemMax to respect the API limit.
	for i := 0; i < len(ids); i += batchGetItemMax {
		end := i + batchGetItemMax
		if end > len(ids) {
			end = len(ids)
		}
		chunk := ids[i:end]

		photos, err := s.batchGetChunk(ctx, chunk)
		if err != nil {
			return nil, err
		}
		allPhotos = append(allPhotos, photos...)
	}

	return allPhotos, nil
}

// batchGetChunk fetches a single batch of at most batchGetItemMax photo IDs,
// retrying UnprocessedKeys up to 3 times.
func (s *DynamoPhotoBatchGetter) batchGetChunk(ctx context.Context, ids []string) ([]models.Photo, error) {
	remaining := make([]map[string]types.AttributeValue, 0, len(ids))
	for _, id := range ids {
		remaining = append(remaining, map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		})
	}

	var photos []models.Photo
	const maxRetries = 3

	for attempt := 0; attempt <= maxRetries; attempt++ {
		out, err := s.Client.BatchGetItem(ctx, &dynamodb.BatchGetItemInput{
			RequestItems: map[string]types.KeysAndAttributes{
				s.TableName: {
					Keys: remaining,
					// Fetch only the four fields consumed by the handler — id, status,
					// watermarkedS3Key, capturedAt.  id and status are reserved words in
					// DynamoDB expression syntax and must be aliased.  Omitting rawS3Key
					// and other large attributes reduces RCU cost and keeps PII off the
					// runner-facing hot path.
					ProjectionExpression: aws.String("#sid, #status, watermarkedS3Key, capturedAt"),
					ExpressionAttributeNames: map[string]string{
						"#sid":    "id",
						"#status": "status",
					},
				},
			},
		})
		if err != nil {
			return nil, fmt.Errorf("BatchGetPhotos: dynamodb BatchGetItem: %w", err)
		}

		if items, ok := out.Responses[s.TableName]; ok {
			for _, item := range items {
				var p models.Photo
				if err := attributevalue.UnmarshalMap(item, &p); err != nil {
					return nil, fmt.Errorf("BatchGetPhotos: unmarshal: %w", err)
				}
				photos = append(photos, p)
			}
		}

		// No unprocessed keys — done.
		unproc, hasUnproc := out.UnprocessedKeys[s.TableName]
		if !hasUnproc || len(unproc.Keys) == 0 {
			break
		}

		remaining = unproc.Keys
		if attempt == maxRetries {
			slog.WarnContext(ctx, "BatchGetPhotos: unprocessed keys remain after max retries",
				"count", len(remaining),
				"table", s.TableName,
			)
			return nil, fmt.Errorf("BatchGetPhotos: %d keys unprocessed after %d retries", len(remaining), maxRetries)
		}
		slog.WarnContext(ctx, "BatchGetPhotos: retrying unprocessed keys",
			"count", len(remaining),
			"attempt", attempt+1,
		)
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
// Uses strongly consistent reads to avoid a stale-read 404 race when an event
// is created and its search URL is shared immediately (e.g. QR code at registration).
func (s *DynamoEventGetter) GetEvent(ctx context.Context, id string) (*models.Event, error) {
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.TableName),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
		ConsistentRead: aws.Bool(true),
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
