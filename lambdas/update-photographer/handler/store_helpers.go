package handler

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

// DeleteForTest removes a photographer record by ID. Used only in integration tests.
func (s *DynamoStore) DeleteForTest(ctx context.Context, id string) error {
	key, err := attributevalue.MarshalMap(map[string]string{"id": id})
	if err != nil {
		return fmt.Errorf("DeleteForTest: marshal key: %w", err)
	}
	_, err = s.Client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(s.TableName),
		Key:       key,
	})
	if err != nil {
		return fmt.Errorf("DeleteForTest: DeleteItem: %w", err)
	}
	return nil
}
