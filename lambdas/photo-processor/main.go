// Lambda: photo-processor
// Trigger: SQS — racephotos-processing queue (S3 ObjectCreated notifications)
// Story: RS-007 — Photo processing pipeline — Rekognition + watermark
//
// Environment variables:
//
//	RACEPHOTOS_ENV                  required — "local"|"dev"|"qa"|"staging"|"prod"
//	RACEPHOTOS_RAW_BUCKET           required — S3 bucket for original uploads
//	RACEPHOTOS_PHOTOS_TABLE         required — DynamoDB photos table name
//	RACEPHOTOS_BIB_INDEX_TABLE      required — DynamoDB bib-index table name
//	RACEPHOTOS_WATERMARK_QUEUE_URL  required — SQS URL for watermark queue
//	RACEPHOTOS_CONFIDENCE_MIN       optional — float in [0,1], default 0.80
package main

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/rekognition"
	"github.com/aws/aws-sdk-go-v2/service/sqs"

	"github.com/racephotos/photo-processor/handler"
	"github.com/racephotos/photo-processor/internal/rekmock"
)

func main() {
	env := mustGetenv("RACEPHOTOS_ENV")
	photosTable := mustGetenv("RACEPHOTOS_PHOTOS_TABLE")
	bibIndexTable := mustGetenv("RACEPHOTOS_BIB_INDEX_TABLE")
	watermarkQueueURL := mustGetenv("RACEPHOTOS_WATERMARK_QUEUE_URL")

	confidenceMin := 0.80
	if v := os.Getenv("RACEPHOTOS_CONFIDENCE_MIN"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			confidenceMin = f
		}
	}

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		slog.Error("failed to load AWS config", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ddbClient := dynamodb.NewFromConfig(cfg)
	sqsClient := sqs.NewFromConfig(cfg)

	photoStore := &handler.DynamoPhotoStore{
		Client:    ddbClient,
		TableName: photosTable,
	}
	bibIndexStore := &handler.DynamoBibIndexStore{
		Client:    ddbClient,
		TableName: bibIndexTable,
	}
	watermarkQueue := &handler.SqsWatermarkQueue{
		Client:   sqsClient,
		QueueURL: watermarkQueueURL,
	}

	var detector handler.TextDetector
	if env == "local" {
		// AC6: wire file-backed Rekognition mock for local development.
		detector = &rekmock.FileBackedDetector{
			TestdataDir: filepath.Join("testdata", "rekognition-responses"),
		}
		slog.Info("photo-processor using file-backed Rekognition mock",
			slog.String("testdataDir", "testdata/rekognition-responses"),
		)
	} else {
		detector = rekognition.NewFromConfig(cfg)
	}

	h := &handler.Handler{
		Detector:      detector,
		Photos:        photoStore,
		BibIndex:      bibIndexStore,
		WatermarkQ:    watermarkQueue,
		ConfidenceMin: confidenceMin,
	}

	slog.Info("photo-processor Lambda starting",
		slog.String("env", env),
		slog.String("photosTable", photosTable),
		slog.String("bibIndexTable", bibIndexTable),
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
