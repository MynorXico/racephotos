package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ses"
	sestypes "github.com/aws/aws-sdk-go-v2/service/ses/types"
)

// EmailSender sends SES templated emails.
type EmailSender interface {
	SendTemplatedEmail(ctx context.Context, to, template string, data map[string]string) error
}

// SESAPIClient wraps the SES SendTemplatedEmail method.
type SESAPIClient interface {
	SendTemplatedEmail(ctx context.Context, params *ses.SendTemplatedEmailInput, optFns ...func(*ses.Options)) (*ses.SendTemplatedEmailOutput, error)
}

// SESEmailSender implements EmailSender using Amazon SES v1 templated emails.
type SESEmailSender struct {
	Client      SESAPIClient
	FromAddress string
}

// SendTemplatedEmail sends a SES templated email to the given address.
// data is serialised to JSON and passed as the template data payload.
func (s *SESEmailSender) SendTemplatedEmail(ctx context.Context, to, template string, data map[string]string) error {
	templateDataJSON, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("SendTemplatedEmail: marshal template data: %w", err)
	}

	_, err = s.Client.SendTemplatedEmail(ctx, &ses.SendTemplatedEmailInput{
		Source: aws.String(s.FromAddress),
		Destination: &sestypes.Destination{
			ToAddresses: []string{to},
		},
		Template:     aws.String(template),
		TemplateData: aws.String(string(templateDataJSON)),
	})
	if err != nil {
		return fmt.Errorf("SendTemplatedEmail: SES: %w", err)
	}
	return nil
}
