//go:build integration

// Package integration provides integration tests for the create-order Lambda.
// Tests run against a live LocalStack instance via the DynamoDB store implementations.
//
// Prerequisites:
//
//	docker-compose up -d    (start LocalStack)
//	make seed-local         (create tables and seed test data)
//
// Run with:
//
//	make test-integration
package integration

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/aws/aws-lambda-go/events"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dynamotypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/racephotos/create-order/handler"
	"github.com/racephotos/shared/models"
)

const (
	localEndpoint       = "http://localhost:4566"
	ordersTable         = "racephotos-orders"
	purchasesTable      = "racephotos-purchases"
	photosTable         = "racephotos-photos"
	eventsTable         = "racephotos-events"
	photographersTable  = "racephotos-photographers"
	testApprovalsURL    = "https://example.com/approvals"
	testSESFromAddress  = "noreply@example.com"
)

func newDDBClient(t *testing.T) *dynamodb.Client {
	t.Helper()
	cfg, err := awsconfig.LoadDefaultConfig(context.Background(),
		awsconfig.WithBaseEndpoint(localEndpoint),
	)
	require.NoError(t, err)
	return dynamodb.NewFromConfig(cfg)
}

// noopEmailSender satisfies the EmailSender interface without actually sending email.
type noopEmailSender struct{}

func (n *noopEmailSender) SendTemplatedEmail(_ context.Context, _, _ string, _ map[string]string) error {
	return nil
}

func seedPhotographer(t *testing.T, client *dynamodb.Client, pg models.Photographer) {
	t.Helper()
	item, err := attributevalue.MarshalMap(pg)
	require.NoError(t, err)
	_, err = client.PutItem(context.Background(), &dynamodb.PutItemInput{
		TableName: strPtr(photographersTable),
		Item:      item,
	})
	require.NoError(t, err)
}

func seedEvent(t *testing.T, client *dynamodb.Client, ev models.Event) {
	t.Helper()
	item, err := attributevalue.MarshalMap(ev)
	require.NoError(t, err)
	_, err = client.PutItem(context.Background(), &dynamodb.PutItemInput{
		TableName: strPtr(eventsTable),
		Item:      item,
	})
	require.NoError(t, err)
}

func seedPhoto(t *testing.T, client *dynamodb.Client, p models.Photo) {
	t.Helper()
	item, err := attributevalue.MarshalMap(p)
	require.NoError(t, err)
	_, err = client.PutItem(context.Background(), &dynamodb.PutItemInput{
		TableName: strPtr(photosTable),
		Item:      item,
	})
	require.NoError(t, err)
}

func makeBody(photoIDs []string, email string) string {
	b, _ := json.Marshal(map[string]interface{}{
		"photoIds":    photoIDs,
		"runnerEmail": email,
	})
	return string(b)
}

func strPtr(s string) *string { return &s }

func TestIntegration_CreateOrder_HappyPath(t *testing.T) {
	client := newDDBClient(t)
	ctx := context.Background()

	photographerID := uuid.New().String()
	eventID := uuid.New().String()
	photoID := uuid.New().String()
	runnerEmail := "runner-" + uuid.New().String()[:8] + "@example.com"

	pg := models.Photographer{
		ID:                photographerID,
		Email:             "photographer@example.com",
		DisplayName:       "Test Photographer",
		BankName:          "Test Bank",
		BankAccountNumber: "9999999999",
		BankAccountHolder: "Test Holder",
		BankInstructions:  "No instructions",
	}
	ev := models.Event{
		ID:             eventID,
		PhotographerID: photographerID,
		Name:           "Integration Test Race",
		PricePerPhoto:  50.0,
		Currency:       "GTQ",
	}
	photo := models.Photo{
		ID:               photoID,
		EventID:          eventID,
		Status:           models.PhotoStatusIndexed,
		WatermarkedS3Key: "processed/photo.jpg",
		UploadedAt:       time.Now().UTC().Format(time.RFC3339),
	}

	seedPhotographer(t, client, pg)
	seedEvent(t, client, ev)
	seedPhoto(t, client, photo)

	h := &handler.Handler{
		Orders: &handler.DynamoOrderStore{
			Client:    client,
			TableName: ordersTable,
		},
		Purchases: &handler.DynamoPurchaseStore{
			Client:    client,
			TableName: purchasesTable,
		},
		Photos: &handler.DynamoPhotoStore{
			Client:    client,
			TableName: photosTable,
		},
		Events: &handler.DynamoEventStore{
			Client:    client,
			TableName: eventsTable,
		},
		Photographers: &handler.DynamoPhotographerStore{
			Client:    client,
			TableName: photographersTable,
		},
		Email:        &noopEmailSender{},
		ApprovalsURL: testApprovalsURL,
	}

	resp, err := h.Handle(ctx, events.APIGatewayV2HTTPRequest{
		Body: makeBody([]string{photoID}, runnerEmail),
	})
	require.NoError(t, err)
	assert.Equal(t, 201, resp.StatusCode)

	var body map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(resp.Body), &body))
	orderID, ok := body["orderId"].(string)
	require.True(t, ok)
	assert.NotEmpty(t, orderID)
	assert.Regexp(t, `^RS-[A-Z0-9]{8}$`, body["paymentRef"])
	assert.Equal(t, 50.0, body["totalAmount"])
	assert.Equal(t, "GTQ", body["currency"])

	// Verify Order was persisted in DynamoDB.
	orderOut, err := client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: strPtr(ordersTable),
		Key: map[string]dynamotypes.AttributeValue{
			"id": &dynamotypes.AttributeValueMemberS{Value: orderID},
		},
	})
	require.NoError(t, err)
	assert.NotEmpty(t, orderOut.Item)

	var persistedOrder models.Order
	require.NoError(t, attributevalue.UnmarshalMap(orderOut.Item, &persistedOrder))
	assert.Equal(t, models.OrderStatusPending, persistedOrder.Status)
	assert.Equal(t, eventID, persistedOrder.EventID)
	assert.Equal(t, photographerID, persistedOrder.PhotographerID)
}

func TestIntegration_CreateOrder_Idempotent(t *testing.T) {
	client := newDDBClient(t)
	ctx := context.Background()

	photographerID := uuid.New().String()
	eventID := uuid.New().String()
	photoID := uuid.New().String()
	runnerEmail := "idempotent-" + uuid.New().String()[:8] + "@example.com"

	pg := models.Photographer{
		ID:    photographerID,
		Email: "photographer@example.com",
	}
	ev := models.Event{
		ID:             eventID,
		PhotographerID: photographerID,
		Name:           "Idempotency Test Race",
		PricePerPhoto:  40.0,
		Currency:       "GTQ",
	}
	photo := models.Photo{
		ID:               photoID,
		EventID:          eventID,
		Status:           models.PhotoStatusIndexed,
		WatermarkedS3Key: "processed/photo.jpg",
		UploadedAt:       time.Now().UTC().Format(time.RFC3339),
	}

	seedPhotographer(t, client, pg)
	seedEvent(t, client, ev)
	seedPhoto(t, client, photo)

	h := &handler.Handler{
		Orders: &handler.DynamoOrderStore{
			Client:    client,
			TableName: ordersTable,
		},
		Purchases: &handler.DynamoPurchaseStore{
			Client:    client,
			TableName: purchasesTable,
		},
		Photos: &handler.DynamoPhotoStore{
			Client:    client,
			TableName: photosTable,
		},
		Events: &handler.DynamoEventStore{
			Client:    client,
			TableName: eventsTable,
		},
		Photographers: &handler.DynamoPhotographerStore{
			Client:    client,
			TableName: photographersTable,
		},
		Email:        &noopEmailSender{},
		ApprovalsURL: testApprovalsURL,
	}

	req := events.APIGatewayV2HTTPRequest{Body: makeBody([]string{photoID}, runnerEmail)}

	// First call → 201.
	resp1, err := h.Handle(ctx, req)
	require.NoError(t, err)
	assert.Equal(t, 201, resp1.StatusCode)

	var body1 map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(resp1.Body), &body1))
	firstOrderID := body1["orderId"].(string)

	// Second call → 200 (idempotent), same orderId.
	resp2, err := h.Handle(ctx, req)
	require.NoError(t, err)
	assert.Equal(t, 200, resp2.StatusCode)

	var body2 map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(resp2.Body), &body2))
	assert.Equal(t, firstOrderID, body2["orderId"])
}

func TestIntegration_CreateOrder_PhotoNotFound(t *testing.T) {
	client := newDDBClient(t)
	ctx := context.Background()

	h := &handler.Handler{
		Orders: &handler.DynamoOrderStore{
			Client:    client,
			TableName: ordersTable,
		},
		Purchases: &handler.DynamoPurchaseStore{
			Client:    client,
			TableName: purchasesTable,
		},
		Photos: &handler.DynamoPhotoStore{
			Client:    client,
			TableName: photosTable,
		},
		Events: &handler.DynamoEventStore{
			Client:    client,
			TableName: eventsTable,
		},
		Photographers: &handler.DynamoPhotographerStore{
			Client:    client,
			TableName: photographersTable,
		},
		Email:        &noopEmailSender{},
		ApprovalsURL: testApprovalsURL,
	}

	resp, err := h.Handle(ctx, events.APIGatewayV2HTTPRequest{
		Body: makeBody([]string{uuid.New().String()}, "runner@example.com"),
	})
	require.NoError(t, err)
	assert.Equal(t, 404, resp.StatusCode)
}
