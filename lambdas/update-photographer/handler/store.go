package handler

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/racephotos/shared/models"
)

// DynamoAPI is the minimal DynamoDB API surface used by DynamoStore.
// The production IAM policy grants only dynamodb:UpdateItem.
// GetItem and DeleteItem are intentionally excluded — this Lambda performs
// a single-round-trip upsert via UpdateItem with if_not_exists(createdAt, :ca).
// See store_helpers.go for the test-only interface that adds DeleteItem for
// integration-test cleanup.
type DynamoAPI interface {
	UpdateItem(ctx context.Context, params *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
}

// DynamoStore implements PhotographerUpserter using DynamoDB.
type DynamoStore struct {
	Client    DynamoAPI
	TableName string
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
		":em":  p.Email,
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
			"SET #em = :em, #dn = :dn, #dc = :dc, #bn = :bn, " +
				"#ban = :ban, #bah = :bah, #bi = :bi, " +
				"#ua = :ua, #ca = if_not_exists(#ca, :ca)",
		),
		ExpressionAttributeNames: map[string]string{
			"#em":  "email",
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
