// Lambda: watermark
// Trigger: SQS — racephotos-watermark queue
// Story: RS-007 — Photo processing pipeline — Rekognition + watermark
//
// Environment variables:
//
//	RACEPHOTOS_ENV              required — "local"|"dev"|"qa"|"staging"|"prod"
//	RACEPHOTOS_RAW_BUCKET       required — S3 bucket for original uploads
//	RACEPHOTOS_PROCESSED_BUCKET required — S3 bucket for watermarked photos
//	RACEPHOTOS_PHOTOS_TABLE     required — DynamoDB photos table name
//	RACEPHOTOS_EVENTS_TABLE     required — DynamoDB events table name (read watermarkText)
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/racephotos/watermark/handler"
)

func main() {
	env := mustGetenv("RACEPHOTOS_ENV")
	rawBucket := mustGetenv("RACEPHOTOS_RAW_BUCKET")
	processedBucket := mustGetenv("RACEPHOTOS_PROCESSED_BUCKET")
	photosTable := mustGetenv("RACEPHOTOS_PHOTOS_TABLE")
	eventsTable := mustGetenv("RACEPHOTOS_EVENTS_TABLE")

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		slog.Error("failed to load AWS config", slog.String("error", err.Error()))
		os.Exit(1)
	}

	s3Client := s3.NewFromConfig(cfg)
	ddbClient := dynamodb.NewFromConfig(cfg)

	h := &handler.Handler{
		RawReader: &handler.S3PhotoReader{
			Client: s3Client,
			Bucket: rawBucket,
		},
		ProcessedWriter: &handler.S3PhotoWriter{
			Client: s3Client,
		},
		Watermarker: &handler.GgWatermarker{},
		Events: &handler.DynamoEventStore{
			Client:    ddbClient,
			TableName: eventsTable,
		},
		Photos: &handler.DynamoPhotoStore{
			Client:    ddbClient,
			TableName: photosTable,
		},
		ProcessedBucket: processedBucket,
	}

	slog.Info("watermark Lambda starting",
		slog.String("env", env),
		slog.String("processedBucket", processedBucket),
	)

	lambda.Start(h.ProcessBatch)
}

func mustGetenv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		slog.Error("required env var not set", slog.String("key", key))
		os.Exit(1)
	}
	return v
}
