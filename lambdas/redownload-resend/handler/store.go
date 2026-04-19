// Package handler implements POST /purchases/redownload-resend business logic.
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/ses"
	sestypes "github.com/aws/aws-sdk-go-v2/service/ses/types"

	"github.com/racephotos/shared/models"
)

// ── Business-logic interfaces ─────────────────────────────────────────────────

// PurchaseStore looks up approved purchases by runner email.
type PurchaseStore interface {
	GetApprovedPurchasesByEmail(ctx context.Context, email string) ([]models.Purchase, error)
}

// RateLimitStore atomically increments a counter and reports whether the limit
// has been exceeded. Returns (true, nil) when the request is allowed; (false, nil)
// when the rate limit is exceeded.
type RateLimitStore interface {
	IncrementAndCheck(ctx context.Context, key string, windowSeconds int, limit int) (bool, error)
}

// EmailSender sends SES templated emails.
// data is marshalled to JSON and passed as SES TemplateData; use map[string]any
// to support nested arrays required by Handlebars {{#each}} templates.
type EmailSender interface {
	SendTemplatedEmail(ctx context.Context, to, template string, data map[string]any) error
}

// ── DynamoDB client interfaces ────────────────────────────────────────────────

// DynamoQueryClient wraps Query for DynamoPurchaseStore.
type DynamoQueryClient interface {
	Query(ctx context.Context, params *dynamodb.QueryInput, optFns ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
}

// DynamoUpdateClient wraps UpdateItem for DynamoRateLimitStore.
type DynamoUpdateClient interface {
	UpdateItem(ctx context.Context, params *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
}

// SESAPIClient wraps SendTemplatedEmail.
type SESAPIClient interface {
	SendTemplatedEmail(ctx context.Context, params *ses.SendTemplatedEmailInput, optFns ...func(*ses.Options)) (*ses.SendTemplatedEmailOutput, error)
}

// ── DynamoPurchaseStore ───────────────────────────────────────────────────────

// DynamoPurchaseStore implements PurchaseStore by querying runnerEmail-claimedAt-index.
type DynamoPurchaseStore struct {
	Client    DynamoQueryClient
	TableName string
}

// maxApprovedPurchasesPerEmail caps the number of purchases returned to avoid
// unbounded reads. A runner is extremely unlikely to have more than a handful
// of approved purchases; this guard prevents runaway pagination.
const maxApprovedPurchasesPerEmail = 100

func (s *DynamoPurchaseStore) GetApprovedPurchasesByEmail(ctx context.Context, email string) ([]models.Purchase, error) {
	var purchases []models.Purchase
	var lastKey map[string]types.AttributeValue

	// Note: this query uses a FilterExpression on `status` applied after DynamoDB
	// reads all items in the runnerEmail partition. Items with pending or rejected
	// status are read and billed before being discarded. For v1 the volume is low
	// (a few purchases per runner); a future story can add a sparse GSI keyed on
	// approvedAt to push the predicate into the key condition and eliminate the filter.
	for {
		out, err := s.Client.Query(ctx, &dynamodb.QueryInput{
			TableName:              aws.String(s.TableName),
			IndexName:              aws.String("runnerEmail-claimedAt-index"),
			KeyConditionExpression: aws.String("#email = :email"),
			FilterExpression:       aws.String("#status = :approved"),
			// Fetch downloadToken and photoId — enough to build link + photo reference.
			ProjectionExpression: aws.String("#dt, #pid"),
			ExpressionAttributeNames: map[string]string{
				"#email":  "runnerEmail",
				"#status": "status",
				"#dt":     "downloadToken",
				"#pid":    "photoId",
			},
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":email":    &types.AttributeValueMemberS{Value: email},
				":approved": &types.AttributeValueMemberS{Value: models.OrderStatusApproved},
			},
			ExclusiveStartKey: lastKey,
		})
		if err != nil {
			return nil, fmt.Errorf("GetApprovedPurchasesByEmail: Query: %w", err)
		}
		for i, item := range out.Items {
			var p models.Purchase
			if err := attributevalue.UnmarshalMap(item, &p); err != nil {
				return nil, fmt.Errorf("GetApprovedPurchasesByEmail: unmarshal[%d]: %w", i, err)
			}
			purchases = append(purchases, p)
			if len(purchases) >= maxApprovedPurchasesPerEmail {
				return purchases, nil
			}
		}
		if len(out.LastEvaluatedKey) == 0 {
			break
		}
		lastKey = out.LastEvaluatedKey
	}
	return purchases, nil
}

// ── DynamoRateLimitStore ──────────────────────────────────────────────────────

// DynamoRateLimitStore implements RateLimitStore using DynamoDB UpdateItem with
// an atomic counter and TTL. The table is racephotos-rate-limits (RS-001).
type DynamoRateLimitStore struct {
	Client    DynamoUpdateClient
	TableName string
}

// IncrementAndCheck atomically increments the request counter for `key`.
// If the resulting count is within `limit`, it returns (true, nil).
// If the count exceeds `limit`, it returns (false, nil).
// The TTL is anchored to the first request in the window (if_not_exists) so that
// the window is a fixed 1-hour tumbling window, not a sliding window that extends
// on each request.
func (s *DynamoRateLimitStore) IncrementAndCheck(ctx context.Context, key string, windowSeconds int, limit int) (bool, error) {
	out, err := s.Client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(s.TableName),
		Key: map[string]types.AttributeValue{
			"rateLimitKey": &types.AttributeValueMemberS{Value: key},
		},
		UpdateExpression: aws.String("SET #count = if_not_exists(#count, :zero) + :one, #ttl = if_not_exists(#ttl, :ttl)"),
		ExpressionAttributeNames: map[string]string{
			"#count": "count",
			"#ttl":   "expiresAt",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":zero": &types.AttributeValueMemberN{Value: "0"},
			":one":  &types.AttributeValueMemberN{Value: "1"},
			":ttl": &types.AttributeValueMemberN{
				Value: fmt.Sprintf("%d", nowUnix()+int64(windowSeconds)),
			},
		},
		ReturnValues: types.ReturnValueAllNew,
	})
	if err != nil {
		return false, fmt.Errorf("IncrementAndCheck: UpdateItem: %w", err)
	}

	var result struct {
		Count int `dynamodbav:"count"`
	}
	if err := attributevalue.UnmarshalMap(out.Attributes, &result); err != nil {
		return false, fmt.Errorf("IncrementAndCheck: unmarshal: %w", err)
	}

	return result.Count <= limit, nil
}

// nowUnix returns the current Unix timestamp. Isolated for testability.
var nowUnix = func() int64 { return time.Now().Unix() }

// ── SESEmailSender ────────────────────────────────────────────────────────────

// SESEmailSender implements EmailSender using Amazon SES v1 templated emails.
type SESEmailSender struct {
	Client      SESAPIClient
	FromAddress string
}

func (s *SESEmailSender) SendTemplatedEmail(ctx context.Context, to, template string, data map[string]any) error {
	templateDataJSON, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("SendTemplatedEmail: marshal: %w", err)
	}
	_, err = s.Client.SendTemplatedEmail(ctx, &ses.SendTemplatedEmailInput{
		Source: aws.String(s.FromAddress),
		Destination: &sestypes.Destination{
			ToAddresses: []string{to},
		},
		Template:     aws.String(template),
		TemplateData: aws.String(string(templateDataJSON)),
	})
	if err != nil {
		return fmt.Errorf("SendTemplatedEmail: SES: %w", err)
	}
	return nil
}
