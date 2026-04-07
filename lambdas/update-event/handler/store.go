package handler

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

// DynamoUpdater is the minimal DynamoDB API surface used by DynamoEventUpdater.
type DynamoUpdater interface {
	UpdateItem(ctx context.Context, params *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// DynamoEventUpdater implements EventUpdater using DynamoDB UpdateItem.
type DynamoEventUpdater struct {
	Client    DynamoUpdater
	TableName string
}

// UpdateEvent updates the mutable fields of an event. The condition expression
// ensures the caller owns the event (photographerId = :callerId).
// Returns apperrors.ErrForbidden on ConditionalCheckFailedException.
// Returns apperrors.ErrNotFound if the item does not exist.
func (s *DynamoEventUpdater) UpdateEvent(ctx context.Context, id, callerID string, fields UpdateFields) (*models.Event, error) {
	now := time.Now().UTC().Format(time.RFC3339)

	priceAttr, err := attributevalue.Marshal(fields.PricePerPhoto)
	if err != nil {
		return nil, fmt.Errorf("UpdateEvent: marshal price: %w", err)
	}

	key, err := attributevalue.MarshalMap(map[string]string{"id": id})
	if err != nil {
		return nil, fmt.Errorf("UpdateEvent: marshal key: %w", err)
	}

	out, err := s.Client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(s.TableName),
		Key:       key,
		UpdateExpression: aws.String(
			"SET #name = :name, #date = :date, #location = :location, " +
				"pricePerPhoto = :price, currency = :currency, " +
				"watermarkText = :watermarkText, updatedAt = :updatedAt",
		),
		ConditionExpression: aws.String("attribute_exists(id) AND photographerId = :callerId"),
		ExpressionAttributeNames: map[string]string{
			"#name":     "name",
			"#date":     "date",
			"#location": "location",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":name":          &types.AttributeValueMemberS{Value: fields.Name},
			":date":          &types.AttributeValueMemberS{Value: fields.Date},
			":location":      &types.AttributeValueMemberS{Value: fields.Location},
			":price":         priceAttr,
			":currency":      &types.AttributeValueMemberS{Value: fields.Currency},
			":watermarkText": &types.AttributeValueMemberS{Value: fields.WatermarkText},
			":updatedAt":     &types.AttributeValueMemberS{Value: now},
			":callerId":      &types.AttributeValueMemberS{Value: callerID},
		},
		ReturnValues: types.ReturnValueAllNew,
	})
	if err != nil {
		var ccfe *types.ConditionalCheckFailedException
		if errors.As(err, &ccfe) {
			// Check if item exists to distinguish 403 from 404.
			exists, checkErr := s.itemExists(ctx, id)
			if checkErr != nil {
				return nil, fmt.Errorf("UpdateEvent: check existence: %w", checkErr)
			}
			if !exists {
				return nil, apperrors.ErrNotFound
			}
			return nil, apperrors.ErrForbidden
		}
		return nil, fmt.Errorf("UpdateEvent: dynamodb.UpdateItem: %w", err)
	}

	var e models.Event
	if err := attributevalue.UnmarshalMap(out.Attributes, &e); err != nil {
		return nil, fmt.Errorf("UpdateEvent: unmarshal: %w", err)
	}
	return &e, nil
}

func (s *DynamoEventUpdater) itemExists(ctx context.Context, id string) (bool, error) {
	key, err := attributevalue.MarshalMap(map[string]string{"id": id})
	if err != nil {
		return false, fmt.Errorf("itemExists: marshal key: %w", err)
	}
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:            aws.String(s.TableName),
		Key:                  key,
		ConsistentRead:       aws.Bool(true),
		ProjectionExpression: aws.String("id"),
	})
	if err != nil {
		return false, fmt.Errorf("itemExists: dynamodb.GetItem: %w", err)
	}
	return len(out.Item) > 0, nil
}
