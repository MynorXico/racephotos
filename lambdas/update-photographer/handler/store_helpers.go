package handler

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

// dynamoDeleter is a test-only interface that extends DynamoAPI with DeleteItem.
// DeleteItem is intentionally excluded from the production DynamoAPI interface
// to prevent accidental use in production code (the Lambda IAM policy does not
// grant dynamodb:DeleteItem).
type dynamoDeleter interface {
	DynamoAPI
	DeleteItem(ctx context.Context, params *dynamodb.DeleteItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.DeleteItemOutput, error)
}

// DeleteForTest removes a photographer record by ID. Used only in integration tests.
func (s *DynamoStore) DeleteForTest(ctx context.Context, id string) error {
	deleter, ok := s.Client.(dynamoDeleter)
	if !ok {
		return fmt.Errorf("DeleteForTest: DynamoStore.Client does not implement DeleteItem (integration tests only)")
	}
	key, err := attributevalue.MarshalMap(map[string]string{"id": id})
	if err != nil {
		return fmt.Errorf("DeleteForTest: marshal key: %w", err)
	}
	_, err = deleter.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(s.TableName),
		Key:       key,
	})
	if err != nil {
		return fmt.Errorf("DeleteForTest: DeleteItem: %w", err)
	}
	return nil
}
