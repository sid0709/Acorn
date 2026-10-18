package agent

import (
	"strings"
	"testing"
)

func TestEveryPointOfAPlanIsPinnedToTheScrollOfItsScreenshotUpToTheFirstScroll(t *testing.T) {
	vp := Viewport{Width: 1280, Height: 800, ScrollY: 854, PageHeight: 2400}
	x, y := 10.0, 10.0
	plan := []Action{
		{Kind: KindClick, X: &x, Y: &y}, {Kind: KindType, Text: "a"}, {Kind: KindChoose, X: &x, Y: &y, Text: "No"},
		{Kind: KindScroll, DY: 400}, {Kind: KindClick, X: &x, Y: &y},
	}
	pinFrame(plan, vp, 0)
	for _, i := range []int{0, 2} {
		if plan[i].ScrollTo == nil || *plan[i].ScrollTo != 854 {
			t.Fatalf("action %d is not pinned: %v", i, plan[i].ScrollTo)
		}
		if plan[i].PageHeight != 0 {
			t.Fatalf("action %d carries a page height: the page's height changes as a form is filled, so it is not checked", i)
		}
	}
	if plan[1].ScrollTo != nil {
		t.Fatal("typing has no point")
	}
	if plan[4].ScrollTo != nil {
		t.Fatal("what follows the plan's own scroll was aimed at a page the plan moved")
	}
}

func TestAPointThatAlreadyHasAScrollKeepsItAndASurveyPinsNothing(t *testing.T) {
	x, y, own := 10.0, 10.0, 300.0
	kept := []Action{{Kind: KindClick, X: &x, Y: &y, ScrollTo: &own}}
	pinFrame(kept, Viewport{ScrollY: 854}, 0)
	if *kept[0].ScrollTo != 300 {
		t.Fatal("a survey screen's own position was replaced")
	}
	survey := []Action{{Kind: KindClick, X: &x, Y: &y}}
	pinFrame(survey, Viewport{ScrollY: 854}, 3)
	if survey[0].ScrollTo != nil {
		t.Fatal("a survey sets its own positions")
	}
}

func TestAPlanIsCutAtItsFirstUploadBecauseThePageMovesAfterAFileIsAttached(t *testing.T) {
	x, y := 10.0, 10.0
	plan := []Action{{Kind: KindClick, X: &x, Y: &y}, {Kind: KindUpload, X: &x, Y: &y}, {Kind: KindClick, X: &x, Y: &y}, {Kind: KindType, Text: "a"}}
	kept, cut := cutAfterUpload(plan)
	if len(kept) != 2 || kept[1].Kind != KindUpload || cut != 2 {
		t.Fatalf("kept %d cut %d", len(kept), cut)
	}
	if kept, cut := cutAfterUpload(plan[:2]); len(kept) != 2 || cut != 0 {
		t.Fatalf("an upload that ends the plan cuts nothing: kept %d cut %d", len(kept), cut)
	}
}

func TestTheModelIsToldWhyWhatItPlannedAfterAnUploadDidNotRun(t *testing.T) {
	model := &scriptedModel{replies: []string{
		plan("attaching", nil, map[string]any{"kind": "upload", "x": 10, "y": 10, "check": "the file row shows"}, click(20, 20, nil), typeAction("Ada", nil)),
		plan("next", nil, click(30, 30, nil)),
	}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	id := start(t, a)
	step := stepOK(t, a, id, observation(shot(t, 40)))
	if len(step.Actions) != 1 || step.Actions[0].Kind != KindUpload || len(step.Dropped) == 0 {
		t.Fatalf("step %+v", step)
	}
	obs := observation(shot(t, 90))
	obs.Results = resultsOf(step)
	stepOK(t, a, id, obs)
	if text := lastText(model); !strings.Contains(text, "Plan the rest on this look") {
		t.Fatalf("the model was not told:\n%s", text)
	}
}

func TestANativeListIsChosenByTheOptionThatIsExactlyTheAnswer(t *testing.T) {
	for _, tc := range []struct {
		answer  string
		options []string
		want    int
		ok      bool
	}{
		{"No", []string{"No answer", "No", "Yes"}, 1, true},
		{"  no ", []string{"No answer", "No", "Yes"}, 1, true},
		{"College - Associates", []string{"GED", "College - Associates"}, 1, true},
		{"No", []string{"No answer", "Not sure"}, 0, false},
		{"No", []string{"No", "no"}, 0, false},
	} {
		if got, ok := exactOption(tc.answer, tc.options); ok != tc.ok || (ok && got != tc.want) {
			t.Fatalf("%q in %v: got %d %v", tc.answer, tc.options, got, ok)
		}
	}
}
