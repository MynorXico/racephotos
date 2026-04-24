// Package handler implements GET /events/{id}/photos/search business logic.
package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"sort"
	"strings"

	"github.com/aws/aws-lambda-go/events"

	"github.com/racephotos/shared/apperrors"
	"github.com/racephotos/shared/models"
)

// bibPageSize is the number of photos returned per page in bib search results.
const bibPageSize = 24

// bibCursorMaxIDs is the maximum number of pre-fetched indexed photo IDs stored
// in the cursor. 150 IDs × 36 chars ≈ 5.4 KB raw JSON → ~7.6 KB base64, which
// stays under the API Gateway 8 KB query-string limit. For bibs with > 174
// indexed photos (24 first page + 150 cursor), subsequent pages fall back to a
// full re-fetch.
const bibCursorMaxIDs = 150

// uuidRE validates that an event ID is a standard UUID (case-insensitive).
// This prevents pathological strings from reaching DynamoDB key lookups.
var uuidRE = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// bibRE validates a bib number: 1–8 alphanumeric characters.
// Road-race bibs are typically 1–5 digits; 8 chars accommodates letter suffixes.
// This prevents log injection (newlines, control chars) and unbounded DynamoDB key construction.
var bibRE = regexp.MustCompile(`^[0-9A-Za-z]{1,8}$`)

// safeS3KeyRE accepts only the characters that a well-formed watermarked S3 key may contain.
// This guards against a tampered DynamoDB record injecting an open-redirect URL into the
// watermarkedUrl field returned to runners.
var safeS3KeyRE = regexp.MustCompile(`^[A-Za-z0-9/_.\-]+$`)

// Handler holds dependencies for GET /events/{id}/photos/search.
type Handler struct {
	BibIndex  BibIndexStore
	Photos    PhotoStore
	Events    EventStore
	CdnDomain string
}

// photoItem is the per-photo shape returned to the runner.
// rawS3Key is deliberately omitted — never exposed to the client (domain rule 7).
type photoItem struct {
	PhotoID        string  `json:"photoId"`
	WatermarkedURL string  `json:"watermarkedUrl"`
	CapturedAt     *string `json:"capturedAt,omitempty"`
}

type searchResponse struct {
	Photos        []photoItem `json:"photos"`
	NextCursor    *string     `json:"nextCursor"`
	TotalCount    int         `json:"totalCount"`
	EventName     string      `json:"eventName"`
	PricePerPhoto float64     `json:"pricePerPhoto"`
	Currency      string      `json:"currency"`
}

type eventResult struct {
	event *models.Event
	err   error
}

type bibResult struct {
	photoIDs []string
	err      error
}

// Handle processes an API Gateway v2 HTTP request.
func (h *Handler) Handle(ctx context.Context, event events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	// Normalise to lowercase — UUIDs are case-insensitive but DynamoDB PKs are
	// case-sensitive; events are stored with lowercase IDs.
	eventID := strings.ToLower(event.PathParameters["id"])
	if eventID == "" || !uuidRE.MatchString(eventID) {
		return errResponse(400, "missing or invalid event id"), nil
	}

	bib := event.QueryStringParameters["bib"]
	if bib == "" || !bibRE.MatchString(bib) {
		return errResponse(400, "missing or invalid bib number"), nil
	}

	cursorStr := event.QueryStringParameters["cursor"]
	var bibCur *bibSearchCursor
	if cursorStr != "" {
		bc, err := decodeBibCursor(cursorStr)
		if err != nil {
			return errResponse(400, "invalid cursor"), nil
		}
		bibCur = bc
	}

	// ── Fast path: load-more with pre-fetched IDs from cursor ────────────────
	// On load-more when the cursor contains pre-fetched indexed photo IDs,
	// only BatchGet those IDs (O(page_size)) rather than re-fetching all bib
	// photos (O(total_bib_photos)). GetEvent runs concurrently so event
	// metadata is always returned for consistency.
	if bibCur != nil && len(bibCur.IDs) > 0 {
		evCh := make(chan eventResult, 1)
		go func() {
			ev, err := h.Events.GetEvent(ctx, eventID)
			evCh <- eventResult{event: ev, err: err}
		}()

		thisPage := bibCur.IDs
		if len(thisPage) > bibPageSize {
			thisPage = thisPage[:bibPageSize]
		}
		photos, err := h.Photos.BatchGetPhotos(ctx, thisPage)
		if err != nil {
			// evCh is buffered (cap 1) — the goroutine writes and exits regardless; no drain needed.
			slog.ErrorContext(ctx, "BatchGetPhotos (cursor fast-path) failed",
				slog.String("eventID", eventID),
				slog.String("error", err.Error()),
			)
			return errResponse(500, "internal server error"), nil
		}

		// BatchGetItem returns items in undefined order. Sort by UploadedAt DESC,
		// then ID DESC as tiebreaker — matches eventId-uploadedAt-index GSI behavior
		// where ScanIndexForward=false returns equal-SK items in descending PK order.
		sort.Slice(photos, func(i, j int) bool {
			if photos[i].UploadedAt != photos[j].UploadedAt {
				return photos[i].UploadedAt > photos[j].UploadedAt
			}
			return photos[i].ID > photos[j].ID
		})
		page := buildPageItems(ctx, h.CdnDomain, photos)

		remaining := bibCur.IDs[len(thisPage):]
		var nextCursorPtr *string
		newOffset := bibCur.Offset + len(thisPage)
		if len(remaining) > 0 {
			nc := &bibSearchCursor{IDs: remaining, Offset: newOffset, HasMore: bibCur.HasMore, TotalCount: bibCur.TotalCount}
			if enc, err := encodeBibCursor(nc); err == nil {
				nextCursorPtr = &enc
			}
		} else if bibCur.HasMore {
			// IDs exhausted but more exist — encode a fallback cursor so the
			// next load-more re-fetches from scratch at the correct offset.
			nc := &bibSearchCursor{IDs: nil, Offset: newOffset, HasMore: true, TotalCount: bibCur.TotalCount}
			if enc, err := encodeBibCursor(nc); err == nil {
				nextCursorPtr = &enc
			}
		}

		evRes := <-evCh
		if evRes.err != nil {
			if errors.Is(evRes.err, apperrors.ErrNotFound) {
				return errResponse(404, "event not found"), nil
			}
			slog.ErrorContext(ctx, "GetEvent (cursor fast-path) failed",
				slog.String("eventID", eventID),
				slog.String("error", evRes.err.Error()),
			)
			return errResponse(500, "internal server error"), nil
		}

		return jsonResponse(200, searchResponse{
			Photos:        page,
			NextCursor:    nextCursorPtr,
			TotalCount:    bibCur.TotalCount,
			EventName:     evRes.event.Name,
			PricePerPhoto: evRes.event.PricePerPhoto,
			Currency:      evRes.event.Currency,
		})
	}

	// ── Full fetch path: first request or fallback for very large bibs ────────
	// Run GetEvent and GetPhotoIDsByBib concurrently — both are independent reads.
	evCh2 := make(chan eventResult, 1)
	bibCh := make(chan bibResult, 1)

	go func() {
		ev, err := h.Events.GetEvent(ctx, eventID)
		evCh2 <- eventResult{event: ev, err: err}
	}()

	go func() {
		ids, err := h.BibIndex.GetPhotoIDsByBib(ctx, eventID, bib)
		bibCh <- bibResult{photoIDs: ids, err: err}
	}()

	evRes := <-evCh2
	if evRes.err != nil {
		// bibCh is buffered (capacity 1) so the bib goroutine can write without
		// blocking even after we return — no explicit drain needed.
		if errors.Is(evRes.err, apperrors.ErrNotFound) {
			return errResponse(404, "event not found"), nil
		}
		slog.ErrorContext(ctx, "GetEvent failed",
			slog.String("eventID", eventID),
			slog.String("error", evRes.err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	bibRes := <-bibCh
	if bibRes.err != nil {
		slog.ErrorContext(ctx, "GetPhotoIDsByBib failed",
			slog.String("eventID", eventID),
			slog.String("error", bibRes.err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	// No bib entries — return empty result with event metadata.
	if len(bibRes.photoIDs) == 0 {
		return jsonResponse(200, searchResponse{
			Photos:        []photoItem{},
			NextCursor:    nil,
			TotalCount:    0,
			EventName:     evRes.event.Name,
			PricePerPhoto: evRes.event.PricePerPhoto,
			Currency:      evRes.event.Currency,
		})
	}

	allPhotos, err := h.Photos.BatchGetPhotos(ctx, bibRes.photoIDs)
	if err != nil {
		slog.ErrorContext(ctx, "BatchGetPhotos failed",
			slog.String("eventID", eventID),
			slog.String("error", err.Error()),
		)
		return errResponse(500, "internal server error"), nil
	}

	// Sort by UploadedAt DESC, ID DESC as tiebreaker — matches eventId-uploadedAt-index
	// GSI behavior (ScanIndexForward=false returns equal-SK items in descending PK order).
	sort.Slice(allPhotos, func(i, j int) bool {
		if allPhotos[i].UploadedAt != allPhotos[j].UploadedAt {
			return allPhotos[i].UploadedAt > allPhotos[j].UploadedAt
		}
		return allPhotos[i].ID > allPhotos[j].ID
	})
	// Filter: only indexed photos with a valid watermark key (AC4).
	allIndexed := buildPageItems(ctx, h.CdnDomain, allPhotos)

	// Apply offset from fallback cursor (for very large bibs where pre-fetched IDs
	// were exhausted after bibCursorMaxIDs). For normal first requests, offset is 0.
	offset := 0
	if bibCur != nil {
		offset = bibCur.Offset
	}

	totalCount := len(allIndexed)
	var page []photoItem
	if offset >= totalCount {
		page = []photoItem{}
	} else {
		end := offset + bibPageSize
		if end > totalCount {
			end = totalCount
		}
		page = allIndexed[offset:end]
	}

	// Build cursor: pre-fetch the next bibCursorMaxIDs indexed photo IDs so that
	// subsequent load-more calls can BatchGet only those IDs (O(page_size)).
	var nextCursorPtr *string
	nextOffset := offset + bibPageSize
	if nextOffset < totalCount {
		remaining := allIndexed[nextOffset:]
		take := len(remaining)
		if take > bibCursorMaxIDs {
			take = bibCursorMaxIDs
		}
		// bibIndexMaxResults cap: if len(bibRes.photoIDs) == bibIndexMaxResults,
		// the bib-index may have been truncated — there could be more photos.
		// We set HasMore=true only in that case to trigger a fallback re-fetch.
		hasMore := (nextOffset+take) < totalCount || len(bibRes.photoIDs) >= bibIndexMaxResults
		nc := &bibSearchCursor{
			IDs:        photoItemIDs(remaining[:take]),
			Offset:     nextOffset,
			HasMore:    hasMore,
			TotalCount: totalCount,
		}
		if enc, err := encodeBibCursor(nc); err == nil {
			nextCursorPtr = &enc
		}
	}

	return jsonResponse(200, searchResponse{
		Photos:        page,
		NextCursor:    nextCursorPtr,
		TotalCount:    totalCount,
		EventName:     evRes.event.Name,
		PricePerPhoto: evRes.event.PricePerPhoto,
		Currency:      evRes.event.Currency,
	})
}

// bibSearchCursor is the cursor payload for bib search pagination.
// Pre-fetched IDs allow load-more to BatchGet only O(page_size) items rather
// than re-fetching all bib photos (O(total_bib_photos)) on every page request.
type bibSearchCursor struct {
	// IDs holds pre-fetched indexed photo IDs for the next load-more page.
	// Empty when HasMore is true and IDs were exhausted — triggers a fallback re-fetch.
	IDs []string `json:"i,omitempty"`
	// Offset is the number of indexed photos already served (used in fallback re-fetch).
	Offset int `json:"o"`
	// HasMore is true when more indexed photos exist beyond IDs.
	HasMore bool `json:"m,omitempty"`
	// TotalCount is the total indexed photo count from the initial full fetch.
	TotalCount int `json:"t"`
}

func encodeBibCursor(bc *bibSearchCursor) (string, error) {
	b, err := json.Marshal(bc)
	if err != nil {
		return "", fmt.Errorf("encodeBibCursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func decodeBibCursor(s string) (*bibSearchCursor, error) {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("decodeBibCursor: base64: %w", err)
	}
	var bc bibSearchCursor
	if err := json.Unmarshal(b, &bc); err != nil {
		return nil, fmt.Errorf("decodeBibCursor: unmarshal: %w", err)
	}
	if bc.Offset < 0 {
		return nil, fmt.Errorf("decodeBibCursor: negative offset")
	}
	return &bc, nil
}

// buildPageItems filters photos to indexed-only, validates S3 keys, and builds
// the photoItem slice. Sort order is left to the caller.
func buildPageItems(ctx context.Context, cdnDomain string, photos []models.Photo) []photoItem {
	items := make([]photoItem, 0, len(photos))
	for _, p := range photos {
		if p.Status != models.PhotoStatusIndexed || p.WatermarkedS3Key == "" {
			continue
		}
		if !safeS3KeyRE.MatchString(p.WatermarkedS3Key) || strings.Contains(p.WatermarkedS3Key, "..") {
			slog.WarnContext(ctx, "skipping photo with malformed WatermarkedS3Key",
				slog.String("photoID", p.ID),
			)
			continue
		}
		item := photoItem{
			PhotoID: p.ID,
			// TrimLeft strips all leading slashes — TrimPrefix removes only one,
			// leaving double-slash URLs if a key begins with "//".
			WatermarkedURL: "https://" + cdnDomain + "/" + strings.TrimLeft(p.WatermarkedS3Key, "/"),
		}
		if p.CapturedAt != "" {
			item.CapturedAt = &p.CapturedAt
		}
		items = append(items, item)
	}
	return items
}

// photoItemIDs extracts the PhotoID from each photoItem in order.
func photoItemIDs(items []photoItem) []string {
	ids := make([]string, len(items))
	for i, item := range items {
		ids[i] = item.PhotoID
	}
	return ids
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
		slog.Error("jsonResponse: marshal failed", slog.String("error", err.Error()))
		return errResponse(500, "internal server error"), nil
	}
	// no-store: search results change as photos finish processing; caching would
	// cause runners to see a stale empty result when photos become available.
	return events.APIGatewayV2HTTPResponse{
		StatusCode: statusCode,
		Headers: map[string]string{
			"Content-Type":  "application/json",
			"Cache-Control": "no-store",
		},
		Body: string(b),
	}, nil
}
