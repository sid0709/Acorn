package support

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func solid(w, h int, c color.Color) image.Image {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	return img
}

func encodeJPEG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func decodeSize(t *testing.T, p Preview) image.Point {
	t.Helper()
	cfg, format, err := image.DecodeConfig(bytes.NewReader(p.Data))
	if err != nil {
		t.Fatal(err)
	}
	if format != "jpeg" || p.MIME != PreviewMIME {
		t.Fatalf("format %q mime %q, want jpeg", format, p.MIME)
	}
	return image.Pt(cfg.Width, cfg.Height)
}

func TestMakePreviewCropsATallPageToItsTop(t *testing.T) {
	// A full-page screenshot: wider than a thumbnail and far taller than it.
	data := encodeJPEG(t, solid(1600, 12000, color.RGBA{R: 200, G: 30, B: 30, A: 255}))
	p, ok := MakePreview(context.Background(), data)
	if !ok {
		t.Fatal("no preview")
	}
	if got, want := decodeSize(t, p), image.Pt(PreviewWidth, PreviewHeight); got != want {
		t.Fatalf("preview is %v, want %v", got, want)
	}
	if p.Width != PreviewWidth || p.Height != PreviewHeight {
		t.Fatalf("reported %dx%d", p.Width, p.Height)
	}
	if len(p.Data) >= len(data)/20 {
		t.Fatalf("preview is %d bytes of %d: not small enough to matter", len(p.Data), len(data))
	}
}

func TestMakePreviewKeepsASmallPictureWhole(t *testing.T) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, solid(200, 100, color.NRGBA{R: 10, G: 200, B: 10, A: 255})); err != nil {
		t.Fatal(err)
	}
	p, ok := MakePreview(context.Background(), buf.Bytes())
	if !ok {
		t.Fatal("no preview")
	}
	if got, want := decodeSize(t, p), image.Pt(200, 100); got != want {
		t.Fatalf("preview is %v, want %v (never enlarged)", got, want)
	}
}

func TestMakePreviewShowsTransparencyOnWhite(t *testing.T) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, solid(40, 40, color.NRGBA{})); err != nil {
		t.Fatal(err)
	}
	p, ok := MakePreview(context.Background(), buf.Bytes())
	if !ok {
		t.Fatal("no preview")
	}
	img, err := jpeg.Decode(bytes.NewReader(p.Data))
	if err != nil {
		t.Fatal(err)
	}
	r, g, b, _ := img.At(20, 20).RGBA()
	if r>>8 < 250 || g>>8 < 250 || b>>8 < 250 {
		t.Fatalf("transparent pixel came out %d,%d,%d, want white", r>>8, g>>8, b>>8)
	}
}

func TestMakePreviewDeclinesWhatItCannotRead(t *testing.T) {
	for name, data := range map[string][]byte{
		"empty":   nil,
		"garbage": []byte("not an image"),
		"webp":    []byte("RIFF\x00\x00\x00\x00WEBPVP8 "),
	} {
		if _, ok := MakePreview(context.Background(), data); ok {
			t.Errorf("%s: got a preview", name)
		}
	}
}

func TestMakePreviewGivesUpWhenCancelledInQueue(t *testing.T) {
	for range previewSlots {
		previewGate <- struct{}{}
	}
	defer func() {
		for range previewSlots {
			<-previewGate
		}
	}()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, ok := MakePreview(ctx, encodeJPEG(t, solid(10, 10, color.White))); ok {
		t.Fatal("previewed with a cancelled context and no free slot")
	}
}

// BenchmarkMakePreviewFullPage is the extension's largest capture: 1600 wide, 16000 tall.
func BenchmarkMakePreviewFullPage(b *testing.B) {
	img := image.NewRGBA(image.Rect(0, 0, 1600, 16000))
	for i := range img.Pix {
		img.Pix[i] = byte(i*7+i/1600) | 0x80
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 75}); err != nil {
		b.Fatal(err)
	}
	b.ReportMetric(float64(buf.Len())/1e6, "MB-in")
	b.ResetTimer()
	var preview Preview
	for range b.N {
		var ok bool
		if preview, ok = MakePreview(context.Background(), buf.Bytes()); !ok {
			b.Fatal("no preview")
		}
	}
	b.ReportMetric(float64(len(preview.Data))/1e3, "KB-out")
}
