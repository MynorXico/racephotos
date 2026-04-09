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
	inPath := flag.String("in", "", "path to input photo (JPEG or PNG)")
	outPath := flag.String("out", "watermarked.jpg", "path to write watermarked JPEG")
	text := flag.String("text", "RaceShots · racephotos.example.com", "watermark text")
	quality := flag.Int("quality", 85, "JPEG output quality (1-100)")
	flag.Parse()

	if *inPath == "" {
		fmt.Fprintln(os.Stderr, "error: -in is required")
		flag.Usage()
		os.Exit(1)
	}

	f, err := os.Open(*inPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: open %s: %v\n", *inPath, err)
		os.Exit(1)
	}
	defer f.Close()

	wm := &handler.GgWatermarker{}
	result, err := wm.ApplyTextWatermark(f, *text)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: ApplyTextWatermark: %v\n", err)
		os.Exit(1)
	}

	out, err := os.Create(*outPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: create %s: %v\n", *outPath, err)
		os.Exit(1)
	}
	defer out.Close()

	if err := jpeg.Encode(out, result, &jpeg.Options{Quality: *quality}); err != nil {
		fmt.Fprintf(os.Stderr, "error: jpeg.Encode: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("✓ watermarked photo written to %s\n", *outPath)
}
