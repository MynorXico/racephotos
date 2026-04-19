// Package handler implements GET /download/{token} business logic.
package handler

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

// ── Business-logic interfaces ─────────────────────────────────────────────────

// PurchaseStore looks up a Purchase by its download token.
type PurchaseStore interface {
	GetPurchaseByDownloadToken(ctx context.Context, token string) (*models.Purchase, error)
}

// PhotoStore fetches a Photo by its primary key.
type PhotoStore interface {
	GetPhotoByID(ctx context.Context, photoID string) (*models.Photo, error)
}

// PhotoPresigner generates a presigned S3 GET URL.
type PhotoPresigner interface {
	PresignGetObject(ctx context.Context, bucket, key string, ttl time.Duration) (string, error)
}

// ── DynamoDB client interfaces ────────────────────────────────────────────────

// DynamoQueryClient wraps the Query method used by DynamoPurchaseStore.
type DynamoQueryClient interface {
	Query(ctx context.Context, params *dynamodb.QueryInput, optFns ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
}

// DynamoGetClient wraps the GetItem method used by DynamoPhotoStore.
type DynamoGetClient interface {
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// S3PresignAPIClient wraps PresignGetObject from the AWS SDK v2 PresignClient.
type S3PresignAPIClient interface {
	PresignGetObject(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error)
}

// ── DynamoPurchaseStore ───────────────────────────────────────────────────────

// DynamoPurchaseStore implements PurchaseStore by querying downloadToken-index.
type DynamoPurchaseStore struct {
	Client    DynamoQueryClient
	TableName string
}

func (s *DynamoPurchaseStore) GetPurchaseByDownloadToken(ctx context.Context, token string) (*models.Purchase, error) {
	out, err := s.Client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.TableName),
		IndexName:              aws.String("downloadToken-index"),
		KeyConditionExpression: aws.String("#dt = :token"),
		ExpressionAttributeNames: map[string]string{
			"#dt": "downloadToken",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":token": &types.AttributeValueMemberS{Value: token},
		},
		Limit: aws.Int32(1),
	})
	if err != nil {
		return nil, fmt.Errorf("GetPurchaseByDownloadToken: Query: %w", err)
	}
	if len(out.Items) == 0 {
		return nil, apperrors.ErrNotFound
	}
	var p models.Purchase
	if err := attributevalue.UnmarshalMap(out.Items[0], &p); err != nil {
		return nil, fmt.Errorf("GetPurchaseByDownloadToken: unmarshal: %w", err)
	}
	return &p, nil
}

// ── DynamoPhotoStore ──────────────────────────────────────────────────────────

// DynamoPhotoStore implements PhotoStore with a DynamoDB GetItem call.
type DynamoPhotoStore struct {
	Client    DynamoGetClient
	TableName string
}

func (s *DynamoPhotoStore) GetPhotoByID(ctx context.Context, photoID string) (*models.Photo, error) {
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.TableName),
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: photoID},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("GetPhotoByID: GetItem: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, apperrors.ErrNotFound
	}
	var ph models.Photo
	if err := attributevalue.UnmarshalMap(out.Item, &ph); err != nil {
		return nil, fmt.Errorf("GetPhotoByID: unmarshal: %w", err)
	}
	return &ph, nil
}

// ── AWSS3GetPresigner ─────────────────────────────────────────────────────────

// AWSS3GetPresigner implements PhotoPresigner using the AWS SDK v2 PresignClient.
type AWSS3GetPresigner struct {
	Client S3PresignAPIClient
}

func (p *AWSS3GetPresigner) PresignGetObject(ctx context.Context, bucket, key string, ttl time.Duration) (string, error) {
	req, err := p.Client.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = ttl
	})
	if err != nil {
		return "", fmt.Errorf("PresignGetObject: %w", err)
	}
	return req.URL, nil
}
