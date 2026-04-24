// Package handler implements GET /events/{id}/public-photos.
package handler

import (
	"context"
	"errors"

	"github.com/racephotos/shared/models"
)

// ErrInvalidCursor is returned when the cursor query parameter cannot be decoded.
var ErrInvalidCursor = errors.New("invalid cursor")

// ErrEventNotFound is returned when the requested event does not exist.
var ErrEventNotFound = errors.New("event not found")

// EventPhotoLister lists indexed photos for an event using the eventId-uploadedAt-index GSI.
type EventPhotoLister interface {
	// ListEventPhotos returns up to limit indexed photos sorted by uploadedAt DESC.
	// cursor is a base64-encoded DynamoDB LastEvaluatedKey; empty string means first page.
	// Returns (photos, nextCursor, error); nextCursor is empty when no more pages exist.
	ListEventPhotos(ctx context.Context, eventID, cursor string, limit int) ([]models.Photo, string, error)
}

// PublicEventReader reads public event metadata (name, photoCount, pricing) from the events table.
type PublicEventReader interface {
	// GetPublicEvent returns event metadata needed by the public browse endpoint.
	// Returns ErrEventNotFound if the event does not exist.
	GetPublicEvent(ctx context.Context, eventID string) (*models.Event, error)
}
