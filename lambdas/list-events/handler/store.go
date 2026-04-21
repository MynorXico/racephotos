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

const gsiName = "status-createdAt-index"

// ErrInvalidCursor is returned when the cursor query parameter cannot be decoded.
var ErrInvalidCursor = errors.New("invalid cursor")

// DynamoQuerier is the minimal DynamoDB API surface used by DynamoEventStore.
type DynamoQuerier interface {
	Query(ctx context.Context, params *dynamodb.QueryInput, optFns ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
}

// DynamoEventStore implements EventStore using DynamoDB Query on the status-createdAt-index GSI.
type DynamoEventStore struct {
	Client    DynamoQuerier
	TableName string
}

// ListActiveEvents queries all active, publicly visible events sorted by createdAt DESC.
// cursor is a base64-encoded, RawURL-safe JSON blob representing the DynamoDB LastEvaluatedKey
// from a previous page. Callers must not re-encode the cursor value (e.g. with encodeURIComponent)
// before appending it to the query string — API Gateway decodes query params before the Lambda sees them.
// Returns the events, the next cursor (empty string if no more pages), and any error.
func (s *DynamoEventStore) ListActiveEvents(ctx context.Context, cursor string, limit int) ([]models.Event, string, error) {
	input := &dynamodb.QueryInput{
		TableName:              aws.String(s.TableName),
		IndexName:              aws.String(gsiName),
		KeyConditionExpression: aws.String("#s = :status"),
		FilterExpression:       aws.String("visibility = :pub"),
		ExpressionAttributeNames: map[string]string{
			"#s": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":status": &types.AttributeValueMemberS{Value: "active"},
			":pub":    &types.AttributeValueMemberS{Value: "public"},
		},
		ScanIndexForward: aws.Bool(false),
		Limit:            aws.Int32(int32(limit)),
	}

	if cursor != "" {
		lek, err := decodeCursor(cursor)
		if err != nil {
			return nil, "", fmt.Errorf("%w: %w", ErrInvalidCursor, err)
		}
		input.ExclusiveStartKey = lek
	}

	out, err := s.Client.Query(ctx, input)
	if err != nil {
		return nil, "", fmt.Errorf("ListActiveEvents: dynamodb.Query: %w", err)
	}

	var eventList []models.Event
	for _, item := range out.Items {
		var e models.Event
		if err := attributevalue.UnmarshalMap(item, &e); err != nil {
			return nil, "", fmt.Errorf("ListActiveEvents: unmarshal: %w", err)
		}
		eventList = append(eventList, e)
	}

	var nextCursor string
	if len(out.LastEvaluatedKey) > 0 {
		nc, err := encodeCursor(out.LastEvaluatedKey)
		if err != nil {
			return nil, "", fmt.Errorf("ListActiveEvents: encodeCursor: %w", err)
		}
		nextCursor = nc
	}

	return eventList, nextCursor, nil
}

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

func decodeCursor(cursor string) (map[string]types.AttributeValue, error) {
	b, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return nil, fmt.Errorf("decodeCursor: base64 decode: %w", err)
	}
	var m map[string]map[string]string
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("decodeCursor: unmarshal: %w", err)
	}
	// status-createdAt-index keys: status (PK), createdAt (SK), id (table PK pointer) = 3 max.
	if len(m) > 3 {
		return nil, fmt.Errorf("decodeCursor: too many key attributes (%d)", len(m))
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
