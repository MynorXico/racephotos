package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/racephotos/shared/models"
)

const photosGSIName = "eventId-uploadedAt-index"

// ErrInvalidCursor is returned when the cursor query parameter cannot be decoded.
var ErrInvalidCursor = errors.New("invalid cursor")

// ErrEventNotFound is returned when the requested event does not exist.
var ErrEventNotFound = errors.New("event not found")

// DynamoQuerier is the minimal DynamoDB surface needed by this package.
type DynamoQuerier interface {
	Query(ctx context.Context, params *dynamodb.QueryInput, optFns ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// DynamoPhotoLister implements PhotoStore using the eventId-uploadedAt-index GSI.
type DynamoPhotoLister struct {
	Client    DynamoQuerier
	TableName string
}

// filterMultiplier controls the DynamoDB page size used when a status filter is
// active. Because DynamoDB applies Limit before FilterExpression, a page of N
// evaluated items may return far fewer matching items. We over-fetch by this
// factor and loop until we have enough results or exhaust the GSI partition.
const filterMultiplier = 5

// maxFilterIterations caps the number of DynamoDB Query rounds when a filter is
// active. This bounds RCU consumption for pathological cases (e.g. an event
// where 0% of photos match the requested status). The caller receives whatever
// results were found plus a cursor to resume from the current position.
const maxFilterIterations = 10

// ListPhotosByEvent queries photos for an event sorted by uploadedAt DESC.
// If filter is non-empty only photos with that status are returned.
// cursor is a base64-encoded JSON representation of the DynamoDB LastEvaluatedKey.
// Returns the photos, the next cursor (empty string when no more pages exist), and any error.
func (s *DynamoPhotoLister) ListPhotosByEvent(ctx context.Context, eventID, filter, cursor string, limit int) ([]models.Photo, string, error) {
	// When a FilterExpression is active, use a larger internal page size and loop
	// to collect at least `limit` matching items — DynamoDB counts Limit before
	// filtering, so each page may return far fewer items than requested.
	internalLimit := int32(limit)
	if filter != "" {
		internalLimit = int32(limit * filterMultiplier)
	}

	input := &dynamodb.QueryInput{
		TableName:              aws.String(s.TableName),
		IndexName:              aws.String(photosGSIName),
		KeyConditionExpression: aws.String("eventId = :eid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":eid": &types.AttributeValueMemberS{Value: eventID},
		},
		ScanIndexForward: aws.Bool(false), // uploadedAt DESC
		Limit:            aws.Int32(internalLimit),
	}

	if filter != "" {
		input.ExpressionAttributeNames = map[string]string{"#st": "status"}
		if filter == "in_progress" {
			// "in_progress" is a virtual filter alias — expand to a compound expression
			// that matches both "processing" and "watermarking" DynamoDB status values.
			// This lets the frontend issue a single paginated request for all in-flight
			// photos without merging two independent cursors client-side (RS-018).
			input.FilterExpression = aws.String("#st = :sp OR #st = :sw")
			input.ExpressionAttributeValues[":sp"] = &types.AttributeValueMemberS{Value: "processing"}
			input.ExpressionAttributeValues[":sw"] = &types.AttributeValueMemberS{Value: "watermarking"}
		} else {
			input.FilterExpression = aws.String("#st = :status")
			input.ExpressionAttributeValues[":status"] = &types.AttributeValueMemberS{Value: filter}
		}
	}

	if cursor != "" {
		// Validate that the cursor's embedded eventId matches the requested event
		// before passing it to DynamoDB, to prevent tampered cursors from jumping
		// to positions in other events' GSI partitions.
		lek, err := decodeCursor(cursor, eventID)
		if err != nil {
			return nil, "", ErrInvalidCursor
		}
		input.ExclusiveStartKey = lek
	}

	var photos []models.Photo
	var lastKey map[string]types.AttributeValue

	for iter := 0; ; iter++ {
		// Safety cap: stop after maxFilterIterations rounds so that a filter
		// matching very few items cannot burn unbounded RCUs. Return whatever
		// was found plus the current lastKey as a cursor so the caller can resume.
		if filter != "" && iter >= maxFilterIterations {
			break
		}
		// Recompute the page size each iteration: only ask DynamoDB to evaluate
		// enough items to satisfy the remaining need. This avoids over-reading
		// on pages beyond the first when only a few items are still needed.
		if filter != "" {
			remaining := limit - len(photos)
			if remaining < 1 {
				remaining = 1
			}
			input.Limit = aws.Int32(int32(remaining * filterMultiplier))
		}

		out, err := s.Client.Query(ctx, input)
		if err != nil {
			return nil, "", fmt.Errorf("ListPhotosByEvent: dynamodb Query: %w", err)
		}
		for _, item := range out.Items {
			var p models.Photo
			if err := attributevalue.UnmarshalMap(item, &p); err != nil {
				return nil, "", fmt.Errorf("ListPhotosByEvent: unmarshal: %w", err)
			}
			photos = append(photos, p)
			if len(photos) >= limit {
				break
			}
		}
		lastKey = out.LastEvaluatedKey
		// Stop when we have enough photos or DynamoDB has no more data.
		if len(photos) >= limit || len(lastKey) == 0 {
			break
		}
		// Continue from where DynamoDB stopped.
		input.ExclusiveStartKey = lastKey
	}

	// Trim to exactly the requested limit.
	if len(photos) > limit {
		photos = photos[:limit]
	}

	// Encode the cursor from the last photo's GSI key attributes so the next
	// page resumes immediately after the last item we returned — not after the
	// last item DynamoDB evaluated, which could be further ahead.
	var nextCursor string
	if len(lastKey) > 0 {
		var cursorKey map[string]types.AttributeValue
		if len(photos) > 0 {
			// Resume from the last item we actually returned.
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
			return nil, "", fmt.Errorf("ListPhotosByEvent: encodeCursor: %w", err)
		}
		nextCursor = nc
	}

	return photos, nextCursor, nil
}

// DynamoEventReader implements EventStore using the events table GetItem.
type DynamoEventReader struct {
	Client    DynamoQuerier
	TableName string
}

// GetEventPhotographerID returns the photographerID for the given eventID.
// Returns ErrEventNotFound if the event does not exist.
// Returns an error (not ErrEventNotFound) if the record is malformed (missing photographerId).
func (s *DynamoEventReader) GetEventPhotographerID(ctx context.Context, eventID string) (string, error) {
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.TableName),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: eventID},
		},
		ProjectionExpression: aws.String("photographerId"),
	})
	if err != nil {
		return "", fmt.Errorf("GetEventPhotographerID: dynamodb.GetItem: %w", err)
	}
	if len(out.Item) == 0 {
		return "", ErrEventNotFound
	}
	var ev struct {
		PhotographerID string `dynamodbav:"photographerId"`
	}
	if err := attributevalue.UnmarshalMap(out.Item, &ev); err != nil {
		return "", fmt.Errorf("GetEventPhotographerID: unmarshal: %w", err)
	}
	// Guard against a malformed record with a present-but-empty photographerId.
	// An empty owner would silently 403 every legitimate request, which is harder
	// to diagnose than a 500 + error log.
	if ev.PhotographerID == "" {
		return "", fmt.Errorf("GetEventPhotographerID: event %s has no photographerId attribute", eventID)
	}
	return ev.PhotographerID, nil
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
	// Validate that the cursor belongs to the requested event.
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
