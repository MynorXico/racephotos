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

const gsiName = "photographerId-createdAt-index"

// errInvalidCursor is returned when the cursor query parameter cannot be decoded.
var errInvalidCursor = errors.New("invalid cursor")

// DynamoQuerier is the minimal DynamoDB API surface used by DynamoEventLister.
type DynamoQuerier interface {
	Query(ctx context.Context, params *dynamodb.QueryInput, optFns ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
}

// DynamoEventLister implements EventLister using DynamoDB Query on the GSI.
type DynamoEventLister struct {
	Client    DynamoQuerier
	TableName string
}

// ListEventsByPhotographer queries events for a photographer sorted by createdAt DESC.
// cursor is a base64-encoded JSON map representing the LastEvaluatedKey from a previous page.
// Returns the events, the next cursor (empty string if no more pages), and any error.
func (s *DynamoEventLister) ListEventsByPhotographer(ctx context.Context, photographerID, cursor string, limit int) ([]models.Event, string, error) {
	input := &dynamodb.QueryInput{
		TableName:              aws.String(s.TableName),
		IndexName:              aws.String(gsiName),
		KeyConditionExpression: aws.String("photographerId = :pid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pid": &types.AttributeValueMemberS{Value: photographerID},
		},
		ScanIndexForward: aws.Bool(false), // DESC by createdAt
		Limit:            aws.Int32(int32(limit)),
	}

	if cursor != "" {
		lek, err := decodeCursor(cursor)
		if err != nil {
			return nil, "", fmt.Errorf("%w: invalid cursor", errInvalidCursor)
		}
		input.ExclusiveStartKey = lek
	}

	out, err := s.Client.Query(ctx, input)
	if err != nil {
		return nil, "", fmt.Errorf("ListEventsByPhotographer: dynamodb.Query: %w", err)
	}

	var eventList []models.Event
	for _, item := range out.Items {
		var e models.Event
		if err := attributevalue.UnmarshalMap(item, &e); err != nil {
			return nil, "", fmt.Errorf("ListEventsByPhotographer: unmarshal: %w", err)
		}
		eventList = append(eventList, e)
	}

	var nextCursor string
	if len(out.LastEvaluatedKey) > 0 {
		nc, err := encodeCursor(out.LastEvaluatedKey)
		if err != nil {
			return nil, "", fmt.Errorf("ListEventsByPhotographer: encodeCursor: %w", err)
		}
		nextCursor = nc
	}

	return eventList, nextCursor, nil
}

// encodeCursor serialises a DynamoDB LastEvaluatedKey to a base64-encoded JSON string.
func encodeCursor(key map[string]types.AttributeValue) (string, error) {
	// Marshal to a simplified map for JSON encoding.
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
