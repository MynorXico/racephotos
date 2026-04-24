package models

// Event represents a photographer's race event stored in DynamoDB.
//
// Status is "active" or "archived". Visibility is "public" or "unlisted" (ADR-0004; v1 always "public").
// ArchivedAt is an empty string when the event is not archived.
type Event struct {
	ID             string  `dynamodbav:"id"             json:"id"`
	PhotographerID string  `dynamodbav:"photographerId" json:"photographerId"`
	Name           string  `dynamodbav:"name"           json:"name"`
	Date           string  `dynamodbav:"date"           json:"date"` // ISO 8601 YYYY-MM-DD
	Location       string  `dynamodbav:"location"       json:"location"`
	PricePerPhoto  float64 `dynamodbav:"pricePerPhoto"  json:"pricePerPhoto"`
	Currency       string  `dynamodbav:"currency"       json:"currency"` // ISO 4217
	WatermarkText  string  `dynamodbav:"watermarkText"  json:"watermarkText"`
	Status         string  `dynamodbav:"status"         json:"status"`     // "active" | "archived"
	Visibility     string  `dynamodbav:"visibility"     json:"visibility"` // "public" | "unlisted"
	ArchivedAt     string  `dynamodbav:"archivedAt"     json:"archivedAt"` // empty if not archived
	CreatedAt      string  `dynamodbav:"createdAt"      json:"createdAt"`
	UpdatedAt      string  `dynamodbav:"updatedAt"      json:"updatedAt"`
	// PhotoCount is a denormalised counter incremented by the watermark Lambda each
	// time a photo transitions to "indexed". Used by the public browsing endpoint
	// to serve "Showing X of Y" without scanning the photos table (ADR-0012).
	PhotoCount int `dynamodbav:"photoCount,omitempty" json:"photoCount,omitempty"`
}
