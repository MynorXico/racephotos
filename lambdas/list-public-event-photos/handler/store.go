package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/racephotos/shared/models"
)

const photosGSIName = "eventId-uploadedAt-index"

// DynamoQuerier is the minimal DynamoDB surface needed by this package.
type DynamoQuerier interface {
	Query(ctx context.Context, params *dynamodb.QueryInput, optFns ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// DynamoEventPhotoLister implements EventPhotoLister using the eventId-uploadedAt-index GSI.
// The FilterExpression always constrains results to status = "indexed" — only publicly
// visible watermarked photos are returned. Because DynamoDB applies Limit before
// FilterExpression, the buffer multiplier and fill-to-limit loop are required to
// reliably return the requested number of photos when many items in the GSI partition
// have non-indexed statuses (ADR-0012).
type DynamoEventPhotoLister struct {
	Client    DynamoQuerier
	TableName string
}

// bufferMultiplier is the factor by which the internal DynamoDB page size exceeds limit.
// Set to 3 — events often have a mix of indexed, review_required, and error photos
// sharing the same GSI partition. A 3× buffer reduces round-trips without over-reading.
const bufferMultiplier = 3

// maxIterations caps the number of DynamoDB Query rounds to bound RCU consumption
// for pathological cases (e.g. an event where very few photos are indexed).
const maxIterations = 10

// ListEventPhotos queries indexed photos for an event sorted by uploadedAt DESC.
// cursor is a base64-encoded JSON representation of the DynamoDB LastEvaluatedKey.
// Returns (photos, nextCursor, error); nextCursor is empty when no more pages exist.
func (s *DynamoEventPhotoLister) ListEventPhotos(ctx context.Context, eventID, cursor string, limit int) ([]models.Photo, string, error) {
	input := &dynamodb.QueryInput{
		TableName:              aws.String(s.TableName),
		IndexName:              aws.String(photosGSIName),
		KeyConditionExpression: aws.String("eventId = :eid"),
		FilterExpression:       aws.String("#st = :indexed"),
		ExpressionAttributeNames: map[string]string{
			"#st": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":eid":     &types.AttributeValueMemberS{Value: eventID},
			":indexed": &types.AttributeValueMemberS{Value: models.PhotoStatusIndexed},
		},
		ScanIndexForward: aws.Bool(false), // uploadedAt DESC
		Limit:            aws.Int32(int32(limit * bufferMultiplier)),
	}

	if cursor != "" {
		lek, err := decodeCursor(cursor, eventID)
		if err != nil {
			return nil, "", ErrInvalidCursor
		}
		input.ExclusiveStartKey = lek
	}

	var photos []models.Photo
	var lastKey map[string]types.AttributeValue

	for iter := 0; iter < maxIterations; iter++ {
		remaining := limit - len(photos)
		if remaining < 1 {
			remaining = 1
		}
		input.Limit = aws.Int32(int32(remaining * bufferMultiplier))

		out, err := s.Client.Query(ctx, input)
		if err != nil {
			return nil, "", fmt.Errorf("ListEventPhotos: dynamodb Query: %w", err)
		}
		for _, item := range out.Items {
			var p models.Photo
			if err := attributevalue.UnmarshalMap(item, &p); err != nil {
				return nil, "", fmt.Errorf("ListEventPhotos: unmarshal: %w", err)
			}
			photos = append(photos, p)
			if len(photos) >= limit {
				break
			}
		}
		lastKey = out.LastEvaluatedKey
		if len(photos) >= limit || len(lastKey) == 0 {
			break
		}
		input.ExclusiveStartKey = lastKey
	}

	if len(photos) > limit {
		photos = photos[:limit]
	}

	var nextCursor string
	if len(lastKey) > 0 {
		var cursorKey map[string]types.AttributeValue
		if len(photos) > 0 {
			last := photos[len(photos)-1]
			cursorKey = map[string]types.AttributeValue{
				"id":         &types.AttributeValueMemberS{Value: last.ID},
				"eventId":    &types.AttributeValueMemberS{Value: last.EventID},
				"uploadedAt": &types.AttributeValueMemberS{Value: last.UploadedAt},
			}
		} else {
			cursorKey = lastKey
		}
		nc, err := encodeCursor(cursorKey)
		if err != nil {
			return nil, "", fmt.Errorf("ListEventPhotos: encodeCursor: %w", err)
		}
		nextCursor = nc
	}

	return photos, nextCursor, nil
}

// DynamoPublicEventReader implements PublicEventReader.
type DynamoPublicEventReader struct {
	Client    DynamoQuerier
	TableName string
}

// GetPublicEvent returns event metadata for the public browse endpoint.
// Returns ErrEventNotFound if the event does not exist.
func (s *DynamoPublicEventReader) GetPublicEvent(ctx context.Context, eventID string) (*models.Event, error) {
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.TableName),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: eventID},
		},
		ProjectionExpression: aws.String("#n, photoCount, pricePerPhoto, currency"),
		ExpressionAttributeNames: map[string]string{
			"#n": "name",
		},
	})
	if err != nil {
		return nil, fmt.Errorf("GetPublicEvent: dynamodb.GetItem: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, ErrEventNotFound
	}
	var ev models.Event
	if err := attributevalue.UnmarshalMap(out.Item, &ev); err != nil {
		return nil, fmt.Errorf("GetPublicEvent: unmarshal: %w", err)
	}
	return &ev, nil
}

// encodeCursor serialises a DynamoDB key map to a base64-encoded JSON string.
func encodeCursor(key map[string]types.AttributeValue) (string, error) {
	m := make(map[string]interface{})
	for k, v := range key {
		switch av := v.(type) {
		case *types.AttributeValueMemberS:
			m[k] = map[string]string{"S": av.Value}
		case *types.AttributeValueMemberN:
			m[k] = map[string]string{"N": av.Value}
		default:
			return "", fmt.Errorf("encodeCursor: unsupported attribute type for key %s", k)
		}
	}
	b, err := json.Marshal(m)
	if err != nil {
		return "", fmt.Errorf("encodeCursor: marshal: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// decodeCursor deserialises a base64-encoded cursor and validates that its
// embedded eventId matches the expected eventID to prevent tampered cursors
// from jumping to positions in other events' GSI partitions.
func decodeCursor(cursor, eventID string) (map[string]types.AttributeValue, error) {
	b, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return nil, fmt.Errorf("decodeCursor: base64 decode: %w", err)
	}
	var m map[string]map[string]string
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("decodeCursor: unmarshal: %w", err)
	}
	key := make(map[string]types.AttributeValue)
	for k, v := range m {
		if s, ok := v["S"]; ok {
			key[k] = &types.AttributeValueMemberS{Value: s}
		} else if n, ok := v["N"]; ok {
			key[k] = &types.AttributeValueMemberN{Value: n}
		} else {
			return nil, fmt.Errorf("decodeCursor: unrecognised type for key %s", k)
		}
	}
	eid, ok := key["eventId"]
	if !ok {
		return nil, fmt.Errorf("decodeCursor: missing eventId")
	}
	s, ok := eid.(*types.AttributeValueMemberS)
	if !ok || s.Value != eventID {
		return nil, fmt.Errorf("decodeCursor: eventId mismatch")
	}
	return key, nil
}
