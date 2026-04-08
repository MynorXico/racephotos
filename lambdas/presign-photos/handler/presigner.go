package handler

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// AWSS3Presigner implements S3Presigner using the AWS SDK v2 PresignClient.
// PresignPutObject is a pure local crypto operation — no S3 API call is made.
type AWSS3Presigner struct {
	Client *s3.PresignClient
}

// PresignPutObject generates a presigned S3 PUT URL for the given bucket/key.
func (p *AWSS3Presigner) PresignPutObject(ctx context.Context, bucket, key, contentType string, ttl time.Duration) (string, error) {
	req, err := p.Client.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(bucket),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = ttl
	})
	if err != nil {
		return "", fmt.Errorf("PresignPutObject: %w", err)
	}
	return req.URL, nil
}
