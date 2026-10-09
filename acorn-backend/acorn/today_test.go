package acorn

import (
	"context"
	"testing"
)

// scriptedClassifier answers each classification by its instructions.
type scriptedClassifier struct {
	answers map[string]map[int]string
}

func (s *scriptedClassifier) ClassifyEach(_ context.Context, instructions string, _ map[string]string, items map[int]string) (map[int]string, error) {
	out := map[int]string{}
	for index := range items {
		if kind, ok := s.answers[instructions][index]; ok {
			out[index] = kind
		}
	}
	return out, nil
}

func (s *scriptedClassifier) PickOne(_ context.Context, _ string, items map[int]string) (int, error) {
	for index := range items {
		return index, nil
	}
	return 0, nil
}

func actionsByIndex(t *testing.T, plan Plan) map[int]map[string]any {
	t.Helper()
	out := map[int]map[string]any{}
	for _, row := range plan["actions"].([]any) {
		action := row.(map[string]any)
		out[int(action["element_index"].(float64))] = action
	}
	return out
}

// Today's date goes in each field in the format that field wants, the applicant's
// local date from the page; a native date input takes year-month-day.
func TestFastPlanWritesTodayInEachFieldsFormat(t *testing.T) {
	signed := FormField{ElementIndex: 1, Kind: fieldText, Label: "Date signed", Placeholder: "MM/DD/YYYY"}
	native := FormField{ElementIndex: 2, Kind: fieldText, Label: "Today's date", InputType: "date"}
	classifier := &scriptedClassifier{answers: map[string]map[int]string{
		textFieldInstructions:  {1: FactToday, 2: FactToday},
		dateFormatInstructions: {1: "month_day_year_slash"},
	}}
	service := New(&fakeModel{}).WithClassifier(classifier).WithPicker(noChoices{})
	result, err := service.FastPlan(context.Background(), "", []FormField{signed, native}, map[string]any{pageTodayKey: "2026-10-09"})
	if err != nil {
		t.Fatal(err)
	}
	actions := actionsByIndex(t, result.Plan)
	if actions[1]["value"] != "10/09/2026" || actions[2]["value"] != "2026-10-09" {
		t.Fatalf("values = %v / %v, want 10/09/2026 and 2026-10-09", actions[1]["value"], actions[2]["value"])
	}
}

// A cover-letter field gets the cover letter, in the one format the field takes.
func TestFastPlanUploadsTheCoverLetterInItsFormat(t *testing.T) {
	letter := FormField{ElementIndex: 7, Kind: fieldFile, Label: "Cover letter (PDF only)"}
	classifier := &scriptedClassifier{answers: map[string]map[int]string{
		fileFieldInstructions:    {7: fileCoverLetter},
		uploadFormatInstructions: {7: uploadFormatPDF},
	}}
	service := New(&fakeModel{}).WithClassifier(classifier).WithPicker(noChoices{})
	result, err := service.FastPlan(context.Background(), "", []FormField{letter}, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	action := actionsByIndex(t, result.Plan)[7]
	if action["action"] != "upload" || action["file"] != fileKeyCoverLetter || action["value"] != uploadFormatPDF {
		t.Fatalf("action = %v, want an upload of the cover letter as PDF", action)
	}
}
