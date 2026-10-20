package agent

import (
	"encoding/json"
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
	if len(s.settled.Spans) != 0 {
		t.Fatal("a page that grew kept what was settled")
	}
	if cleared := s.takeSettledMap(); cleared == nil || len(cleared.Spans) != 0 {
		t.Fatalf("the extension is not told that nothing is settled any more: %+v", cleared)
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
	if second.Settled != nil {
		t.Fatalf("the extension was told again of what it already knows: %+v", second.Settled)
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
