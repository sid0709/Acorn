package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/sid0709/acorn/acorn-agent/applicant"
	"github.com/sid0709/acorn/acorn-agent/decide"
)

// domScreen answers the DOM-first loop's questions from a script, and records what it was asked.
type domScreen struct {
	mu       sync.Mutex
	requests []decide.Request
	err      error
	// review answers
	errors, loading, sent        float64
	unanswered, unticked, greyed float64
	human                        string
	humanSure                    float64
	// advance answers: the candidate key chosen, how sure, which key sends the application, how sure
	next, nextSure string
	nextP          float64
	final          string
	finalP         float64
	// probs, when set, is every probability the model gives for the advance question.
	probs map[string]float64
	// need is what the screen is said to need from the applicant (the stop check), and how sure; "" is none.
	need     string
	needSure float64
}

func (d *domScreen) Name() string { return "dom-screen" }

func (d *domScreen) Decide(_ context.Context, req decide.Request) (decide.Response, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.requests = append(d.requests, req)
	if d.err != nil {
		return decide.Response{}, d.err
	}
	noul := func(p float64) decide.Answer { return decide.Answer{Type: decide.TypeNoul, Noul: &p} }
	answers := map[string]decide.Answer{}
	if _, ok := req.Questions[askVisibleErrors]; ok {
		answers[askVisibleErrors], answers[askLoading], answers[askSent] = noul(d.errors), noul(d.loading), noul(d.sent)
		answers[askUnanswered], answers[askUnticked], answers[askGreyedOut] = noul(d.unanswered), noul(d.unticked), noul(d.greyed)
		human := d.human
		if human == "" {
			human = humanNone
		}
		answers[askHuman] = decide.Answer{Type: decide.TypeChoice, Choice: human, Probabilities: map[string]float64{human: d.humanSure}}
	}
	if _, ok := req.Questions[askHumanRequired]; ok {
		need := d.need
		if need == "" {
			need = needNone
		}
		answers[askHumanRequired] = decide.Answer{Type: decide.TypeChoice, Choice: need, Probabilities: map[string]float64{need: d.needSure, needNone: 1 - d.needSure}}
	}
	if _, ok := req.Questions[askAdvance]; ok {
		next, final := d.next, d.final
		if next == "" {
			next = advanceNone
		}
		if final == "" {
			final = advanceNone
		}
		probs := map[string]float64{next: d.nextP}
		if next != advanceNone {
			probs[advanceNone] = 1 - d.nextP
		}
		if d.probs != nil {
			probs = d.probs
		}
		answers[askAdvance] = decide.Answer{Type: decide.TypeChoice, Choice: next, Probabilities: probs}
		answers[askFinal] = decide.Answer{Type: decide.TypeChoice, Choice: final, Probabilities: map[string]float64{final: d.finalP}}
	}
	return decide.Response{Model: "dom-screen-1", Answers: answers, Usage: decide.Usage{InputTokens: 900, Cost: 0.0002}}, nil
}

func newDOMAgent(t *testing.T, screen *domScreen, stopBeforeSubmit bool) (*Agent, string) {
	t.Helper()
	a := newAgentWithScreen(t, &scriptedModel{}, &fixedDecider{}, screen, DefaultConfig())
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{URL: "https://jobs.example/apply", Title: "Apply", Prefill: true, StopBeforeSubmit: stopBeforeSubmit})
	if err != nil {
		t.Fatal(err)
	}
	return a, started.SessionID
}

func reviewOf(screen string) ReviewRequest {
	return ReviewRequest{URL: "https://jobs.example/apply", Title: "Apply", Screenshot: screen, Viewport: Viewport{Width: 1280, Height: 800}, DOM: ReviewFindings{Fields: 5}}
}

func TestAPageWithProblemsInItsOwnStateIsFixedWithoutAnyModelCall(t *testing.T) {
	screen := &domScreen{}
	a, id := newDOMAgent(t, screen, false)
	req := reviewOf("")
	req.DOM = ReviewFindings{Fields: 5, Empty: []string{"Phone", "Résumé"}, Failed: []string{"Country"}, Errors: []string{"Enter a valid email"}}
	result, err := a.Review(context.Background(), id, req)
	if err != nil {
		t.Fatal(err)
	}
	if result.Verdict != ReviewFix || len(result.Problems) != 4 {
		t.Fatalf("result = %+v", result)
	}
	for _, want := range []string{"still empty: Phone", "did not take: Country", "the page shows: Enter a valid email", "Do exactly these, then continue."} {
		if !strings.Contains(result.Note, want) {
			t.Fatalf("the note is missing %q:\n%s", want, result.Note)
		}
	}
	if len(screen.requests) != 0 {
		t.Fatal("the decision model was asked about a page whose own state already says what to fix")
	}
}

func TestACleanPageIsReadByTheDecisionModelAndAllowedOn(t *testing.T) {
	screen := &domScreen{}
	a, id := newDOMAgent(t, screen, false)
	result, err := a.Review(context.Background(), id, reviewOf(shot(t, 40)))
	if err != nil {
		t.Fatal(err)
	}
	if result.Verdict != ReviewClean || !strings.Contains(result.Note, "Go to the control that continues") {
		t.Fatalf("result = %+v", result)
	}
	if len(screen.requests) != 1 || result.Usage.Checks != 1 || result.Usage.Calls != 0 {
		t.Fatalf("requests %d, usage %+v: one decision-model check and no driving call", len(screen.requests), result.Usage)
	}
}

func TestAVisibleErrorTheDomCannotSeeSendsThePageToBeFixed(t *testing.T) {
	a, id := newDOMAgent(t, &domScreen{errors: 0.9}, false)
	result, _ := a.Review(context.Background(), id, reviewOf(shot(t, 40)))
	if result.Verdict != ReviewFix || len(result.Problems) != 1 {
		t.Fatalf("result = %+v", result)
	}
}

func TestAPageStillLoadingAndAConfirmationAreToldApart(t *testing.T) {
	a, id := newDOMAgent(t, &domScreen{loading: 0.9}, false)
	if result, _ := a.Review(context.Background(), id, reviewOf(shot(t, 40))); result.Verdict != ReviewLoading {
		t.Fatalf("loading: %+v", result)
	}
	b, id2 := newDOMAgent(t, &domScreen{sent: 0.95}, false)
	if result, _ := b.Review(context.Background(), id2, reviewOf(shot(t, 40))); result.Verdict != ReviewSent || !strings.Contains(result.Note, "report done") {
		t.Fatalf("sent: %+v", result)
	}
}

func TestACheckOnlyThePersonCanPassIsAHintAndDoesNotEndTheRun(t *testing.T) {
	a, id := newDOMAgent(t, &domScreen{human: humanCaptcha, humanSure: 0.95}, false)
	result, err := a.Review(context.Background(), id, reviewOf(shot(t, 40)))
	if err != nil {
		t.Fatal(err)
	}
	if result.Verdict != ReviewHuman || result.Step != nil || !strings.Contains(result.Note, "does not end the run") {
		t.Fatalf("the review hints and the driving model decides: %+v", result)
	}
	// The run goes on: the driving model may still be asked, and may stop for the person itself.
	if _, err := a.Review(context.Background(), id, reviewOf(shot(t, 40))); err != nil {
		t.Fatalf("the run is not over: %v", err)
	}
}

func TestAHumanCheckTheModelIsUnsureOfIsLeftToTheDrivingModel(t *testing.T) {
	a, id := newDOMAgent(t, &domScreen{human: humanCaptcha, humanSure: 0.5}, false)
	result, _ := a.Review(context.Background(), id, reviewOf(shot(t, 40)))
	if result.Verdict != ReviewClean || result.Step != nil {
		t.Fatalf("a badge that only mentions a captcha stopped the run: %+v", result)
	}
}

func TestAReviewThatCannotBeMadeHandsTheLookToTheDrivingModel(t *testing.T) {
	a, id := newDOMAgent(t, &domScreen{err: errors.New("the decision model is down")}, false)
	result, err := a.Review(context.Background(), id, reviewOf(shot(t, 40)))
	if err != nil || result.Verdict != ReviewLook || result.Note != "" {
		t.Fatalf("result %+v, err %v", result, err)
	}
}

func TestReviewsAndAdvancesAreOffWithoutThePassAndBoundedWithIt(t *testing.T) {
	a := newTestAgent(t, &scriptedModel{}, &fixedDecider{}, DefaultConfig())
	id := start(t, a)
	if _, err := a.Review(context.Background(), id, reviewOf("")); !errors.Is(err, ErrPrefillOff) {
		t.Fatalf("review: %v", err)
	}
	if _, err := a.Advance(context.Background(), id, AdvanceRequest{}); !errors.Is(err, ErrPrefillOff) {
		t.Fatalf("advance: %v", err)
	}
	cfg := DefaultConfig()
	cfg.MaxReviews, cfg.MaxAdvances = 1, 1
	b := newAgentWithScreen(t, &scriptedModel{}, &fixedDecider{}, &domScreen{next: "c0", nextP: 0.9}, cfg)
	started, _ := b.Start(context.Background(), "key", applicant.Auth{}, Start{Prefill: true})
	// A review the page's own state settles asks no model, so it does not count against the limit.
	bad := reviewOf("")
	bad.DOM.Empty = []string{"x"}
	for i := 0; i < 3; i++ {
		if _, err := b.Review(context.Background(), started.SessionID, bad); err != nil {
			t.Fatalf("free review %d: %v", i, err)
		}
	}
	clean := reviewOf(shot(t, 40))
	if _, err := b.Review(context.Background(), started.SessionID, clean); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Review(context.Background(), started.SessionID, clean); !errors.Is(err, ErrReviewLimit) {
		t.Fatalf("review limit: %v", err)
	}
}

func candidates() []AdvanceCandidate {
	return []AdvanceCandidate{
		{Ref: 11, Text: "Clear", Kind: "button"},
		{Ref: 12, Text: "Next", Kind: "button", InForm: true},
		{Ref: 13, Text: "Submit application", Kind: "submit", InForm: true},
	}
}

func advanceOf(t *testing.T) AdvanceRequest {
	return AdvanceRequest{URL: "https://jobs.example/apply", Title: "Apply", Screenshot: shot(t, 40), Candidates: candidates()}
}

func TestTheControlTheDecisionModelPicksIsPressedAndTheDecisionModelIsToldTheList(t *testing.T) {
	screen := &domScreen{next: "c1", nextP: 0.95, final: advanceNone, finalP: 0.9}
	a, id := newDOMAgent(t, screen, false)
	result, err := a.Advance(context.Background(), id, advanceOf(t))
	if err != nil {
		t.Fatal(err)
	}
	if result.Action != AdvanceClick || result.Ref != 12 || result.Submit || result.Text != "Next" {
		t.Fatalf("result = %+v", result)
	}
	state := ""
	for _, part := range screen.requests[0].State {
		state += part.Text
	}
	if !strings.Contains(state, `c1: button "Next" (in the form)`) || !strings.Contains(state, `c2: submit "Submit application"`) {
		t.Fatalf("the model was not told the controls:\n%s", state)
	}
}

func TestTheControlThatSendsTheApplicationIsPressedOnlyWhenTheApplicantDoesNotWantToReview(t *testing.T) {
	screen := &domScreen{next: "c2", nextP: 0.95, final: "c2", finalP: 0.9}
	a, id := newDOMAgent(t, screen, false)
	if result, _ := a.Advance(context.Background(), id, advanceOf(t)); result.Action != AdvanceClick || !result.Submit || result.Ref != 13 {
		t.Fatalf("not reviewing: %+v", result)
	}
	b, id2 := newDOMAgent(t, &domScreen{next: "c2", nextP: 0.95, final: "c2", finalP: 0.9}, true)
	result, _ := b.Advance(context.Background(), id2, advanceOf(t))
	if result.Action != AdvanceReady || result.Step == nil || result.Step.Status != StatusDone {
		t.Fatalf("reviewing first: %+v", result)
	}
	if _, err := b.Advance(context.Background(), id2, advanceOf(t)); !errors.Is(err, ErrSessionOver) {
		t.Fatalf("the run is over: %v", err)
	}
}

func TestTheFirstControlIsNamedByItsNumberEvenWhenThatIsZero(t *testing.T) {
	a, id := newDOMAgent(t, &domScreen{next: "c0", nextP: 0.95, final: advanceNone, finalP: 0.9}, false)
	req := advanceOf(t)
	req.Candidates = []AdvanceCandidate{{Ref: 0, Text: "Create account", Kind: "submit"}}
	result, _ := a.Advance(context.Background(), id, req)
	raw, _ := json.Marshal(result)
	if result.Action != AdvanceClick || !strings.Contains(string(raw), `"ref":0`) {
		t.Fatalf("the first control was not named in %s", raw)
	}
}

func TestNoControlIsPressedWhenTheModelIsNotSureOfOne(t *testing.T) {
	for name, screen := range map[string]*domScreen{
		"none":      {next: advanceNone, nextP: 0.99},
		"unsure":    {next: "c1", nextP: 0.5},
		"not there": {next: "c9", nextP: 0.99},
	} {
		a, id := newDOMAgent(t, screen, false)
		if result, _ := a.Advance(context.Background(), id, advanceOf(t)); result.Action != AdvanceNone || result.Ref != 0 {
			t.Fatalf("%s: %+v", name, result)
		}
	}
}

func TestAnAdvanceWithNothingToChooseFromOrNoModelCallsNothing(t *testing.T) {
	screen := &domScreen{}
	a, id := newDOMAgent(t, screen, false)
	req := advanceOf(t)
	req.Candidates = nil
	if result, _ := a.Advance(context.Background(), id, req); result.Action != AdvanceNone || len(screen.requests) != 0 {
		t.Fatalf("result %+v, requests %d", result, len(screen.requests))
	}
}

func TestTheAdvanceListIsBoundedAndTheirTextClipped(t *testing.T) {
	screen := &domScreen{}
	a, id := newDOMAgent(t, screen, false)
	req := advanceOf(t)
	req.Candidates = nil
	for i := 0; i < maxAdvanceCandidates+10; i++ {
		req.Candidates = append(req.Candidates, AdvanceCandidate{Ref: i, Text: strings.Repeat("x", 500), Kind: "button"})
	}
	if _, err := a.Advance(context.Background(), id, req); err != nil {
		t.Fatal(err)
	}
	criteria := screen.requests[0].Questions[askAdvance].Criteria
	if len(criteria) != maxAdvanceCandidates+1 {
		t.Fatalf("%d criteria", len(criteria))
	}
	for key, text := range criteria {
		if len(text) > maxCandidateText+40 && key != advanceNone {
			t.Fatalf("%s is %d characters", key, len(text))
		}
	}
}

func TestTheDecisionModelNamesWhatItSeesUnfinishedOnAPageTheDomThoughtClean(t *testing.T) {
	for name, tc := range map[string]struct {
		screen  *domScreen
		problem string
	}{
		"unanswered": {&domScreen{unanswered: 0.8}, "still looks unanswered"},
		"unticked":   {&domScreen{unticked: 0.8}, "still unticked"},
		"greyed out": {&domScreen{greyed: 0.8}, "greyed out"},
	} {
		a, id := newDOMAgent(t, tc.screen, false)
		result, _ := a.Review(context.Background(), id, reviewOf(shot(t, 40)))
		if result.Verdict != ReviewFix || len(result.Problems) != 1 || !strings.Contains(result.Problems[0], tc.problem) {
			t.Fatalf("%s: %+v", name, result)
		}
	}
}

func TestAControlThePageMarksDisabledIsAProblemWithoutAnyModelCall(t *testing.T) {
	screen := &domScreen{}
	a, id := newDOMAgent(t, screen, false)
	req := reviewOf("")
	req.DOM.Blocked = []string{"the control \"Create Account\" is disabled", "unticked: I agree"}
	result, _ := a.Review(context.Background(), id, req)
	if result.Verdict != ReviewFix || len(result.Problems) != 2 || len(screen.requests) != 0 {
		t.Fatalf("result %+v, requests %d", result, len(screen.requests))
	}
	if strings.Contains(result.Note, "do not scroll") {
		t.Fatalf("the note tells the model not to look: %s", result.Note)
	}
}

func TestAPageTallerThanTheScreensIsNeverCalledClean(t *testing.T) {
	tall := Viewport{Width: 1280, Height: 800, ScrollY: 0, PageHeight: 2400}
	screen := &domScreen{}
	a, id := newDOMAgent(t, screen, false)
	req := reviewOf(shot(t, 40))
	req.Viewport = tall
	result, _ := a.Review(context.Background(), id, req)
	if result.Verdict != ReviewLook || len(screen.requests) != 0 {
		t.Fatalf("one screen of a 3-screen page was called %s", result.Verdict)
	}
	// With the whole page, from top to bottom with overlap, it is read.
	req.Survey = []SurveyScreen{{Screenshot: shot(t, 40), ScrollY: 0}, {Screenshot: shot(t, 41), ScrollY: 680}, {Screenshot: shot(t, 42), ScrollY: 1360}, {Screenshot: shot(t, 43), ScrollY: 1600}}
	result, _ = a.Review(context.Background(), id, req)
	if result.Verdict != ReviewClean || len(screen.requests) != 1 {
		t.Fatalf("whole page: %+v", result)
	}
	images := 0
	for _, part := range screen.requests[0].State {
		if part.Type == "image_url" {
			images++
		}
	}
	if images != 4 {
		t.Fatalf("the decision model was shown %d screens", images)
	}
}

func TestAGapBetweenScreensMeansTheWholePageWasNotSeen(t *testing.T) {
	vp := Viewport{Height: 800, PageHeight: 2400}
	if seesWholePage(vp, []SurveyScreen{{ScrollY: 0}, {ScrollY: 1000}, {ScrollY: 1600}}, 0) {
		t.Fatal("a 200 px gap was called seen")
	}
	if seesWholePage(vp, []SurveyScreen{{ScrollY: 100}, {ScrollY: 800}, {ScrollY: 1600}}, 100) {
		t.Fatal("a missing top was called seen")
	}
	if !seesWholePage(vp, []SurveyScreen{{ScrollY: 0}, {ScrollY: 800}, {ScrollY: 1600}}, 0) {
		t.Fatal("a page seen from top to bottom was not")
	}
	if !seesWholePage(Viewport{Height: 800, PageHeight: 700}, nil, 0) {
		t.Fatal("a page shorter than the screen is seen by one")
	}
}

func TestAControlTheModelIsSplitOnIsPressedWhenItIsSureOneContinues(t *testing.T) {
	// The real Workday answer: 98% sure a control continues, torn between two.
	screen := &domScreen{next: "c1", probs: map[string]float64{"c0": 0.38, "c1": 0.57, advanceNone: 0.02}, final: advanceNone, finalP: 0.9}
	a, id := newDOMAgent(t, screen, false)
	result, _ := a.Advance(context.Background(), id, advanceOf(t))
	if result.Action != AdvanceClick || result.Ref != 12 || result.None != 0.02 {
		t.Fatalf("result = %+v", result)
	}
}

func TestAControlIsNotPressedWhenTheModelIsUnsureAnyContinuesOrCannotTellTwoApart(t *testing.T) {
	for name, probs := range map[string]map[string]float64{
		"maybe none": {"c1": 0.57, "c0": 0.2, advanceNone: 0.23},
		"too close":  {"c1": 0.5, "c0": 0.45, advanceNone: 0.05},
		"too low":    {"c1": 0.4, "c0": 0.1, "c2": 0.1, advanceNone: 0.1},
		"nothing":    {advanceNone: 1},
	} {
		a, id := newDOMAgent(t, &domScreen{next: "c1", probs: probs}, false)
		if result, _ := a.Advance(context.Background(), id, advanceOf(t)); result.Action != AdvanceNone {
			t.Fatalf("%s: pressed %+v", name, result)
		}
	}
}

func TestAnAdvanceIsTracedWithEveryControlAndProbabilityAndWhy(t *testing.T) {
	dir := t.TempDir()
	cfg := DefaultConfig()
	cfg.TraceDir = dir
	screen := &domScreen{next: "c1", probs: map[string]float64{"c0": 0.38, "c1": 0.57, advanceNone: 0.02}}
	a := newAgentWithScreen(t, &scriptedModel{}, &fixedDecider{}, screen, cfg)
	started, _ := a.Start(context.Background(), "key", applicant.Auth{}, Start{Prefill: true, Trace: true})
	result, _ := a.Advance(context.Background(), started.SessionID, advanceOf(t))
	if result.Trace == nil {
		t.Fatal("no trace came back")
	}
	text := ""
	for _, file := range result.Trace.Files {
		text += file.Text
	}
	for _, want := range []string{`"candidates"`, `c1: button \"Next\"`, `"c0": 0.38`, `"accepted": true`, `a control continues`} {
		if !strings.Contains(text, want) {
			t.Fatalf("the trace is missing %q:\n%s", want, text)
		}
	}
}

func TestADisabledControlIsToldToTheModelAsProbablyStillSubmitting(t *testing.T) {
	note := reviewNote(ReviewFix, []string{"blocked: a control that continues is disabled: Save and Continue"})
	if !strings.Contains(note, "still submitting") {
		t.Fatalf("note = %s", note)
	}
	if strings.Contains(reviewNote(ReviewFix, []string{"still empty: Phone"}), "still submitting") {
		t.Fatal("an ordinary problem was told to wait")
	}
}
