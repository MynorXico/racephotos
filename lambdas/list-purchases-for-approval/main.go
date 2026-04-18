// Lambda: list-purchases-for-approval
// HTTP method + route: GET /photographer/me/purchases?status=pending
// Auth: Cognito JWT required (photographer-facing)
// Story: RS-011 — Photographer approves or rejects a purchase claim
//
// Environment variables:
//
//	RACEPHOTOS_ENV             required — "local"|"dev"|"qa"|"staging"|"prod"
//	RACEPHOTOS_ORDERS_TABLE    required — DynamoDB orders table name
//	RACEPHOTOS_PURCHASES_TABLE required — DynamoDB purchases table name
//	RACEPHOTOS_PHOTOS_TABLE    required — DynamoDB photos table name
//	RACEPHOTOS_CDN_BASE_URL    required — CloudFront domain for watermarked photos (no trailing slash)
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"github.com/racephotos/list-purchases-for-approval/handler"
)

func main() {
	ordersTable := mustGetenv("RACEPHOTOS_ORDERS_TABLE")
	purchasesTable := mustGetenv("RACEPHOTOS_PURCHASES_TABLE")
	photosTable := mustGetenv("RACEPHOTOS_PHOTOS_TABLE")
	cdnBaseURL := mustGetenv("RACEPHOTOS_CDN_BASE_URL")

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	// cold-start: no request context available yet; context.TODO() is intentional here.
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		slog.Error("failed to load AWS config", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ddbClient := dynamodb.NewFromConfig(cfg)

	h := &handler.Handler{
		Orders: &handler.DynamoOrderStore{
			Client:    ddbClient,
			TableName: ordersTable,
		},
		Purchases: &handler.DynamoPurchaseStore{
			Client:    ddbClient,
			TableName: purchasesTable,
		},
		Photos: &handler.DynamoPhotoStore{
			Client:    ddbClient,
			TableName: photosTable,
		},
		CDNBaseURL: cdnBaseURL,
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
