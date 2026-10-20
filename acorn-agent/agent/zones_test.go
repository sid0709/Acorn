package agent

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"
)

func pointAt(kind string, zone int, x, y float64) Action {
	return Action{ID: kind, Kind: kind, Zone: zone, X: &x, Y: &y}
}

func TestActionsWithoutAPointTakeTheZoneOfTheActionBefore(t *testing.T) {
	plan := []Action{{Kind: KindKey}, pointAt(KindClick, 2, 10, 10), {Kind: KindType}, {Kind: KindKey}, pointAt(KindClick, 3, 20, 20), {Kind: KindWait}}
	var got []int
	for _, action := range inheritZones(plan) {
		got = append(got, action.Zone)
	}
	if want := []int{2, 2, 2, 2, 3, 3}; len(got) != len(want) || got[0] != 2 || got[2] != 2 || got[4] != 3 || got[5] != 3 {
		t.Fatalf("zones = %v, want %v", got, want)
	}
	none := inheritZones([]Action{{Kind: KindType}, {Kind: KindKey}})
	if none[0].Zone != 0 || none[1].Zone != 0 {
		t.Fatalf("a plan with no zones was given some: %+v", none)
	}
}

func TestAPlanIsCutIntoRunsWhereItsZoneChanges(t *testing.T) {
	plan := inheritZones([]Action{pointAt(KindClick, 1, 1, 1), {Kind: KindType}, pointAt(KindClick, 1, 2, 2), pointAt(KindChoose, 2, 3, 3), pointAt(KindClick, 3, 4, 4), {Kind: KindKey}})
	runs := zoneRuns(plan)
	if len(runs) != 3 || runs[0].Zone != 1 || len(runs[0].Actions) != 3 || runs[1].Zone != 2 || len(runs[1].Actions) != 1 || runs[2].Zone != 3 || len(runs[2].Actions) != 2 {
		t.Fatalf("runs = %+v", runs)
	}
}

func decodeCrop(t *testing.T, raw []byte) image.Image {
	t.Helper()
	img, err := jpeg.Decode(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("the crop is not an image: %v", err)
	}
	return img
}

func TestEveryPointGetsACropOfItsOwnSurveyScreenAroundIt(t *testing.T) {
	obs := surveyObservation(t)
	plan := []Action{pointAt(KindClick, 1, 640, 400), {ID: "typed", Kind: KindType, Zone: 1}, pointAt(KindChoose, 3, 5, 790), pointAt(KindUpload, 2, 1275, 3)}
	plan[2].ID, plan[3].ID = "edge", "corner"
	got := buildAnchors(plan, obs)
	if len(got) != 3 {
		t.Fatalf("%d anchors, want one for each of the 3 points and none for the typing", len(got))
	}
	if _, has := got["typed"]; has {
		t.Fatal("typing was given an anchor")
	}
	middle := got["click"]
	if middle.Zone != 1 || middle.ScrollY != 0 || middle.Point != image.Pt(640, 400) {
		t.Fatalf("anchor = %+v", middle)
	}
	if want := image.Rect(640-anchorWidth/2, 400-anchorAbove, 640+anchorWidth/2, 400+anchorBelow); middle.Rect != want {
		t.Fatalf("crop %v, want %v", middle.Rect, want)
	}
	if size := decodeCrop(t, middle.JPEG).Bounds().Size(); size != middle.Rect.Size() {
		t.Fatalf("the JPEG is %v, the crop %v", size, middle.Rect.Size())
	}
	// A point near the edge of the screen is cropped to what the screen has.
	edge := got["edge"]
	if edge.Zone != 3 || edge.ScrollY != 1360 || edge.Rect.Min.X != 0 || edge.Rect.Max.Y != 800 {
		t.Fatalf("edge anchor = %+v", edge)
	}
	corner := got["corner"]
	if corner.Rect.Min.Y != 0 || corner.Rect.Max.X != 1280 {
		t.Fatalf("corner anchor = %+v", corner)
	}
}

func TestACropIsTakenFromTheScreenTheModelMeasuredItOn(t *testing.T) {
	obs := surveyObservation(t)
	// The survey's second screen has a dark patch where the third has none.
	patch := image.Rect(600, 380, 700, 420)
	obs.Survey[1].Screenshot = shot(t, 200, patch)
	middle := buildAnchors([]Action{pointAt(KindClick, 2, 650, 400)}, obs)["click"]
	img := decodeCrop(t, middle.JPEG)
	inside := color.GrayModel.Convert(img.At(650-middle.Rect.Min.X, 400-middle.Rect.Min.Y)).(color.Gray).Y
	if inside > 60 {
		t.Fatalf("the crop does not show screen 2's patch: %d", inside)
	}
	other := buildAnchors([]Action{pointAt(KindClick, 3, 650, 400)}, obs)["click"]
	if got := color.GrayModel.Convert(decodeCrop(t, other.JPEG).At(650-other.Rect.Min.X, 400-other.Rect.Min.Y)).(color.Gray).Y; got < 150 {
		t.Fatalf("screen 3's crop shows the patch: %d", got)
	}
}

func TestASingleScreenshotIsItsOwnScreen(t *testing.T) {
	obs := observation(shot(t, 90))
	obs.Viewport.ScrollY = 500
	got := buildAnchors([]Action{pointAt(KindClick, 0, 300, 300)}, obs)["click"]
	if got.Zone != 0 || got.ScrollY != 500 || len(got.JPEG) == 0 {
		t.Fatalf("anchor = %+v", got)
	}
}

func TestZonePhotosOfTheWrongSizeAreDroppedAndTheNumberIsBounded(t *testing.T) {
	obs := observation(shot(t, 40))
	one := shot(t, 90)
	for i := 0; i < maxZoneShots+4; i++ {
		obs.ZoneShots = append(obs.ZoneShots, ZoneShot{Zone: i + 1, Screenshot: one, ScrollY: float64(i)})
	}
	obs.ZoneShots[1].Screenshot = "data:image/jpeg;base64,AAAA"
	kept := acceptZoneShots(obs)
	if len(kept) != maxZoneShots {
		t.Fatalf("kept %d, want %d", len(kept), maxZoneShots)
	}
	for _, shot := range kept {
		if shot.Zone == 2 {
			t.Fatal("a photo that is not an image was kept")
		}
	}
}

func fastRun(t *testing.T, cfg Config, model *scriptedModel) (*Agent, string) {
	t.Helper()
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, cfg)
	return a, startFast(t, a, true)
}

func TestAFastFillPlanCarriesZonesAndKeepsAnAnchorForEachPoint(t *testing.T) {
	reply := plan("filling", nil, onScreen(1, 100, 100, nil), typeAction("Ada", nil), onScreen(2, 200, 200, nil), onScreen(3, 300, 300, nil))
	a, id := fastRun(t, DefaultConfig(), &scriptedModel{replies: []string{reply}})
	step := stepOK(t, a, id, surveyObservation(t))
	var zones []int
	for _, action := range step.Actions {
		zones = append(zones, action.Zone)
	}
	if len(zones) != 4 || zones[0] != 1 || zones[1] != 1 || zones[2] != 2 || zones[3] != 3 {
		t.Fatalf("zones = %v", zones)
	}
	s, _ := a.sessions.get(id)
	if len(s.anchors) != 3 {
		t.Fatalf("%d anchors, want 3", len(s.anchors))
	}
}

func TestWithoutFastFillNoZonesAreSentAndNoAnchorsAreKept(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("filling", nil, onScreen(1, 100, 100, nil), onScreen(2, 200, 200, nil))}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	id := startFast(t, a, false)
	step := stepOK(t, a, id, surveyObservation(t))
	for _, action := range step.Actions {
		if action.Zone != 0 {
			t.Fatalf("an action carries zone %d in a run that is not fast-fill", action.Zone)
		}
	}
	if s, _ := a.sessions.get(id); len(s.anchors) != 0 {
		t.Fatal("anchors were kept")
	}
}

func TestZonePhotosAreKeptAndWrittenToTheTraceBesideTheEntry(t *testing.T) {
	cfg := DefaultConfig()
	cfg.TraceDir = t.TempDir()
	a, id := fastRun(t, cfg, &scriptedModel{replies: []string{wholePage(1), wholePage(1), wholePage(1)}})
	stepOK(t, a, id, surveyObservation(t))
	next := observation(shot(t, 90))
	next.ZoneShots = []ZoneShot{{Zone: 1, Screenshot: shot(t, 70), ScrollY: 0}, {Zone: 2, Screenshot: shot(t, 80), ScrollY: 680}}
	stepOK(t, a, id, next)
	s, _ := a.sessions.get(id)
	if len(s.zones) != 2 {
		t.Fatalf("%d zone photos kept", len(s.zones))
	}
	for _, name := range []string{"002.zone1.jpg", "002.zone2.jpg"} {
		if _, err := os.Stat(filepath.Join(cfg.TraceDir, id, name)); err != nil {
			t.Fatalf("missing %s: %v", name, err)
		}
	}
	// The photos belong to the look they came with: the next look starts again.
	stepOK(t, a, id, observation(shot(t, 120)))
	if s, _ := a.sessions.get(id); len(s.zones) != 0 {
		t.Fatal("the photos of an earlier look were kept")
	}
}
