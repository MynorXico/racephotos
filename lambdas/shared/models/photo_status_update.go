package models

// PhotoStatusUpdate carries the fields written back to DynamoDB after
// photo-processor runs Rekognition. All pointer fields are omitted when nil
// so a partial update does not overwrite existing values.
type PhotoStatusUpdate struct {
	Status                string   `dynamodbav:"status"`
	BibNumbers            []string `dynamodbav:"bibNumbers,omitempty"`
	RekognitionConfidence float64  `dynamodbav:"rekognitionConfidence,omitempty"`
}
