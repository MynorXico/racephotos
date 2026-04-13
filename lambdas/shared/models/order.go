package models

// Order status constants.
const (
	OrderStatusPending  = "pending"
	OrderStatusApproved = "approved"
	OrderStatusRejected = "rejected"
)

// Order is the primary purchase entity (ADR-0010).
//
// A single bank transfer for one or more photos from the same event and
// photographer. PaymentRef is the reference the runner quotes to the bank.
// Each photo in the order is a Purchase line item with its own DownloadToken.
//
// RunnerEmail is financial PII — must never appear in log output.
type Order struct {
	ID             string  `dynamodbav:"id"             json:"id"`
	RunnerEmail    string  `dynamodbav:"runnerEmail"    json:"runnerEmail"`
	PaymentRef     string  `dynamodbav:"paymentRef"     json:"paymentRef"`
	TotalAmount    float64 `dynamodbav:"totalAmount"    json:"totalAmount"`
	Currency       string  `dynamodbav:"currency"       json:"currency"` // ISO 4217
	Status         string  `dynamodbav:"status"         json:"status"`   // "pending"|"approved"|"rejected"
	PhotographerID string  `dynamodbav:"photographerId" json:"photographerId"`
	EventID        string  `dynamodbav:"eventId"        json:"eventId"`
	EventName      string  `dynamodbav:"eventName"      json:"eventName"` // denormalized
	ClaimedAt      string  `dynamodbav:"claimedAt"      json:"claimedAt"`
	ApprovedAt     string  `dynamodbav:"approvedAt"     json:"approvedAt,omitempty"`
}
