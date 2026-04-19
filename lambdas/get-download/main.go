// Lambda: get-download
// HTTP method + route: GET /download/{token}
// Auth: none (public — token is the credential)
// Story: RS-012 — Runner downloads a photo via download token
//
// Environment variables:
//
//	RACEPHOTOS_ENV             required — "local"|"dev"|"qa"|"staging"|"prod"
//	RACEPHOTOS_PURCHASES_TABLE required — DynamoDB purchases table name
//	RACEPHOTOS_PHOTOS_TABLE    required — DynamoDB photos table name (Photo lookup for rawS3Key)
//	RACEPHOTOS_RAW_BUCKET      required — S3 bucket containing original unwatermarked photos
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/racephotos/get-download/handler"
)

func main() {
	purchasesTable := mustGetenv("RACEPHOTOS_PURCHASES_TABLE")
	photosTable := mustGetenv("RACEPHOTOS_PHOTOS_TABLE")
	rawBucket := mustGetenv("RACEPHOTOS_RAW_BUCKET")

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		slog.Error("failed to load AWS config", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ddbClient := dynamodb.NewFromConfig(cfg)
	s3Client := s3.NewFromConfig(cfg)

	h := &handler.Handler{
		Purchases: &handler.DynamoPurchaseStore{
			Client:    ddbClient,
			TableName: purchasesTable,
		},
		Photos: &handler.DynamoPhotoStore{
			Client:    ddbClient,
			TableName: photosTable,
		},
		Presigner: &handler.AWSS3GetPresigner{
			Client: s3.NewPresignClient(s3Client),
		},
		RawBucket: rawBucket,
	}

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
