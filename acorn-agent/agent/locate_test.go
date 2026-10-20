package agent

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"math/rand"
	"strings"
	"testing"
)

// widget draws a field the way a form does: a caption above a box, in shapes that are the same for the
// same seed and different for another, so one caption can be told from the next. (x, y) is the middle
// of the box, the point an action would aim at.
func widget(img *image.Gray, seed int64, x, y int) {
	random := rand.New(rand.NewSource(seed))
	bar := func(x0, y0, w, h int, level uint8) {
		for yy := y0; yy < y0+h; yy++ {
			for xx := x0; xx < x0+w; xx++ {
				if image.Pt(xx, yy).In(img.Bounds()) {
					img.SetGray(xx, yy, color.Gray{Y: level})
				}
			}
		}
	}
	for i, at := 0, x-210; i < 8; i++ {
		w := 14 + random.Intn(26)
		bar(at, y-62, w, 11, uint8(20+random.Intn(60)))
		at += w + 6 + random.Intn(8)
	}
	bar(x-210, y-30, 420, 2, 110)
	bar(x-210, y+28, 420, 2, 110)
	bar(x-210, y-30, 2, 60, 110)
	bar(x+208, y-30, 2, 60, 110)
}

// pageField is one widget on a page: which (its seed) and at what height.
type pageField struct {
	seed int64
	y    int
}

// page is a 1280 by 800 screenshot of fields.
func page(fields ...pageField) *image.Gray {
	img := image.NewGray(image.Rect(0, 0, 1280, 800))
	for i := range img.Pix {
		img.Pix[i] = 245
	}
	for _, f := range fields {
		widget(img, f.seed, 500, f.y)
	}
	return img
}

func asJPEG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// anchorAt is the anchor a survey of img would keep for a target at the point.
func anchorAt(t *testing.T, img image.Image, x, y int) anchor {
	t.Helper()
	point := image.Pt(x, y)
	rect, encoded, ok := cropAround(decodeJPEG(t, asJPEG(t, img)), point)
	if !ok {
		t.Fatal("no crop")
	}
	return anchor{Point: point, Rect: rect, JPEG: encoded}
}

func decodeJPEG(t *testing.T, raw []byte) image.Image {
	t.Helper()
	img, err := jpeg.Decode(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	return img
}

func TestATargetThatMovedDownThePageIsFoundWhereItIsNow(t *testing.T) {
	before := anchorAt(t, page(pageField{1, 150}, pageField{2, 330}, pageField{3, 510}, pageField{4, 690}), 500, 330)
	// A question appeared above it: everything below moved down by 137 px.
	after := decodeJPEG(t, asJPEG(t, page(pageField{1, 150}, pageField{2, 467}, pageField{3, 647})))
	got := locateAnchor(before, after)
	if !got.Found {
		t.Fatalf("not found: %s", got.Reason)
	}
	if abs(int(got.X)-500) > 3 || abs(int(got.Y)-467) > 3 {
		t.Fatalf("found at (%.0f, %.0f), want about (500, 467)", got.X, got.Y)
	}
	if got.Score < locateMinScore {
		t.Fatalf("score %.2f", got.Score)
	}
}

func TestATargetThatDidNotMoveIsFoundWhereItWas(t *testing.T) {
	before := anchorAt(t, page(pageField{1, 150}, pageField{2, 330}, pageField{3, 510}), 500, 330)
	got := locateAnchor(before, decodeJPEG(t, asJPEG(t, page(pageField{1, 150}, pageField{2, 330}, pageField{3, 510}))))
	if !got.Found || abs(int(got.Y)-330) > 2 || abs(int(got.X)-500) > 2 {
		t.Fatalf("%+v", got)
	}
}

func TestAScrollbarThatNarrowedThePageStillFindsTheTarget(t *testing.T) {
	before := anchorAt(t, page(pageField{1, 150}, pageField{2, 330}, pageField{3, 510}), 500, 330)
	shifted := image.NewGray(image.Rect(0, 0, 1280, 800))
	for i := range shifted.Pix {
		shifted.Pix[i] = 245
	}
	// The same page drawn 14 px to the left.
	original := page(pageField{1, 150}, pageField{2, 330}, pageField{3, 510})
	for y := 0; y < 800; y++ {
		for x := 14; x < 1280; x++ {
			shifted.SetGray(x-14, y, original.GrayAt(x, y))
		}
	}
	got := locateAnchor(before, decodeJPEG(t, asJPEG(t, shifted)))
	if !got.Found || abs(int(got.X)-486) > 3 || abs(int(got.Y)-330) > 2 {
		t.Fatalf("%+v, want about (486, 330)", got)
	}
}

func TestAFieldThatWasFilledInIsStillTheSameTarget(t *testing.T) {
	before := anchorAt(t, page(pageField{1, 150}, pageField{2, 330}, pageField{3, 510}), 500, 330)
	filled := page(pageField{1, 150}, pageField{2, 330}, pageField{3, 510})
	// Text typed into the box: marks inside it, where the caption above is untouched.
	for i := 0; i < 12; i++ {
		for y := 322; y < 338; y++ {
			for x := 300 + i*22; x < 312+i*22; x++ {
				filled.SetGray(x, y, color.Gray{Y: 30})
			}
		}
	}
	got := locateAnchor(before, decodeJPEG(t, asJPEG(t, filled)))
	if !got.Found || abs(int(got.Y)-330) > 2 {
		t.Fatalf("%+v", got)
	}
}

func TestATargetThatIsGoneIsNotGuessedAt(t *testing.T) {
	before := anchorAt(t, page(pageField{1, 150}, pageField{2, 330}, pageField{3, 510}), 500, 330)
	got := locateAnchor(before, decodeJPEG(t, asJPEG(t, page(pageField{1, 150}, pageField{3, 510}))))
	// Other fields share its box, so a weak likeness is found elsewhere; it is neither good enough nor alone.
	if got.Found || got.Reason == "" {
		t.Fatalf("a target that is gone was found: %+v", got)
	}
}

func TestTwoPlacesThatLookAlikeAreNotGuessedBetween(t *testing.T) {
	// The same field drawn twice (seed 1 both times): which one the target is, is not known.
	before := anchorAt(t, page(pageField{1, 150}, pageField{2, 330}, pageField{3, 510}), 500, 150)
	twin := page(pageField{1, 150}, pageField{2, 330}, pageField{3, 510})
	widget(twin, 1, 500, 650)
	got := locateAnchor(before, decodeJPEG(t, asJPEG(t, twin)))
	if got.Found || !strings.Contains(got.Reason, "two places look like it") {
		t.Fatalf("%+v", got)
	}
}

func TestACropOfPlainWhiteCannotBeFoundBy(t *testing.T) {
	before := anchorAt(t, page(pageField{1, 150}, pageField{2, 330}, pageField{3, 510}), 900, 700)
	got := locateAnchor(before, decodeJPEG(t, asJPEG(t, page(pageField{1, 150}, pageField{2, 330}, pageField{3, 510}))))
	if got.Found || !strings.Contains(got.Reason, "too plain") {
		t.Fatalf("%+v", got)
	}
}

func TestTheAgentLocatesATargetOfThePlanOnAScreenshotTakenNow(t *testing.T) {
	survey := observation("data:image/jpeg;base64," + b64(asJPEG(t, page(pageField{1, 150}, pageField{2, 330}, pageField{3, 510}, pageField{4, 690}))))
	a := newAgentWithScreen(t, &scriptedModel{}, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	id := startFast(t, a, true)
	s, _ := a.sessions.get(id)
	click := pointAt(KindClick, 0, 500, 510)
	click.ID = "s1a1"
	s.anchors = buildAnchors([]Action{click}, survey)

	moved := "data:image/jpeg;base64," + b64(asJPEG(t, page(pageField{1, 150}, pageField{2, 330}, pageField{3, 647}, pageField{4, 827})))
	found, err := a.Locate(context.Background(), id, LocateRequest{ActionID: "s1a1", Screenshot: moved})
	if err != nil || !found.Found || abs(int(found.Y)-647) > 3 {
		t.Fatalf("found %+v, err %v", found, err)
	}
	unknown, err := a.Locate(context.Background(), id, LocateRequest{ActionID: "s9a9", Screenshot: moved})
	if err != nil || unknown.Found || unknown.Reason == "" {
		t.Fatalf("an action with no anchor: %+v, %v", unknown, err)
	}
	if _, err := a.Locate(context.Background(), "nope", LocateRequest{ActionID: "s1a1", Screenshot: moved}); !errors.Is(err, ErrNoSession) {
		t.Fatalf("unknown session: %v", err)
	}
	if _, err := a.Locate(context.Background(), id, LocateRequest{ActionID: "s1a1", Screenshot: "not an image"}); !errors.Is(err, ErrBadObservation) {
		t.Fatalf("a screenshot that is not an image: %v", err)
	}
}

func b64(raw []byte) string { return base64.StdEncoding.EncodeToString(raw) }
