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
		return nil, fmt.Errorf("S3PhotoReader.GetObject: %w", err)
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
		return fmt.Errorf("S3PhotoWriter.PutObject: %w", err)
	}
	return nil
}

// ── DynamoDB stores ───────────────────────────────────────────────────────────

// DynamoEventStore implements EventStore against racephotos-events.
type DynamoEventStore struct {
	Client    DynamoAPI
	TableName string
}

// GetWatermarkText reads watermarkText and name from the event record.
// Returns both so the handler can fall back to the default when watermarkText is empty.
func (s *DynamoEventStore) GetWatermarkText(ctx context.Context, eventId string) (string, string, error) {
	key, err := attributevalue.MarshalMap(map[string]string{"id": eventId})
	if err != nil {
		return "", "", fmt.Errorf("GetWatermarkText: marshal key: %w", err)
	}
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:            aws.String(s.TableName),
		Key:                  key,
		ProjectionExpression: aws.String("#wt, #n"),
		ExpressionAttributeNames: map[string]string{
			"#wt": "watermarkText",
			"#n":  "name",
		},
	})
	if err != nil {
		return "", "", fmt.Errorf("GetWatermarkText: dynamodb.GetItem eventId=%s: %w", eventId, err)
	}
	if len(out.Item) == 0 {
		return "", "", fmt.Errorf("GetWatermarkText: %w: eventId=%s", apperrors.ErrNotFound, eventId)
	}

	var item struct {
		WatermarkText string `dynamodbav:"watermarkText"`
		Name          string `dynamodbav:"name"`
	}
	if err := attributevalue.UnmarshalMap(out.Item, &item); err != nil {
		return "", "", fmt.Errorf("GetWatermarkText: unmarshal: %w", err)
	}
	return item.WatermarkText, item.Name, nil
}

// DynamoPhotoStore implements PhotoStore against racephotos-photos.
type DynamoPhotoStore struct {
	Client    DynamoAPI
	TableName string
}

// CompleteWatermark atomically writes watermarkedS3Key and status in a single
// UpdateItem expression (RS-017). This prevents a partial state where the key
// is written but the status is still "watermarking" if the Lambda crashes
// between two separate writes.
//
// finalStatus must be "indexed" or "review_required".
func (s *DynamoPhotoStore) CompleteWatermark(ctx context.Context, photoId, watermarkedS3Key, finalStatus string) error {
	key, err := attributevalue.MarshalMap(map[string]string{"id": photoId})
	if err != nil {
		return fmt.Errorf("CompleteWatermark: marshal key: %w", err)
	}
	keyVal, err := attributevalue.Marshal(watermarkedS3Key)
	if err != nil {
		return fmt.Errorf("CompleteWatermark: marshal watermarkedS3Key: %w", err)
	}
	statusVal, err := attributevalue.Marshal(finalStatus)
	if err != nil {
		return fmt.Errorf("CompleteWatermark: marshal finalStatus: %w", err)
	}
	_, err = s.Client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:        aws.String(s.TableName),
		Key:              key,
		UpdateExpression: aws.String("SET #wk = :wk, #st = :st"),
		// ConditionExpression prevents silent ghost-record creation if photoId does not exist.
		// DynamoDB UpdateItem upserts by default; attribute_exists(id) makes it fail-fast instead.
		ConditionExpression: aws.String("attribute_exists(id)"),
		ExpressionAttributeNames: map[string]string{
			"#wk": "watermarkedS3Key",
			"#st": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":wk": keyVal,
			":st": statusVal,
		},
	})
	if err != nil {
		return fmt.Errorf("CompleteWatermark: dynamodb.UpdateItem photoId=%s: %w", photoId, err)
	}
	return nil
}
