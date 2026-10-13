package selector

import (
	"context"
	"regexp"
	"testing"

	"github.com/sid0709/OpenSeat/backend-core/jev"
)

var requirementControls = []Control{
	{ID: 20, Tag: "button", Text: "Take assessment", InForm: true},
	{ID: 21, Tag: "button", Text: "Submit", InForm: true},
}

func TestReadPageNamesTheOutstandingRequirementAheadOfSubmit(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion:    {Choice: KindForm},
		controlQuestion:     {Choice: "control_1"},
		finalQuestion:       {Noul: yes(0.9)},
		requirementQuestion: {Choice: "control_0", Confidence: 0.8},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{
		Text: "This info is required", Intent: IntentAdvance, Controls: requirementControls,
		PageMessages: []string{"This info is required. (1 issue)"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if read.Requirement == nil || read.Requirement.ID != 20 || read.Requirement.Role != RoleResolve {
		t.Fatalf("requirement = %+v, want control 20 to resolve", read.Requirement)
	}
	if read.Control == nil || read.Control.ID != 21 {
		t.Fatalf("control = %+v, want the forward control kept", read.Control)
	}
}

func TestReadPageNoRequirementWhenItIsTheForwardControl(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion:    {Choice: KindForm},
		controlQuestion:     {Choice: "control_1"},
		requirementQuestion: {Choice: "control_1", Confidence: 0.9},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Review", Intent: IntentAdvance, Controls: requirementControls})
	if err != nil || read.Requirement != nil {
		t.Fatalf("requirement = %+v err = %v, want none", read.Requirement, err)
	}
}

func TestReadPageAsksForARequirementOnlyWhenAdvancing(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{pageKindQuestion: {Choice: KindPosting}}}
	if _, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Job", Intent: IntentStart, Controls: requirementControls}); err != nil {
		t.Fatal(err)
	}
	if _, asked := decider.last.Questions[requirementQuestion]; asked {
		t.Fatal("a first look asked for an outstanding requirement")
	}
}

func TestRequirementInstructionsQuoteNoWording(t *testing.T) {
	if quoted := regexp.MustCompile(`"[^"]+"`).FindString(requirementInstructions + noRequirement); quoted != "" {
		t.Fatalf("instructions quote site wording %s", quoted)
	}
}

func TestReadPageIgnoresAnUnsureRequirement(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion:    {Choice: KindForm},
		controlQuestion:     {Choice: "control_1"},
		requirementQuestion: {Choice: "control_0", Confidence: minRequirementConfidence / 2},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Review", Intent: IntentAdvance, Controls: requirementControls})
	if err != nil || read.Requirement != nil {
		t.Fatalf("requirement = %+v err = %v, want none for an unsure pick", read.Requirement, err)
	}
}

func TestLastClickOnARequirementIsNotTheWayForward(t *testing.T) {
	if got := lastClickRole(RoleResolve); got == lastClickRole(RoleNext) {
		t.Fatalf("a requirement click reads as the forward control: %q", got)
	}
}
