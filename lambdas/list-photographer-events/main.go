// Lambda: list-photographer-events
// HTTP method + route: GET /photographer/me/events
// Auth: Cognito JWT required
// Story: RS-005 — Event management — create, view, edit, archive, share
//
// Environment variables:
//
//	RACEPHOTOS_ENV          required — "local"|"dev"|"qa"|"staging"|"prod"
//	RACEPHOTOS_EVENTS_TABLE required — DynamoDB events table name
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"github.com/racephotos/list-photographer-events/handler"
)

func main() {
	env := os.Getenv("RACEPHOTOS_ENV")
	eventsTable := mustGetenv("RACEPHOTOS_EVENTS_TABLE")

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		slog.Error("failed to load AWS config", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ddbClient := dynamodb.NewFromConfig(cfg)

	store := &handler.DynamoEventLister{
		Client:    ddbClient,
		TableName: eventsTable,
	}

	h := &handler.Handler{Store: store}

	slog.Info("list-photographer-events Lambda starting",
		slog.String("env", env),
		slog.String("eventsTable", eventsTable),
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
