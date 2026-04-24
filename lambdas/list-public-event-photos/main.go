// Lambda: list-public-event-photos
// HTTP method + route: GET /events/{id}/public-photos
// Auth: none — public, unauthenticated endpoint
// Story: RS-019 — Paginated photo browsing for runners
//
// Environment variables:
//
//	RACEPHOTOS_ENV              required — "local"|"dev"|"qa"|"staging"|"prod"
//	RACEPHOTOS_PHOTOS_TABLE     required — DynamoDB photos table name
//	RACEPHOTOS_EVENTS_TABLE     required — DynamoDB events table name (photoCount read)
//	RACEPHOTOS_PHOTO_CDN_DOMAIN required — CloudFront domain for constructing watermarkedUrl
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"github.com/racephotos/list-public-event-photos/handler"
)

func main() {
	env := mustGetenv("RACEPHOTOS_ENV")
	photosTable := mustGetenv("RACEPHOTOS_PHOTOS_TABLE")
	eventsTable := mustGetenv("RACEPHOTOS_EVENTS_TABLE")
	cdnDomain := mustGetenv("RACEPHOTOS_PHOTO_CDN_DOMAIN")

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		slog.Error("failed to load AWS config", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ddbClient := dynamodb.NewFromConfig(cfg)

	h := &handler.Handler{
		Photos: &handler.DynamoEventPhotoLister{
			Client:    ddbClient,
			TableName: photosTable,
		},
		Events: &handler.DynamoPublicEventReader{
			Client:    ddbClient,
			TableName: eventsTable,
		},
		CdnDomain: cdnDomain,
	}

	slog.Info("list-public-event-photos Lambda starting",
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
