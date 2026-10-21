package agent

import (
	"context"
	"strings"
	"testing"

	"github.com/sid0709/acorn/acorn-agent/applicant"
	"github.com/sid0709/acorn/acorn-agent/decide"
)

// formMarks are the controls of a form the page reports: a filled text box and the button that sends it.
func formMarks() []ControlMark {
	filled := false
	return []ControlMark{
		{ID: "input:text:first", Kind: MarkKindInput, Label: "First Name", Rect: Rect{X: 400, Y: 300, W: 300, H: 40}, Empty: &filled},
		{ID: "button:submit", Kind: "button", Label: "Submit application", Rect: Rect{X: 600, Y: 700, W: 180, H: 40}},
	}
}

// codeBox is a box for a code that appeared once the form was sent: required and empty.
func codeBox() ControlMark {
	empty := true
	return ControlMark{ID: "input:text:code", Kind: MarkKindInput, Label: "Security code", Rect: Rect{X: 400, Y: 760, W: 40, H: 40}, Required: true, Empty: &empty}
}

// sentForm runs a fast-fill plan that sends the form, and answers with the look after, which the model
// stops on. It returns the step of that stop.
func sentForm(t *testing.T, after []ControlMark, stop string) (Step, *scriptedModel) {
	t.Helper()
	model := &scriptedModel{replies: []string{
		plan("sending", nil, committing(1, 690, 720, "Submit application")),
		stop,
		stop,
	}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	id := startFast(t, a, true)
	first := surveyObservation(t)
	first.Marks = formMarks()
	sent := stepOK(t, a, id, first)
	if len(sent.Actions) != 1 || !sent.Actions[0].Commit {
		t.Fatalf("the click that sends the page did not go out: %s", kinds(sent.Actions))
	}
	look := observation(shot(t, 90))
	look.Results = carriedOut(sent.Actions)
	look.Marks = after
	return stepOK(t, a, id, look), model
}

var codeStop = ending("need_person", "Enter the code", map[string]any{"reason": "verification", "problem": "The page wants the code it sent you.", "action": "Type the code."})

func TestAStopStandsAtOnceWhenOnlyWhatAppearedAfterTheSendIsEmpty(t *testing.T) {
	step, model := sentForm(t, append(formMarks(), codeBox()), codeStop)
	if step.Status != StatusNeedPerson || step.Stop == nil || step.Stop.Reason != StopVerification {
		t.Fatalf("the stop was sent back though the page says nothing else is left: %+v", step)
	}
	if model.count() != 2 {
		t.Fatalf("the model was called %d times, want 2: no pass to finish the page", model.count())
	}
}

func TestAStopIsSentBackWhenAControlThePageHadBeforeTheSendIsEmpty(t *testing.T) {
	marks := formMarks()
	empty := true
	marks[0].Empty = &empty
	step, _ := sentForm(t, append(marks, codeBox()), codeStop)
	if step.Status != StatusWorking || step.Message != stopPassMessage {
		t.Fatalf("a stop with a field still empty was not sent back: %+v", step)
	}
}

func TestAStopIsSentBackWhenThePageMarksAControlInvalid(t *testing.T) {
	marks := formMarks()
	marks[0].Invalid = true
	step, _ := sentForm(t, append(marks, codeBox()), codeStop)
	if step.Status != StatusWorking {
		t.Fatalf("a stop with a control the page marks invalid was not sent back: %+v", step)
	}
}

func TestAStopBeforeAnySendStandsOnlyWhenNothingIsEmpty(t *testing.T) {
	stopFor := func(marks []ControlMark) Step {
		model := &scriptedModel{replies: []string{codeStop, codeStop}}
		a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
		look := surveyObservation(t)
		look.Marks = marks
		return stepOK(t, a, startFast(t, a, true), look)
	}
	if step := stopFor(formMarks()); step.Status != StatusNeedPerson {
		t.Fatalf("with nothing empty the stop must stand: %+v", step)
	}
	if step := stopFor(append(formMarks(), codeBox())); step.Status != StatusWorking {
		t.Fatalf("with an empty box and no send the stop must go back: %+v", step)
	}
	if step := stopFor(nil); step.Status != StatusWorking {
		t.Fatalf("a look that reports no controls says nothing, so the stop must go back: %+v", step)
	}
}

func TestTheSendIsForgottenOnAnotherPage(t *testing.T) {
	model := &scriptedModel{replies: []string{
		plan("sending", nil, committing(1, 690, 720, "Submit application")),
		codeStop, codeStop,
	}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, &fakeScreen{}, DefaultConfig())
	id := startFast(t, a, true)
	first := surveyObservation(t)
	first.Marks = formMarks()
	sent := stepOK(t, a, id, first)
	look := observation(shot(t, 90))
	look.URL = "https://jobs.example/verify"
	look.Results = carriedOut(sent.Actions)
	look.Marks = append(formMarks(), codeBox())
	if step := stepOK(t, a, id, look); step.Status != StatusWorking || !strings.Contains(step.Message, "Finishing") {
		t.Fatalf("on another page what appeared is not known to be the applicant's: %+v", step)
	}
}

func TestASendThatLedOnToTheNextPageOfTheFormIsNotTheSendThatAsked(t *testing.T) {
	// The form's own field is gone and another page's field is there, under the same URL: a wizard went on,
	// and what the next page asks is the run's to fill.
	empty := true
	next := []ControlMark{
		{ID: "input:text:city", Kind: MarkKindInput, Label: "City", Rect: Rect{X: 400, Y: 300, W: 300, H: 40}, Empty: &empty},
		{ID: "button:submit", Kind: "button", Label: "Save and continue", Rect: Rect{X: 600, Y: 700, W: 180, H: 40}},
	}
	step, _ := sentForm(t, next, codeStop)
	if step.Status != StatusWorking || step.Message != stopPassMessage {
		t.Fatalf("a stop on the next page of the form stood at once: %+v", step)
	}
}

// stepMarks are the controls of one step of an application: a question of two radio buttons, a text box,
// the box for an identity number and the button that goes on. filled says whether the first two are answered.
func stepMarks(filled bool) []ControlMark {
	empty, stillEmpty := !filled, true
	return []ControlMark{
		{ID: "input:radio:veteran:Veteran", Kind: MarkKindCheck, Label: "Veteran", Group: "radio:veteran", Question: "Veteran status", Required: true, Empty: &empty, Rect: Rect{X: 400, Y: 300, W: 20, H: 20}},
		{ID: "input:radio:veteran:Not a veteran", Kind: MarkKindCheck, Label: "Not a veteran", Group: "radio:veteran", Question: "Veteran status", Required: true, Empty: &empty, Rect: Rect{X: 400, Y: 330, W: 20, H: 20}},
		{ID: "input:text:gender:Gender", Kind: MarkKindInput, Label: "Gender", Required: true, Empty: &empty, Rect: Rect{X: 400, Y: 400, W: 300, H: 40}},
		{ID: "input:text:identifier", Kind: MarkKindInput, Label: "Please enter a unique identifier", Required: true, Empty: &stillEmpty, Rect: Rect{X: 400, Y: 500, W: 300, H: 40}},
		{ID: "button:submit", Kind: MarkKindButton, Label: "Save and continue", Rect: Rect{X: 600, Y: 700, W: 180, H: 40}},
	}
}

var idStop = ending("need_person", "Enter your identifier", map[string]any{"reason": "identity", "problem": "The page asks for a unique identifier that is not in your profile.", "action": "Type your identifier in the box."})

var idReply = reply{Status: StatusNeedPerson, Stop: &StopInfo{Reason: StopIdentity, Problem: "The page asks for a unique identifier that is not in your profile.", Action: "Type your identifier in the box."}}

func TestAStopIsSentBackNamingTheRequiredFieldsTheRunCanStillFill(t *testing.T) {
	model := &scriptedModel{replies: []string{idStop, idStop}}
	screen := &fakeScreen{personFields: []string{"Please enter a unique identifier"}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := startFast(t, a, true)
	first := surveyObservation(t)
	first.Viewport.PageHeight = 2160 // what the survey's screens cover: nothing is left unseen
	first.Marks = stepMarks(false)
	step := stepOK(t, a, id, first)
	if step.Status != StatusWorking || step.Message != stopPassMessage {
		t.Fatalf("the stop was not sent back for the fields: %+v", step)
	}
	second := surveyObservation(t)
	second.Viewport.PageHeight = 2160
	second.Marks = stepMarks(true)
	step = stepOK(t, a, id, second)
	messages := model.requests[1].Messages
	text := messages[len(messages)-1].Text
	for _, want := range []string{
		`the page still reports these required fields empty: "Veteran status", "Gender".`,
		`the applicant will do "Please enter a unique identifier" after`,
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %q in:\n%s", want, text)
		}
	}
	if step.Status != StatusNeedPerson || step.Stop == nil || step.Stop.Reason != StopIdentity {
		t.Fatalf("with the fields filled and only the applicant's left, the stop must stand: %+v", step)
	}
	if screen.fieldRequests != 2 {
		t.Fatalf("the screen was asked about the empty fields %d times, want 2", screen.fieldRequests)
	}
	if !strings.Contains(screen.requests[0].State[0].Text, "unique identifier that is not in your profile") {
		t.Fatalf("the screen was not told why the model stops: %q", screen.requests[0].State[0].Text)
	}
}

func TestAPassThatFilledNoneOfTheNamedFieldsIsTheLastAndAnotherPageStartsAfresh(t *testing.T) {
	screen := &fakeScreen{personFields: []string{"Please enter a unique identifier"}}
	a := newAgentWithScreen(t, &scriptedModel{}, &fixedDecider{}, screen, DefaultConfig())
	s, _ := a.sessions.get(startFast(t, a, true))
	ctx := context.Background()
	obs := surveyObservation(t)
	obs.Marks = stepMarks(false)
	if _, held, calls := a.holdStop(ctx, s, StatusNeedPerson, idReply, obs); !held || len(calls) != 1 {
		t.Fatalf("the first stop with fields to fill was not sent back: held %v, %d calls", held, len(calls))
	}
	// A pass that filled one of the two is progress; one that filled nothing is the last.
	some := stepMarks(false)
	filled := false
	some[2].Empty = &filled
	obs.Marks = some
	if note, held, _ := a.holdStop(ctx, s, StatusNeedPerson, idReply, obs); !held || !strings.Contains(note, `empty: "Veteran status".`) {
		t.Fatalf("a stop after a pass that filled some was not sent back for the rest: held %v, %q", held, note)
	}
	if _, held, _ := a.holdStop(ctx, s, StatusNeedPerson, idReply, obs); held {
		t.Fatal("a stop after a pass that filled nothing was sent back again")
	}
	other := obs
	other.URL = "https://jobs.example/apply/next"
	if _, held, _ := a.holdStop(ctx, s, StatusNeedPerson, idReply, other); !held {
		t.Fatal("on another page the fields are new, so the stop must go back")
	}
}

func TestAStopWithOnlyTheApplicantsFieldEmptyIsNotHeldForFields(t *testing.T) {
	screen := &fakeScreen{personFields: []string{"Please enter a unique identifier"}}
	a := newAgentWithScreen(t, &scriptedModel{}, &fixedDecider{}, screen, DefaultConfig())
	s, _ := a.sessions.get(startFast(t, a, true))
	obs := surveyObservation(t)
	obs.Marks = stepMarks(true)
	note, held, calls := a.holdStop(context.Background(), s, StatusNeedPerson, idReply, obs)
	if !held || len(calls) != 1 || strings.Contains(note, "reports these required fields empty") {
		t.Fatalf("the first stop must go back once as before, not for the fields: held %v, %d calls, %q", held, len(calls), note)
	}
	if names := unfilledFields(stepMarks(false)); strings.Join(names, "|") != "Veteran status|Gender|Please enter a unique identifier" {
		t.Fatalf("the page's empty required fields, named once each: %q", names)
	}
	unnamed := stepMarks(false)
	unnamed[0].Question, unnamed[1].Question = "", ""
	if names := unfilledFields(unnamed); names[0] != `the choice between "Veteran", "Not a veteran"` {
		t.Fatalf("a group without a question is named by its choices: %q", names)
	}
}

// captchaStop is the model stopping for a human check, in the words a recorded run used for a badge.
func captchaStop() string {
	return ending("need_person", "Please complete the human check and submit the application.",
		map[string]any{"reason": "captcha", "problem": "The application requires a human check before it can be submitted.", "action": "Complete the check on the page, then submit the application."})
}

// humanCheckRequests is how many times the screen was asked whether a human check is in view, and the
// last such request.
func humanCheckRequests(screen *fakeScreen) (int, decide.Request) {
	screen.mu.Lock()
	defer screen.mu.Unlock()
	n, last := 0, decide.Request{}
	for _, req := range screen.requests {
		if _, asked := req.Questions[askHumanCheck]; asked {
			n, last = n+1, req
		}
	}
	return n, last
}

func TestACaptchaStopTheScreenDoesNotShowIsSentBackToPressTheSendButton(t *testing.T) {
	badge := 0.08
	screen := &fakeScreen{humanCheck: &badge}
	model := &scriptedModel{replies: []string{captchaStop(), captchaStop()}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	step := stepOK(t, a, id, observation(shot(t, 40)))
	if step.Status != StatusWorking || step.Message != stopPassMessage || len(step.Actions) != 1 || step.Actions[0].Kind != KindWait {
		t.Fatalf("a captcha stop with no check on screen goes back once: %+v", step)
	}
	obs := observation(shot(t, 90))
	obs.Results = resultsOf(step)
	step = stepOK(t, a, id, obs)
	if step.Status != StatusNeedPerson || step.Stop == nil || step.Stop.Reason != StopCaptcha {
		t.Fatalf("the next captcha stop stands, so the run cannot go round for ever: %+v", step)
	}
	text := lastText(model)
	for _, want := range []string{"only 8% sure", "not a check", "press the button that sends the application", "Stop with need_person for the check only when"} {
		if !strings.Contains(text, want) {
			t.Fatalf("the model was not told %q:\n%s", want, text)
		}
	}
	if asked, _ := humanCheckRequests(screen); asked != 1 {
		t.Fatalf("the screen is asked about a human check once a run, not %d times", asked)
	}
}

func TestACaptchaStopTheScreenShowsIsHeldOnlyToFinishThePage(t *testing.T) {
	box := 0.96
	screen := &fakeScreen{humanCheck: &box}
	model := &scriptedModel{replies: []string{captchaStop(), captchaStop()}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, DefaultConfig())
	id := start(t, a)
	step := stepOK(t, a, id, observation(shot(t, 40)))
	if step.Status != StatusWorking {
		t.Fatalf("the first stop of a run goes back to finish the page: %+v", step)
	}
	obs := observation(shot(t, 90))
	obs.Results = resultsOf(step)
	if step = stepOK(t, a, id, obs); step.Status != StatusNeedPerson {
		t.Fatalf("a check the screen shows stands on the next stop: %+v", step)
	}
	text := lastText(model)
	if !strings.Contains(text, "the applicant is asked last") || strings.Contains(text, "press the button that sends the application") {
		t.Fatalf("a check the screen shows is held only to finish the page:\n%s", text)
	}
}

func TestTheHumanCheckIsReadFromEveryScreenOfASurvey(t *testing.T) {
	badge := 0.1
	screen := &fakeScreen{humanCheck: &badge}
	a := newAgentWithScreen(t, &scriptedModel{replies: []string{captchaStop()}}, &fixedDecider{}, screen, DefaultConfig())
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{Survey: true})
	if err != nil {
		t.Fatal(err)
	}
	obs := observation(shot(t, 40))
	obs.Survey = []SurveyScreen{{Screenshot: shot(t, 50)}, {Screenshot: shot(t, 60), ScrollY: 800}}
	if step := stepOK(t, a, started.SessionID, obs); step.Status != StatusWorking {
		t.Fatalf("%+v", step)
	}
	asked, req := humanCheckRequests(screen)
	if asked != 1 {
		t.Fatalf("asked %d times", asked)
	}
	images := 0
	for _, part := range req.State {
		if part.ImageURL != nil {
			images++
		}
	}
	if images != 2 {
		t.Fatalf("the checker sees every screen of the survey, not %d images", images)
	}
}

func TestACaptchaStopIsTakenAtItsWordWhenTheCheckIsOff(t *testing.T) {
	badge := 0.05
	screen := &fakeScreen{humanCheck: &badge}
	cfg := DefaultConfig()
	cfg.CaptchaConfirm = 0
	model := &scriptedModel{replies: []string{captchaStop(), captchaStop()}}
	a := newAgentWithScreen(t, model, &fixedDecider{}, screen, cfg)
	id := start(t, a)
	step := stepOK(t, a, id, observation(shot(t, 40)))
	obs := observation(shot(t, 90))
	obs.Results = resultsOf(step)
	if step = stepOK(t, a, id, obs); step.Status != StatusNeedPerson {
		t.Fatalf("%+v", step)
	}
	if asked, _ := humanCheckRequests(screen); asked != 0 {
		t.Fatalf("the screen was asked %d times with the check off", asked)
	}
}
