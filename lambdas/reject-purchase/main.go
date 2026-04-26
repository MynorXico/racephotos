// Lambda: reject-purchase
// HTTP method + route: PUT /purchases/{id}/reject
// Auth: Cognito JWT required (photographer-facing)
// Story: RS-011 — Photographer approves or rejects a purchase claim
//       RS-021 — Adds rejection email to runner with locale-aware SES template
//
// Environment variables:
//
//	RACEPHOTOS_ENV             required — "local"|"dev"|"qa"|"staging"|"prod"
//	RACEPHOTOS_PURCHASES_TABLE required — DynamoDB purchases table name
//	RACEPHOTOS_ORDERS_TABLE    required — DynamoDB orders table name
//	RACEPHOTOS_FROM_EMAIL      required — SES verified sender address
//
// SES template variables:
//
//	racephotos-runner-purchase-rejected-{locale}: eventName
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/ses"

	"github.com/racephotos/reject-purchase/handler"
)

func main() {
	purchasesTable := mustGetenv("RACEPHOTOS_PURCHASES_TABLE")
	ordersTable := mustGetenv("RACEPHOTOS_ORDERS_TABLE")
	fromEmail := mustGetenv("RACEPHOTOS_FROM_EMAIL")

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
		Purchases: &handler.DynamoPurchaseStore{
			Client:    ddbClient,
			TableName: purchasesTable,
		},
		Orders: &handler.DynamoOrderStore{
			Client:    ddbClient,
			TableName: ordersTable,
		},
		Email: &handler.SESEmailSender{
			Client:      sesClient,
			FromAddress: fromEmail,
		},
	}

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
