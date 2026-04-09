# ADR-0009: Go image processing library for watermark rendering
**Date**: 2026-04-08
**Status**: accepted

## Context

The watermark Lambda must load a JPEG from S3, draw a multi-line text overlay
(event name + photographer studio name), and write the result back to S3. This
requires font rendering, alpha compositing, and JPEG encode/decode — capabilities
that span several concerns:

- JPEG decode/encode: covered by stdlib `image/jpeg`
- Text layout and font rendering: not covered by stdlib alone; requires either
  hand-rolling glyph placement with `golang.org/x/image/font` or a higher-level
  canvas abstraction
- Draw context (fill colour, opacity, positioning): no stdlib equivalent

The Lambda runs in a Go 1.22+ environment. Binary size affects cold-start duration,
so dependencies must be chosen carefully. The library must be MIT or Apache-2.0
licensed (open-source requirement — contributors cannot take on GPL obligations).

## Decision

Use **`github.com/fogleman/gg`** (MIT) as the 2D canvas layer for watermark
rendering. It is the only Go library that covers font loading, text drawing, alpha
compositing, and coordinate-based positioning in a single coherent API without
requiring an external graphics runtime. The stdlib `image` and `image/jpeg`
packages handle encode/decode; `gg` handles everything in between.

## Options considered

### Option A — stdlib only (`image/draw` + `golang.org/x/image/font`)
Pros:
- Zero external dependencies
- No supply-chain risk

Cons:
- `golang.org/x/image/font` provides glyph-level primitives only — no text layout,
  word wrap, or line spacing; multi-line watermarks require hundreds of lines of
  hand-written layout code
- TTF font loading requires a separate library (`golang.org/x/image/font/opentype`)
  still not part of the standard library
- High implementation complexity for a non-differentiating concern; error-prone
  pixel arithmetic for alpha compositing
- No canvas abstraction — coordinate transforms (centering text, padding from edges)
  must be computed manually

### Option B — `github.com/fogleman/gg` (chosen)
Pros:
- Single import covers: canvas context, TTF font loading, `DrawStringAnchored`,
  alpha fill, and JPEG output — everything the watermark Lambda needs
- MIT license — no contributor friction
- Actively maintained; used widely in Go data-visualisation tooling
- Adds ~2 MB to the Lambda binary — acceptable at the v1 traffic level (cold starts
  not provisioned; p99 latency target is for end-to-end photo load, not Lambda init)
- `ImageWatermarker` interface isolates the dependency behind a boundary — swappable
  without touching business logic

Cons:
- External dependency: supply-chain surface area increases by one module
- Pulls in `golang.org/x/image` transitively (itself a well-maintained x/ package)
- If the watermark requirement grows to image-based logos or complex compositing,
  a more specialised library (e.g. `libvips` via cgo) may be needed in v2

### Option C — `github.com/disintegration/imaging`
Pros:
- Clean API for resize, crop, flip, and filter operations (MIT)

Cons:
- No text rendering or font loading — still requires Option A's stdlib approach
  for the text overlay; solves a different problem than what is needed here

### Option D — `github.com/anthonynsimon/bild`
Pros:
- Broad image processing operations, MIT license

Cons:
- Same gap as Option C: image manipulation only, no text/font primitives
- Higher binary footprint than `gg` with no benefit for this use case

## Consequences

**Positive**:
- Watermark Lambda implementation is straightforward: load font, set fill colour,
  call `DrawStringAnchored` for each line, encode JPEG
- `ImageWatermarker` interface means unit tests mock the library entirely — no
  pixel-level assertions needed in unit tests; integration tests validate actual output
- Swapping the library in v2 requires only a new `ImageWatermarker` implementation,
  not touching the Lambda handler or business logic

**Negative / tradeoffs**:
- `github.com/fogleman/gg` is a relatively small open-source project; if it becomes
  unmaintained, the interface boundary makes migration low-risk but still necessary
- Binary size increase (~2 MB) is acceptable in v1 but should be revisited if
  cold-start latency becomes a concern at higher traffic

**Stories affected**: RS-007
