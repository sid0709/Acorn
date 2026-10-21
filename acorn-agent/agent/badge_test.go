package agent

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"strings"
	"testing"
)

func decodeShot(t *testing.T, dataURL string) image.Image {
	t.Helper()
	raw, ok := decodeDataURL(dataURL)
	if !ok {
		t.Fatal("not a data URL")
	}
	img, err := jpeg.Decode(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	return img
}

func grayAt(img image.Image, x, y int) uint8 {
	return color.GrayModel.Convert(img.At(x, y)).(color.Gray).Y
}

func TestEverySurveyScreenshotHasItsNumberWrittenInItsCorner(t *testing.T) {
	obs := surveyObservation(t)
	images := badgedImages(obs)
	if len(images) != len(obs.Survey) {
		t.Fatalf("%d images for %d screens", len(images), len(obs.Survey))
	}
	for i, shotURL := range images {
		img := decodeShot(t, shotURL)
		if img.Bounds() != image.Rect(0, 0, 1280, 800) {
			t.Fatalf("screen %d is %v: a badge must not change the picture's size", i+1, img.Bounds())
		}
		// The corner is a black plate with letters on it; the rest of the screen is as it was.
		if got := grayAt(img, 2, 2); got > 40 {
			t.Fatalf("screen %d has no plate in its corner (%d)", i+1, got)
		}
		if got, want := grayAt(img, 900, 600), grayAt(decodeShot(t, obs.Survey[i].Screenshot), 900, 600); abs(int(got)-int(want)) > 6 {
			t.Fatalf("screen %d changed away from its corner: %d, was %d", i+1, got, want)
		}
	}
	// The numbers differ, so the pictures of two screens of one shade still differ.
	obs.Survey[0].Screenshot, obs.Survey[1].Screenshot = shot(t, 120), shot(t, 120)
	same := badgedImages(obs)
	if same[0] == same[1] {
		t.Fatal("two screens of one shade got the same badge")
	}
}

func TestABadgeSaysTheScreenAndHowManyThereAre(t *testing.T) {
	if got := badgeText(6, 8); got != "SCREEN 6 OF 8" {
		t.Fatalf("badge text = %q", got)
	}
	for _, r := range badgeText(12, 12) {
		if _, ok := badgeFont[r]; !ok {
			t.Fatalf("the badge font has no %q", r)
		}
	}
}

func TestAScreenshotThatCannotBeReadIsSentAsItIs(t *testing.T) {
	for _, bad := range []string{"not a data url", "data:image/jpeg;base64,AAAA"} {
		if got := badged(bad, 1, 3); got != bad {
			t.Fatalf("badged(%q) = %q", bad, got)
		}
	}
}

func TestTheModelIsToldTheNumbersAreOnThePictures(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("planning", nil, onScreen(1, 10, 10, nil))}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	obs := surveyObservation(t)
	stepOK(t, a, start(t, a), obs)
	last := model.requests[0].Messages[len(model.requests[0].Messages)-1]
	if !strings.Contains(last.Text, "written on a black plate in its top left corner") {
		t.Fatalf("the model was not told: %s", last.Text)
	}
	if last.Images[1] == obs.Survey[1].Screenshot {
		t.Fatal("the model was given the survey without its badges")
	}
}
