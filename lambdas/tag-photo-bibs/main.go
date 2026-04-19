// Lambda: tag-photo-bibs
// HTTP method + route: PUT /photos/{id}/bibs
// Auth: Cognito JWT required
// Story: RS-013 — Photographer manually tags bib numbers for undetected photos
//
// Environment variables:
//
//	RACEPHOTOS_ENV              required — "local"|"dev"|"qa"|"staging"|"prod"
//	RACEPHOTOS_PHOTOS_TABLE     required — DynamoDB photos table name
//	RACEPHOTOS_BIB_INDEX_TABLE  required — DynamoDB bib-index table name
//	RACEPHOTOS_EVENTS_TABLE     required — DynamoDB events table name
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"github.com/racephotos/tag-photo-bibs/handler"
)

func main() {
	env := os.Getenv("RACEPHOTOS_ENV")
	photosTable := mustGetenv("RACEPHOTOS_PHOTOS_TABLE")
	bibIndexTable := mustGetenv("RACEPHOTOS_BIB_INDEX_TABLE")
	eventsTable := mustGetenv("RACEPHOTOS_EVENTS_TABLE")

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	// cold-start: no request context available yet; context.TODO() is intentional here.
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		slog.Error("failed to load AWS config", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ddbClient := dynamodb.NewFromConfig(cfg)

	photoStore := &handler.DynamoPhotoStore{
		Client:    ddbClient,
		TableName: photosTable,
	}
	bibIndexStore := &handler.DynamoBibIndexStore{
		Client:    ddbClient,
		TableName: bibIndexTable,
	}
	eventStore := &handler.DynamoEventStore{
		Client:    ddbClient,
		TableName: eventsTable,
	}

	h := &handler.Handler{
		Photos:   photoStore,
		BibIndex: bibIndexStore,
		Events:   eventStore,
	}

	slog.Info("tag-photo-bibs Lambda starting", slog.String("env", env))

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
