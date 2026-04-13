// Lambda: create-order
// HTTP method + route: POST /orders
// Auth: none — public, runner-facing
// Story: RS-010 — Runner purchases a photo
//
// Environment variables:
//
//	RACEPHOTOS_ENV                  required — "local"|"dev"|"qa"|"staging"|"prod"
//	RACEPHOTOS_ORDERS_TABLE         required — DynamoDB orders table name
//	RACEPHOTOS_PURCHASES_TABLE      required — DynamoDB purchases table name
//	RACEPHOTOS_PHOTOS_TABLE         required — DynamoDB photos table name
//	RACEPHOTOS_EVENTS_TABLE         required — DynamoDB events table name
//	RACEPHOTOS_PHOTOGRAPHERS_TABLE  required — DynamoDB photographers table name
//	RACEPHOTOS_SES_FROM_ADDRESS     required — verified SES sender address
//	RACEPHOTOS_APPROVALS_URL        required — base URL for photographer dashboard
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/ses"

	"github.com/racephotos/create-order/handler"
)

func main() {
	env := os.Getenv("RACEPHOTOS_ENV")
	ordersTable := mustGetenv("RACEPHOTOS_ORDERS_TABLE")
	purchasesTable := mustGetenv("RACEPHOTOS_PURCHASES_TABLE")
	photosTable := mustGetenv("RACEPHOTOS_PHOTOS_TABLE")
	eventsTable := mustGetenv("RACEPHOTOS_EVENTS_TABLE")
	photographersTable := mustGetenv("RACEPHOTOS_PHOTOGRAPHERS_TABLE")
	sesFromAddress := mustGetenv("RACEPHOTOS_SES_FROM_ADDRESS")
	approvalsURL := mustGetenv("RACEPHOTOS_APPROVALS_URL")

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	// cold-start: no request context available yet; context.TODO() is intentional here.
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		slog.Error("failed to load AWS config", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ddbClient := dynamodb.NewFromConfig(cfg)
	sesClient := ses.NewFromConfig(cfg)

	h := &handler.Handler{
		Orders: &handler.DynamoOrderStore{
			Client:    ddbClient,
			TableName: ordersTable,
		},
		Purchases: &handler.DynamoPurchaseStore{
			Client:    ddbClient,
			TableName: purchasesTable,
		},
		Writer: &handler.DynamoOrderTransacter{
			Client:         ddbClient,
			OrdersTable:    ordersTable,
			PurchasesTable: purchasesTable,
		},
		Photos: &handler.DynamoPhotoStore{
			Client:    ddbClient,
			TableName: photosTable,
		},
		Events: &handler.DynamoEventStore{
			Client:    ddbClient,
			TableName: eventsTable,
		},
		Photographers: &handler.DynamoPhotographerStore{
			Client:    ddbClient,
			TableName: photographersTable,
		},
		Email: &handler.SESEmailSender{
			Client:      sesClient,
			FromAddress: sesFromAddress,
		},
		ApprovalsURL: approvalsURL,
	}

	slog.Info("create-order Lambda starting", slog.String("env", env))
	slog.Debug("create-order Lambda config",
		slog.String("ordersTable", ordersTable),
		slog.String("purchasesTable", purchasesTable),
		slog.String("photosTable", photosTable),
		slog.String("eventsTable", eventsTable),
		slog.String("photographersTable", photographersTable),
	)

	lambda.Start(h.Handle)
}

func mustGetenv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		slog.Error("required env var not set", slog.String("key", key))
		os.Exit(1)
	}
	return v
}
