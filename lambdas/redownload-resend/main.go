// Lambda: redownload-resend
// HTTP method + route: POST /purchases/redownload-resend
// Auth: none (public — runner recovery flow)
// Story: RS-012 — Runner downloads a photo via download token
//
// Environment variables:
//
//	RACEPHOTOS_ENV              required — "local"|"dev"|"qa"|"staging"|"prod"
//	RACEPHOTOS_PURCHASES_TABLE  required — DynamoDB purchases table name
//	RACEPHOTOS_SES_FROM_ADDRESS required — verified SES sender address
//	RACEPHOTOS_RATE_LIMITS_TABLE required — DynamoDB rate-limits table name
//	RACEPHOTOS_APP_BASE_URL     required — base URL for download links in email (no trailing slash)
package main

import (
	"context"
	"log/slog"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/ses"

	"github.com/racephotos/redownload-resend/handler"
)

func main() {
	purchasesTable := mustGetenv("RACEPHOTOS_PURCHASES_TABLE")
	sesFromAddress := mustGetenv("RACEPHOTOS_SES_FROM_ADDRESS")
	rateLimitsTable := mustGetenv("RACEPHOTOS_RATE_LIMITS_TABLE")
	appBaseURL := strings.TrimSuffix(mustGetenv("RACEPHOTOS_APP_BASE_URL"), "/")

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

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
		RateLimit: &handler.DynamoRateLimitStore{
			Client:    ddbClient,
			TableName: rateLimitsTable,
		},
		Email: &handler.SESEmailSender{
			Client:      sesClient,
			FromAddress: sesFromAddress,
		},
		AppBaseURL: appBaseURL,
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
