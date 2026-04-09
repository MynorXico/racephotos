// cmd/test-watermark is a local development tool for visually verifying the
// watermark output without deploying to AWS.
//
// Usage:
//
//	go run ./cmd/test-watermark -in /path/to/photo.jpg -out /tmp/watermarked.jpg
//	go run ./cmd/test-watermark -in /path/to/photo.jpg -text "My Race 2026 · example.com"
package main

import (
	"flag"
	"fmt"
	"image/jpeg"
	"os"

	"github.com/racephotos/watermark/handler"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run() error {
	inPath := flag.String("in", "", "path to input photo (JPEG or PNG)")
	outPath := flag.String("out", "watermarked.jpg", "path to write watermarked JPEG")
	text := flag.String("text", "RaceShots · racephotos.example.com", "watermark text")
	quality := flag.Int("quality", 85, "JPEG output quality (1-100)")
	flag.Parse()

	if *inPath == "" {
		flag.Usage()
		return fmt.Errorf("-in is required")
	}

	f, err := os.Open(*inPath)
	if err != nil {
		return fmt.Errorf("open %s: %w", *inPath, err)
	}
	defer f.Close()

	wm := &handler.GgWatermarker{}
	result, err := wm.ApplyTextWatermark(f, *text)
	if err != nil {
		return fmt.Errorf("ApplyTextWatermark: %w", err)
	}

	out, err := os.Create(*outPath)
	if err != nil {
		return fmt.Errorf("create %s: %w", *outPath, err)
	}
	defer out.Close()

	if err := jpeg.Encode(out, result, &jpeg.Options{Quality: *quality}); err != nil {
		return fmt.Errorf("jpeg.Encode: %w", err)
	}

	fmt.Printf("✓ watermarked photo written to %s\n", *outPath)
	return nil
}
