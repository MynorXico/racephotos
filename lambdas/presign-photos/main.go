// Lambda: presign-photos
// HTTP method + route: POST /events/{eventId}/photos/presign
// Auth: Cognito JWT required
// Story: RS-006 — Bulk photo upload — batch presign + upload UI
//
// Environment variables:
//
//	RACEPHOTOS_ENV              required — "local"|"dev"|"qa"|"staging"|"prod"
//	RACEPHOTOS_RAW_BUCKET       required — S3 bucket for original uploads
//	RACEPHOTOS_PHOTOS_TABLE     required — DynamoDB photos table name
//	RACEPHOTOS_EVENTS_TABLE     required — DynamoDB events table name (ownership check)
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/racephotos/presign-photos/handler"
)

func main() {
	env := mustGetenv("RACEPHOTOS_ENV")
	rawBucket := mustGetenv("RACEPHOTOS_RAW_BUCKET")
	photosTable := mustGetenv("RACEPHOTOS_PHOTOS_TABLE")
	eventsTable := mustGetenv("RACEPHOTOS_EVENTS_TABLE")

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		slog.Error("failed to load AWS config", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ddbClient := dynamodb.NewFromConfig(cfg)
	s3Client := s3.NewFromConfig(cfg)

	photoStore := &handler.DynamoPhotoStore{
		Client:    ddbClient,
		TableName: photosTable,
	}
	eventReader := &handler.DynamoEventReader{
		Client:    ddbClient,
		TableName: eventsTable,
	}
	presigner := &handler.AWSS3Presigner{
		Client: s3.NewPresignClient(s3Client),
	}

	h := &handler.Handler{
		Events:    eventReader,
		Photos:    photoStore,
		Presigner: presigner,
		RawBucket: rawBucket,
		Env:       env,
	}

	slog.Info("presign-photos Lambda starting",
		slog.String("env", env),
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
