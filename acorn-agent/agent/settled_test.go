package agent

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// planSettled is a plan whose answer also lists the screens the model will not come back to.
func planSettled(settled []int, actions ...map[string]any) string {
	var out map[string]any
	_ = json.Unmarshal([]byte(plan("planning", nil, actions...)), &out)
	out["settled"] = settled
	raw, _ := json.Marshal(out)
	return string(raw)
}

func TestScreensTheModelWillNotComeBackToAreMergedIntoStretchesOfThePage(t *testing.T) {
	obs := surveyObservation(t) // screens at 0, 680 and 1360 px, each 800 high
	var s session
	if n := s.markSettled(obs, []int{1, 2}, nil, nil); n != 2 {
		t.Fatalf("settled %d screens, want 2", n)
	}
	if len(s.settled.Spans) != 1 || s.settled.Spans[0] != (Span{From: 0, To: 1480}) {
		t.Fatalf("spans = %+v, want the two overlapping screens as one stretch 0 to 1480", s.settled.Spans)
	}
	if n := s.markSettled(obs, []int{9, 0, -1}, nil, nil); n != 0 {
		t.Fatalf("screens that are not in the survey were settled: %d", n)
	}
}

func TestAScreenThePlanActsOnIsNotSettledByTheSameAnswer(t *testing.T) {
	obs := surveyObservation(t)
	var s session
	scrollTo := 680.0
	planned := []Action{{Kind: KindClick, ScrollTo: &scrollTo}}
	if n := s.markSettled(obs, []int{1, 2, 3}, planned, map[int]bool{3: true}); n != 1 {
		t.Fatalf("settled %d screens, want only screen 1 (screen 2 has an action, screen 3 had a point refused)", n)
	}
	if got := s.settled.Spans[0]; got != (Span{From: 0, To: 800}) {
		t.Fatalf("span = %+v", got)
	}
}

func TestWhatWasSettledIsForgottenOnAnotherPageOrAtAnotherHeight(t *testing.T) {
	obs := surveyObservation(t)
	obs.Viewport.PageHeight = 2400
	var s session
	s.markSettled(obs, []int{1}, nil, nil)
	s.takeSettledMap()

	same := obs
	same.Viewport.PageHeight = 2400 + settledHeightTolerance
	s.forgetSettledIfStale(same)
	if len(s.settled.Spans) != 1 {
		t.Fatal("a page that is as tall as it was (within the tolerance) lost what was settled")
	}
	taller := obs
	taller.Viewport.PageHeight = 2400 + settledHeightTolerance + 1
	s.forgetSettledIfStale(taller)
	if len(s.settled.Spans) != 1 || s.settled.PageHeight != taller.Viewport.PageHeight {
		t.Fatal("a page that grew at the bottom lost a settled stretch whose coordinates still hold")
	}
	if told := s.takeSettledMap(); told == nil || told.PageHeight != taller.Viewport.PageHeight || len(told.Spans) != 1 {
		t.Fatalf("the extension is not told the page's new height: %+v", told)
	}

	s.markSettled(obs, []int{1}, nil, nil)
	other := obs
	other.URL = "https://jobs.example/other"
	s.forgetSettledIfStale(other)
	if len(s.settled.Spans) != 0 {
		t.Fatal("another page kept what was settled")
	}
}

func TestTheExtensionIsToldWhenTheSettledPartsChangeAndOnlyThen(t *testing.T) {
	model := &scriptedModel{replies: []string{
		planSettled([]int{1, 2}, onScreen(3, 100, 100, nil)),
		plan("next", nil, click(5, 5, nil)),
		plan("again", nil, click(5, 5, nil)),
	}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	id := startFast(t, a, true)
	first := stepOK(t, a, id, surveyObservation(t))
	if first.Settled == nil || len(first.Settled.Spans) != 1 || first.Settled.Spans[0].To != 1480 {
		t.Fatalf("settled = %+v", first.Settled)
	}
	same := observation(shot(t, 90))
	same.Viewport.PageHeight = 2400
	second := stepOK(t, a, id, same)
	// The plan's first point is at y 5, so the fence moved: the extension is told the same stretches with it.
	if second.Settled == nil || second.Settled.Fence != 5 || len(second.Settled.Spans) != 1 {
		t.Fatalf("the extension is not told the fence: %+v", second.Settled)
	}
	third := stepOK(t, a, id, same)
	if third.Settled != nil {
		t.Fatalf("the extension was told again of what it already knows: %+v", third.Settled)
	}
}

func TestASurveyLooksSayWhatIsSettledAndTheModelIsToldItHasLookedAtAll(t *testing.T) {
	model := &scriptedModel{replies: []string{
		planSettled([]int{1, 2}, onScreen(3, 100, 100, nil)),
		plan("next", nil, onScreen(1, 5, 5, nil)),
	}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	id := startFast(t, a, true)
	whole := surveyObservation(t)
	whole.Viewport.PageHeight = 2160 // the three screens reach the bottom of the page
	stepOK(t, a, id, whole)
	// The next survey shows only the screen that is not settled.
	next := surveyObservation(t)
	next.Viewport.PageHeight = 2160
	next.Survey = next.Survey[2:]
	stepOK(t, a, id, next)
	text := lastText(model)
	for _, want := range []string{"You settled these parts of the page and they are not shown again", "0 to 1480 px", "You have looked at all of it"} {
		if !strings.Contains(text, want) {
			t.Fatalf("the look does not say %q:\n%s", want, text)
		}
	}
}

func TestTheSchemaAsksForSettledScreensOnlyInASurveyAndNeverLimitsTheScreens(t *testing.T) {
	if !strings.Contains(string(replySchemaFor(true, true)), `"settled"`) || strings.Contains(string(replySchemaFor(false, true)), `"settled"`) {
		t.Fatal("settled is not in the schema exactly when surveys are")
	}
	if maxSurveyScreens < 1000 {
		t.Fatalf("maxSurveyScreens = %d: a survey must never be cut short", maxSurveyScreens)
	}
	obs := surveyObservation(t)
	for len(obs.Survey) < 40 {
		obs.Survey = append(obs.Survey, SurveyScreen{Screenshot: shot(t, 60), ScrollY: float64(len(obs.Survey)) * 700})
	}
	if _, err := checkSurvey(obs); err != nil {
		t.Fatalf("a survey of 40 screens was refused: %v", err)
	}
}

func TestAFragmentOfTheAddressIsTheSamePage(t *testing.T) {
	obs := surveyObservation(t)
	var s session
	s.markSettled(obs, []int{1}, nil, nil)
	jumped := obs
	jumped.URL = obs.URL + "#application"
	s.forgetSettledIfStale(jumped)
	if len(s.settled.Spans) != 1 {
		t.Fatal("an Apply button that jumps to a place on the page made the page another page, and what was settled was forgotten")
	}
	var c coverage
	c.see(obs.URL, obs.Viewport)
	c.see(jumped.URL, jumped.Viewport)
	if len(c.spans) == 0 || c.url != obs.URL {
		t.Fatalf("the reach of the looks started again at a fragment: %+v", c)
	}
}

func TestAScrollIntoASettledPartIsNotMade(t *testing.T) {
	var s session
	s.settled = settledState{Spans: []Span{{From: 0, To: 2000}}}
	obs := observation(shot(t, 40))
	obs.Viewport.PageHeight = 6000
	obs.Viewport.ScrollY = 3000
	up := Action{Kind: KindScroll, DY: -1500} // the window would then be at 1500 to 2300: not wholly settled
	deep := Action{Kind: KindScroll, DY: -2500}
	down := Action{Kind: KindScroll, DY: 400}
	kept, dropped := s.withoutBlueScrolls([]Action{up, down, deep}, obs)
	// up: 3000 - 1500 = 1500, the window is 1500 to 2300: partly outside the stretch, so it is made.
	// down: 1500 + 400 = 1900 (window 1900 to 2700): partly outside, made.
	// deep: 1900 - 2500 clamps to 0 (window 0 to 800): wholly settled, dropped.
	if dropped != 1 || len(kept) != 2 || kept[0].DY != -1500 || kept[1].DY != 400 {
		t.Fatalf("kept %+v, dropped %d", kept, dropped)
	}
	// A pinned point puts the window where its survey screen was: the next scroll goes on from there.
	to := 1000.0
	pinned := Action{Kind: KindClick, ScrollTo: &to}
	kept, dropped = s.withoutBlueScrolls([]Action{pinned, {Kind: KindScroll, DY: -100}}, obs)
	if dropped != 1 || len(kept) != 1 || kept[0].Kind != KindClick {
		t.Fatalf("a scroll from a settled place into it was made: %+v, %d", kept, dropped)
	}
	// With nothing settled nothing is dropped.
	var none session
	kept, dropped = none.withoutBlueScrolls([]Action{deep}, obs)
	if dropped != 0 || len(kept) != 1 {
		t.Fatal("a scroll was dropped on a page with nothing settled")
	}
}

func TestThePlanSaysWhyAScrollIntoASettledPartWasDropped(t *testing.T) {
	model := &scriptedModel{replies: []string{
		planSettled([]int{1, 2}, onScreen(3, 100, 100, nil)),
		plan("going back", nil, map[string]any{"kind": "scroll", "x": 640.0, "y": 400.0, "dx": 0.0, "dy": -1400.0}, click(5, 5, nil)),
		plan("next", nil, click(6, 6, nil)),
	}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	id := startFast(t, a, true)
	first := surveyObservation(t)
	first.Viewport.PageHeight = 2160
	stepOK(t, a, id, first)
	// The page is as tall as it was, so screens 1 and 2 (0 to 1480 px) are still settled; the window is at 1360.
	look := observation(shot(t, 90))
	look.Viewport.PageHeight, look.Viewport.ScrollY = 2160, 1360
	step := stepOK(t, a, id, look)
	for _, action := range step.Actions {
		if action.Kind == KindScroll {
			t.Fatalf("a scroll into the settled part was sent: %+v", step.Actions)
		}
	}
	if len(step.Dropped) == 0 || !strings.Contains(strings.Join(step.Dropped, " "), "scroll to a settled part") {
		t.Fatalf("dropped = %v", step.Dropped)
	}
	again := observation(shot(t, 140))
	again.Viewport.PageHeight, again.Viewport.ScrollY = 2160, 1360
	stepOK(t, a, id, again)
	if !strings.Contains(lastText(model), "a part of the page you settled") {
		t.Fatalf("the model was not told why:\n%s", lastText(model))
	}
}

func TestWhatLiesAboveWhereThePlanFirstActedStaysSettledWhenThePageChangesHeight(t *testing.T) {
	obs := surveyObservation(t)
	obs.Viewport.PageHeight = 2400
	var s session
	s.markSettled(obs, []int{1, 2}, nil, nil) // 0 to 1480 settled
	// The plan about to run acts first at 1500 px down the page (a click at y 140 on the screen scrolled to 1360).
	scroll, y := 1360.0, 140.0
	s.setFence([]Action{{Kind: KindClick, X: &y, Y: &y, ScrollTo: &scroll}, {Kind: KindClick, X: &y, Y: &y, ScrollTo: &scroll}}, obs)
	if s.settled.Fence != 1500 {
		t.Fatalf("fence = %.0f, want 1500", s.settled.Fence)
	}
	s.takeSettledMap()
	// A résumé was attached: the page is 112 px shorter.
	shorter := obs
	shorter.Viewport.PageHeight = 2288
	s.forgetSettledIfStale(shorter)
	if len(s.settled.Spans) != 1 || s.settled.Spans[0] != (Span{From: 0, To: 1480}) || s.settled.PageHeight != 2288 {
		t.Fatalf("what lay above the plan's first point was forgotten: %+v", s.settled)
	}
	if told := s.takeSettledMap(); told == nil || told.PageHeight != 2288 {
		t.Fatalf("the extension is not told the page's new height: %+v", told)
	}
	// A stretch below the fence holds when the extra pixels are at the bottom and nothing moved.
	s.settled.Spans = append(s.settled.Spans, Span{From: 1600, To: 2000})
	s.settled.Fence = 1500
	taller := obs
	taller.Viewport.PageHeight = 2600
	s.forgetSettledIfStale(taller)
	if len(s.settled.Spans) != 2 || s.settled.Spans[1] != (Span{From: 1600, To: 2000}) {
		t.Fatalf("spans = %+v", s.settled.Spans)
	}
}

func TestAShiftFromTheControlsMovesTheSettledPartBelowItAndCutsOneThatItCrosses(t *testing.T) {
	obs := surveyObservation(t)
	obs.Viewport.PageHeight = 2400
	var s session
	s.markSettled(obs, []int{1}, nil, nil) // 0 to 800
	s.settled.Spans = append(s.settled.Spans, Span{From: 1400, To: 2000})
	s.takeSettledMap()
	moved := obs
	moved.Viewport.PageHeight = 2480
	// Something appeared between 1500 and 1600 px: the controls from 1600 down moved 80 px.
	moved.Layout = []LayoutMove{{From: 1500, At: 1600, Dy: 80}}
	s.forgetSettledIfStale(moved)
	want := []Span{{From: 0, To: 800}, {From: 1400, To: 1500}, {From: 1680, To: 2080}}
	if len(s.settled.Spans) != len(want) {
		t.Fatalf("spans = %+v, want %+v", s.settled.Spans, want)
	}
	for i := range want {
		if s.settled.Spans[i] != want[i] {
			t.Fatalf("spans = %+v, want %+v (what appeared in the gap is not settled)", s.settled.Spans, want)
		}
	}
	// A stretch wholly below the insertion shifts by the same amount.
	s.settled.Spans = []Span{{From: 0, To: 800}, {From: 1800, To: 2200}}
	s.settled.PageHeight = 2400
	s.forgetSettledIfStale(moved)
	if len(s.settled.Spans) != 2 || s.settled.Spans[1] != (Span{From: 1880, To: 2280}) {
		t.Fatalf("spans = %+v", s.settled.Spans)
	}
}

func TestSeveralMovesOfTheFormEachPlaceTheStretchesAmongTheirOwnControls(t *testing.T) {
	moves := []LayoutMove{{From: 1000, At: 1050, Dy: 30}, {From: 1500, At: 1560, Dy: 100}}
	got := placeSettled([]Span{{From: 900, To: 2000}}, moves)
	want := []Span{{From: 900, To: 1000}, {From: 1080, To: 1530}, {From: 1660, To: 2100}}
	if len(got) != len(want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %+v, want %+v", got, want)
		}
	}
}

func TestWhereTheFormShrankOverAStretchTheContradictoryPlaceIsNotSettled(t *testing.T) {
	// 150 px went from between 1000 and 1100: what was at 1100 is now at 950, on top of what was at 950.
	got := placeSettled([]Span{{From: 0, To: 2000}}, []LayoutMove{{From: 1000, At: 1100, Dy: -150}})
	want := []Span{{From: 0, To: 950}, {From: 1000, To: 1850}}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestNoMoveLeavesTheStretchesAsTheyAreAndAMoveAtTheTopLeavesNoGapAbove(t *testing.T) {
	spans := []Span{{From: 0, To: 800}, {From: 1400, To: 2000}}
	if got := placeSettled(spans, nil); len(got) != 2 || got[0] != spans[0] || got[1] != spans[1] {
		t.Fatalf("no move changed the stretches: %+v", got)
	}
	// Every control moved (the first one too): nothing above the first control moved, and nothing is lost there.
	got := placeSettled(spans, []LayoutMove{{From: 900, At: 900, Dy: 40}})
	if len(got) != 2 || got[0] != (Span{From: 0, To: 800}) || got[1] != (Span{From: 1440, To: 2040}) {
		t.Fatalf("got %+v", got)
	}
	// A stretch pushed off the top is clamped to it, and one wholly off it is gone.
	got = placeSettled([]Span{{From: 100, To: 200}, {From: 300, To: 900}}, []LayoutMove{{From: 50, At: 50, Dy: -400}})
	if len(got) != 1 || got[0] != (Span{From: 0, To: 500}) {
		t.Fatalf("got %+v", got)
	}
}

func TestMovesThatAreNotNumbersOrOutOfOrderAreCleaned(t *testing.T) {
	nan := math.NaN()
	got := placeSettled([]Span{{From: 0, To: 3000}}, []LayoutMove{
		{From: 2000, At: 2100, Dy: 50},
		{From: nan, At: 500, Dy: 10},
		{From: 1000, At: 1100, Dy: 20},
	})
	want := []Span{{From: 0, To: 1000}, {From: 1120, To: 2020}, {From: 2150, To: 3050}}
	if len(got) != len(want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %+v, want %+v", got, want)
		}
	}
}

func TestAPlanThatActsOnNoPointLeavesTheWholePageAsItIs(t *testing.T) {
	obs := surveyObservation(t)
	obs.Viewport.PageHeight = 2400
	if got := fenceOf([]Action{{Kind: KindWait, Ms: 100}}, obs); got != 2400 {
		t.Fatalf("fence = %.0f", got)
	}
}

func TestAStepSentAgainPlacesTheMoveOfItsLookOnce(t *testing.T) {
	obs := surveyObservation(t)
	obs.Viewport.PageHeight = 2400
	var s session
	s.markSettled(obs, []int{1}, nil, nil) // 0 to 800
	s.settled.Spans = append(s.settled.Spans, Span{From: 1400, To: 2000})
	s.takeSettledMap()
	moved := obs
	moved.Viewport.PageHeight = 2480
	moved.Layout = []LayoutMove{{From: 1000, At: 1100, Dy: 80}}
	moved.Look = "look-7"
	s.forgetSettledIfStale(moved)
	s.forgetSettledIfStale(moved) // the model failed and the extension sent the same look again
	if len(s.settled.Spans) != 2 || s.settled.Spans[1] != (Span{From: 1480, To: 2080}) {
		t.Fatalf("spans = %+v, want the move placed once", s.settled.Spans)
	}
	next := moved
	next.Look = "look-8"
	s.forgetSettledIfStale(next)
	if s.settled.Spans[1] != (Span{From: 1560, To: 2160}) {
		t.Fatalf("spans = %+v, want the next look's move placed", s.settled.Spans)
	}
	// An extension that does not name its looks has every move placed, as before.
	unnamed := moved
	unnamed.Look = ""
	s.forgetSettledIfStale(unnamed)
	s.forgetSettledIfStale(unnamed)
	if s.settled.Spans[1] != (Span{From: 1720, To: 2320}) {
		t.Fatalf("spans = %+v", s.settled.Spans)
	}
}

func TestEveryAnswerCarriesTheSettledPartsWhenTheFormMovedEvenAProbeOfDropdowns(t *testing.T) {
	screen := &fakeScreen{optionByAnswer: map[string]optionVerdict{"No": {1, 0.95}, "Male": {3, 0.95}}}
	a, id := newProbeAgent(t, []string{planSettled([]int{3},
		labelled(1, 100, 100, "First Name"), typeAction("Ada", nil),
		chooseWithLabel(1, 500, 300, "Sponsorship", "No"),
		chooseWithLabel(1, 500, 500, "Gender", "Male"),
	)}, screen, DefaultConfig())
	first := stepOK(t, a, id, surveyObservation(t))
	if first.Settled == nil || len(first.Settled.Spans) != 1 || first.Settled.Spans[0].From != 1360 {
		t.Fatalf("settled = %+v", first.Settled)
	}
	sends(t, a, id, first.Actions, nil)
	obs := observation(shot(t, 130))
	obs.Viewport.PageHeight = 2440
	obs.Results = carriedOut(first.Actions)
	obs.Layout = []LayoutMove{{From: 700, At: 760, Dy: 40}}
	obs.Look = "look-2"
	second := stepOK(t, a, id, obs)
	if second.Settled == nil || len(second.Settled.Spans) != 1 || second.Settled.Spans[0] != (Span{From: 1400, To: 2200}) {
		t.Fatalf("the probe's answer does not carry the stretch where the form moved it: %+v", second.Settled)
	}
	s, _ := a.sessions.get(id)
	if s.settled.changed {
		t.Fatal("the answer carried the settled parts, but the session still holds them as not yet told")
	}
}
