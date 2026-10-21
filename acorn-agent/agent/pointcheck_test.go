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

func TestAPointTheCheckerDoubtsIsStillActedOnAndTheModelIsTold(t *testing.T) {
	step, _, a, id := runPointCheck(t, DefaultConfig(), &fakeScreen{wrongPoints: []string{"Last Name"}})
	if len(step.Actions) != 7 {
		t.Fatalf("%d actions went out (%s), want the whole plan: a checker's doubt never overrides the model", len(step.Actions), kinds(step.Actions))
	}
	if !step.Survey {
		t.Fatal("the model is not shown the page again to check what the doubted point filled")
	}
	s, _ := a.sessions.get(id)
	if len(s.notes) == 0 || !strings.Contains(s.notes[len(s.notes)-1], `"Last Name" on screen 1`) || !strings.Contains(s.notes[len(s.notes)-1], "doubts") {
		t.Fatalf("the model is not told which point was doubted: %v", s.notes)
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
}

func TestTheSchemaGivesEveryPointALabelInASurvey(t *testing.T) {
	model := &scriptedModel{replies: []string{fillPlan()}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	stepOK(t, a, startFast(t, a, true), surveyObservation(t))
	if !strings.Contains(string(model.requests[0].Schema), `"label"`) || !strings.Contains(model.requests[0].Messages[0].Text, `Give every click, choose and upload a "label"`) {
		t.Fatal("the model was not asked for labels")
	}
}

// committing is a click the model named as the one that sends the application.
func committing(screen int, x, y float64, label string) map[string]any {
	return commitClick(screen, x, y, label, CommitSend)
}

// commitClick is a click the model marked with what it does beyond the click: CommitNext or CommitSend.
func commitClick(screen int, x, y float64, label, commit string) map[string]any {
	action := labelled(screen, x, y, label)
	action["commit"] = commit
	return action
}

func TestTheClickThatSendsThePageIsHeldBackWhenPartOfThePlanWasRefused(t *testing.T) {
	// An action the server refuses (nothing to type) is the plan losing a part; a checker's doubt about a
	// point is not, since the point is acted on anyway.
	reply := plan("filling", nil,
		labelled(1, 100, 100, "First Name"), typeAction("Ada", nil),
		labelled(1, 100, 200, "Sponsorship"), map[string]any{"kind": "type"},
		committing(3, 900, 700, "Submit application"),
	)
	model := &scriptedModel{replies: []string{reply}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	id := startFast(t, a, true)
	step := stepOK(t, a, id, surveyObservation(t))
	var got []string
	for _, action := range step.Actions {
		got = append(got, action.Kind+":"+action.Text)
	}
	if want := "click: type:Ada click:"; strings.Join(got, " ") != want {
		t.Fatalf("actions = %v, want %q: the refused typing and the click that sends the page stay behind", got, want)
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
		if action.Commit != "" || (action.Kind == KindClick && action.ScrollTo != nil && *action.ScrollTo == 1360) {
			t.Fatalf("the click that sends the page went with a plan that lost an action: %s", kinds(step.Actions))
		}
	}
}

func TestOnlyAClickCanBeTheOneThatSendsThePage(t *testing.T) {
	valid, _ := checkActions(1, []modelAction{
		{Kind: KindClick, X: ptr(10.0), Y: ptr(10.0), Commit: ptr(CommitSend)},
		{Kind: KindHover, X: ptr(10.0), Y: ptr(10.0), Commit: ptr(CommitSend)},
		{Kind: KindClick, X: ptr(10.0), Y: ptr(10.0)},
	}, Viewport{Width: 1280, Height: 800}, 10, nil)
	if len(valid) != 3 || valid[0].Commit != CommitSend || valid[1].Commit != "" || valid[2].Commit != "" {
		t.Fatalf("commit flags = %q %q %q, want only the click that was named", valid[0].Commit, valid[1].Commit, valid[2].Commit)
	}
}

func TestACommitIsNextOrSendAndAnythingElseIsAPlainClick(t *testing.T) {
	valid, _ := checkActions(1, []modelAction{
		{Kind: KindClick, X: ptr(10.0), Y: ptr(10.0), Commit: ptr(CommitNext)},
		{Kind: KindClick, X: ptr(10.0), Y: ptr(10.0), Commit: ptr(" send ")},
		{Kind: KindDoubleClick, X: ptr(10.0), Y: ptr(10.0), Commit: ptr("true")},
		{Kind: KindClick, X: ptr(10.0), Y: ptr(10.0), Commit: ptr("")},
	}, Viewport{Width: 1280, Height: 800}, 10, nil)
	got := []string{valid[0].Commit, valid[1].Commit, valid[2].Commit, valid[3].Commit}
	if want := []string{CommitNext, CommitSend, "", ""}; strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("commits = %q, want %q", got, want)
	}
}

func TestTheSchemaOffersCommitOnAClickInEveryMode(t *testing.T) {
	for _, survey := range []bool{false, true} {
		schema := string(replySchemaFor(survey, true))
		if !strings.Contains(schema, `"commit": {"anyOf": [{"type": "null"}, {"type": "string", "enum": ["next", "send"]}]}`) {
			t.Fatalf("survey=%v: the click shape does not offer next/send:\n%s", survey, schema)
		}
		if n := strings.Count(schema, `"commit": {`); n != 1 {
			t.Fatalf("survey=%v: commit is defined %d times, want once (the click shape only)", survey, n)
		}
	}
}

func TestAClickThatGoesOnToTheNextPageIsHeldBackLikeASendWhenThePlanLostAPart(t *testing.T) {
	reply := plan("filling", nil,
		labelled(1, 100, 100, "First Name"), typeAction("Ada", nil),
		labelled(1, 100, 200, "Sponsorship"), map[string]any{"kind": "type"}, // nothing to type: refused
		commitClick(3, 900, 700, "Save and continue", CommitNext),
	)
	model := &scriptedModel{replies: []string{reply}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	step := stepOK(t, a, startFast(t, a, true), surveyObservation(t))
	for _, action := range step.Actions {
		if action.Commit != "" {
			t.Fatalf("the click that goes on to the next page went with a plan that lost an action: %s", kinds(step.Actions))
		}
	}
	if !strings.Contains(strings.Join(step.Dropped, " "), "held back") {
		t.Fatalf("dropped = %v", step.Dropped)
	}
}

func ptr[T any](v T) *T { return &v }

func TestAPointOnTheWordsOfAQuestionIsMovedOntoItsBoxBeforeTheCheck(t *testing.T) {
	// The label of the question sits above its box and inside the field: the point is moved onto the box
	// before anything is checked, so the check sees it on its control and nothing is refused.
	reply := plan("filling", nil,
		labelled(1, 100, 100, "First Name"), typeAction("Ada", nil),
		labelled(1, 500, 280, "Sponsorship"), typeAction("No", nil),
		committing(3, 900, 700, "Submit application"),
	)
	model := &scriptedModel{replies: []string{reply}}
	screen := &fakeScreen{}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := startFast(t, a, true)
	step := stepOK(t, a, id, markedSurvey(t))
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
		t.Fatalf("the model was told of a refusal: %v", s.notes)
	}
	if _, ok := s.anchors[moved.ID]; !ok {
		t.Fatal("the moved point has no picture of its new place")
	}
	if screen.pointRequests != 2 {
		t.Fatalf("%d point checks, want one for each of the 2 screens the points are on", screen.pointRequests)
	}
}

func TestAPointTheCheckerDoubtsThoughItIsOnItsControlStillGoesOutWithANote(t *testing.T) {
	reply := plan("filling", nil,
		labelled(1, 500, 280, "Sponsorship"), typeAction("No", nil),
		committing(3, 900, 700, "Submit application"),
	)
	model := &scriptedModel{replies: []string{reply}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{wrongPoints: []string{"Sponsorship"}}, DefaultConfig())
	id := startFast(t, a, true)
	step := stepOK(t, a, id, markedSurvey(t))
	if len(step.Actions) != 3 {
		t.Fatalf("%d actions went out (%s), want the whole plan", len(step.Actions), kinds(step.Actions))
	}
	s, _ := a.sessions.get(id)
	if len(s.notes) == 0 || !strings.Contains(strings.Join(s.notes, " "), `"Sponsorship" on screen 1`) {
		t.Fatalf("the model is not told: %v", s.notes)
	}
}

// namedMarks are the marks of markedSurvey with the names the page gives the controls.
func namedMarks(t *testing.T) Observation {
	t.Helper()
	obs := markedSurvey(t)
	for i := range obs.Marks {
		switch obs.Marks[i].ID {
		case "input:text:first":
			obs.Marks[i].Label = "First Name *"
		case "input:combobox:country":
			obs.Marks[i].Label = "Country of residence"
		case "input:text:last":
			obs.Marks[i].Label = "Last Name"
		}
	}
	return obs
}

func TestAPointOnAControlThePageCallsByItsLabelIsNotCheckedAgainstAPicture(t *testing.T) {
	reply := plan("filling", nil,
		labelled(1, 500, 320, "First Name"), typeAction("Ada", nil),
		labelled(2, 500, 130, "Last name"), typeAction("Lovelace", nil),
		committing(3, 900, 700, "Submit application"),
	)
	model := &scriptedModel{replies: []string{reply}}
	screen := &fakeScreen{wrongPoints: []string{"First Name", "Last name"}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	step := stepOK(t, a, startFast(t, a, true), namedMarks(t))
	if len(step.Actions) != 5 {
		t.Fatalf("%d actions went out (%s): a point the page itself names must not be refused by a picture", len(step.Actions), kinds(step.Actions))
	}
	if screen.pointRequests != 1 {
		t.Fatalf("%d point checks, want 1: only the click that sends the page is bound to no named control", screen.pointRequests)
	}
}

func TestAPointWhoseLabelDisagreesWithThePagesIsStillChecked(t *testing.T) {
	reply := plan("filling", nil, labelled(1, 500, 320, "Email"), typeAction("ada@example.com", nil))
	model := &scriptedModel{replies: []string{reply}}
	screen := &fakeScreen{wrongPoints: []string{"Email"}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	step := stepOK(t, a, startFast(t, a, true), namedMarks(t))
	if screen.pointRequests != 1 {
		t.Fatalf("%d checks: a point the page calls something else must be checked", screen.pointRequests)
	}
	if len(step.Actions) != 2 {
		t.Fatalf("actions %s: the doubted point and its text still go out; the model is told", kinds(step.Actions))
	}
}
