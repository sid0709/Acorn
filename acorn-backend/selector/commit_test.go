package selector

import (
	"context"
	"regexp"
	"strings"
	"testing"

	"github.com/sid0709/OpenSeat/backend-core/jev"
)

// entryControls is a form with an entry form open inside it: its own cancel and
// save, and the application's submit.
var entryControls = []Control{
	{ID: 40, Tag: "button", Text: "Cancel", InForm: true},
	{ID: 41, Tag: "button", Text: "Add Education", InForm: true},
	{ID: 42, Tag: "button", Text: "Submit", InForm: true},
}

func TestReadPageNamesTheControlThatSavesTheOpenedForm(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindForm},
		controlQuestion:  {Choice: "control_2"},
		commitQuestion:   {Choice: "control_1", Confidence: 0.9},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{
		Text: "Education", Intent: IntentAdvance, Controls: entryControls, Scope: []int{40, 41}, ScopeTitle: "Education",
	})
	if err != nil {
		t.Fatal(err)
	}
	if read.Commit == nil || read.Commit.ID != 41 || read.Commit.Role != RoleCommit {
		t.Fatalf("commit = %+v, want control 41 to save the opened form", read.Commit)
	}
	criteria := decider.last.Questions[commitQuestion].Criteria
	if len(criteria) != 3 {
		t.Fatalf("commit criteria = %v, want the opened form's two controls and none", criteria)
	}
	if !strings.Contains(decider.last.State, "in the form the run opened") {
		t.Fatalf("state does not mark the opened form's controls:\n%s", decider.last.State)
	}
}

func TestReadPageNeverSavesWithAControlOutsideTheOpenedForm(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindForm},
		commitQuestion:   {Choice: "control_2", Confidence: 0.95},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{
		Text: "Education", Intent: IntentAdvance, Controls: entryControls, Scope: []int{40, 41},
	})
	if err != nil || read.Commit != nil {
		t.Fatalf("commit = %+v err = %v, want none for a control outside the form", read.Commit, err)
	}
}

func TestReadPageIgnoresAnUnsureSave(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		pageKindQuestion: {Choice: KindForm},
		commitQuestion:   {Choice: "control_1", Confidence: minCommitConfidence / 2},
	}}
	read, err := New(decider).ReadPage(context.Background(), PageQuery{
		Text: "Education", Intent: IntentAdvance, Controls: entryControls, Scope: []int{40, 41},
	})
	if err != nil || read.Commit != nil {
		t.Fatalf("commit = %+v err = %v, want none for an unsure pick", read.Commit, err)
	}
}

func TestReadPageAsksToSaveOnlyWithAnOpenedForm(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{pageKindQuestion: {Choice: KindForm}}}
	if _, err := New(decider).ReadPage(context.Background(), PageQuery{Text: "Education", Intent: IntentAdvance, Controls: entryControls}); err != nil {
		t.Fatal(err)
	}
	if _, asked := decider.last.Questions[commitQuestion]; asked {
		t.Fatal("a read with no opened form asked which control saves it")
	}
}

func TestCommitInstructionsQuoteNoWording(t *testing.T) {
	if quoted := regexp.MustCompile(`"[^"]+"`).FindString(commitInstructions + noCommit); quoted != "" {
		t.Fatalf("instructions quote site wording %s", quoted)
	}
}
