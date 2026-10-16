package agent

import (
	"context"
	"strings"
	"testing"

	"github.com/sid0709/OpenSeat/acorn-agent/applicant"
)

func TestADoneThatTheScreenDoesNotConfirmIsSentBackAndNeverEndsAsSent(t *testing.T) {
	unsent := 0.05
	screen := &fakeScreen{sent: &unsent}
	model := &scriptedModel{replies: []string{
		ending("done", "I did not submit: the posting's location requirement excludes the applicant", nil),
		ending("done", "still not submitting", nil),
		ending("done", "not submitting", nil),
	}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	step := stepOK(t, a, id, observation(shot(t, 40)))
	if step.Status != StatusWorking || len(step.Actions) != 1 || step.Actions[0].Kind != KindWait || step.Message != donePassMessage {
		t.Fatalf("the first done goes back: %+v", step)
	}
	obs := observation(shot(t, 90))
	obs.Results = resultsOf(step)
	step = stepOK(t, a, id, obs)
	if step.Status != StatusWorking {
		t.Fatalf("the second done goes back too: %+v", step)
	}
	if text := lastText(model); !strings.Contains(text, "Done means the page confirmed receipt") || !strings.Contains(text, "not a reason to leave an application unsent") {
		t.Fatalf("the model was not told:\n%s", text)
	}
	obs = observation(shot(t, 140))
	obs.Results = resultsOf(step)
	step = stepOK(t, a, id, obs)
	if step.Status != StatusStuck || step.Stop == nil || step.Stop.Reason != StopPageProblem {
		t.Fatalf("a done the page never confirmed must not end as sent: %+v", step)
	}
}

func TestADoneTheScreenConfirmsEndsTheRun(t *testing.T) {
	a := newAgentWithScreen(t, &scriptedModel{replies: []string{ending("done", "Application received", nil)}}, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	if step := stepOK(t, a, start(t, a), observation(shot(t, 40))); step.Status != StatusDone {
		t.Fatalf("%+v", step)
	}
}

func TestTheSentCheckIsNotUsedWhenTheRunStopsBeforeSubmitOrChecksAreOff(t *testing.T) {
	unsent := 0.0
	cfg := DefaultConfig()
	a := newAgentWithScreen(t, &scriptedModel{replies: []string{ending("done", "Ready to submit", nil)}}, &fixedDecider{}, &fakeScreen{sent: &unsent}, cfg)
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{StopBeforeSubmit: true})
	if err != nil {
		t.Fatal(err)
	}
	if step := stepOK(t, a, started.SessionID, observation(shot(t, 40))); step.Status != StatusDone {
		t.Fatalf("a run asked to stop before submitting is ready, not sent: %+v", step)
	}
	off := newTestAgent(t, &scriptedModel{replies: []string{ending("done", "ok", nil)}}, &fixedDecider{}, cfg)
	if step := stepOK(t, off, start(t, off), observation(shot(t, 40))); step.Status != StatusDone {
		t.Fatalf("%+v", step)
	}
}
