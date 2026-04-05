package handler

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

// DynamoAPI is the minimal DynamoDB API surface used by DynamoStore.
// The production IAM policy grants only GetItem and UpdateItem.
// DeleteItem is intentionally excluded — see store_helpers.go for the
// test-only interface that adds it for integration-test cleanup.
type DynamoAPI interface {
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	UpdateItem(ctx context.Context, params *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
}

// DynamoStore implements PhotographerUpserter using DynamoDB.
type DynamoStore struct {
	Client    DynamoAPI
	TableName string
}

// GetPhotographer retrieves the photographer profile by Cognito sub.
// Returns apperrors.ErrNotFound if no record exists.
func (s *DynamoStore) GetPhotographer(ctx context.Context, id string) (*models.Photographer, error) {
	key, err := attributevalue.MarshalMap(map[string]string{"id": id})
	if err != nil {
		return nil, fmt.Errorf("GetPhotographer: marshal key: %w", err)
	}

	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.TableName),
		Key:       key,
	})
	if err != nil {
		return nil, fmt.Errorf("GetPhotographer: dynamodb.GetItem: %w", err)
	}

	if len(out.Item) == 0 {
		return nil, apperrors.ErrNotFound
	}

	var p models.Photographer
	if err := attributevalue.UnmarshalMap(out.Item, &p); err != nil {
		return nil, fmt.Errorf("GetPhotographer: unmarshal: %w", err)
	}

	return &p, nil
}

// UpsertPhotographer writes the photographer profile to DynamoDB using a single
// UpdateItem call. The if_not_exists(createdAt, :ca) expression preserves the
// original creation timestamp on subsequent updates — no pre-fetch required.
// Returns the full profile as stored in DynamoDB (ReturnValues: ALL_NEW).
func (s *DynamoStore) UpsertPhotographer(ctx context.Context, p models.Photographer) (*models.Photographer, error) {
	key, err := attributevalue.MarshalMap(map[string]string{"id": p.ID})
	if err != nil {
		return nil, fmt.Errorf("UpsertPhotographer: marshal key: %w", err)
	}

	values, err := attributevalue.MarshalMap(map[string]any{
		":dn":  p.DisplayName,
		":dc":  p.DefaultCurrency,
		":bn":  p.BankName,
		":ban": p.BankAccountNumber,
		":bah": p.BankAccountHolder,
		":bi":  p.BankInstructions,
		":ua":  p.UpdatedAt,
		":ca":  p.UpdatedAt, // initial createdAt for new items; ignored on update
	})
	if err != nil {
		return nil, fmt.Errorf("UpsertPhotographer: marshal values: %w", err)
	}

	// ExpressionAttributeNames aliases each attribute to guard against DynamoDB
	// reserved-word collisions on future renames. if_not_exists(createdAt, :ca)
	// is used here because the Go SDK expression.Builder does not support
	// if_not_exists in a SET clause — a raw expression string is required.
	out, err := s.Client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(s.TableName),
		Key:       key,
		UpdateExpression: aws.String(
			"SET #dn = :dn, #dc = :dc, #bn = :bn, " +
				"#ban = :ban, #bah = :bah, #bi = :bi, " +
				"#ua = :ua, #ca = if_not_exists(#ca, :ca)",
		),
		ExpressionAttributeNames: map[string]string{
			"#dn":  "displayName",
			"#dc":  "defaultCurrency",
			"#bn":  "bankName",
			"#ban": "bankAccountNumber",
			"#bah": "bankAccountHolder",
			"#bi":  "bankInstructions",
			"#ua":  "updatedAt",
			"#ca":  "createdAt",
		},
		ExpressionAttributeValues: values,
		ReturnValues:              ddbtypes.ReturnValueAllNew,
	})
	if err != nil {
		return nil, fmt.Errorf("UpsertPhotographer: dynamodb.UpdateItem: %w", err)
	}

	var result models.Photographer
	if err := attributevalue.UnmarshalMap(out.Attributes, &result); err != nil {
		return nil, fmt.Errorf("UpsertPhotographer: unmarshal result: %w", err)
	}
	return &result, nil
}
