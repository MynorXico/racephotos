// Package rekmock provides a file-backed TextDetector for local development.
//
// When RACEPHOTOS_ENV=local, main.go wires this in instead of the real Rekognition
// client. It reads testdata/rekognition-responses/{photoId}.json if the file exists,
// otherwise returns an empty DetectTextOutput (zero detections).
//
// AC6: Given RACEPHOTOS_ENV=local, when the photo-processor Lambda initialises, then
// a file-backed Rekognition mock is used instead of the real service.
package rekmock

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/aws/aws-sdk-go-v2/service/rekognition"
)

// FileBackedDetector implements TextDetector by reading pre-canned responses from disk.
// Responses are stored at {testdataDir}/{photoId}.json.
type FileBackedDetector struct {
	TestdataDir string // absolute or relative path to the responses directory
}

// DetectText reads photoId from the S3 object key in the input and returns
// the canned response for that photoId, or an empty output if no file exists.
func (d *FileBackedDetector) DetectText(ctx context.Context, input *rekognition.DetectTextInput, optFns ...func(*rekognition.Options)) (*rekognition.DetectTextOutput, error) {
	if input.Image == nil || input.Image.S3Object == nil || input.Image.S3Object.Name == nil {
		return &rekognition.DetectTextOutput{}, nil
	}

	photoID := extractPhotoID(*input.Image.S3Object.Name)
	candidatePath := filepath.Join(d.TestdataDir, photoID+".json")

	// Guard against path traversal: reject any path that escapes TestdataDir.
	absDir, err := filepath.Abs(d.TestdataDir)
	if err != nil {
		return &rekognition.DetectTextOutput{}, nil
	}
	absPath, err := filepath.Abs(candidatePath)
	if err != nil {
		return &rekognition.DetectTextOutput{}, nil
	}
	if !strings.HasPrefix(absPath, absDir+string(filepath.Separator)) {
		slog.InfoContext(ctx, "rekmock: path traversal attempt rejected",
			slog.String("photoId", photoID),
		)
		return &rekognition.DetectTextOutput{}, nil
	}
	path := candidatePath

	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		slog.InfoContext(ctx, "rekmock: no fixture — returning zero detections",
			slog.String("photoId", photoID),
			slog.String("path", path),
		)
		return &rekognition.DetectTextOutput{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("rekmock: read %s: %w", path, err)
	}

	var out rekognition.DetectTextOutput
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("rekmock: unmarshal %s: %w", path, err)
	}

	slog.InfoContext(ctx, "rekmock: loaded fixture",
		slog.String("photoId", photoID),
		slog.Int("detections", len(out.TextDetections)),
	)
	return &out, nil
}

// extractPhotoID parses photoId from a raw S3 key of the form
// {envName}/{eventId}/{photoId}/{filename}.
func extractPhotoID(key string) string {
	parts := splitKey(key)
	if len(parts) >= 4 {
		return parts[2]
	}
	return key
}

func splitKey(key string) []string {
	var parts []string
	start := 0
	for i := 0; i < len(key); i++ {
		if key[i] == '/' {
			parts = append(parts, key[start:i])
			start = i + 1
		}
	}
	parts = append(parts, key[start:])
	return parts
}
