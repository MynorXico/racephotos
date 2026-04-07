// Lambda: create-event
// HTTP method + route: POST /events
// Auth: Cognito JWT required
// Story: RS-005 — Event management — create, view, edit, archive, share
//
// Environment variables:
//
//	RACEPHOTOS_ENV                  required — "local"|"dev"|"qa"|"staging"|"prod"
//	RACEPHOTOS_EVENTS_TABLE         required — DynamoDB events table name
//	RACEPHOTOS_PHOTOGRAPHERS_TABLE  required — DynamoDB photographers table name
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"github.com/racephotos/create-event/handler"
)

func main() {
	env := os.Getenv("RACEPHOTOS_ENV")
	eventsTable := mustGetenv("RACEPHOTOS_EVENTS_TABLE")
	photographersTable := mustGetenv("RACEPHOTOS_PHOTOGRAPHERS_TABLE")

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		slog.Error("failed to load AWS config", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ddbClient := dynamodb.NewFromConfig(cfg)

	eventStore := &handler.DynamoEventCreator{
		Client:    ddbClient,
		TableName: eventsTable,
	}
	photographerStore := &handler.DynamoPhotographerReader{
		Client:    ddbClient,
		TableName: photographersTable,
	}

	h := &handler.Handler{
		Events:        eventStore,
		Photographers: photographerStore,
	}

	slog.Info("create-event Lambda starting",
		slog.String("env", env),
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
