package agent

import (
	"errors"
	"strings"
	"testing"
)

func labelled(screen int, x, y float64, label string) map[string]any {
	return map[string]any{"kind": "click", "screen": screen, "x": x, "y": y, "label": label}
}

func fillPlan() string {
	return plan("filling", nil,
		labelled(1, 100, 100, "First Name"), typeAction("Ada", nil),
		labelled(1, 100, 200, "Last Name"), typeAction("Lovelace", nil),
		labelled(2, 100, 300, "Country"),
		labelled(3, 100, 400, "Phone"), typeAction("555", nil),
	)
}

func runPointCheck(t *testing.T, cfg Config, screen *fakeScreen) (Step, *fakeScreen, *Agent, string) {
	t.Helper()
	model := &scriptedModel{replies: []string{fillPlan()}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, cfg)
	id := startFast(t, a, true)
	return stepOK(t, a, id, surveyObservation(t)), screen, a, id
}

func TestEveryLabelledPointIsCheckedOnItsScreenAndTheScreensAreCheckedSideBySide(t *testing.T) {
	step, screen, _, _ := runPointCheck(t, DefaultConfig(), &fakeScreen{})
	if screen.pointRequests != 3 {
		t.Fatalf("%d point checks, want one for each of the 3 screens the points are on", screen.pointRequests)
	}
	if len(step.Actions) != 7 {
		t.Fatalf("%d actions went out, want the whole plan of 7", len(step.Actions))
	}
	for _, request := range screen.requests {
		if _, asked := request.Questions[pointQuestionKey(1)]; !asked {
			continue
		}
		images := 0
		for _, part := range request.State {
			if part.ImageURL != nil {
				images++
			}
		}
		if images != 1 {
			t.Fatalf("a point check was given %d images, want the one screen with its points marked", images)
		}
	}
}

func TestAPointThatIsNotOnItsControlIsNotActedOnNorIsWhatWasTypedIntoIt(t *testing.T) {
	step, _, a, id := runPointCheck(t, DefaultConfig(), &fakeScreen{wrongPoints: []string{"Last Name"}})
	var got []string
	for _, action := range step.Actions {
		got = append(got, action.Kind+":"+action.Text)
	}
	want := []string{"click:", "type:Ada", "click:", "click:", "type:555"}
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Fatalf("actions = %v, want %v (the wrong click and its typing gone, the rest kept)", got, want)
	}
	if !step.Survey {
		t.Fatal("the model is not shown the page again to plan the missing field")
	}
	s, _ := a.sessions.get(id)
	if len(s.notes) == 0 || !strings.Contains(s.notes[len(s.notes)-1], `"Last Name" on screen 1`) {
		t.Fatalf("the model is not told which point was not carried out: %v", s.notes)
	}
	if s.usage.Checks < 3 {
		t.Fatalf("the point checks were not counted: %d", s.usage.Checks)
	}
}

func TestAPlanWithNoLabelsIsNotChecked(t *testing.T) {
	model := &scriptedModel{replies: []string{wholePage(3)}}
	screen := &fakeScreen{}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	stepOK(t, a, startFast(t, a, true), surveyObservation(t))
	if screen.pointRequests != 0 {
		t.Fatalf("%d point checks for a plan without labels", screen.pointRequests)
	}
}

func TestAPointCheckThatFailsLeavesThePlanAsPlanned(t *testing.T) {
	step, _, _, _ := runPointCheck(t, DefaultConfig(), &fakeScreen{err: errors.New("the decision model is down")})
	if len(step.Actions) != 7 {
		t.Fatalf("%d actions went out; a checker that is down must not hold up the plan", len(step.Actions))
	}
}

func TestThePointCheckIsOnlyForFastFillAndCanBeTurnedOff(t *testing.T) {
	model := &scriptedModel{replies: []string{fillPlan()}}
	screen := &fakeScreen{wrongPoints: []string{"First Name"}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	step := stepOK(t, a, startFast(t, a, false), surveyObservation(t))
	if screen.pointRequests != 0 || len(step.Actions) == 0 {
		t.Fatalf("a run without fast fill was point-checked: %d checks", screen.pointRequests)
	}
	cfg := DefaultConfig()
	cfg.PointMatch = 0
	step, screen, _, _ = runPointCheck(t, cfg, &fakeScreen{wrongPoints: []string{"First Name"}})
	if screen.pointRequests != 0 || len(step.Actions) != 7 {
		t.Fatalf("PointMatch 0 did not turn the check off: %d checks, %d actions", screen.pointRequests, len(step.Actions))
	}
}

func TestTheSchemaGivesEveryPointALabelInASurvey(t *testing.T) {
	model := &scriptedModel{replies: []string{fillPlan()}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	stepOK(t, a, startFast(t, a, true), surveyObservation(t))
	if !strings.Contains(string(model.requests[0].Schema), `"label"`) || !strings.Contains(model.requests[0].Messages[0].Text, `Give every click, choose and upload a "label"`) {
		t.Fatal("the model was not asked for labels")
	}
}
