package agent

import (
	"encoding/json"
	"strings"
	"testing"
)

func ending(status, message string, stop any) string {
	out, _ := json.Marshal(map[string]any{
		"observation": "I see a form", "memo": nil, "job": "", "status": status,
		"message": message, "stop": stop, "actions": []any{},
	})
	return string(out)
}

func TestARunTheModelEndsSaysWhyForThePerson(t *testing.T) {
	cases := map[string]struct {
		reply string
		want  *StopInfo
	}{
		"need_person with a reason": {
			ending("need_person", "Solve the CAPTCHA", map[string]any{"reason": "captcha", "problem": "The page asks you to prove you're not a robot.", "action": "Tick the box."}),
			&StopInfo{Reason: StopCaptcha, Problem: "The page asks you to prove you're not a robot.", Action: "Tick the box."},
		},
		"stuck without a stop": {
			ending("stuck", "The Next button does nothing", nil),
			&StopInfo{Reason: StopOther, Problem: "The Next button does nothing"},
		},
		"an unknown reason": {
			ending("need_person", "hm", map[string]any{"reason": "telepathy", "problem": "", "action": "x"}),
			&StopInfo{Reason: StopOther, Problem: "hm", Action: "x"},
		},
		"done carries none": {ending("done", "Sent", nil), nil},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			a := newTestAgent(t, &scriptedModel{replies: []string{tc.reply}}, &fixedDecider{}, DefaultConfig())
			step := stepOK(t, a, start(t, a), observation(shot(t, 40)))
			if (step.Stop == nil) != (tc.want == nil) || (step.Stop != nil && *step.Stop != *tc.want) {
				t.Fatalf("stop = %+v, want %+v", step.Stop, tc.want)
			}
		})
	}
}

func TestAPageThatNeverMovesEndsWithAReasonThePersonCanRead(t *testing.T) {
	var replies []string
	for i := 0; i < 10; i++ {
		replies = append(replies, answerJSON("working", "trying", map[string]any{"kind": "wait", "ms": 100}))
	}
	cfg := DefaultConfig()
	cfg.MaxStale = 2
	a := newTestAgent(t, &scriptedModel{replies: replies}, &fixedDecider{}, cfg)
	id := start(t, a)
	var step Step
	for i := 0; i < 3; i++ {
		step = stepOK(t, a, id, observation(shot(t, 40)))
	}
	if step.Status != StatusStuck || step.Stop == nil || step.Stop.Reason != StopNoChange || step.Stop.Action == "" {
		t.Fatalf("step = %+v stop = %+v", step, step.Stop)
	}
}

func TestThePromptStopsOnlyForTheApplicantsOwnHand(t *testing.T) {
	model := &scriptedModel{replies: []string{ending("done", "x", nil)}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	stepOK(t, a, start(t, a), observation(shot(t, 40)))
	system := model.requests[0].Messages[0].Text
	for _, want := range []string{`reason "captcha"`, `reason "identity"`, `reason "document"`, "choose the answer most applicants choose", "Never stop for a question like that"} {
		if !strings.Contains(system, want) {
			t.Fatalf("the prompt lacks %q", want)
		}
	}
}
