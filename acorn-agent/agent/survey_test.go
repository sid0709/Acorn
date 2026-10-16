package agent

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sid0709/OpenSeat/acorn-agent/applicant"
)

// surveyObservation is a look at a page of three screens, scrolled to the top.
func surveyObservation(t *testing.T) Observation {
	t.Helper()
	obs := observation(shot(t, 40))
	obs.Survey = []SurveyScreen{
		{Screenshot: shot(t, 40), ScrollY: 0},
		{Screenshot: shot(t, 120), ScrollY: 680},
		{Screenshot: shot(t, 200), ScrollY: 1360},
	}
	return obs
}

func onScreen(screen int, x, y float64, check any) map[string]any {
	return map[string]any{"kind": "click", "screen": screen, "x": x, "y": y, "check": check}
}

func TestASurveyIsShownToTheModelAsItsScreensNotTheSingleScreenshot(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("planning", nil, onScreen(1, 10, 10, nil))}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	obs := surveyObservation(t)
	stepOK(t, a, start(t, a), obs)
	last := model.requests[0].Messages
	message := last[len(last)-1]
	if len(message.Images) != 3 || message.Images[1] != obs.Survey[1].Screenshot {
		t.Fatalf("the model got %d images", len(message.Images))
	}
	for _, want := range []string{"survey of the whole page: 3 screenshots", "screen 2 is scrolled to 680 px", "The page shows screen 1 now", `give each click its "screen"`} {
		if !strings.Contains(message.Text, want) {
			t.Fatalf("missing %q in:\n%s", want, message.Text)
		}
	}
}

func TestAnActionOnAScreenIsToldWhereToScrollAndHowTallThePageWas(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("planning", nil,
		onScreen(1, 10, 10, nil), onScreen(2, 20, 20, nil), onScreen(3, 30, 30, nil),
		map[string]any{"kind": "type", "text": "x", "check": nil})}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	step := stepOK(t, a, start(t, a), surveyObservation(t))
	if len(step.Actions) != 4 {
		t.Fatalf("actions = %s", kinds(step.Actions))
	}
	want := []float64{0, 680, 1360}
	for i, scroll := range want {
		got := step.Actions[i].ScrollTo
		if got == nil || *got != scroll || step.Actions[i].PageHeight != 2400 {
			t.Fatalf("action %d scrollTo = %v pageHeight = %v, want %v and 2400", i+1, got, step.Actions[i].PageHeight, scroll)
		}
	}
	if step.Actions[3].ScrollTo != nil {
		t.Fatal("typing follows the action before it and has no screen")
	}
}

func TestAnActionOnAScreenThatDoesNotExistIsRefused(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("planning", nil, onScreen(9, 10, 10, nil), onScreen(2, 20, 20, nil))}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	step := stepOK(t, a, start(t, a), surveyObservation(t))
	if len(step.Actions) != 1 || len(step.Dropped) == 0 || !strings.Contains(step.Dropped[0], "there is no screen 9") {
		t.Fatalf("step = %+v", step)
	}
}

func TestAScreenIndexOnASingleScreenshotIsIgnored(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("planning", nil, onScreen(0, 20, 20, nil), onScreen(2, 5, 5, nil))}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	step := stepOK(t, a, start(t, a), observation(shot(t, 40)))
	if len(step.Actions) != 2 {
		t.Fatalf("actions = %s, dropped = %v", kinds(step.Actions), step.Dropped)
	}
	for i, action := range step.Actions {
		if action.ScrollTo != nil {
			t.Fatalf("action %d should not scroll on a single screenshot", i+1)
		}
	}
}

func TestASurveyScreenOfTheWrongSizeIsRefused(t *testing.T) {
	a := newTestAgent(t, &scriptedModel{}, &fixedDecider{}, DefaultConfig())
	obs := surveyObservation(t)
	obs.Survey[1].Screenshot = shotOfSize(t, 640, 400)
	if _, err := a.Step(context.Background(), start(t, a), obs); !errors.Is(err, ErrBadObservation) {
		t.Fatalf("err = %v", err)
	}
}

func TestAskingForASurveyAsksTheExtensionForOneWithNoActionAndNoWait(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("a new page", nil, map[string]any{"kind": "survey"})}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{URL: "https://jobs.example/apply", Title: "Apply", Survey: true})
	if err != nil {
		t.Fatal(err)
	}
	step := stepOK(t, a, started.SessionID, observation(shot(t, 40)))
	if !step.Survey || len(step.Actions) != 0 || step.Status != StatusWorking {
		t.Fatalf("step = %+v", step)
	}
}

func TestARunWithoutSurveysIsNotToldOfThemAndIgnoresAnAskForOne(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("a new page", nil, map[string]any{"kind": "survey"})}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	id := start(t, a)
	step := stepOK(t, a, id, observation(shot(t, 40)))
	if step.Survey {
		t.Fatalf("a survey was asked for although the run did not turn them on: %+v", step)
	}
	if prompt := model.requests[0].Messages[0].Text; strings.Contains(prompt, "Seeing the whole page") {
		t.Fatal("the prompt tells the model about surveys")
	}
	withSurveys, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{Survey: true})
	if err != nil {
		t.Fatal(err)
	}
	s, _ := a.sessions.get(withSurveys.SessionID)
	if !strings.Contains(s.system, "Seeing the whole page") {
		t.Fatal("a run with surveys on is not told about them")
	}
}

func TestTheSurveyLookAfterARequestIsNotTakenForAStall(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("a new page", nil, map[string]any{"kind": "survey"}), plan("planning", nil, onScreen(1, 5, 5, nil))}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	id := start(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))
	obs := surveyObservation(t) // the main screenshot is the same pixels as before
	stepOK(t, a, id, obs)
	if text := lastText(model); strings.Contains(text, "looks the same") {
		t.Fatalf("a survey look must not carry the unchanged-screen warning:\n%s", text)
	}
}

func TestARunThatEndsMayStillScrollWhatThePersonMustActOnIntoView(t *testing.T) {
	reply := ending("need_person", "A code was sent", map[string]any{"reason": "verification", "problem": "p", "action": "a"})
	// ending() sends no actions; build one that carries scrolls, a click and a third scroll.
	scroll := func(dy float64) map[string]any { return map[string]any{"kind": "scroll", "x": 100, "y": 100, "dy": dy} }
	reply = plan("A code was sent", nil, scroll(300), click(5, 5, nil), scroll(200), scroll(100))
	reply = strings.Replace(reply, `"status":"working"`, `"status":"need_person"`, 1)
	a := newTestAgent(t, &scriptedModel{replies: []string{reply}}, &fixedDecider{}, DefaultConfig())
	step := stepOK(t, a, start(t, a), observation(shot(t, 40)))
	if step.Status != StatusNeedPerson || len(step.Actions) != 2 || step.Actions[0].Kind != KindScroll || step.Actions[1].Kind != KindScroll {
		t.Fatalf("step = %+v actions = %s", step, kinds(step.Actions))
	}
}

func TestAJobOfNullKeepsTheJobAndAStringReplacesIt(t *testing.T) {
	first := plan("one", nil, click(1, 1, nil))
	second := strings.Replace(plan("two", nil, click(2, 2, nil)), `"job":"Data engineer at Acme"`, `"job":null`, 1)
	third := strings.Replace(plan("three", nil, click(3, 3, nil)), `"job":"Data engineer at Acme"`, `"job":"Platform engineer at Beta"`, 1)
	model := &scriptedModel{replies: []string{first, second, third, plan("four", nil, click(4, 4, nil))}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	id := start(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))
	stepOK(t, a, id, observation(shot(t, 90)))
	if text := lastText(model); !strings.Contains(text, "Job you recorded: Data engineer at Acme") {
		t.Fatalf("a null job must keep the job:\n%s", text)
	}
	stepOK(t, a, id, observation(shot(t, 140)))
	if text := lastText(model); !strings.Contains(text, "Job you recorded: Data engineer at Acme") {
		t.Fatalf("job should still be the first until the new one is read:\n%s", text)
	}
	stepOK(t, a, id, observation(shot(t, 190)))
	if text := lastText(model); !strings.Contains(text, "Job you recorded: Platform engineer at Beta") {
		t.Fatalf("a new job must replace it:\n%s", text)
	}
}

func TestASurveyTurnKeepsAllItsScreensInTheHistoryUntilItIsCompacted(t *testing.T) {
	model := &scriptedModel{replies: []string{
		plan("planning", nil, onScreen(1, 10, 10, nil)), plan("next", nil, click(1, 1, nil)),
	}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	id := start(t, a)
	first := stepOK(t, a, id, surveyObservation(t))
	next := observation(shot(t, 90))
	next.Results = []ActionResult{{ID: first.Actions[0].ID, OK: true}}
	stepOK(t, a, id, next)
	images := 0
	for _, message := range model.requests[1].Messages {
		images += len(message.Images)
	}
	if images != 4 { // the survey's three screens and the new look
		t.Fatalf("images = %d, want 4", images)
	}
}

func TestTheSurveyIsWrittenToTheTraceWithTheActionsDrawnOnTheirScreens(t *testing.T) {
	cfg := DefaultConfig()
	cfg.TraceDir = t.TempDir()
	model := &scriptedModel{replies: []string{plan("planning", nil, onScreen(2, 40, 50, nil))}}
	a := newTestAgent(t, model, &fixedDecider{}, cfg)
	id := start(t, a)
	stepOK(t, a, id, surveyObservation(t))
	dir := filepath.Join(cfg.TraceDir, id)
	for _, name := range []string{"001.survey1.jpg", "001.survey2.jpg", "001.survey3.jpg", "001.survey2.marked.jpg"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatalf("missing %s: %v", name, err)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "001.survey1.marked.jpg")); err == nil {
		t.Fatal("a screen with no action on it has no marked copy")
	}
}
