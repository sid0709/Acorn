package selector

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"

	"github.com/sid0709/OpenSeat/backend-core/jev"
)

// scriptedDecider answers each question by key from a fixed table and keeps the request.
type scriptedDecider struct {
	answers map[string]jev.Answer
	last    jev.Request
}

func (s *scriptedDecider) Decide(_ context.Context, req jev.Request) (jev.Response, error) {
	s.last = req
	return jev.Response{Answers: s.answers}, nil
}

func (s *scriptedDecider) Model() string { return "scripted" }

func yes(p float64) *float64 { return &p }

var formControls = []Control{
	{ID: 10, Tag: "button", Text: "Back"},
	{ID: 11, Tag: "button", Text: "Save and continue", InForm: true},
}

func TestReadPagePicksTheForwardControl(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindForm, Confidence: 0.9},
		controlQuestion:  {Choice: "control_1", Confidence: 0.8, Probabilities: map[string]float64{"control_0": 0.1, "control_1": 0.8}},
		finalQuestion:    {Noul: yes(0.2)},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Your details", Intent: IntentAdvance, Controls: formControls})
	if err != nil {
		t.Fatal(err)
	}
	if read.Kind != KindForm || read.Control == nil || read.Control.ID != 11 || read.Control.Role != RoleNext {
		t.Fatalf("read = %+v control = %+v, want a form with control 11 as next", read, read.Control)
	}
	if got := len(decider.last.Questions[controlQuestion].Criteria); got != len(formControls)+1 {
		t.Fatalf("control criteria = %d, want controls plus none", got)
	}
	if !strings.Contains(decider.last.State, "Save and continue") {
		t.Fatalf("state does not list the controls:\n%s", decider.last.State)
	}
}

func TestReadPageSubmitOnTheLastStep(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindForm},
		controlQuestion:  {Choice: "control_1"},
		finalQuestion:    {Noul: yes(0.95)},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Review", Intent: IntentAdvance, Controls: formControls})
	if err != nil || read.Control == nil || read.Control.Role != RoleSubmit {
		t.Fatalf("read = %+v err = %v, want submit", read, err)
	}
}

func TestReadPageApplyOnAPosting(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindPosting},
		controlQuestion:  {Choice: "control_0"},
		finalQuestion:    {Noul: yes(0.9)},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Senior Go Engineer", Intent: IntentStart, Controls: formControls})
	if err != nil || read.Control == nil || read.Control.Role != RoleApply || read.Control.ID != 10 {
		t.Fatalf("read = %+v err = %v, want apply on control 10", read, err)
	}
}

func TestReadPageNoControl(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindConfirmation},
		controlQuestion:  {Choice: noControlKey},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Thank you", Controls: formControls})
	if err != nil || read.Kind != KindConfirmation || read.Control != nil {
		t.Fatalf("read = %+v err = %v, want a confirmation with no control", read, err)
	}
}

func TestReadPageUnknownKindIsOther(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{pageKindQuestion: {Choice: "mystery"}}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "x"})
	if err != nil || read.Kind != KindOther {
		t.Fatalf("read = %+v err = %v, want other", read, err)
	}
}

func TestReadPageRejectsAnEmptyPage(t *testing.T) {
	if _, err := New(&scriptedDecider{}).ReadPage(context.Background(), PageQuery{}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
}

func TestDiagnoseNamesAReason(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		diagnoseQuestion: {Choice: FailBotCheck, Confidence: 0.7},
	}}
	failure, err := New(decider).Diagnose(context.Background(), FailureQuery{Stage: "advance", Evidence: []string{"Please verify you are human"}})
	if err != nil || failure.Reason != FailBotCheck {
		t.Fatalf("failure = %+v err = %v, want bot_check", failure, err)
	}
	if !strings.Contains(decider.last.State, "verify you are human") {
		t.Fatalf("state is missing the evidence:\n%s", decider.last.State)
	}
}

func TestDiagnoseUnknownReasonIsOther(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{diagnoseQuestion: {Choice: "??"}}}
	failure, err := New(decider).Diagnose(context.Background(), FailureQuery{Evidence: []string{"x"}})
	if err != nil || failure.Reason != FailOther {
		t.Fatalf("failure = %+v err = %v, want other", failure, err)
	}
}

func TestReadPageFallsBackToTheMostProbableControl(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindForm},
		controlQuestion: {Choice: noControlKey, Probabilities: map[string]float64{
			noControlKey: 0.7, "control_0": 0.05, "control_1": 0.25,
		}},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Your details", Intent: IntentAdvance, Controls: formControls})
	if err != nil || read.Control != nil || read.Fallback == nil || read.Fallback.ID != 11 {
		t.Fatalf("read = %+v err = %v, want no pick and a fallback on control 11", read, err)
	}
}

func TestReadPageNoFallbackOffAForm(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindPosting},
		controlQuestion:  {Choice: noControlKey, Probabilities: map[string]float64{"control_1": 0.2}},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Senior Go Engineer", Intent: IntentAdvance, Controls: formControls})
	if err != nil || read.Fallback != nil {
		t.Fatalf("read = %+v err = %v, want no fallback on a posting", read, err)
	}
}

func TestReadPageAccountStepOffersAGuestPath(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindAccount},
		controlQuestion:  {Choice: "control_1"},
		finalQuestion:    {Noul: yes(0.9)},
		guestQuestion:    {Noul: yes(0.95)},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Already have an account?", Intent: IntentStart, Controls: formControls})
	if err != nil || read.Kind != KindAccount || !read.Guest || read.Control == nil || read.Control.Role != RoleNext {
		t.Fatalf("read = %+v control = %+v err = %v, want a guest account step moving on with next", read, read.Control, err)
	}
}

func TestReadPageAccountStepFallsBack(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindAccount},
		controlQuestion:  {Choice: noControlKey, Probabilities: map[string]float64{"control_1": 0.3}},
		guestQuestion:    {Noul: yes(0.1)},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Sign in", Intent: IntentStart, Controls: formControls})
	if err != nil || read.Guest || read.Fallback == nil || read.Fallback.ID != 11 {
		t.Fatalf("read = %+v err = %v, want no guest path and a fallback", read, err)
	}
}

// The decision reads what a control does; no instruction quotes a control's wording,
// since every site words its controls its own way.
func TestControlInstructionsQuoteNoWording(t *testing.T) {
	quoted := regexp.MustCompile(`"[^"]+"|\([A-Z][a-z]+(, [A-Z][a-z]+)+`)
	for _, intent := range []string{IntentStart, IntentAdvance} {
		if found := quoted.FindString(controlInstructions(intent)); found != "" {
			t.Errorf("%s instructions quote wording %q", intent, found)
		}
	}
}
