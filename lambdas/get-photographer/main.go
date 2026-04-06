// Lambda: get-photographer
// HTTP method + route: GET /photographer/me
// Auth: Cognito JWT required
// Story: RS-004 — Photographer account — auth shell + profile setup
//
// Environment variables:
//
//	RACEPHOTOS_ENV                 required — "local"|"dev"|"qa"|"staging"|"prod"
//	RACEPHOTOS_PHOTOGRAPHERS_TABLE required — DynamoDB table name
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"github.com/racephotos/get-photographer/handler"
)

func main() {
	env := os.Getenv("RACEPHOTOS_ENV")
	tableName := mustGetenv("RACEPHOTOS_PHOTOGRAPHERS_TABLE")

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		slog.Error("failed to load AWS config", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ddbClient := dynamodb.NewFromConfig(cfg)

	store := &handler.DynamoStore{
		Client:    ddbClient,
		TableName: tableName,
	}

	h := &handler.Handler{Store: store}

	slog.Info("get-photographer Lambda starting",
		slog.String("env", env),
		slog.String("table", tableName),
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
