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

// ListPhotosByEvent queries photos for an event sorted by uploadedAt DESC.
// If filter is non-empty only photos with that status are returned.
// cursor is a base64-encoded JSON representation of the DynamoDB LastEvaluatedKey.
// Returns the photos, the next cursor (empty string when no more pages exist), and any error.
func (s *DynamoPhotoLister) ListPhotosByEvent(ctx context.Context, eventID, filter, cursor string, limit int) ([]models.Photo, string, error) {
	input := &dynamodb.QueryInput{
		TableName:              aws.String(s.TableName),
		IndexName:              aws.String(photosGSIName),
		KeyConditionExpression: aws.String("eventId = :eid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":eid": &types.AttributeValueMemberS{Value: eventID},
		},
		ScanIndexForward: aws.Bool(false), // uploadedAt DESC
		Limit:            aws.Int32(int32(limit)),
	}

	if filter != "" {
		input.FilterExpression = aws.String("#st = :status")
		input.ExpressionAttributeNames = map[string]string{"#st": "status"}
		input.ExpressionAttributeValues[":status"] = &types.AttributeValueMemberS{Value: filter}
	}

	if cursor != "" {
		lek, err := decodeCursor(cursor)
		if err != nil {
			return nil, "", ErrInvalidCursor
		}
		input.ExclusiveStartKey = lek
	}

	out, err := s.Client.Query(ctx, input)
	if err != nil {
		return nil, "", fmt.Errorf("ListPhotosByEvent: dynamodb Query: %w", err)
	}

	var photos []models.Photo
	for _, item := range out.Items {
		var p models.Photo
		if err := attributevalue.UnmarshalMap(item, &p); err != nil {
			return nil, "", fmt.Errorf("ListPhotosByEvent: unmarshal: %w", err)
		}
		photos = append(photos, p)
	}

	var nextCursor string
	if len(out.LastEvaluatedKey) > 0 {
		nc, err := encodeCursor(out.LastEvaluatedKey)
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
// Returns errEventNotFound if the event does not exist.
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
	return ev.PhotographerID, nil
}

// encodeCursor serialises a DynamoDB LastEvaluatedKey to a base64-encoded JSON string.
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

// decodeCursor deserialises a base64-encoded cursor back to a DynamoDB key map.
func decodeCursor(cursor string) (map[string]types.AttributeValue, error) {
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
	return key, nil
}
