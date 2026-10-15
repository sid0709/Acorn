package support

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"

	"golang.org/x/image/draw"
)

const (
	// PreviewMIME is what every preview is encoded as, whatever the original was.
	PreviewMIME = "image/jpeg"

	// PreviewWidth and PreviewHeight bound a preview: the top of the picture, as wide as a
	// thumbnail or a list row needs. A taller picture (a full-page screenshot) is cropped,
	// never squeezed, so the part that shows is readable.
	PreviewWidth  = 480
	PreviewHeight = 360
	// previewQuality trades a few KB for a clean thumbnail.
	previewQuality = 72
	// maxPreviewPixels skips pictures too big to decode cheaply; the original is served instead.
	maxPreviewPixels = 64 << 20
	// previewSlots bounds how many pictures decode at once, so a burst of uploads cannot
	// hold hundreds of MB of pixels.
	previewSlots = 2
)

var previewGate = make(chan struct{}, previewSlots)

// Preview is a small copy of an image, for showing before the original is asked for.
type Preview struct {
	MIME          string
	Data          []byte
	Width, Height int
}

// MakePreview shrinks data to a preview. It answers false when the format cannot be decoded
// here (WebP) or the picture is too large, and callers then show the original.
func MakePreview(ctx context.Context, data []byte) (Preview, bool) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > maxPreviewPixels {
		return Preview{}, false
	}
	select {
	case previewGate <- struct{}{}:
		defer func() { <-previewGate }()
	case <-ctx.Done():
		return Preview{}, false
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return Preview{}, false
	}
	out := image.NewRGBA(previewBounds(src.Bounds()))
	// JPEG has no transparency: a transparent PNG shows on white.
	draw.Draw(out, out.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.BiLinear.Scale(out, out.Bounds(), src, previewSource(src.Bounds(), out.Bounds()), draw.Over, nil)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: previewQuality}); err != nil {
		return Preview{}, false
	}
	size := out.Bounds().Size()
	return Preview{MIME: PreviewMIME, Data: buf.Bytes(), Width: size.X, Height: size.Y}, true
}

// previewScale is how much of the original's width the preview keeps; never above 1.
func previewScale(width int) float64 {
	if width <= PreviewWidth {
		return 1
	}
	return float64(PreviewWidth) / float64(width)
}

// previewBounds is the preview's size for an original of these bounds.
func previewBounds(src image.Rectangle) image.Rectangle {
	scale := previewScale(src.Dx())
	w := max(1, int(float64(src.Dx())*scale+0.5))
	h := max(1, int(float64(min(src.Dy(), int(float64(PreviewHeight)/scale+0.5)))*scale+0.5))
	return image.Rect(0, 0, w, min(h, PreviewHeight))
}

// previewSource is the part of the original that the preview shows: from the top, as much as fits.
func previewSource(src, out image.Rectangle) image.Rectangle {
	scale := previewScale(src.Dx())
	height := min(src.Dy(), max(1, int(float64(out.Dy())/scale+0.5)))
	return image.Rect(src.Min.X, src.Min.Y, src.Max.X, src.Min.Y+height)
}
