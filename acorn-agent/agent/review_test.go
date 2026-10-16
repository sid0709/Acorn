package agent

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/sid0709/OpenSeat/acorn-agent/applicant"
	"github.com/sid0709/OpenSeat/acorn-agent/decide"
)

func TestCoverageIsKeptInPixelsAndTheGapsAreNamed(t *testing.T) {
	var c coverage
	c.see("https://jobs.example/a", Viewport{Width: 1280, Height: 800, ScrollY: 800, PageHeight: 5560})
	c.see("https://jobs.example/a", Viewport{Width: 1280, Height: 800, ScrollY: 1500, PageHeight: 5560})
	if got := formatSpans(c.spans); got != "800 to 2300" {
		t.Fatalf("seen %s", got)
	}
	if got := formatSpans(c.gaps()); got != "0 to 800, 2300 to 5560" {
		t.Fatalf("gaps %s", got)
	}
	line := c.line(Viewport{Height: 800})
	if !strings.Contains(line, "5560 px tall") || !strings.Contains(line, "You have not looked at: 0 to 800, 2300 to 5560") {
		t.Fatalf("line %q", line)
	}
	// The page grew: what was seen is no longer trusted.
	c.see("https://jobs.example/a", Viewport{Width: 1280, Height: 800, ScrollY: 0, PageHeight: 5700})
	if got := formatSpans(c.spans); got != "0 to 800" {
		t.Fatalf("after the page grew, seen %s", got)
	}
	// A page that fits the screen has nothing unseen.
	var short coverage
	short.see("u", Viewport{Height: 800, PageHeight: 800})
	if len(short.gaps()) != 0 || short.line(Viewport{Height: 800}) != "" {
		t.Fatalf("a page that fits has gaps %v", short.gaps())
	}
}

// reviewScreen is a decision model for the review: which marker sends the application, and what each
// look at a screen says (a probability that something there would stop the form).
type reviewScreen struct {
	mu sync.Mutex
	// submit is the marker that sends the application; later asks get the next of laterSubmits (then "none").
	submit       string
	laterSubmits []string
	issues       []float64
	asked        []string
}

func (f *reviewScreen) Name() string { return "review-screen" }

func (f *reviewScreen) Decide(_ context.Context, req decide.Request) (decide.Response, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	noul := func(p float64) decide.Answer { return decide.Answer{Type: decide.TypeNoul, Noul: &p} }
	answers := map[string]decide.Answer{}
	for key := range req.Questions {
		f.asked = append(f.asked, key)
		switch key {
		case askSubmitPoint:
			choice := f.submit
			if f.count(askSubmitPoint) > 1 {
				choice = pointNone
				if len(f.laterSubmits) > 0 {
					choice, f.laterSubmits = f.laterSubmits[0], f.laterSubmits[1:]
				}
			}
			answers[key] = decide.Answer{Type: decide.TypeChoice, Choice: choice, Probabilities: map[string]float64{choice: 0.95}}
		case askReviewIssue:
			p := 0.0
			if len(f.issues) > 0 {
				p, f.issues = f.issues[0], f.issues[1:]
			}
			answers[key] = noul(p)
		case askMatches, askFormReady:
			answers[key] = noul(1)
		default:
			answers[key] = noul(0)
		}
	}
	return decide.Response{Model: "review-screen-1", Answers: answers, Usage: decide.Usage{InputTokens: 800, Cost: 0.0001}}, nil
}

func (f *reviewScreen) count(key string) int {
	n := 0
	for _, asked := range f.asked {
		if asked == key {
			n++
		}
	}
	return n
}

// tallPage is a look at a 2400 px page scrolled to y.
func tallPage(t *testing.T, y float64, results ...ActionResult) Observation {
	t.Helper()
	obs := observation(shot(t, uint8(40+int(y/20)%150)))
	obs.Viewport.ScrollY, obs.Viewport.PageHeight = y, 2400
	obs.Results = results
	return obs
}

func startReview(t *testing.T, a *Agent, stopBefore bool) string {
	t.Helper()
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{URL: "https://jobs.example/apply", Title: "Apply", StopBeforeSubmit: stopBefore})
	if err != nil {
		t.Fatal(err)
	}
	return started.SessionID
}

func scrollOf(t *testing.T, step Step) float64 {
	t.Helper()
	if len(step.Actions) != 1 || step.Actions[0].Kind != KindScroll || !isReviewID(step.Actions[0].ID) {
		t.Fatalf("want one review scroll, got %+v", step)
	}
	return step.Actions[0].DY
}

func TestWhatLiesAboveWhereTheFormBeganIsNotAGap(t *testing.T) {
	var c coverage
	c.see("u", Viewport{Height: 800, ScrollY: 2000, PageHeight: 4000})
	c.floor = 1600
	if got := formatSpans(c.gaps()); got != "1600 to 2000, 2800 to 4000" {
		t.Fatalf("gaps %s: the job description above the form counted", got)
	}
}

func TestASendWhilePartsOfThePageAreUnseenIsHeldForALookThroughThem(t *testing.T) {
	// The model, at 800 px of a 2400 px page, plans to type and to send. Marker 2 is the send.
	model := &scriptedModel{replies: []string{plan("filling and sending", nil, typeAction("Ada", nil), click(500, 700, nil))}}
	screen := &reviewScreen{submit: "2"}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := startReview(t, a, false)

	// Only what comes before the send goes on.
	first := stepOK(t, a, id, tallPage(t, 800))
	if len(first.Actions) != 1 || first.Actions[0].Kind != KindType {
		t.Fatalf("the part before the send: %+v", first.Actions)
	}
	// The look at the unseen parts begins: up to the top first.
	second := stepOK(t, a, id, tallPage(t, 800, ActionResult{ID: first.Actions[0].ID, OK: true}))
	if dy := scrollOf(t, second); dy != -800 {
		t.Fatalf("first scroll dy = %v, want -800 (the unseen top)", dy)
	}
	// The top is clean; the unseen bottom is next (from 1600).
	third := stepOK(t, a, id, tallPage(t, 0, ActionResult{ID: second.Actions[0].ID, OK: true}))
	if dy := scrollOf(t, third); dy != 1576 {
		t.Fatalf("second scroll dy = %v, want 1576", dy)
	}
	// The bottom is clean too; the page goes back to where the plan was made.
	fourth := stepOK(t, a, id, tallPage(t, 1576, ActionResult{ID: third.Actions[0].ID, OK: true}))
	if dy := scrollOf(t, fourth); dy != -776 {
		t.Fatalf("return scroll dy = %v, want -776", dy)
	}
	// Back at 800 px, the held click goes out, and the model was called once.
	last := stepOK(t, a, id, tallPage(t, 800, ActionResult{ID: fourth.Actions[0].ID, OK: true}))
	if len(last.Actions) != 1 || last.Actions[0].Kind != KindClick || last.Status != StatusWorking {
		t.Fatalf("the held send: %+v", last)
	}
	if len(model.requests) != 1 {
		t.Fatalf("the model was called %d times, want 1: the look was the checker's", len(model.requests))
	}
	if screen.count(askReviewIssue) != 2 {
		t.Fatalf("looks at the unseen parts = %d, want 2", screen.count(askReviewIssue))
	}
}

func TestAProblemInAnUnseenPartGoesToTheModelWithThePageScrolledThere(t *testing.T) {
	model := &scriptedModel{replies: []string{
		plan("sending", nil, click(500, 700, nil)),
		plan("fixing the missing answer", nil, click(300, 200, nil)),
	}}
	screen := &reviewScreen{submit: "1", issues: []float64{0.9}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := startReview(t, a, false)
	first := stepOK(t, a, id, tallPage(t, 800))
	scrollOf(t, first)
	// The first unseen part (the top) holds a required field left empty.
	fixed := stepOK(t, a, id, tallPage(t, 0, ActionResult{ID: first.Actions[0].ID, OK: true}))
	if len(model.requests) != 2 || len(fixed.Actions) != 1 || fixed.Actions[0].Kind != KindClick {
		t.Fatalf("the model did not take over: calls %d, step %+v", len(model.requests), fixed)
	}
	text := model.requests[1].Messages[len(model.requests[1].Messages)-1].Text
	if !strings.Contains(text, "Before sending") || !strings.Contains(text, "scrolled there now (0 px from the top)") {
		t.Fatalf("the model was not told: %s", text)
	}
	if strings.Contains(text, "rv") {
		t.Fatalf("the review's own scroll is shown as the model's: %s", text)
	}
}

func TestARunToStopBeforeSendingLooksThroughWhatItHasNotSeenBeforeItSaysReady(t *testing.T) {
	model := &scriptedModel{replies: []string{answerJSON("done", "Everything is filled in")}}
	screen := &reviewScreen{}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := startReview(t, a, true)
	step := stepOK(t, a, id, tallPage(t, 800))
	dy := scrollOf(t, step)
	if dy != -800 {
		t.Fatalf("first scroll %v", dy)
	}
	step = stepOK(t, a, id, tallPage(t, 0, ActionResult{ID: step.Actions[0].ID, OK: true}))
	scrollOf(t, step)
	end := stepOK(t, a, id, tallPage(t, 1576, ActionResult{ID: step.Actions[0].ID, OK: true}))
	if end.Status != StatusDone || end.Message != "Everything is filled in" {
		t.Fatalf("the run did not end as it said: %+v", end)
	}
}

func TestAPageThatFitsTheScreenIsNotReviewed(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("sending", nil, click(500, 700, nil))}}
	screen := &reviewScreen{submit: "1"}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	step := stepOK(t, a, startReview(t, a, false), observation(shot(t, 40)))
	if len(step.Actions) != 1 || step.Actions[0].Kind != KindClick || screen.count(askSubmitPoint) != 0 {
		t.Fatalf("a page with nothing unseen was reviewed: %+v, asked %v", step, screen.asked)
	}
}
