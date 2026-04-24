package handler

import (
	"bytes"
	"context"
	"errors"
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

// isDynamoConditionFailed returns true when err is a DynamoDB ConditionalCheckFailedException.
func isDynamoConditionFailed(err error) bool {
	var ccfe *types.ConditionalCheckFailedException
	return errors.As(err, &ccfe)
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
//
// ConditionExpression: attribute_exists(id) AND #st = :watermarking ensures
// the update only applies when the photo is in the expected "watermarking" state.
// If the condition fails (prior attempt already completed), ErrAlreadyCompleted is
// returned so the caller can skip the photoCount increment (RS-019 idempotency).
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
	wmStatusVal, err := attributevalue.Marshal("watermarking")
	if err != nil {
		return fmt.Errorf("CompleteWatermark: marshal watermarking status: %w", err)
	}
	_, err = s.Client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:        aws.String(s.TableName),
		Key:              key,
		UpdateExpression: aws.String("SET #wk = :wk, #st = :st"),
		// Dual condition:
		//   attribute_exists(id)   — guard against ghost-record upserts (original RS-017 guard)
		//   #st = :wm              — idempotency: only apply when status is still "watermarking";
		//                            a retry after a prior successful run will find "indexed" or
		//                            "review_required" and fail here, returning ErrAlreadyCompleted
		//                            so the caller knows to skip IncrementPhotoCount (RS-019).
		ConditionExpression: aws.String("attribute_exists(id) AND #st = :wm"),
		ExpressionAttributeNames: map[string]string{
			"#wk": "watermarkedS3Key",
			"#st": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":wk": keyVal,
			":st": statusVal,
			":wm": wmStatusVal,
		},
	})
	if err != nil {
		if isDynamoConditionFailed(err) {
			return ErrAlreadyCompleted
		}
		return fmt.Errorf("CompleteWatermark: dynamodb.UpdateItem photoId=%s: %w", photoId, err)
	}
	return nil
}

// DynamoEventCountUpdater implements EventCountUpdater against racephotos-events.
type DynamoEventCountUpdater struct {
	Client    DynamoAPI
	TableName string
}

// IncrementPhotoCount atomically increments the photoCount field on the event
// record using a DynamoDB ADD expression (RS-019 / ADR-0012).
// ADD is safe for concurrent Lambda executions — no condition needed because
// the CompleteWatermark idempotency guard in DynamoPhotoStore ensures this is
// called at most once per photo.
func (s *DynamoEventCountUpdater) IncrementPhotoCount(ctx context.Context, eventID string) error {
	key, err := attributevalue.MarshalMap(map[string]string{"id": eventID})
	if err != nil {
		return fmt.Errorf("IncrementPhotoCount: marshal key: %w", err)
	}
	one, err := attributevalue.Marshal(1)
	if err != nil {
		return fmt.Errorf("IncrementPhotoCount: marshal one: %w", err)
	}
	_, err = s.Client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:        aws.String(s.TableName),
		Key:              key,
		UpdateExpression: aws.String("ADD photoCount :one"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":one": one,
		},
	})
	if err != nil {
		return fmt.Errorf("IncrementPhotoCount: dynamodb.UpdateItem eventId=%s: %w", eventID, err)
	}
	return nil
}
