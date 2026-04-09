package handler

import (
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg" // register JPEG decoder
	_ "image/png"  // register PNG decoder
	"io"
	"log/slog"
	"math"

	"github.com/fogleman/gg"
)

const (
	// watermarkFontPath is the TrueType font tried at runtime. If absent (minimal
	// Lambda runtime), gg falls back to its built-in monospace font.
	watermarkFontPath = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
	// watermarkAngleDeg is the counter-clockwise rotation of each watermark tile in degrees.
	watermarkAngleDeg = 30.0
	// watermarkOpacity is the alpha of the white watermark text (0–255).
	// 80 ≈ 31% opacity — visible enough to deter theft, light enough to preview the photo.
	watermarkOpacity uint8 = 80
)

// watermarkTextColor is the semi-transparent white used for diagonal text tiles.
var watermarkTextColor = color.RGBA{R: 255, G: 255, B: 255, A: watermarkOpacity}

// GgWatermarker implements ImageWatermarker using github.com/fogleman/gg (ADR-0009).
// Text is tiled diagonally across the entire image to deter photo theft while
// keeping the preview recognisable for runners to identify themselves.
type GgWatermarker struct{}

// ApplyTextWatermark decodes the image from src, tiles the watermark text diagonally
// across the full image, and returns the result.
func (w *GgWatermarker) ApplyTextWatermark(src io.Reader, text string) (image.Image, error) {
	img, _, err := image.Decode(src)
	if err != nil {
		return nil, fmt.Errorf("GgWatermarker: decode image: %w", err)
	}

	bounds := img.Bounds()
	imgW := float64(bounds.Dx())
	imgH := float64(bounds.Dy())

	dc := gg.NewContext(bounds.Dx(), bounds.Dy())

	// Draw the source image as the base layer.
	dc.DrawImage(img, 0, 0)

	// Font size scales with the larger image dimension: ~5%, clamped to [24, 120] pts.
	// Using max(width, height) keeps the watermark proportional for both portrait
	// and landscape orientations at the same resolution.
	fontSize := math.Max(24, math.Min(math.Max(imgW, imgH)*0.05, 120))

	if err := dc.LoadFontFace(watermarkFontPath, fontSize); err != nil {
		slog.Warn("watermarker: could not load font — falling back to built-in",
			slog.String("path", watermarkFontPath),
			slog.String("error", err.Error()),
		)
	}

	dc.SetColor(watermarkTextColor)

	// Tile the text diagonally using a rotated coordinate system.
	//
	// Approach:
	//   1. Measure the text so tiles have consistent spacing.
	//   2. Rotate the canvas origin (image centre) by -watermarkAngleDeg.
	//   3. In rotated space, tile the text in a staggered grid that extends
	//      to the full image diagonal — this ensures all four corners are
	//      covered even after the rotation is applied.
	textW, textH := dc.MeasureString(text)
	if textW <= 0 || textH <= 0 {
		// Empty or unmeasurable text — return the image without a watermark rather
		// than entering an infinite loop (zero rowSpacing would never advance y).
		return img, nil
	}
	colSpacing := textW * 2.0 // horizontal gap between columns
	rowSpacing := textH * 3.5 // vertical gap between rows

	// Half-diagonal: the maximum distance from centre to any corner.
	halfDiag := math.Sqrt(imgW*imgW+imgH*imgH) / 2.0

	angle := -watermarkAngleDeg * math.Pi / 180.0

	dc.Push()
	dc.Translate(imgW/2, imgH/2)
	dc.Rotate(angle)

	// Tile from -halfDiag to +halfDiag in both axes with one tile of padding.
	rowStart := -halfDiag - rowSpacing
	rowEnd := halfDiag + rowSpacing
	colStart := -halfDiag - colSpacing
	colEnd := halfDiag + colSpacing

	rowIdx := 0
	for y := rowStart; y <= rowEnd; y += rowSpacing {
		// Stagger every other row by half a column width — makes it harder to
		// crop a clean strip out than an aligned grid would be.
		xOffset := 0.0
		if rowIdx%2 == 1 {
			xOffset = colSpacing / 2
		}
		for x := colStart + xOffset; x <= colEnd; x += colSpacing {
			dc.DrawStringAnchored(text, x, y, 0.5, 0.5)
		}
		rowIdx++
	}

	dc.Pop()

	result := dc.Image()
	if result == nil {
		return nil, fmt.Errorf("GgWatermarker: dc.Image() returned nil")
	}
	return result, nil
}
