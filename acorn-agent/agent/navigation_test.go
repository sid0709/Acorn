package agent

import (
	"strings"
	"testing"
)

func TestNavigationScrollsWhenTheFormIsNotReady(t *testing.T) {
	notReady := 0.05
	screen := &fakeScreen{formReady: &notReady}
	model := &scriptedModel{replies: []string{plan("should not run", nil, click(1, 1, nil))}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	step := stepOK(t, a, id, observation(shot(t, 40)))
	if model.count() != 0 {
		t.Fatalf("model calls %d, want 0", model.count())
	}
	if len(step.Actions) != 1 || step.Actions[0].Kind != KindScroll {
		t.Fatalf("step = %+v", step)
	}
	if step.Actions[0].DY <= 0 {
		t.Fatalf("scroll dy = %v", step.Actions[0].DY)
	}
	if step.Actions[0].X == nil || step.Actions[0].Y == nil {
		t.Fatal("a scroll turns the wheel at a point; without one the extension refuses it")
	}
}

func TestNavigationNeverSpendsANoteTheExtensionAttached(t *testing.T) {
	notReady := 0.05
	screen := &fakeScreen{formReady: &notReady}
	model := &scriptedModel{replies: []string{plan("typing the code", nil, click(1, 1, nil))}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	obs := observation(shot(t, 40))
	obs.Notes = []string{"Acorn read this verification code from your Gmail: abc123."}
	stepOK(t, a, id, obs)
	if model.count() != 1 || !strings.Contains(lastText(model), "abc123") {
		t.Fatalf("the model must be the one to see the code; calls %d", model.count())
	}
}

func TestNavigationDoesNotRunAgainOnceTheModelHasLookedOrAfterContinue(t *testing.T) {
	ready, notReady := 0.95, 0.05
	screen := &fakeScreen{formReady: &ready}
	model := &scriptedModel{replies: []string{plan("one", nil, click(1, 1, nil)), plan("two", nil, click(2, 2, nil))}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))
	screen.formReady = &notReady // the bottom of the form, with a code to type, reads as "not a form"
	if _, err := a.Continue(id); err != nil {
		t.Fatal(err)
	}
	step := stepOK(t, a, id, observation(shot(t, 90)))
	if model.count() != 2 || step.Actions[0].Kind != KindClick {
		t.Fatalf("the model must look; calls %d, step %+v", model.count(), step)
	}
}

func TestNavigationLetsTheModelLookWhenTheFormIsReady(t *testing.T) {
	screen := &fakeScreen{}
	model := &scriptedModel{replies: []string{plan("applying", nil, click(1, 1, nil))}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	stepOK(t, a, id, observation(shot(t, 40)))
	if model.count() != 1 {
		t.Fatalf("model calls %d, want 1", model.count())
	}
}

func TestNavigationSkipsWhileVerifyPending(t *testing.T) {
	a := newAgentWithScreen(t, &scriptedModel{}, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	id := start(t, a)
	s, ok := a.sessions.get(id)
	if !ok {
		t.Fatal("session missing")
	}
	s.mu.Lock()
	s.verify = "the résumé row shows the file"
	s.mu.Unlock()
	if a.navigateGate(s, observation(shot(t, 40)), 0) {
		t.Fatal("navigation must not run while a screen check is pending")
	}
}

func TestNavigationSkipsScrollOnApplicationFormPageText(t *testing.T) {
	notReady := 0.05
	screen := &fakeScreen{formReady: &notReady}
	model := &scriptedModel{replies: []string{plan("filling", nil, click(1, 1, nil))}}
	a := newAgentWithScreen(t, model, &fixedDecider{jd: 0.1}, screen, DefaultConfig())
	id := start(t, a)
	step := stepOK(t, a, id, withText(observation(shot(t, 40)), jdText))
	if len(step.Actions) != 1 || step.Actions[0].Kind != KindClick {
		t.Fatalf("expected model plan, got %+v", step.Actions)
	}
	if model.count() != 1 {
		t.Fatalf("model calls %d, want 1 (no nav scroll)", model.count())
	}
}
