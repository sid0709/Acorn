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

// committing is a click the model named as the one that sends the page.
func committing(screen int, x, y float64, label string) map[string]any {
	action := labelled(screen, x, y, label)
	action["commit"] = true
	return action
}

func TestTheClickThatSendsThePageIsHeldBackWhenPartOfThePlanWasRefused(t *testing.T) {
	reply := plan("filling", nil,
		labelled(1, 100, 100, "First Name"), typeAction("Ada", nil),
		labelled(1, 100, 200, "Sponsorship"), typeAction("No", nil),
		committing(3, 900, 700, "Submit application"),
	)
	model := &scriptedModel{replies: []string{reply}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{wrongPoints: []string{"Sponsorship"}}, DefaultConfig())
	id := startFast(t, a, true)
	step := stepOK(t, a, id, surveyObservation(t))
	var got []string
	for _, action := range step.Actions {
		got = append(got, action.Kind+":"+action.Text)
	}
	if want := "click: type:Ada"; strings.Join(got, " ") != want {
		t.Fatalf("actions = %v, want %q: the refused field, its text and the click that sends the page all stay behind", got, want)
	}
	if !step.Survey {
		t.Fatal("the model is not shown the page again to plan what is left")
	}
	s, _ := a.sessions.get(id)
	joined := strings.Join(s.notes, "\n")
	if !strings.Contains(joined, `"Submit application" on screen 3`) || !strings.Contains(joined, "the page is not complete") {
		t.Fatalf("the model is not told that the click was held back and why: %v", s.notes)
	}
	if !strings.Contains(strings.Join(step.Dropped, " "), "click that sends the page was held back") {
		t.Fatalf("dropped = %v", step.Dropped)
	}
}

func TestTheClickThatSendsThePageGoesWhenNothingWasLost(t *testing.T) {
	reply := plan("filling", nil,
		labelled(1, 100, 100, "First Name"), typeAction("Ada", nil),
		committing(3, 900, 700, "Submit application"),
	)
	model := &scriptedModel{replies: []string{reply}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	step := stepOK(t, a, startFast(t, a, true), surveyObservation(t))
	if len(step.Actions) != 3 || step.Actions[2].Kind != KindClick {
		t.Fatalf("a complete plan lost its last click: %s", kinds(step.Actions))
	}
}

func TestTheClickThatSendsThePageIsHeldBackWhenAnActionWasInvalid(t *testing.T) {
	reply := plan("filling", nil,
		labelled(1, 100, 100, "First Name"),
		map[string]any{"kind": "type"}, // nothing to type: refused before anything is carried out
		committing(3, 900, 700, "Submit application"),
	)
	model := &scriptedModel{replies: []string{reply}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	step := stepOK(t, a, startFast(t, a, true), surveyObservation(t))
	for _, action := range step.Actions {
		if action.Commit || (action.Kind == KindClick && action.ScrollTo != nil && *action.ScrollTo == 1360) {
			t.Fatalf("the click that sends the page went with a plan that lost an action: %s", kinds(step.Actions))
		}
	}
}

func TestOnlyAClickCanBeTheOneThatSendsThePage(t *testing.T) {
	yes := true
	valid, _ := checkActions(1, []modelAction{
		{Kind: KindClick, X: ptr(10.0), Y: ptr(10.0), Commit: &yes},
		{Kind: KindHover, X: ptr(10.0), Y: ptr(10.0), Commit: &yes},
		{Kind: KindClick, X: ptr(10.0), Y: ptr(10.0)},
	}, Viewport{Width: 1280, Height: 800}, 10, nil)
	if len(valid) != 3 || !valid[0].Commit || valid[1].Commit || valid[2].Commit {
		t.Fatalf("commit flags = %v %v %v, want only the click that was named", valid[0].Commit, valid[1].Commit, valid[2].Commit)
	}
}

func ptr[T any](v T) *T { return &v }

func TestAPointOnTheWordsOfAQuestionIsMovedOntoItsBoxAndCheckedAgain(t *testing.T) {
	// The label of the question sits above its box and inside the field; the first check refuses the point.
	reply := plan("filling", nil,
		labelled(1, 100, 100, "First Name"), typeAction("Ada", nil),
		labelled(1, 500, 280, "Sponsorship"), typeAction("No", nil),
		committing(3, 900, 700, "Submit application"),
	)
	model := &scriptedModel{replies: []string{reply}}
	screen := &fakeScreen{wrongFirst: []string{"Sponsorship"}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := startFast(t, a, true)
	obs := markedSurvey(t)
	step := stepOK(t, a, id, obs)
	if len(step.Actions) != 5 {
		t.Fatalf("%d actions went out (%s), want the whole plan: the point was moved, not dropped", len(step.Actions), kinds(step.Actions))
	}
	moved := step.Actions[2]
	if moved.Y == nil || *moved.Y != 320 || *moved.X != 500 {
		t.Fatalf("the point is at (%v, %v), want it on the middle of the box, at the same x: (500, 320)", moved.X, moved.Y)
	}
	if moved.Mark == nil || moved.Mark.ID != "input:text:first" {
		t.Fatalf("the moved point has %+v, want the control it was moved onto", moved.Mark)
	}
	if step.Actions[4].Kind != KindClick {
		t.Fatalf("the click that sends the page was held back though nothing was lost: %s", kinds(step.Actions))
	}
	s, _ := a.sessions.get(id)
	if len(s.notes) != 0 {
		t.Fatalf("the model was told of a refusal that was put right: %v", s.notes)
	}
	if _, ok := s.anchors[moved.ID]; !ok {
		t.Fatal("the moved point has no picture of its new place")
	}
	if screen.pointRequests < 3 {
		t.Fatalf("%d point checks: the moved point was not checked again", screen.pointRequests)
	}
}

func TestAMovedPointThatIsStillRefusedIsDroppedAsBefore(t *testing.T) {
	reply := plan("filling", nil,
		labelled(1, 500, 280, "Sponsorship"), typeAction("No", nil),
		committing(3, 900, 700, "Submit application"),
	)
	model := &scriptedModel{replies: []string{reply}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{wrongPoints: []string{"Sponsorship"}}, DefaultConfig())
	id := startFast(t, a, true)
	step := stepOK(t, a, id, markedSurvey(t))
	for _, action := range step.Actions {
		if action.Kind == KindType {
			t.Fatalf("text was typed into a field whose point was refused twice: %s", kinds(step.Actions))
		}
	}
	s, _ := a.sessions.get(id)
	if len(s.notes) == 0 || !strings.Contains(strings.Join(s.notes, " "), `"Sponsorship" on screen 1`) {
		t.Fatalf("the model is not told: %v", s.notes)
	}
}

func TestAPointAlreadyOnAControlOrInNoFieldIsNotMoved(t *testing.T) {
	obs := markedSurvey(t)
	x, onBox, nowhere := 500.0, 320.0, 420.0
	scroll := 0.0
	onControl := Action{Kind: KindClick, X: &x, Y: &onBox, ScrollTo: &scroll}
	if _, ok := reaimed(onControl, obs); ok {
		t.Fatal("a point on a control was moved: the label is what was wrong")
	}
	between := Action{Kind: KindClick, X: &x, Y: &nowhere, ScrollTo: &scroll}
	if _, ok := reaimed(between, obs); ok {
		t.Fatal("a point in no field was moved")
	}
	noMarks := surveyObservation(t)
	label := 280.0
	words := Action{Kind: KindClick, X: &x, Y: &label, ScrollTo: &scroll}
	if _, ok := reaimed(words, noMarks); ok {
		t.Fatal("a point was moved on a look without marks")
	}
	moved, ok := reaimed(words, obs)
	if !ok || *moved.Y != 320 {
		t.Fatalf("the point on the label was not moved onto the box: %+v %v", moved, ok)
	}
}
