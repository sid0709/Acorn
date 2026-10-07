package acorn

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// fakeClassifier labels every file field with fileKind and answers PickOne with pick.
type fakeClassifier struct {
	fileKind   string
	pick       int
	pickErr    error
	candidates map[int]string
}

func (f *fakeClassifier) ClassifyEach(_ context.Context, instructions string, _ map[string]string, items map[int]string) (map[int]string, error) {
	out := map[int]string{}
	if instructions != fileFieldInstructions {
		return out, nil
	}
	for id := range items {
		out[id] = f.fileKind
	}
	return out, nil
}

func (f *fakeClassifier) PickOne(_ context.Context, _ string, items map[int]string) (int, error) {
	f.candidates = items
	return f.pick, f.pickErr
}

type noChoices struct{}

func (noChoices) PickChoices(context.Context, string, []ChoiceQuestion) (map[int][]string, error) {
	return map[int][]string{}, nil
}

// autofillZone and resumeField are the two uploads an Ashby-style form shows: a
// parse-to-prefill drop zone above the form and the résumé field inside it.
var (
	autofillZone = FormField{ElementIndex: 25, Kind: fieldFile, Label: "Drop your resume here! — Autofill from resume — Upload file"}
	resumeField  = FormField{ElementIndex: 39, Kind: fieldFile, Label: "Resume — Upload File", Required: true}
)

func resumeUploads(t *testing.T, plan Plan) []int {
	t.Helper()
	var indexes []int
	for _, row := range plan["actions"].([]any) {
		action := row.(map[string]any)
		if action["action"] == "resume_upload" {
			indexes = append(indexes, int(action["element_index"].(float64)))
		}
	}
	return indexes
}

func fastPlan(t *testing.T, classifier *fakeClassifier, fields ...FormField) Plan {
	t.Helper()
	service := New(&fakeModel{}).WithClassifier(classifier).WithPicker(noChoices{})
	result, err := service.FastPlan(context.Background(), "", fields, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	return result.Plan
}

func TestFastPlanUploadsOnlyThePickedResumeField(t *testing.T) {
	classifier := &fakeClassifier{fileKind: fileResume, pick: resumeField.ElementIndex}
	plan := fastPlan(t, classifier, autofillZone, resumeField)

	if got := resumeUploads(t, plan); len(got) != 1 || got[0] != resumeField.ElementIndex {
		t.Fatalf("résumé uploads = %v, want only %d", got, resumeField.ElementIndex)
	}
	if len(classifier.candidates) != 2 {
		t.Fatalf("PickOne compared %d fields, want both uploads", len(classifier.candidates))
	}
}

func TestFastPlanAsksNothingForOneResumeField(t *testing.T) {
	classifier := &fakeClassifier{fileKind: fileResume}
	plan := fastPlan(t, classifier, resumeField)

	if got := resumeUploads(t, plan); len(got) != 1 || got[0] != resumeField.ElementIndex {
		t.Fatalf("résumé uploads = %v, want %d", got, resumeField.ElementIndex)
	}
	if classifier.candidates != nil {
		t.Fatal("PickOne asked with a single résumé field")
	}
}

func TestFastPlanKeepsClassificationWhenPickFails(t *testing.T) {
	classifier := &fakeClassifier{fileKind: fileResume, pickErr: errors.New("jev down")}
	plan := fastPlan(t, classifier, autofillZone, resumeField)

	if got := resumeUploads(t, plan); len(got) != 2 {
		t.Fatalf("résumé uploads = %v, want both classified résumé fields", got)
	}
}

// recordingPicker keeps the choice questions it was asked.
type recordingPicker struct{ asked []ChoiceQuestion }

func (r *recordingPicker) PickChoices(_ context.Context, _ string, questions []ChoiceQuestion) (map[int][]string, error) {
	r.asked = questions
	return map[int][]string{}, nil
}

func TestFastPlanTellsThePickerAChoiceIsRequired(t *testing.T) {
	picker := &recordingPicker{}
	consent := FormField{ElementIndex: 7, Kind: fieldToggle, Label: "I consent to processing my survey responses", Required: true}
	optional := FormField{ElementIndex: 8, Kind: fieldToggle, Label: "Send me job alerts"}
	service := New(&fakeModel{}).WithClassifier(&fakeClassifier{}).WithPicker(picker)
	if _, err := service.FastPlan(context.Background(), "", []FormField{consent, optional}, map[string]any{}); err != nil {
		t.Fatal(err)
	}
	if len(picker.asked) != 2 {
		t.Fatalf("asked %d choice questions, want 2", len(picker.asked))
	}
	if !strings.HasSuffix(picker.asked[0].Field, requiredNote) {
		t.Fatalf("required field read %q, want the required note", picker.asked[0].Field)
	}
	if strings.Contains(picker.asked[1].Field, requiredNote) {
		t.Fatalf("optional field read %q, want no required note", picker.asked[1].Field)
	}
}
