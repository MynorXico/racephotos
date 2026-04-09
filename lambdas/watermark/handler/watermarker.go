package handler

import (
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg" // register JPEG decoder
	_ "image/png"  // register PNG decoder
	"io"

	"github.com/fogleman/gg"
)

const (
	// watermarkFontSize is the base font size for watermark text in points.
	watermarkFontSize = 32.0
	// watermarkPaddingFrac is the fractional distance from the bottom edge.
	watermarkPaddingFrac = 0.05
	// watermarkFontPath is the TrueType font tried at runtime. If absent (minimal
	// Lambda runtime), gg falls back to its built-in monospace font.
	watermarkFontPath = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
)

// watermarkBarColor is the semi-transparent black bar drawn behind watermark text.
var watermarkBarColor = color.RGBA{A: 160} // ~63% opacity

// GgWatermarker implements ImageWatermarker using github.com/fogleman/gg (ADR-0009).
// Text is drawn centred horizontally near the bottom of the image with a
// semi-transparent black bar behind it for legibility on any background.
type GgWatermarker struct{}

// ApplyTextWatermark decodes the image from src, draws text centred at the bottom, and returns the result.
func (w *GgWatermarker) ApplyTextWatermark(src io.Reader, text string) (image.Image, error) {
	img, _, err := image.Decode(src)
	if err != nil {
		return nil, fmt.Errorf("GgWatermarker: decode image: %w", err)
	}

	bounds := img.Bounds()
	width := float64(bounds.Dx())
	height := float64(bounds.Dy())

	dc := gg.NewContext(bounds.Dx(), bounds.Dy())

	// Draw the source image.
	dc.DrawImage(img, 0, 0)

	// ── Semi-transparent bar ──────────────────────────────────────────────────
	barH := watermarkFontSize*1.8 + watermarkPaddingFrac*height
	dc.SetColor(watermarkBarColor)
	dc.DrawRectangle(0, height-barH, width, barH)
	dc.Fill()

	// ── Watermark text ────────────────────────────────────────────────────────
	// Use the built-in monospace font. An ADR-0009 follow-up may load a custom
	// TTF via dc.LoadFontFace for branding; this keeps the binary lean for v1.
	// Attempt to load a system TrueType font for better rendering.
	// If unavailable (e.g. minimal Lambda runtime), gg uses its built-in font.
	_ = dc.LoadFontFace(watermarkFontPath, watermarkFontSize)

	dc.SetColor(color.White)
	textY := height - barH/2
	dc.DrawStringAnchored(text, width/2, textY, 0.5, 0.5)

	result := dc.Image()
	if result == nil {
		return nil, fmt.Errorf("GgWatermarker: dc.Image() returned nil")
	}
	return result, nil
}
