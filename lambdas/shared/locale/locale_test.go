package locale

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestLocaleTemplateName(t *testing.T) {
	tests := []struct {
		name   string
		base   string
		locale string
		want   string
	}{
		{"english", "racephotos-photographer-claim", "en", "racephotos-photographer-claim-en"},
		{"latin spanish", "racephotos-photographer-claim", "es-419", "racephotos-photographer-claim-es-419"},
		{"unsupported falls back to en", "racephotos-runner-purchase-approved", "de", "racephotos-runner-purchase-approved-en"},
		{"empty falls back to en", "racephotos-runner-purchase-approved", "", "racephotos-runner-purchase-approved-en"},
		{"unknown variant falls back to en", "racephotos-runner-redownload-resend", "es-ES", "racephotos-runner-redownload-resend-en"},
		{"base preserved exactly", "racephotos-runner-purchase-rejected", "es-419", "racephotos-runner-purchase-rejected-es-419"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := LocaleTemplateName(tt.base, tt.locale)
			assert.Equal(t, tt.want, got)
		})
	}
}
