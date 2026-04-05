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
// DeleteItem is included for integration-test cleanup only (see store_helpers.go).
// The production IAM policy grants only GetItem and UpdateItem.
type DynamoAPI interface {
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	UpdateItem(ctx context.Context, params *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
	DeleteItem(ctx context.Context, params *dynamodb.DeleteItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.DeleteItemOutput, error)
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

	out, err := s.Client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(s.TableName),
		Key:       key,
		UpdateExpression: aws.String(
			"SET displayName = :dn, defaultCurrency = :dc, bankName = :bn, " +
				"bankAccountNumber = :ban, bankAccountHolder = :bah, bankInstructions = :bi, " +
				"updatedAt = :ua, createdAt = if_not_exists(createdAt, :ca)",
		),
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
