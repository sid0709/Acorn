package acorn

import (
	"context"
	"testing"
)

// The résumé field, a required document the applicant has to produce, and an optional extra.
var (
	mainResume   = FormField{ElementIndex: 1, Kind: fieldFile, Label: "Resume/CV"}
	assessment   = FormField{ElementIndex: 2, Kind: fieldFile, Label: "Please upload your completed Self-Assessment here", Required: true}
	optionalMore = FormField{ElementIndex: 3, Kind: fieldFile, Label: "If true, please provide additional details via document upload."}
)

func planUploads(t *testing.T, answers map[string]map[int]string, fields ...FormField) map[int]map[string]any {
	t.Helper()
	service := New(&fakeModel{}).WithClassifier(&scriptedClassifier{answers: answers}).WithPicker(noChoices{})
	result, err := service.FastPlan(context.Background(), "", fields, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	return actionsByIndex(t, result.Plan)
}

// A required upload that is neither the résumé nor a cover letter gets the document
// the decision model picks; here it picks the résumé.
func TestFastPlanUploadsTheDecidedDocumentToAnOtherRequiredField(t *testing.T) {
	actions := planUploads(t, map[string]map[int]string{
		fileFieldInstructions: {1: fileResume, 2: fileOther},
		documentInstructions:  {2: documentResume},
	}, mainResume, assessment)
	if got := actions[2]; got["action"] != "resume_upload" || got["file"] != fileKeyResume {
		t.Fatalf("action = %v, want the résumé uploaded to the assessment field", got)
	}
}

// A required upload that asks for a specific document the applicant does not have is
// not given the wrong one: no step, and the plan names it so the run asks the person.
func TestFastPlanAsksForARequiredDocumentTheApplicantDoesNotHave(t *testing.T) {
	service := New(&fakeModel{}).WithClassifier(&scriptedClassifier{answers: map[string]map[int]string{
		fileFieldInstructions: {1: fileResume, 2: fileOther},
		documentInstructions:  {2: documentMissing},
	}}).WithPicker(noChoices{})
	result, err := service.FastPlan(context.Background(), "", []FormField{mainResume, assessment}, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if got, has := actionsByIndex(t, result.Plan)[2]; has {
		t.Fatalf("a document the applicant lacks must not be filled, got %v", got)
	}
	rows, _ := result.Plan["unanswerable"].([]any)
	if len(rows) != 1 {
		t.Fatalf("unanswerable = %v, want the assessment field", result.Plan["unanswerable"])
	}
	row := rows[0].(map[string]any)
	if row["element_index"] != float64(2) || row["reason"] != documentNotHeld {
		t.Fatalf("unanswerable row = %v", row)
	}
}

// A decision that cannot be made still leaves a required upload with the résumé (a guess
// is better than a blocked run), and an optional one alone.
func TestFastPlanFallsBackWhenTheDocumentCannotBeDecided(t *testing.T) {
	actions := planUploads(t, map[string]map[int]string{
		fileFieldInstructions: {1: fileResume, 2: fileOther, 3: fileOther},
	}, mainResume, assessment, optionalMore)
	if got := actions[2]; got["action"] != "resume_upload" {
		t.Fatalf("required upload = %v, want the résumé", got)
	}
	if _, has := actions[3]; has {
		t.Fatalf("an optional upload with no decision must be left alone, got %v", actions[3])
	}
}

func TestFastPlanLeavesAnOptionalUploadNothingFits(t *testing.T) {
	actions := planUploads(t, map[string]map[int]string{
		fileFieldInstructions: {1: fileResume, 3: fileOther},
		documentInstructions:  {3: documentMissing},
	}, mainResume, optionalMore)
	if _, has := actions[3]; has {
		t.Fatalf("an optional upload for a document the applicant lacks must get no step, got %v", actions[3])
	}
}

func TestFastPlanUploadsTheCoverLetterWhenTheDecisionSaysSo(t *testing.T) {
	statement := FormField{ElementIndex: 4, Kind: fieldFile, Label: "Personal statement"}
	actions := planUploads(t, map[string]map[int]string{
		fileFieldInstructions: {1: fileResume, 4: fileOther},
		documentInstructions:  {4: documentCoverLetter},
	}, mainResume, statement)
	if got := actions[4]; got["action"] != "upload" || got["file"] != fileKeyCoverLetter {
		t.Fatalf("action = %v, want the cover letter", got)
	}
}

// A required field the cover letter was decided for names the résumé to give when the
// Library has no letter; an optional one names nothing and is left to the page.
func TestFastPlanNamesTheResumeAsTheFallbackOfARequiredCoverLetterField(t *testing.T) {
	required := FormField{ElementIndex: 5, Kind: fieldFile, Label: "Cover letter", Required: true}
	optional := FormField{ElementIndex: 6, Kind: fieldFile, Label: "Cover letter (optional)"}
	actions := planUploads(t, map[string]map[int]string{
		fileFieldInstructions: {1: fileResume, 5: fileCoverLetter, 6: fileCoverLetter},
	}, mainResume, required, optional)
	if got := actions[5]["fallback_file"]; got != fileKeyResume {
		t.Fatalf("required fallback_file = %v, want the résumé", got)
	}
	if got, has := actions[6]["fallback_file"]; has {
		t.Fatalf("optional fallback_file = %v, want none", got)
	}
}

// A text field whose question the page never gave is not answered (what a writer put
// in it would be invented); a required one is named so the run can say so.
func TestFastPlanLeavesAFieldWithoutAQuestionUnanswered(t *testing.T) {
	named := FormField{ElementIndex: 7, Kind: fieldTextarea, Label: "cards[x][field9]", Name: "cards[x][field9]", Required: true}
	marked := FormField{ElementIndex: 8, Kind: fieldTextarea, Label: "✱", Required: false}
	asked := FormField{ElementIndex: 9, Kind: fieldText, Label: "Desired Compensation Range", Required: true}
	service := New(&fakeModel{}).WithClassifier(&scriptedClassifier{answers: map[string]map[int]string{
		textFieldInstructions: {9: FactSkip},
	}}).WithPicker(noChoices{})
	result, err := service.FastPlan(context.Background(), "", []FormField{named, marked, asked}, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	actions := actionsByIndex(t, result.Plan)
	for _, index := range []int{7, 8} {
		if _, has := actions[index]; has {
			t.Fatalf("field %d has no question and must get no step, got %v", index, actions[index])
		}
	}
	rows, _ := result.Plan["unanswerable"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["element_index"] != float64(7) {
		t.Fatalf("unanswerable = %v, want only the required field 7", result.Plan["unanswerable"])
	}
}
