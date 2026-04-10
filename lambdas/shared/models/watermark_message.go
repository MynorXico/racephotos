package models

// WatermarkMessage is the payload published to the racephotos-watermark SQS queue
// by the photo-processor Lambda. The watermark Lambda reads watermarkText itself
// from the events table (ADR-0009 / RS-007 issue resolution).
//
// FinalStatus is the status the watermark Lambda must write atomically alongside
// watermarkedS3Key when processing completes. It is either "indexed" (bibs were
// detected) or "review_required" (no confident bib detection). This avoids a
// second DynamoDB read inside the watermark Lambda to re-derive the outcome
// (RS-017).
type WatermarkMessage struct {
	PhotoID     string `json:"photoId"`
	EventID     string `json:"eventId"`
	RawS3Key    string `json:"rawS3Key"`
	FinalStatus string `json:"finalStatus"`
}
