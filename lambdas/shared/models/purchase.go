package models

// Purchase is a line item within an Order (ADR-0010).
//
// Each photo in an Order becomes one Purchase record. DownloadToken is set at
// approval time; it is empty before the Order is approved.
//
// RunnerEmail is denormalized from the parent Order for download history lookups
// (runnerEmail-claimedAt-index on racephotos-purchases).
//
// Locale is denormalized from the parent Order so redownload-resend can select
// the correct SES template without a serial GetOrder call.
//
// Status mirrors the parent Order's status and is set atomically at approval.
type Purchase struct {
	ID            string  `dynamodbav:"id"            json:"id"`
	OrderID       string  `dynamodbav:"orderId"       json:"orderId"`
	PhotoID       string  `dynamodbav:"photoId"       json:"photoId"`
	RunnerEmail   string  `dynamodbav:"runnerEmail"   json:"runnerEmail"`
	Locale        string  `dynamodbav:"locale"        json:"locale"` // IETF BCP 47; empty = "en" for legacy items
	DownloadToken *string `dynamodbav:"downloadToken,omitempty" json:"downloadToken,omitempty"`
	Status        string  `dynamodbav:"status"        json:"status"` // mirrors Order.Status
	ClaimedAt     string  `dynamodbav:"claimedAt"     json:"claimedAt"`
	ApprovedAt    string  `dynamodbav:"approvedAt"    json:"approvedAt,omitempty"`
}
