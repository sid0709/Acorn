package agent

import (
	"context"
	"strings"
	"testing"

	"github.com/sid0709/acorn/acorn-agent/applicant"
)

func startFast(t *testing.T, a *Agent, fast bool) string {
	t.Helper()
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{URL: "https://jobs.example/apply", Title: "Apply", FastFill: fast})
	if err != nil {
		t.Fatal(err)
	}
	s, _ := a.sessions.get(started.SessionID)
	s.mu.Lock()
	s.formReady = true
	s.mu.Unlock()
	return started.SessionID
}

// wholePage is a plan of n clicks down a survey's screens, with no checks.
func wholePage(n int) string {
	actions := make([]map[string]any, n)
	for i := range actions {
		actions[i] = onScreen(1+i%3, float64(10+i), float64(10+i), nil)
	}
	return plan("filling the page", nil, actions...)
}

func TestAFastFillRunIsToldToPlanAWholePageAndSurveysAreOn(t *testing.T) {
	prompt := func(fast bool) (string, string) {
		model := &scriptedModel{replies: []string{wholePage(1)}}
		a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
		stepOK(t, a, startFast(t, a, fast), surveyObservation(t))
		return model.requests[0].Messages[0].Text, string(model.requests[0].Schema)
	}
	system, schema := prompt(true)
	for _, want := range []string{"Filling a whole page at once", "up to 60 actions", "plan only that upload", "Leave \"check\" null on every action", "A look may be a survey"} {
		if !strings.Contains(system, want) {
			t.Fatalf("the fast-fill prompt lacks %q", want)
		}
	}
	for _, unwanted := range []string{"Put a check on every field you fill", "A plan may scroll on to fields below the screen"} {
		if strings.Contains(system, unwanted) {
			t.Fatalf("the fast-fill prompt still says %q", unwanted)
		}
	}
	if !strings.Contains(schema, `"screen"`) || !strings.Contains(schema, KindSurvey) {
		t.Fatal("a fast-fill run was not offered surveys")
	}
	plain, _ := prompt(false)
	if strings.Contains(plain, "Filling a whole page at once") || !strings.Contains(plain, "Put a check on every field you fill") {
		t.Fatal("a run without fast fill was changed")
	}
}

func TestAFastFillPlanRunsAsOnePieceAndThePageIsLookedAtAgain(t *testing.T) {
	for name, screen := range map[string]Screen{"with checks": &fakeScreen{}, "without checks": nil} {
		model := &scriptedModel{replies: []string{wholePage(14)}}
		a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
		step := stepOK(t, a, startFast(t, a, true), surveyObservation(t))
		if len(step.Actions) != 14 {
			t.Fatalf("%s: %d actions went out, want the whole plan of 14", name, len(step.Actions))
		}
		if !step.Survey {
			t.Fatalf("%s: the look after the plan is not a survey", name)
		}
	}
}

func TestWithoutFastFillAPlanIsStillCutAndNotFollowedBySurvey(t *testing.T) {
	model := &scriptedModel{replies: []string{wholePage(14)}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	step := stepOK(t, a, startFast(t, a, false), surveyObservation(t))
	if len(step.Actions) != 6 || step.Survey {
		t.Fatalf("%d actions, survey %v: a run without fast fill changed", len(step.Actions), step.Survey)
	}
}

func TestAnUploadIsFollowedByASurveyOfThePageItChanged(t *testing.T) {
	reply := plan("résumé first", nil, map[string]any{"kind": "upload", "x": 386.0, "y": 684.0}, click(5, 5, nil))
	for fast, want := range map[bool]bool{true: true, false: false} {
		model := &scriptedModel{replies: []string{reply}}
		a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
		step := stepOK(t, a, startFast(t, a, fast), observation(shot(t, 40)))
		if kinds(step.Actions) == "" || step.Survey != want {
			t.Fatalf("fast=%v: actions %s, survey %v, want survey %v", fast, kinds(step.Actions), step.Survey, want)
		}
	}
}

func TestOnlyTheLastPieceOfAPlanIsFollowedByASurvey(t *testing.T) {
	reply := plan("two pieces", nil, click(10, 10, "the first field is filled"), click(20, 20, "the second field is filled"))
	model := &scriptedModel{replies: []string{reply}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{verdicts: []screenVerdict{sure}}, DefaultConfig())
	id := startFast(t, a, true)
	first := stepOK(t, a, id, observation(shot(t, 40)))
	if len(first.Actions) != 1 || first.Survey {
		t.Fatalf("the first piece: %d actions, survey %v; a survey now would interrupt a plan that goes on", len(first.Actions), first.Survey)
	}
	next := observation(shot(t, 90))
	next.Results = []ActionResult{{ID: first.Actions[0].ID, OK: true}}
	second := stepOK(t, a, id, next)
	if len(second.Actions) != 1 || !second.Survey {
		t.Fatalf("the last piece: %d actions, survey %v", len(second.Actions), second.Survey)
	}
}
