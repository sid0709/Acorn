package agent

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/jpeg" // registers the decoder for the extension's screenshots
	_ "image/png"  // registers the decoder for lossless screenshots
	"strings"
)

const (
	// gridSize is the side of the brightness grid a screenshot is reduced to.
	gridSize = 32
	// unchangedBelow is the largest brightness difference (0-255) any one cell of the grid
	// may show for two screenshots to count as the same page. A blinking caret or a JPEG's
	// noise moves a cell by a few points; typed text, a new message or a new page moves
	// some cell by far more. The largest cell, not the mean, is compared so a small change
	// in a big page is not averaged away.
	unchangedBelow = 12
	// maxScreenshotBytes bounds what one observation may carry.
	maxScreenshotBytes = 12 << 20
)

// signature reduces a screenshot (a data URL) to a small grid of brightness values, so two
// screenshots can be compared without a model reading either. It also reports the image's
// own size in pixels, which the model's coordinates are measured in.
func signature(dataURL string) (sig []uint8, width, height int, err error) {
	comma := strings.IndexByte(dataURL, ',')
	if !strings.HasPrefix(dataURL, "data:image/") || comma < 0 {
		return nil, 0, 0, fmt.Errorf("the screenshot is not an image data URL")
	}
	raw, err := base64.StdEncoding.DecodeString(dataURL[comma+1:])
	if err != nil {
		return nil, 0, 0, fmt.Errorf("the screenshot is not valid base64: %w", err)
	}
	if len(raw) > maxScreenshotBytes {
		return nil, 0, 0, fmt.Errorf("the screenshot is larger than %d MB", maxScreenshotBytes>>20)
	}
	decoded, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, 0, 0, fmt.Errorf("the screenshot is not a readable image: %w", err)
	}
	bounds := decoded.Bounds()
	return grid(decoded), bounds.Dx(), bounds.Dy(), nil
}

// grid averages the image's brightness over a gridSize x gridSize layout. Every pixel
// counts: a thin caret or a line of text is a few pixels wide, and sampling would hit it
// or miss it by chance.
func grid(img image.Image) []uint8 {
	bounds := img.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width == 0 || height == 0 {
		return make([]uint8, gridSize*gridSize)
	}
	sums := make([]float64, gridSize*gridSize)
	counts := make([]float64, gridSize*gridSize)
	luma := lumaReader(img)
	for y := 0; y < height; y++ {
		row := (y * gridSize / height) * gridSize
		for x := 0; x < width; x++ {
			cell := row + x*gridSize/width
			sums[cell] += luma(bounds.Min.X+x, bounds.Min.Y+y)
			counts[cell]++
		}
	}
	out := make([]uint8, len(sums))
	for i := range sums {
		if counts[i] > 0 {
			out[i] = uint8(sums[i] / counts[i])
		}
	}
	return out
}

// lumaReader returns a brightness reader for the image. A JPEG already stores brightness
// as its Y plane (or is grayscale), which is far cheaper to read than converting every pixel to RGB.
func lumaReader(img image.Image) func(x, y int) float64 {
	if ycc, ok := img.(*image.YCbCr); ok {
		return func(x, y int) float64 { return float64(ycc.Y[ycc.YOffset(x, y)]) }
	}
	if gray, ok := img.(*image.Gray); ok {
		return func(x, y int) float64 { return float64(gray.Pix[gray.PixOffset(x, y)]) }
	}
	return func(x, y int) float64 {
		r, g, b, _ := img.At(x, y).RGBA()
		return (0.299*float64(r) + 0.587*float64(g) + 0.114*float64(b)) / 257
	}
}

// unchanged reports whether two signatures are the same page.
func unchanged(a, b []uint8) bool {
	if len(a) == 0 || len(a) != len(b) {
		return false
	}
	for i := range a {
		diff := int(a[i]) - int(b[i])
		if diff < 0 {
			diff = -diff
		}
		if diff >= unchangedBelow {
			return false
		}
	}
	return true
}
