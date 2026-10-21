package agent

import (
	"context"
	"strings"
	"testing"

	"github.com/sid0709/acorn/acorn-agent/applicant"
)

// startStopping opens a fast-fill run that was asked to stop before sending, on the application form.
func startStopping(t *testing.T, a *Agent) string {
	t.Helper()
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{URL: "https://jobs.example/apply", Title: "Apply", FastFill: true, StopBeforeSubmit: true})
	if err != nil {
		t.Fatal(err)
	}
	s, _ := a.sessions.get(started.SessionID)
	s.mu.Lock()
	s.formReady = true
	s.mu.Unlock()
	return started.SessionID
}

// requiredEmpty is a form the page reports with a required text box still empty beside the button that sends it.
func requiredEmpty() []ControlMark {
	empty := true
	return []ControlMark{
		{ID: "input:text:phone", Kind: MarkKindInput, Label: "Phone", Rect: Rect{X: 400, Y: 300, W: 300, H: 40}, Required: true, Empty: &empty},
		{ID: "button:submit", Kind: MarkKindButton, Label: "Submit application", Rect: Rect{X: 600, Y: 700, W: 180, H: 40}},
	}
}

func TestTheServerSwitchHoldsEveryRunBeforeSendingAndSaysSoInThePrompt(t *testing.T) {
	cfg := DefaultConfig()
	cfg.StopBeforeSubmit = true
	model := &scriptedModel{replies: []string{ending("done", "Ready", nil)}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, cfg)
	id := start(t, a) // the start request does not ask for it
	s, _ := a.sessions.get(id)
	if !s.start.StopBeforeSubmit {
		t.Fatal("the server's switch did not reach the run")
	}
	step := stepOK(t, a, id, observation(shot(t, 40)))
	if step.Status != StatusDone || !step.ReadyToSubmit {
		t.Fatalf("a done under the switch is ready to submit: %+v", step)
	}
	system := model.requests[0].Messages[0].Text
	for _, want := range []string{"review before sending", `"commit": "next"`, `"commit": "send"`, "no Enter or other key"} {
		if !strings.Contains(system, want) {
			t.Fatalf("the prompt lacks %q", want)
		}
	}
	off := newTestAgent(t, &scriptedModel{replies: []string{ending("done", "Sent", nil)}}, &fixedDecider{}, stopsAtOnce())
	plain := stepOK(t, off, start(t, off), observation(shot(t, 40)))
	if plain.ReadyToSubmit || !strings.Contains(off.sessions.sessions[plainID(off)].system, "When the page confirms the application was received") {
		t.Fatalf("a default server changed: %+v", plain)
	}
}

// plainID is the id of the one session an agent holds.
func plainID(a *Agent) string {
	for id := range a.sessions.sessions {
		return id
	}
	return ""
}

func TestWithoutSendKeepsEverythingBeforeTheSendAndHoldsItAndWhatFollows(t *testing.T) {
	plan := []Action{
		{ID: "a", Kind: KindClick, X: ptr(1.0), Y: ptr(1.0)},
		{ID: "b", Kind: KindType, Text: "Ada"},
		{ID: "c", Kind: KindClick, X: ptr(1.0), Y: ptr(1.0), Commit: CommitNext},
		{ID: "d", Kind: KindClick, X: ptr(1.0), Y: ptr(1.0), Commit: CommitSend},
		{ID: "e", Kind: KindWait, Ms: 500},
		{ID: "f", Kind: KindClick, X: ptr(1.0), Y: ptr(1.0)},
	}
	kept, held := withoutSend(plan)
	if kinds(kept) != "a,b,c" || kinds(held) != "d,e,f" {
		t.Fatalf("kept %s, held %s", kinds(kept), kinds(held))
	}
	kept, held = withoutSend(plan[:3])
	if kinds(kept) != "a,b,c" || len(held) != 0 {
		t.Fatalf("a plan with no send changed: kept %s, held %s", kinds(kept), kinds(held))
	}
}

func TestWithoutCommitsHoldsANextAndASendAlike(t *testing.T) {
	plan := []Action{
		{ID: "a", Kind: KindClick, X: ptr(1.0), Y: ptr(1.0), Commit: CommitNext},
		{ID: "b", Kind: KindType, Text: "x"},
		{ID: "c", Kind: KindClick, X: ptr(1.0), Y: ptr(1.0)},
		{ID: "d", Kind: KindClick, X: ptr(1.0), Y: ptr(1.0), Commit: CommitSend},
	}
	kept, held := withoutCommits(plan)
	if kinds(kept) != "c" || kinds(held) != "a,d" {
		t.Fatalf("kept %s, held %s", kinds(kept), kinds(held))
	}
}

func TestANextClickGoesOutAndASendClickStaysBehindWithWhatFollowsIt(t *testing.T) {
	next := plan("saving", nil,
		labelled(1, 100, 100, "First Name"), typeAction("Ada", nil),
		commitClick(1, 690, 720, "Save and continue", CommitNext),
	)
	model := &scriptedModel{replies: []string{next}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	id := startStopping(t, a)
	first := surveyObservation(t)
	first.Marks = formMarks()
	step := stepOK(t, a, id, first)
	if step.Status != StatusWorking || len(step.Actions) != 3 || step.Actions[2].Commit != CommitNext {
		t.Fatalf("a click that goes on to the next page must go out as usual: %+v", step)
	}

	send := plan("sending", nil,
		labelled(1, 100, 100, "First Name"), typeAction("Ada", nil),
		commitClick(1, 690, 720, "Submit application", CommitSend),
		labelled(1, 100, 100, "After"), typeAction("never", nil),
	)
	model = &scriptedModel{replies: []string{send}}
	a = newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	id = startStopping(t, a)
	first = surveyObservation(t)
	first.Marks = formMarks()
	step = stepOK(t, a, id, first)
	if step.Status != StatusWorking || step.ReadyToSubmit {
		t.Fatalf("with fields still to run the run goes on: %+v", step)
	}
	var got []string
	for _, action := range step.Actions {
		got = append(got, action.Kind+":"+action.Text)
	}
	if want := "click: type:Ada"; strings.Join(got, " ") != want {
		t.Fatalf("actions = %v, want %q: the send and everything after it stay behind", got, want)
	}
	if !strings.Contains(strings.Join(step.Dropped, " "), "stops before sending") {
		t.Fatalf("dropped = %v", step.Dropped)
	}
	s, _ := a.sessions.get(id)
	if joined := strings.Join(s.notes, "\n"); !strings.Contains(joined, `"Submit application"`) || !strings.Contains(joined, "review before sending") {
		t.Fatalf("the model is not told why the send was not pressed: %v", s.notes)
	}
}

func TestASendPlannedAloneEndsTheRunReadyToSubmitWithoutPressingIt(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("sending", nil, committing(1, 690, 720, "Submit application"))}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	id := startStopping(t, a)
	first := surveyObservation(t)
	first.Marks = formMarks()
	step := stepOK(t, a, id, first)
	if step.Status != StatusDone || !step.ReadyToSubmit || len(step.Actions) != 0 || step.Stop != nil {
		t.Fatalf("the run must end ready, with nothing sent: %+v", step)
	}
	if step.Message != readyMessage {
		t.Fatalf("message = %q", step.Message)
	}
	s, _ := a.sessions.get(id)
	if !s.finished || s.commit.id != "" {
		t.Fatalf("the run is over and no send was noted: finished %v, commit %q", s.finished, s.commit.id)
	}
	if _, err := a.Step(context.Background(), id, first); err != ErrSessionOver {
		t.Fatalf("a step after the end: %v", err)
	}
}

func TestWithoutTheSwitchASendClickGoesOut(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("sending", nil, committing(1, 690, 720, "Submit application"))}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	id := startFast(t, a, true)
	first := surveyObservation(t)
	first.Marks = formMarks()
	step := stepOK(t, a, id, first)
	if step.Status != StatusWorking || len(step.Actions) != 1 || step.Actions[0].Commit != CommitSend || step.ReadyToSubmit {
		t.Fatalf("a run that sends changed: %+v", step)
	}
}

func TestTheReadyStopIsSentBackWhileRequiredFieldsAreEmptyThenStands(t *testing.T) {
	submit := plan("sending", nil, committing(1, 690, 720, "Submit application"))
	model := &scriptedModel{replies: []string{submit, submit, submit, submit}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	id := startStopping(t, a)
	look := surveyObservation(t)
	look.Marks = requiredEmpty()
	step := stepOK(t, a, id, look)
	if step.Status != StatusWorking || step.Message != readyPassMessage || len(step.Actions) != 1 || step.Actions[0].Kind != KindWait || step.ReadyToSubmit {
		t.Fatalf("the first ready with a required field empty must go back: %+v", step)
	}
	if !step.Survey {
		t.Fatal("the model must see the whole page again to fill what is named")
	}
	next := surveyObservation(t)
	next.Results = resultsOf(step)
	next.Marks = requiredEmpty()
	// The same field still empty: the pass filled nothing, so the stop stands, as a stop for the applicant would.
	step = stepOK(t, a, id, next)
	if step.Status != StatusDone || !step.ReadyToSubmit {
		t.Fatalf("a pass that filled none of the fields is the last: %+v", step)
	}
	if text := lastText(model); !strings.Contains(text, `"Phone"`) || !strings.Contains(text, "without pressing it") {
		t.Fatalf("the note does not name the field:\n%s", text)
	}
	if model.count() != 2 {
		t.Fatalf("model calls %d, want 2", model.count())
	}
}

func TestTheReadyStopUsesThePassesAStopForTheApplicantHas(t *testing.T) {
	// Each pass fills one of two empty fields; with StopPasses 1 the second pass is not made.
	cfg := DefaultConfig()
	cfg.StopPasses = 1
	two := func(filled int) []ControlMark {
		empty, full := true, false
		marks := []ControlMark{
			{ID: "input:text:phone", Kind: MarkKindInput, Label: "Phone", Rect: Rect{X: 400, Y: 300, W: 300, H: 40}, Required: true, Empty: &empty},
			{ID: "input:text:city", Kind: MarkKindInput, Label: "City", Rect: Rect{X: 400, Y: 400, W: 300, H: 40}, Required: true, Empty: &empty},
			{ID: "button:submit", Kind: MarkKindButton, Label: "Submit application", Rect: Rect{X: 600, Y: 700, W: 180, H: 40}},
		}
		for i := 0; i < filled; i++ {
			marks[i].Empty = &full
		}
		return marks
	}
	done := ending("done", "Ready to submit", nil)
	model := &scriptedModel{replies: []string{done, done, done}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, cfg)
	id := startStopping(t, a)
	look := surveyObservation(t)
	look.Marks = two(0)
	if step := stepOK(t, a, id, look); step.Status != StatusWorking {
		t.Fatalf("the first ready goes back: %+v", step)
	}
	look = surveyObservation(t)
	look.Marks = two(1)
	if step := stepOK(t, a, id, look); step.Status != StatusDone || !step.ReadyToSubmit {
		t.Fatalf("the passes are used up, so the run ends ready though a field is empty: %+v", step)
	}

	none := DefaultConfig()
	none.StopPasses = 0
	a = newAgentWithScreen(t, &scriptedModel{replies: []string{done}}, &fixedDecider{}, &fakeScreen{}, none)
	look = surveyObservation(t)
	look.Marks = two(0)
	if step := stepOK(t, a, startStopping(t, a), look); step.Status != StatusDone || !step.ReadyToSubmit {
		t.Fatalf("0 passes accepts the ready at once: %+v", step)
	}
}

func TestTheModelsOwnDoneUnderTheSwitchIsReadyNotSentAndNeverCheckedAsSent(t *testing.T) {
	unsent := 0.0
	screen := &fakeScreen{sent: &unsent}
	a := newAgentWithScreen(t, &scriptedModel{replies: []string{ending("done", "Ready to submit", nil)}}, &fixedDecider{}, screen, DefaultConfig())
	id := startStopping(t, a)
	look := surveyObservation(t)
	look.Marks = formMarks()
	step := stepOK(t, a, id, look)
	if step.Status != StatusDone || !step.ReadyToSubmit || step.Message != "Ready to submit" {
		t.Fatalf("%+v", step)
	}
	for _, request := range screen.requests {
		if _, asked := request.Questions[askSent]; asked {
			t.Fatal("a run that stops before sending must not be checked for a sent application")
		}
	}
}

var unavailableStop = ending("stuck", "This job is closed", map[string]any{"reason": "job_unavailable", "kind": "expired", "problem": "The posting says this position has been filled.", "action": "Try another job."})

func TestAJobUnavailableStopEndsTheRunAtOnceAndCarriesItsKind(t *testing.T) {
	model := &scriptedModel{replies: []string{unavailableStop, unavailableStop}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	id := startFast(t, a, true)
	look := surveyObservation(t)
	look.Marks = requiredEmpty() // fields the page still reports empty do not hold this stop
	step := stepOK(t, a, id, look)
	if step.Status != StatusStuck || step.Stop == nil || step.Stop.Reason != StopJobUnavailable || step.Stop.Kind != UnavailableExpired {
		t.Fatalf("the stop was sent back or lost its kind: %+v stop %+v", step, step.Stop)
	}
	if step.Stop.Problem != "The posting says this position has been filled." || model.count() != 1 {
		t.Fatalf("stop %+v after %d calls", step.Stop, model.count())
	}
	// The same page with an ordinary stuck is sent back to fill the field first, as before.
	other := ending("stuck", "The Next button does nothing", map[string]any{"reason": "other", "problem": "x", "action": "y"})
	a = newAgentWithScreen(t, &scriptedModel{replies: []string{other, other}}, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	look = surveyObservation(t)
	look.Marks = requiredEmpty()
	if step := stepOK(t, a, startFast(t, a, true), look); step.Status != StatusWorking || step.Message != stopPassMessage {
		t.Fatalf("an ordinary stop is still sent back first: %+v", step)
	}
}

func TestAnUnknownKindIsDroppedAndAKindOutsideJobUnavailableToo(t *testing.T) {
	cases := map[string]struct {
		reply string
		want  StopInfo
	}{
		"a kind the model made up": {
			ending("stuck", "x", map[string]any{"reason": "job_unavailable", "kind": "haunted", "problem": "p", "action": "a"}),
			StopInfo{Reason: StopJobUnavailable, Problem: "p", Action: "a"},
		},
		"a kind on another reason": {
			ending("stuck", "x", map[string]any{"reason": "page_problem", "kind": "expired", "problem": "p", "action": "a"}),
			StopInfo{Reason: StopPageProblem, Problem: "p", Action: "a"},
		},
		"no online way to apply": {
			ending("stuck", "x", map[string]any{"reason": "job_unavailable", "kind": "no_online_apply", "problem": "Email your CV to jobs@example.com.", "action": "Send it by email."}),
			StopInfo{Reason: StopJobUnavailable, Kind: UnavailableNoOnlineApply, Problem: "Email your CV to jobs@example.com.", Action: "Send it by email."},
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			a := newTestAgent(t, &scriptedModel{replies: []string{tc.reply}}, &fixedDecider{}, stopsAtOnce())
			step := stepOK(t, a, start(t, a), observation(shot(t, 40)))
			if step.Stop == nil || *step.Stop != tc.want {
				t.Fatalf("stop = %+v, want %+v", step.Stop, tc.want)
			}
		})
	}
}

func TestTheSchemaOffersJobUnavailableAndItsKinds(t *testing.T) {
	schema := string(replySchemaFor(false, true))
	for _, want := range []string{`"job_unavailable"`, `"kind": {"anyOf": [{"type": "null"}, {"type": "string", "enum": ["expired", "no_online_apply", "not_a_job"]}]}`} {
		if !strings.Contains(schema, want) {
			t.Fatalf("the stop shape lacks %s:\n%s", want, schema)
		}
	}
}

func TestThePromptSaysWhenAJobCannotBeAppliedToAndWhenItStillCan(t *testing.T) {
	model := &scriptedModel{replies: []string{ending("done", "x", nil)}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	stepOK(t, a, start(t, a), observation(shot(t, 40)))
	system := model.requests[0].Messages[0].Text
	for _, want := range []string{"# A job that cannot be applied to", `"job_unavailable"`, `"expired"`, `"no_online_apply"`, `"not_a_job"`, "below the fold", "leads to a form on another site"} {
		if !strings.Contains(system, want) {
			t.Fatalf("the prompt lacks %q", want)
		}
	}
}

func TestTheTimelineAndTheStoryTellAReadyRunFromASentOne(t *testing.T) {
	entry := stepTrace{Seq: 3, Step: 3, Status: StatusDone, Message: readyMessage, ReadyToSubmit: true}
	if line := timelineLine(entry, nil); !strings.Contains(line, timelineReady) {
		t.Fatalf("timeline = %q", line)
	}
	if line := timelineLine(stepTrace{Seq: 3, Step: 3, Status: StatusDone, Message: "Sent"}, nil); strings.Contains(line, timelineReady) {
		t.Fatalf("a sent run reads as ready: %q", line)
	}
	if story := endStory(StatusDone, true, Usage{}, 0); !strings.Contains(story, "ready to submit") {
		t.Fatalf("story = %q", story)
	}
}
