package models

// Photographer represents a photographer's account profile stored in DynamoDB.
//
// BankAccountNumber, BankAccountHolder, and BankInstructions are financial PII
// and must never appear in log output. These fields are intentionally returned
// in full on the GET /photographer/me (self-service) endpoint. Any future
// cross-user read path (e.g. a runner viewing photographer details) must strip
// these fields before returning the response.
type Photographer struct {
	ID                string `dynamodbav:"id"                json:"id"`
	Email             string `dynamodbav:"email"             json:"email"`
	DisplayName       string `dynamodbav:"displayName"       json:"displayName"`
	DefaultCurrency   string `dynamodbav:"defaultCurrency"   json:"defaultCurrency"` // ISO 4217
	BankName          string `dynamodbav:"bankName"          json:"bankName"`
	BankAccountNumber string `dynamodbav:"bankAccountNumber" json:"bankAccountNumber"`
	BankAccountHolder string `dynamodbav:"bankAccountHolder" json:"bankAccountHolder"`
	BankInstructions  string `dynamodbav:"bankInstructions"  json:"bankInstructions"`
	PreferredLocale   string `dynamodbav:"preferredLocale"   json:"preferredLocale"` // IETF BCP 47, e.g. "en" or "es-419"; empty = "en"
	CreatedAt         string `dynamodbav:"createdAt"         json:"createdAt"`
	UpdatedAt         string `dynamodbav:"updatedAt"         json:"updatedAt"`
}
