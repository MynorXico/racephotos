// Package handler implements the GET /photographer/me/events Lambda business logic.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/aws/aws-lambda-go/events"
	"github.com/racephotos/shared/models"
)

const defaultPageSize = 20

// EventLister abstracts the list-by-photographer query on the events table.
type EventLister interface {
	ListEventsByPhotographer(ctx context.Context, photographerID, cursor string, limit int) ([]models.Event, string, error)
}

// Handler holds the dependencies for the GET /photographer/me/events Lambda.
type Handler struct {
	Store EventLister
}

type listEventsResponse struct {
	Events     []models.Event `json:"events"`
	NextCursor string         `json:"nextCursor"`
}

// Handle processes an API Gateway v2 HTTP request.
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	photographerID, ok := extractSub(event)
	if !ok {
		return errResponse(401, "unauthorized"), nil
	}

	cursor := event.QueryStringParameters["cursor"]

	result, nextCursor, err := h.Store.ListEventsByPhotographer(ctx, photographerID, cursor, defaultPageSize)
	if err != nil {
		if errors.Is(err, errInvalidCursor) {
			return errResponse(400, "invalid cursor"), nil
		}
		slog.ErrorContext(ctx, "ListEventsByPhotographer failed",
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	// Never return nil slice — always return an empty array for JSON consistency.
	if result == nil {
		result = []models.Event{}
	}

	return jsonResponse(200, listEventsResponse{
		Events:     result,
		NextCursor: nextCursor,
	})
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
