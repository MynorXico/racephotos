// Lambda: search
// HTTP method + route: GET /events/{id}/photos/search
// Auth: none — public, runner-facing
// Story: RS-009 — Runner searches for photos by bib number
//
// Environment variables:
//
//	RACEPHOTOS_ENV              required — "local"|"dev"|"qa"|"staging"|"prod"
//	RACEPHOTOS_BIB_INDEX_TABLE  required — DynamoDB bib-index table name
//	RACEPHOTOS_PHOTOS_TABLE     required — DynamoDB photos table name
//	RACEPHOTOS_EVENTS_TABLE     required — DynamoDB events table name
//	RACEPHOTOS_PHOTO_CDN_DOMAIN required — CloudFront domain for watermarked photos
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"github.com/racephotos/search/handler"
)

func main() {
	env := os.Getenv("RACEPHOTOS_ENV")
	bibIndexTable := mustGetenv("RACEPHOTOS_BIB_INDEX_TABLE")
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

	bibIndex := &handler.DynamoBibIndexReader{
		Client:    ddbClient,
		TableName: bibIndexTable,
	}
	photos := &handler.DynamoPhotoBatchGetter{
		Client:    ddbClient,
		TableName: photosTable,
	}
	evStore := &handler.DynamoEventGetter{
		Client:    ddbClient,
		TableName: eventsTable,
	}

	h := &handler.Handler{
		BibIndex:  bibIndex,
		Photos:    photos,
		Events:    evStore,
		CdnDomain: cdnDomain,
	}

	slog.Info("search Lambda starting",
		slog.String("env", env),
		slog.String("bibIndexTable", bibIndexTable),
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
