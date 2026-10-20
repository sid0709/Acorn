package agent

import (
	"context"
	"strings"
	"testing"

	"github.com/sid0709/acorn/acorn-agent/applicant"
)

// Phase 0 of fast fill (docs 19.4m) is only the switch: with it on, a run asks the model the same
// things and the same way as with it off.
func TestFastFillOnlyCarriesTheSwitchForNow(t *testing.T) {
	run := func(fast bool) (system, schema string) {
		model := &scriptedModel{replies: []string{answerJSON("working", "ok", map[string]any{"kind": "wait", "ms": 100})}}
		a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
		started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{URL: "https://jobs.example/apply", Title: "Apply", FastFill: fast})
		if err != nil {
			t.Fatal(err)
		}
		stepOK(t, a, started.SessionID, observation(shot(t, 40)))
		return model.requests[0].Messages[0].Text, string(model.requests[0].Schema)
	}
	offSystem, offSchema := run(false)
	onSystem, onSchema := run(true)
	if offSystem != onSystem || offSchema != onSchema {
		t.Fatal("turning fast fill on changed what the model is asked")
	}
}

func TestTheOpeningSentenceSaysWhenFastFillIsOn(t *testing.T) {
	on := startStory("abcdef1234", Start{URL: "https://jobs.example/apply", FastFill: true}, 3, true)
	off := startStory("abcdef1234", Start{URL: "https://jobs.example/apply"}, 3, true)
	if !strings.Contains(on, ", using fast fill") || strings.Contains(off, "fast fill") {
		t.Fatalf("on: %q off: %q", on, off)
	}
}
