package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/aws/aws-lambda-go/events"

	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

const presignTTL = 24 * time.Hour

// Handler holds dependencies for GET /download/{token}.
type Handler struct {
	Purchases PurchaseStore
	Photos    PhotoStore
	Presigner PhotoPresigner
	RawBucket string // S3 bucket containing original unwatermarked photos
}

type downloadResponse struct {
	URL string `json:"url"`
}

// Handle processes GET /download/{token}.
// AC1: valid approved token → 200 { "url": "<presignedUrl>" }
// AC2: unknown token or non-approved purchase → 404
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	token := event.PathParameters["token"]
	if token == "" {
		return errResponse(400, "token is required"), nil
	}

	purchase, err := h.Purchases.GetPurchaseByDownloadToken(ctx, token)
	if err != nil {
		if errors.Is(err, apperrors.ErrNotFound) {
			return errResponse(404, "not found"), nil
		}
		slog.ErrorContext(ctx, "GetPurchaseByDownloadToken failed",
			slog.String("service", "get-download"),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	if purchase.Status != models.OrderStatusApproved {
		return errResponse(404, "not found"), nil
	}

	photo, err := h.Photos.GetPhotoByID(ctx, purchase.PhotoID)
	if err != nil {
		if errors.Is(err, apperrors.ErrNotFound) {
			slog.ErrorContext(ctx, "photo not found for approved purchase",
				slog.String("service", "get-download"),
				slog.String("purchaseID", purchase.ID),
			)
			return errResponse(500, "internal server error"), nil
		}
		slog.ErrorContext(ctx, "GetPhotoByID failed",
			slog.String("service", "get-download"),
			slog.String("purchaseID", purchase.ID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	presignedURL, err := h.Presigner.PresignGetObject(ctx, h.RawBucket, photo.RawS3Key, presignTTL)
	if err != nil {
		slog.ErrorContext(ctx, "PresignGetObject failed",
			slog.String("service", "get-download"),
			slog.String("error", fmt.Sprintf("%v", err)),
		)
		return errResponse(500, "internal server error"), nil
	}

	slog.InfoContext(ctx, "presigned download URL generated",
		slog.String("service", "get-download"),
		slog.String("purchaseID", purchase.ID),
	)

	return jsonResponse(200, downloadResponse{URL: presignedURL})
}

type errorBody struct {
	Error string `json:"error"`
}

func errResponse(statusCode int, message string) events.APIGatewayV2HTTPResponse {
	b, _ := json.Marshal(errorBody{Error: message})
	return events.APIGatewayV2HTTPResponse{
		StatusCode: statusCode,
		Headers: map[string]string{
			"Content-Type":  "application/json",
			"Cache-Control": "no-store",
		},
		Body: string(b),
	}
}

func jsonResponse(statusCode int, body any) (events.APIGatewayV2HTTPResponse, error) {
	b, err := json.Marshal(body)
	if err != nil {
		slog.Error("jsonResponse: marshal failed", slog.String("error", err.Error()))
		return errResponse(500, "internal server error"), nil
	}
	return events.APIGatewayV2HTTPResponse{
		StatusCode: statusCode,
		Headers: map[string]string{
			"Content-Type":  "application/json",
			"Cache-Control": "no-store",
		},
		Body: string(b),
	}, nil
}
