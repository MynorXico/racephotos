// Lambda: list-event-photos
// HTTP method + route: GET /events/{id}/photos
// Auth: Cognito JWT required
// Story: RS-008 — Photographer views event photos gallery
//
// Environment variables:
//
//	RACEPHOTOS_ENV              required — "local"|"dev"|"qa"|"staging"|"prod"
//	RACEPHOTOS_PHOTOS_TABLE     required — DynamoDB photos table name
//	RACEPHOTOS_EVENTS_TABLE     required — DynamoDB events table name (ownership check)
//	RACEPHOTOS_PHOTO_CDN_DOMAIN required — CloudFront domain for processed bucket
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"github.com/racephotos/list-event-photos/handler"
)

func main() {
	env := os.Getenv("RACEPHOTOS_ENV")
	photosTable := mustGetenv("RACEPHOTOS_PHOTOS_TABLE")
	eventsTable := mustGetenv("RACEPHOTOS_EVENTS_TABLE")
	cdnDomain := mustGetenv("RACEPHOTOS_PHOTO_CDN_DOMAIN")

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	// cold-start: no request context available yet; context.TODO() is intentional here.
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		slog.Error("failed to load AWS config", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ddbClient := dynamodb.NewFromConfig(cfg)

	photoStore := &handler.DynamoPhotoLister{
		Client:    ddbClient,
		TableName: photosTable,
	}
	eventStore := &handler.DynamoEventReader{
		Client:    ddbClient,
		TableName: eventsTable,
	}

	h := &handler.Handler{
		Photos:    photoStore,
		Events:    eventStore,
		CdnDomain: cdnDomain,
	}

	slog.Info("list-event-photos Lambda starting",
		slog.String("env", env),
		slog.String("photosTable", photosTable),
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
