package models

// Photo represents a race photo stored in DynamoDB.
//
// Status values (introduced incrementally across stories):
//
//	"uploading"       — Photo record created; S3 PUT not yet confirmed (RS-006)
//	"processing"      — Picked up by photo-processor Lambda (RS-007)
//	"indexed"         — Rekognition complete, bib numbers extracted (RS-007)
//	"review_required" — Rekognition found no confident bib numbers (RS-007)
//	"error"           — Processing or conversion failed (RS-007, RS-015)
//
// Note: "uploading" extends the four statuses defined in PRODUCT_CONTEXT.md.
// RS-007 transitions it to "processing" when the S3 ObjectCreated message fires.
//
// ConvertedS3Key and OriginalFormat are reserved for RS-015 (format-converter);
// absent for native JPEG/PNG uploads.
type Photo struct {
	ID                    string   `dynamodbav:"id"                       json:"id"`
	EventID               string   `dynamodbav:"eventId"                  json:"eventId"`
	BibNumbers            []string `dynamodbav:"bibNumbers"               json:"bibNumbers"`
	Status                string   `dynamodbav:"status"                   json:"status"`
	RawS3Key              string   `dynamodbav:"rawS3Key"                 json:"rawS3Key"`
	WatermarkedS3Key      string   `dynamodbav:"watermarkedS3Key"         json:"watermarkedS3Key"`
	RekognitionConfidence float64  `dynamodbav:"rekognitionConfidence"    json:"rekognitionConfidence"`
	CapturedAt            string   `dynamodbav:"capturedAt"               json:"capturedAt"`
	UploadedAt            string   `dynamodbav:"uploadedAt"               json:"uploadedAt"`
	ConvertedS3Key        string   `dynamodbav:"convertedS3Key,omitempty" json:"convertedS3Key,omitempty"`
	OriginalFormat        string   `dynamodbav:"originalFormat,omitempty" json:"originalFormat,omitempty"`
}
