package locale

// supportedLocales is the authoritative list of supported IETF BCP 47 locale codes.
// Frontend LocaleService.SUPPORTED_LOCALES must mirror this list.
// Unexported to prevent external mutation; access via IsSupported or LocaleTemplateName.
var supportedLocales = map[string]bool{
	"en":     true,
	"es-419": true,
}

// IsSupported reports whether code is a supported locale code.
func IsSupported(code string) bool {
	return supportedLocales[code]
}

// LocaleTemplateName returns the SES template name for the given base and locale.
// If locale is not a supported value it falls back to "en".
// Example: LocaleTemplateName("racephotos-photographer-claim", "es-419")
//
//	→ "racephotos-photographer-claim-es-419"
func LocaleTemplateName(base, locale string) string {
	if supportedLocales[locale] {
		return base + "-" + locale
	}
	return base + "-en"
}
