package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/sqs"

	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

// DynamoAPI is the minimal DynamoDB surface used by all stores in this package.
type DynamoAPI interface {
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	UpdateItem(ctx context.Context, params *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
	BatchWriteItem(ctx context.Context, params *dynamodb.BatchWriteItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.BatchWriteItemOutput, error)
}

// SQSAPI is the minimal SQS surface used by SqsWatermarkQueue.
type SQSAPI interface {
	SendMessage(ctx context.Context, params *sqs.SendMessageInput, optFns ...func(*sqs.Options)) (*sqs.SendMessageOutput, error)
}

// ── Photo store ───────────────────────────────────────────────────────────────

// DynamoPhotoStore implements PhotoStore against racephotos-photos.
type DynamoPhotoStore struct {
	Client    DynamoAPI
	TableName string
}

// GetPhotoById retrieves a Photo record by its primary key.
// Uses a consistent read to avoid eventual-consistency misses immediately after upload
// (the upload Lambda writes the record before the S3 PUT that triggers this Lambda).
// Returns apperrors.ErrNotFound when the item does not exist.
func (s *DynamoPhotoStore) GetPhotoById(ctx context.Context, id string) (*models.Photo, error) {
	key, err := attributevalue.MarshalMap(map[string]string{"id": id})
	if err != nil {
		return nil, fmt.Errorf("GetPhotoById: marshal key: %w", err)
	}
	out, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      aws.String(s.TableName),
		Key:            key,
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("GetPhotoById: dynamodb.GetItem: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, apperrors.ErrNotFound
	}
	var photo models.Photo
	if err := attributevalue.UnmarshalMap(out.Item, &photo); err != nil {
		return nil, fmt.Errorf("GetPhotoById: unmarshal: %w", err)
	}
	return &photo, nil
}

// UpdatePhotoStatus writes a partial update to a Photo record.
// All attribute names are aliased via ExpressionAttributeNames to guard against
// DynamoDB reserved-word collisions (CLAUDE.md mandate).
func (s *DynamoPhotoStore) UpdatePhotoStatus(ctx context.Context, id string, update models.PhotoStatusUpdate) error {
	key, err := attributevalue.MarshalMap(map[string]string{"id": id})
	if err != nil {
		return fmt.Errorf("UpdatePhotoStatus: marshal key: %w", err)
	}

	exprNames := map[string]string{"#st": "status"}
	exprValues := map[string]types.AttributeValue{}
	setExpr := "SET #st = :status"

	statusVal, err := attributevalue.Marshal(update.Status)
	if err != nil {
		return fmt.Errorf("UpdatePhotoStatus: marshal status: %w", err)
	}
	exprValues[":status"] = statusVal

	if len(update.BibNumbers) > 0 {
		var bibVal types.AttributeValue
		bibVal, err = attributevalue.Marshal(update.BibNumbers)
		if err != nil {
			return fmt.Errorf("UpdatePhotoStatus: marshal bibNumbers: %w", err)
		}
		exprValues[":bibs"] = bibVal
		exprNames["#bn"] = "bibNumbers"
		setExpr += ", #bn = :bibs"
	}

	if update.RekognitionConfidence > 0 {
		var confVal types.AttributeValue
		confVal, err = attributevalue.Marshal(update.RekognitionConfidence)
		if err != nil {
			return fmt.Errorf("UpdatePhotoStatus: marshal confidence: %w", err)
		}
		exprValues[":conf"] = confVal
		exprNames["#rc"] = "rekognitionConfidence"
		setExpr += ", #rc = :conf"
	}

	// ConditionExpression prevents silent ghost-record creation if the photo was
	// deleted between GetPhotoById and this write (defence-in-depth; mirrors the
	// guard used in CompleteWatermark in the watermark Lambda).
	_, err = s.Client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 aws.String(s.TableName),
		Key:                       key,
		UpdateExpression:          aws.String(setExpr),
		ConditionExpression:       aws.String("attribute_exists(id)"),
		ExpressionAttributeNames:  exprNames,
		ExpressionAttributeValues: exprValues,
	})
	if err != nil {
		return fmt.Errorf("UpdatePhotoStatus: dynamodb.UpdateItem: %w", err)
	}
	return nil
}

// ── BibIndex store ────────────────────────────────────────────────────────────

const dynamoBatchSize = 25

// DynamoBibIndexStore implements BibIndexStore against racephotos-bib-index.
type DynamoBibIndexStore struct {
	Client    DynamoAPI
	TableName string
}

// WriteBibEntries writes one item per (bibKey, photoId) pair using BatchWriteItem.
// Unprocessed items are retried once.
func (s *DynamoBibIndexStore) WriteBibEntries(ctx context.Context, entries []models.BibEntry) error {
	for i := 0; i < len(entries); i += dynamoBatchSize {
		end := i + dynamoBatchSize
		if end > len(entries) {
			end = len(entries)
		}
		if err := s.writeChunk(ctx, entries[i:end]); err != nil {
			return err
		}
	}
	return nil
}

func (s *DynamoBibIndexStore) writeChunk(ctx context.Context, chunk []models.BibEntry) error {
	reqs := make([]types.WriteRequest, len(chunk))
	for i, e := range chunk {
		item, err := attributevalue.MarshalMap(e)
		if err != nil {
			return fmt.Errorf("WriteBibEntries: marshal entry: %w", err)
		}
		reqs[i] = types.WriteRequest{PutRequest: &types.PutRequest{Item: item}}
	}

	out, err := s.Client.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
		RequestItems: map[string][]types.WriteRequest{s.TableName: reqs},
	})
	if err != nil {
		return fmt.Errorf("WriteBibEntries: dynamodb.BatchWriteItem: %w", err)
	}
	if len(out.UnprocessedItems) > 0 {
		retry, err := s.Client.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
			RequestItems: out.UnprocessedItems,
		})
		if err != nil {
			return fmt.Errorf("WriteBibEntries: retry unprocessed: %w", err)
		}
		if len(retry.UnprocessedItems) > 0 {
			return fmt.Errorf("WriteBibEntries: items still unprocessed after retry")
		}
	}
	return nil
}

// ── Watermark queue ───────────────────────────────────────────────────────────

// SqsWatermarkQueue implements WatermarkQueue against racephotos-watermark.
type SqsWatermarkQueue struct {
	Client   SQSAPI
	QueueURL string
}

// SendWatermarkMessage serialises msg to JSON and publishes it to the watermark queue.
func (q *SqsWatermarkQueue) SendWatermarkMessage(ctx context.Context, msg models.WatermarkMessage) error {
	body, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("SendWatermarkMessage: marshal: %w", err)
	}
	_, err = q.Client.SendMessage(ctx, &sqs.SendMessageInput{
		QueueUrl:    aws.String(q.QueueURL),
		MessageBody: aws.String(string(body)),
	})
	if err != nil {
		return fmt.Errorf("SendWatermarkMessage: sqs.SendMessage: %w", err)
	}
	return nil
}
