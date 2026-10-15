package agent

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/sid0709/OpenSeat/acorn-agent/decide"
)

// fakeScreen answers each check with the next canned verdict and records what it was asked.
type fakeScreen struct {
	mu       sync.Mutex
	verdicts []screenVerdict
	err      error
	requests []decide.Request
}

type screenVerdict struct{ matches, blocked, loading float64 }

func (f *fakeScreen) Name() string { return "fake-screen" }

func (f *fakeScreen) Decide(_ context.Context, req decide.Request) (decide.Response, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = append(f.requests, req)
	if f.err != nil {
		return decide.Response{}, f.err
	}
	if len(f.verdicts) == 0 {
		return decide.Response{}, errors.New("no scripted verdict left")
	}
	v := f.verdicts[0]
	f.verdicts = f.verdicts[1:]
	noul := func(p float64) decide.Answer { return decide.Answer{Type: decide.TypeNoul, Noul: &p} }
	return decide.Response{
		Model:   "fake-screen-1",
		Answers: map[string]decide.Answer{askMatches: noul(v.matches), askBlocked: noul(v.blocked), askLoading: noul(v.loading)},
		Usage:   decide.Usage{InputTokens: 1200, Cost: 0.0002},
		Latency: 5 * time.Millisecond,
	}, nil
}

var (
	sure    = screenVerdict{matches: 0.98}
	notSure = screenVerdict{matches: 0.1}
)

func (f *fakeScreen) calls() int { f.mu.Lock(); defer f.mu.Unlock(); return len(f.requests) }

// plan is a model answer with these actions; memo is a string, or nil for "unchanged".
func plan(message string, memo any, actions ...map[string]any) string {
	full := make([]map[string]any, 0, len(actions))
	for _, action := range actions {
		item := map[string]any{"x": nil, "y": nil, "text": nil, "secret": nil, "keys": nil, "dx": nil, "dy": nil, "ms": nil, "resume": nil, "check": nil}
		for key, value := range action {
			item[key] = value
		}
		full = append(full, item)
	}
	out, _ := json.Marshal(map[string]any{
		"observation": "I see a form", "memo": memo, "job": "Data engineer at Acme",
		"status": "working", "message": message, "actions": full,
	})
	return string(out)
}

func click(x, y float64, check any) map[string]any {
	return map[string]any{"kind": "click", "x": x, "y": y, "check": check}
}

func resultsFor(prefix string, ids ...int) []ActionResult {
	var out []ActionResult
	for _, id := range ids {
		out = append(out, ActionResult{ID: prefix + string(rune('0'+id)), OK: true})
	}
	return out
}

func lastText(m *scriptedModel) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	messages := m.requests[len(m.requests)-1].Messages
	return messages[len(messages)-1].Text
}

func (m *scriptedModel) count() int { m.mu.Lock(); defer m.mu.Unlock(); return len(m.requests) }

// six clicks, checked after the 2nd and 4th, with the 6th ending the plan.
func sixClicks() string {
	return plan("filling the form", "notes", click(10, 10, nil), click(20, 20, "first name shows Ada"),
		click(30, 30, nil), click(40, 40, "email shows ada@example.com"), click(50, 50, nil), click(60, 60, "phone shows a number"))
}

func stepOK(t *testing.T, a *Agent, id string, obs Observation) Step {
	t.Helper()
	step, err := a.Step(context.Background(), id, obs)
	if err != nil {
		t.Fatal(err)
	}
	return step
}

func kinds(actions []Action) string {
	ids := make([]string, len(actions))
	for i, action := range actions {
		ids[i] = action.ID
	}
	return strings.Join(ids, ",")
}

func TestPlanRunsOnWhenTheScreenMatchesWithoutCallingTheModel(t *testing.T) {
	model := &scriptedModel{replies: []string{sixClicks(), plan("next page", nil, click(5, 5, nil))}}
	screen := &fakeScreen{verdicts: []screenVerdict{sure, sure}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)

	first := stepOK(t, a, id, observation(shot(t, 40)))
	if kinds(first.Actions) != "s1a1,s1a2" || model.count() != 1 {
		t.Fatalf("first run = %s, model calls %d", kinds(first.Actions), model.count())
	}
	// The check is the agent's own: the extension is never sent it.
	if raw, _ := json.Marshal(first.Actions); strings.Contains(string(raw), "check") {
		t.Fatalf("the wire form carries a check: %s", raw)
	}

	obs := observation(shot(t, 90))
	obs.Results = resultsFor("s1a", 1, 2)
	second := stepOK(t, a, id, obs)
	if kinds(second.Actions) != "s1a3,s1a4" || model.count() != 1 || screen.calls() != 1 {
		t.Fatalf("second run = %s, model calls %d, checks %d", kinds(second.Actions), model.count(), screen.calls())
	}
	if second.Message != "filling the form" || second.Number != 1 {
		t.Fatalf("the person keeps seeing the model's line: %+v", second)
	}

	obs = observation(shot(t, 140))
	obs.Results = resultsFor("s1a", 3, 4)
	third := stepOK(t, a, id, obs)
	if kinds(third.Actions) != "s1a5,s1a6" || model.count() != 1 {
		t.Fatalf("third run = %s, model calls %d", kinds(third.Actions), model.count())
	}

	// The plan is used up: the model looks, and is told how its plan went.
	obs = observation(shot(t, 190))
	obs.Results = resultsFor("s1a", 5, 6)
	stepOK(t, a, id, obs)
	text := lastText(model)
	if model.count() != 2 || screen.calls() != 2 {
		t.Fatalf("model calls %d, checks %d", model.count(), screen.calls())
	}
	for _, want := range []string{"s1a1 done", "s1a4 done", "s1a6 done", "ran in 3 parts"} {
		if !strings.Contains(text, want) {
			t.Fatalf("the model's next look must say %q:\n%s", want, text)
		}
	}
}

func TestTheCheckerIsAskedWhatTheModelExpectedAboutTheScreenshot(t *testing.T) {
	model := &scriptedModel{replies: []string{sixClicks()}}
	screen := &fakeScreen{verdicts: []screenVerdict{sure}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))
	obs := observation(shot(t, 90))
	obs.Results = resultsFor("s1a", 1, 2)
	stepOK(t, a, id, obs)

	request := screen.requests[0]
	if len(request.State) != 2 || request.State[1].ImageURL == nil || request.State[1].ImageURL.URL != obs.Screenshot {
		t.Fatalf("the checker must be shown the new screenshot: %+v", request.State)
	}
	if !strings.Contains(request.Questions[askMatches].Instructions, "first name shows Ada") {
		t.Fatalf("the question must carry the model's own words: %+v", request.Questions[askMatches])
	}
	for _, key := range []string{askMatches, askBlocked, askLoading} {
		if question := request.Questions[key]; question.Type != decide.TypeNoul || question.Criteria["true"] == "" {
			t.Fatalf("%s is not a yes/no question: %+v", key, question)
		}
	}
}

func TestMismatchSendsTheScreenToTheModelAndSaysWhyThePlanStopped(t *testing.T) {
	model := &scriptedModel{replies: []string{sixClicks(), plan("recovering", nil, click(5, 5, nil))}}
	screen := &fakeScreen{verdicts: []screenVerdict{notSure}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))

	obs := observation(shot(t, 90))
	obs.Results = resultsFor("s1a", 1, 2)
	step := stepOK(t, a, id, obs)
	if model.count() != 2 || step.Message != "recovering" {
		t.Fatalf("the model must look: calls %d, %+v", model.count(), step)
	}
	text := lastText(model)
	for _, want := range []string{"You planned 6 actions: 2 ran, 4 did not", "first name shows Ada", "s1a2 done"} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %q in:\n%s", want, text)
		}
	}
	// The plan is gone: the next look goes to the model again, not to the checker.
	obs = observation(shot(t, 140))
	obs.Results = resultsFor("s2a", 1)
	model.replies = append(model.replies, plan("again", nil, click(1, 1, nil)))
	stepOK(t, a, id, obs)
	if screen.calls() != 1 || model.count() != 3 {
		t.Fatalf("checks %d, model calls %d", screen.calls(), model.count())
	}
}

func TestSomethingInTheWayOrAFailedActionOrAFrozenScreenSendsTheModelToLook(t *testing.T) {
	cases := map[string]struct {
		verdict  *screenVerdict
		obs      func(t *testing.T) Observation
		wantNote string
		checks   int
	}{
		"a popup": {
			verdict: &screenVerdict{matches: 0.97, blocked: 0.9},
			obs:     func(t *testing.T) Observation { return observation(shot(t, 90)) },
			checks:  1, wantNote: "something may be in the way",
		},
		"a failed action": {
			obs: func(t *testing.T) Observation {
				o := observation(shot(t, 90))
				o.Results = []ActionResult{{ID: "s1a1", OK: true}, {ID: "s1a2", OK: false, Error: "no element at that point"}}
				return o
			},
			wantNote: "no element at that point",
		},
		"a screen that did not change": {
			obs:      func(t *testing.T) Observation { return observation(shot(t, 40)) },
			wantNote: "did not change",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			model := &scriptedModel{replies: []string{sixClicks(), plan("recovering", nil, click(5, 5, nil))}}
			screen := &fakeScreen{}
			if tc.verdict != nil {
				screen.verdicts = []screenVerdict{*tc.verdict}
			}
			a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
			id := start(t, a)
			stepOK(t, a, id, observation(shot(t, 40)))
			stepOK(t, a, id, tc.obs(t))
			if model.count() != 2 || screen.calls() != tc.checks {
				t.Fatalf("model calls %d, checks %d", model.count(), screen.calls())
			}
			if text := lastText(model); !strings.Contains(text, tc.wantNote) {
				t.Fatalf("missing %q in:\n%s", tc.wantNote, text)
			}
		})
	}
}

func TestALoadingPageIsWaitedForWithoutTheModelThenChecked(t *testing.T) {
	model := &scriptedModel{replies: []string{sixClicks()}}
	screen := &fakeScreen{verdicts: []screenVerdict{{matches: 0.2, loading: 0.95}, sure}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))

	obs := observation(shot(t, 90))
	obs.Results = resultsFor("s1a", 1, 2)
	waiting := stepOK(t, a, id, obs)
	if len(waiting.Actions) != 1 || waiting.Actions[0].Kind != KindWait || model.count() != 1 {
		t.Fatalf("waiting = %+v, model calls %d", waiting, model.count())
	}
	obs = observation(shot(t, 140))
	obs.Results = []ActionResult{{ID: waiting.Actions[0].ID, OK: true}}
	next := stepOK(t, a, id, obs)
	if kinds(next.Actions) != "s1a3,s1a4" || model.count() != 1 {
		t.Fatalf("after the wait = %s, model calls %d", kinds(next.Actions), model.count())
	}
}

func TestALoadingPageThatNeverLoadsIsLeftToTheModel(t *testing.T) {
	model := &scriptedModel{replies: []string{sixClicks(), plan("looking", nil, click(5, 5, nil))}}
	loading := screenVerdict{matches: 0.2, loading: 0.95}
	screen := &fakeScreen{verdicts: []screenVerdict{loading, loading, loading, loading, loading}}
	cfg := DefaultConfig()
	cfg.MaxLoadWaits = 2
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, cfg)
	id := start(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))
	for i, shade := range []uint8{90, 140} {
		obs := observation(shot(t, shade))
		obs.Results = resultsFor("s1a", 1, 2)
		step := stepOK(t, a, id, obs)
		if step.Actions[0].Kind != KindWait || model.count() != 1 {
			t.Fatalf("wait %d = %+v", i, step)
		}
	}
	stepOK(t, a, id, observation(shot(t, 190)))
	if model.count() != 2 {
		t.Fatalf("after the waits are spent the model must look; calls %d", model.count())
	}
}

func TestAChunkWithoutACheckEndsThePlanThere(t *testing.T) {
	reply := plan("filling", nil, click(10, 10, nil), click(20, 20, nil), click(30, 30, nil), click(40, 40, nil), click(50, 50, "later"), click(60, 60, nil))
	model := &scriptedModel{replies: []string{reply}}
	screen := &fakeScreen{}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	first := stepOK(t, a, id, observation(shot(t, 40)))
	if len(first.Actions) != 4 || len(first.Dropped) != 1 || !strings.Contains(first.Dropped[0], "2 planned actions were not sent") {
		t.Fatalf("first = %+v", first)
	}
	model.replies = append(model.replies, plan("next", nil, click(1, 1, nil)))
	obs := observation(shot(t, 90))
	obs.Results = resultsFor("s1a", 1, 2, 3, 4)
	stepOK(t, a, id, obs)
	if screen.calls() != 0 || !strings.Contains(lastText(model), "4 ran") {
		t.Fatalf("checks %d, text:\n%s", screen.calls(), lastText(model))
	}
}

func TestACheckerThatFailsIsDroppedForTheRestOfTheRun(t *testing.T) {
	model := &scriptedModel{replies: []string{sixClicks(), sixClicks()}}
	screen := &fakeScreen{err: errors.New("no credits")}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))
	obs := observation(shot(t, 90))
	obs.Results = resultsFor("s1a", 1, 2)
	step := stepOK(t, a, id, obs)
	if model.count() != 2 || !strings.Contains(lastText(model), "could not be checked") {
		t.Fatalf("model calls %d:\n%s", model.count(), lastText(model))
	}
	// Without a checker a plan is cut to the few actions that are safe to send unchecked.
	if len(step.Actions) != 6 || kinds(step.Actions) != "s2a1,s2a2,s2a3,s2a4,s2a5,s2a6" {
		t.Fatalf("actions = %s", kinds(step.Actions))
	}
	long := []map[string]any{}
	for i := 0; i < 9; i++ {
		long = append(long, click(float64(10+i), 10, nil))
	}
	model.replies = append(model.replies, plan("long", nil, long...))
	obs = observation(shot(t, 140))
	obs.Results = resultsFor("s2a", 1, 2, 3, 4, 5, 6)
	step = stepOK(t, a, id, obs)
	if len(step.Actions) != 6 || len(step.Dropped) == 0 || screen.calls() != 1 {
		t.Fatalf("actions %d, dropped %v, checks %d", len(step.Actions), step.Dropped, screen.calls())
	}
}

func TestWithoutADecisionModelThePromptAndPlanStayAsBefore(t *testing.T) {
	model := &scriptedModel{replies: []string{sixClicks()}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, nil, DefaultConfig())
	id := start(t, a)
	step := stepOK(t, a, id, observation(shot(t, 40)))
	if len(step.Actions) != 6 {
		t.Fatalf("actions = %s", kinds(step.Actions))
	}
	system := model.requests[0].Messages[0].Text
	if strings.Contains(system, `"check"`) || !strings.Contains(system, "up to 6") {
		t.Fatalf("the unchecked prompt must not mention checks and must cap at 6:\n%s", system)
	}

	checked := newAgentWithScreen(t, &scriptedModel{replies: []string{sixClicks()}}, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	cid := start(t, checked)
	stepOK(t, checked, cid, observation(shot(t, 40)))
	system = checked.newModel("").(*scriptedModel).requests[0].Messages[0].Text
	if !strings.Contains(system, `"check"`) || !strings.Contains(system, "up to 12") {
		t.Fatalf("the checked prompt must explain checks and allow 12:\n%s", system)
	}
}

func TestChecksAreCountedAndCostedSeparately(t *testing.T) {
	model := &scriptedModel{replies: []string{sixClicks()}}
	screen := &fakeScreen{verdicts: []screenVerdict{sure}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))
	obs := observation(shot(t, 90))
	obs.Results = resultsFor("s1a", 1, 2)
	step := stepOK(t, a, id, obs)
	if step.Usage.Calls != 1 || step.Usage.Checks != 1 || math.Abs(step.Usage.CheckCost-0.0002) > 1e-9 || math.Abs(step.Usage.Cost-0.0012) > 1e-9 {
		t.Fatalf("usage = %+v", step.Usage)
	}
}

func TestSplitPlanEndsARunAtACheckOrTheLimit(t *testing.T) {
	act := func(check string) Action { return Action{Kind: KindClick, Check: check} }
	runs := splitPlan([]Action{act(""), act("a"), act(""), act(""), act(""), act(""), act(""), act("b")}, 3)
	var shape []string
	for _, run := range runs {
		shape = append(shape, strings.Repeat("x", len(run.actions))+"|"+run.expect)
	}
	if got := strings.Join(shape, " "); got != "xx|a xxx| xxx|b" {
		t.Fatalf("runs = %s", got)
	}
	if got := splitPlan(nil, 3); len(got) != 0 {
		t.Fatalf("empty plan = %v", got)
	}
}
