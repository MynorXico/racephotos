package models

// BibEntry is one row in the racephotos-bib-index fan-out table.
//
// One BibEntry is written per detected bib number per photo (ADR-0003).
// PK: BibKey = "{eventId}#{bibNumber}"
// SK: PhotoID
type BibEntry struct {
	BibKey  string `dynamodbav:"bibKey"`  // "{eventId}#{bibNumber}"
	PhotoID string `dynamodbav:"photoId"` // references racephotos-photos PK
}
