package agent

import (
	"strings"
	"testing"
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
