package agent

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestContinueTakesAStoppedRunBackUpWithItsMemory(t *testing.T) {
	model := &scriptedModel{replies: []string{
		answerJSON("working", "Typing the name", map[string]any{"kind": "type", "text": "Ada"}),
		answerJSON("need_person", "A CAPTCHA is on the page"),
		answerJSON("working", "Carrying on", map[string]any{"kind": "wait", "ms": 100}),
	}}
	a := newTestAgent(t, model, &fixedDecider{}, stopsAtOnce())
	id := start(t, a)
	stepOK(t, a, id, observation(shot(t, 255)))
	stopped := stepOK(t, a, id, observation(shot(t, 200)))
	if stopped.Status != StatusNeedPerson {
		t.Fatalf("stopped = %+v", stopped)
	}

	continued, err := a.Continue(id)
	if err != nil || continued.Number != 2 || continued.Usage.Calls != 2 {
		t.Fatalf("continued = %+v err = %v", continued, err)
	}
	// The same page as when the run stopped: the person's help is not a stalled screen.
	step := stepOK(t, a, id, observation(shot(t, 200)))
	if step.Status != StatusWorking || step.Number != 3 || step.Usage.Calls != 3 {
		t.Fatalf("step = %+v", step)
	}

	req := model.requests[2].Messages
	// The system prompt, then both earlier turns as the model lived them, then this one.
	if len(req) != 1+2*2+1 {
		t.Fatalf("the history was not kept: %d messages", len(req))
	}
	text := lastText(model)
	for _, want := range []string{"A CAPTCHA is on the page", "pressed Continue", "notes after A CAPTCHA is on the page", "Data engineer at Acme"} {
		if !strings.Contains(text, want) {
			t.Fatalf("the model was not told %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "looks the same") {
		t.Fatalf("the person's help counted as a stalled screen:\n%s", text)
	}
}

func TestContinueResumesARunThatWasOnlyInterrupted(t *testing.T) {
	model := &scriptedModel{replies: []string{
		answerJSON("working", "one", map[string]any{"kind": "click", "x": 10.0, "y": 10.0}),
		answerJSON("working", "two", map[string]any{"kind": "wait", "ms": 100}),
	}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	id := start(t, a)
	stepOK(t, a, id, observation(shot(t, 255)))
	if _, err := a.Continue(id); err != nil {
		t.Fatal(err)
	}
	stepOK(t, a, id, observation(shot(t, 255)))
	if text := lastText(model); !strings.Contains(text, "may not have run") || strings.Contains(text, "You stopped the run") {
		t.Fatalf("the model was not told the run was interrupted:\n%s", text)
	}
}

func TestContinueAfterTheStepLimitGivesAnotherBudget(t *testing.T) {
	model := &scriptedModel{replies: []string{
		answerJSON("working", "one", map[string]any{"kind": "wait", "ms": 100}),
		answerJSON("working", "two", map[string]any{"kind": "wait", "ms": 100}),
		answerJSON("working", "three", map[string]any{"kind": "wait", "ms": 100}),
	}}
	cfg := DefaultConfig()
	cfg.MaxSteps = 2
	a := newTestAgent(t, model, &fixedDecider{}, cfg)
	id := start(t, a)
	for i := 0; i < 2; i++ {
		stepOK(t, a, id, observation(shot(t, uint8(80*i))))
	}
	if step := stepOK(t, a, id, observation(shot(t, 250))); step.Status != StatusStuck || step.Stop == nil || step.Stop.Reason != StopStepLimit {
		t.Fatalf("step = %+v", step)
	}
	if _, err := a.Continue(id); err != nil {
		t.Fatal(err)
	}
	step := stepOK(t, a, id, observation(shot(t, 250)))
	if step.Status != StatusWorking || step.Number != 3 || !strings.Contains(lastText(model), "Step 3 of at most 4") {
		t.Fatalf("step = %+v\n%s", step, lastText(model))
	}
}

func TestContinueDropsAnUploadHeldForTheAnswer(t *testing.T) {
	model := &scriptedModel{replies: []string{uploadPlan("attaching"), uploadPlan("attaching again")}}
	a := newTestAgent(t, model, &fixedDecider{jd: 0.1}, gateConfig())
	id := start(t, a)
	if asked := stepOK(t, a, id, observation(shot(t, 40))); asked.Status != StatusAsk {
		t.Fatalf("asked = %+v", asked)
	}
	if _, err := a.Continue(id); err != nil {
		t.Fatal(err)
	}
	// The unanswered question is not still pending: the model plans from the screen again.
	again := stepOK(t, a, id, observation(shot(t, 40)))
	if again.Status != StatusAsk || len(model.requests) != 2 {
		t.Fatalf("again = %+v requests = %d", again, len(model.requests))
	}
}

func TestContinueNeedsALiveSession(t *testing.T) {
	a := newTestAgent(t, &scriptedModel{}, &fixedDecider{}, DefaultConfig())
	if _, err := a.Continue("nobody"); !errors.Is(err, ErrNoSession) {
		t.Fatalf("unknown run: %v", err)
	}
	id := start(t, a)
	a.End(id)
	if _, err := a.Continue(id); !errors.Is(err, ErrNoSession) {
		t.Fatalf("ended run: %v", err)
	}
	if _, err := a.Step(context.Background(), id, observation(shot(t, 255))); !errors.Is(err, ErrNoSession) {
		t.Fatalf("step after end: %v", err)
	}
}
