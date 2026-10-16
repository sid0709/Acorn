package agent

import "testing"

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
