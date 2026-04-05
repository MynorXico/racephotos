package apperrors

import "errors"

// Sentinel errors — return these from business logic; map to HTTP status codes in handlers.
var (
	// ErrNotFound is returned when the requested resource does not exist.
	ErrNotFound = errors.New("not found")

	// ErrForbidden is returned when the caller does not own the requested resource.
	ErrForbidden = errors.New("forbidden")

	// ErrValidation is returned when the request body fails validation.
	ErrValidation = errors.New("validation error")

	// ErrConflict is returned when the operation would create a duplicate resource.
	ErrConflict = errors.New("conflict")
)
