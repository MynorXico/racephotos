package models

// WatermarkMessage is the payload published to the racephotos-watermark SQS queue
// by the photo-processor Lambda. The watermark Lambda reads watermarkText itself
// from the events table (ADR-0009 / RS-007 issue resolution).
type WatermarkMessage struct {
	PhotoID  string `json:"photoId"`
	EventID  string `json:"eventId"`
	RawS3Key string `json:"rawS3Key"`
}
