package handler

import (
	"bytes"
	"context"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/racephotos/shared/apperrors"
)

// DynamoAPI is the minimal DynamoDB surface used by stores in this package.
type DynamoAPI interface {
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	UpdateItem(ctx context.Context, params *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
}

// S3API is the minimal S3 surface used by the photo reader/writer.
type S3API interface {
	GetObject(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.Options)) (*s3.GetObjectOutput, error)
	PutObject(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.Options)) (*s3.PutObjectOutput, error)
}

// ── S3 photo reader / writer ──────────────────────────────────────────────────

// S3PhotoReader implements RawPhotoReader. The bucket is passed per-call to
// allow the same implementation to be used for different buckets if needed.
type S3PhotoReader struct {
	Client S3API
	Bucket string // racephotos-raw-{envName}
}

// GetObject downloads an object from S3 and returns its body.
func (r *S3PhotoReader) GetObject(ctx context.Context, _ string, key string) (io.ReadCloser, error) {
	out, err := r.Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(r.Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("S3PhotoReader.GetObject key=%s: %w", key, err)
	}
	return out.Body, nil
}

// S3PhotoWriter implements ProcessedPhotoWriter.
type S3PhotoWriter struct {
	Client S3API
}

// PutObject uploads body to bucket/key with the given content type.
// If body implements io.ReadSeeker (e.g. *bytes.Reader), the length is determined
// by seeking — no extra copy. Otherwise the body is read into a buffer.
func (w *S3PhotoWriter) PutObject(ctx context.Context, bucket, key string, body io.Reader, contentType string) error {
	var r io.Reader
	var n int64

	if rs, ok := body.(io.ReadSeeker); ok {
		size, err := rs.Seek(0, io.SeekEnd)
		if err != nil {
			return fmt.Errorf("S3PhotoWriter.PutObject: seek end: %w", err)
		}
		if _, err = rs.Seek(0, io.SeekStart); err != nil {
			return fmt.Errorf("S3PhotoWriter.PutObject: seek start: %w", err)
		}
		r, n = rs, size
	} else {
		data, err := io.ReadAll(body)
		if err != nil {
			return fmt.Errorf("S3PhotoWriter.PutObject: read body: %w", err)
		}
		r, n = bytes.NewReader(data), int64(len(data))
	}

	_, err := w.Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(bucket),
		Key:           aws.String(key),
		Body:          r,
		ContentType:   aws.String(contentType),
		ContentLength: aws.Int64(n),
	})
	if err != nil {
		return fmt.Errorf("S3PhotoWriter.PutObject bucket=%s key=%s: %w", bucket, key, err)
	}
	return nil
}

// ── DynamoDB stores ───────────────────────────────────────────────────────────

// DynamoEventStore implements EventStore against racephotos-events.
type DynamoEventStore struct {
	Client    DynamoAPI
	TableName string
}

// GetWatermarkText reads only the watermarkText field from the event record.
func (s *DynamoEventStore) GetWatermarkText(ctx context.Context, eventId string) (string, error) {
	key, err := attributevalue.MarshalMap(map[string]string{"id": eventId})
	if err != nil {
		return "", fmt.Errorf("GetWatermarkText: marshal key: %w", err)
	}
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:                aws.String(s.TableName),
		Key:                      key,
		ProjectionExpression:     aws.String("#wt"),
		ExpressionAttributeNames: map[string]string{"#wt": "watermarkText"},
	})
	if err != nil {
		return "", fmt.Errorf("GetWatermarkText: dynamodb.GetItem eventId=%s: %w", eventId, err)
	}
	if len(out.Item) == 0 {
		return "", fmt.Errorf("GetWatermarkText: %w: eventId=%s", apperrors.ErrNotFound, eventId)
	}

	var item struct {
		WatermarkText string `dynamodbav:"watermarkText"`
	}
	if err := attributevalue.UnmarshalMap(out.Item, &item); err != nil {
		return "", fmt.Errorf("GetWatermarkText: unmarshal: %w", err)
	}
	return item.WatermarkText, nil
}

// DynamoPhotoStore implements PhotoStore against racephotos-photos.
type DynamoPhotoStore struct {
	Client    DynamoAPI
	TableName string
}

// UpdateWatermarkedKey writes the watermarkedS3Key field on an existing Photo record.
func (s *DynamoPhotoStore) UpdateWatermarkedKey(ctx context.Context, photoId, watermarkedS3Key string) error {
	key, err := attributevalue.MarshalMap(map[string]string{"id": photoId})
	if err != nil {
		return fmt.Errorf("UpdateWatermarkedKey: marshal key: %w", err)
	}
	val, err := attributevalue.Marshal(watermarkedS3Key)
	if err != nil {
		return fmt.Errorf("UpdateWatermarkedKey: marshal value: %w", err)
	}
	_, err = s.Client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:        aws.String(s.TableName),
		Key:              key,
		UpdateExpression: aws.String("SET #wk = :wk"),
		// ConditionExpression prevents silent ghost-record creation if photoId does not exist.
		// DynamoDB UpdateItem upserts by default; attribute_exists(id) makes it fail-fast instead.
		ConditionExpression:      aws.String("attribute_exists(id)"),
		ExpressionAttributeNames: map[string]string{"#wk": "watermarkedS3Key"},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":wk": val,
		},
	})
	if err != nil {
		return fmt.Errorf("UpdateWatermarkedKey: dynamodb.UpdateItem photoId=%s: %w", photoId, err)
	}
	return nil
}
