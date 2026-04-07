// Package handler implements the PUT /events/{id}/archive Lambda business logic.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/aws/aws-lambda-go/events"

	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

// EventArchiver abstracts the archive operation on the events table.
type EventArchiver interface {
	ArchiveEvent(ctx context.Context, id, callerID string) (*models.Event, error)
}

// Handler holds the dependencies for the PUT /events/{id}/archive Lambda.
type Handler struct {
	Store EventArchiver
}

// Handle processes an API Gateway v2 HTTP request.
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	callerID, ok := extractSub(event)
	if !ok {
		return errResponse(401, "unauthorized"), nil
	}

	id := event.PathParameters["id"]
	if id == "" {
		return errResponse(400, "id path parameter is required"), nil
	}

	archived, err := h.Store.ArchiveEvent(ctx, id, callerID)
	if err != nil {
		if errors.Is(err, apperrors.ErrForbidden) {
			return errResponse(403, "forbidden"), nil
		}
		if errors.Is(err, apperrors.ErrNotFound) {
			return errResponse(404, "event not found"), nil
		}
		slog.ErrorContext(ctx, "ArchiveEvent failed",
			slog.String("error", err.Error()),
			slog.String("id", id),
			slog.String("callerId", callerID),
		)
		return errResponse(500, "internal server error"), nil
	}

	return jsonResponse(200, archived)
}

// extractSub returns the Cognito sub claim from the JWT authorizer context.
func extractSub(event events.APIGatewayV2HTTPRequest) (string, bool) {
	if event.RequestContext.Authorizer == nil {
		return "", false
	}
	if event.RequestContext.Authorizer.JWT == nil {
		return "", false
	}
	sub, ok := event.RequestContext.Authorizer.JWT.Claims["sub"]
	return sub, ok && sub != ""
}

type errorBody struct {
	Error string `json:"error"`
}

func errResponse(statusCode int, message string) events.APIGatewayV2HTTPResponse {
	b, err := json.Marshal(errorBody{Error: message})
	if err != nil {
		b = []byte(`{"error":"internal server error"}`)
	}
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
		return errResponse(500, "internal server error"), fmt.Errorf("jsonResponse: marshal: %w", err)
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
