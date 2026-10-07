package acorn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
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

func TestWriteFieldsCarryTheFieldsLimits(t *testing.T) {
	fields := writeFields([]FormField{{
		ElementIndex: 7, Kind: fieldTextarea, Label: "Why do you want to work here?",
		MaxLength: 500, Notes: []string{"0/300"},
	}})
	if len(fields) != 1 {
		t.Fatalf("got %d fields, want 1", len(fields))
	}
	prompt := proseUserPrompt("{}", fields, nil)
	for _, want := range []string{"max 500 characters", "text under the field: 0/300"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("writer prompt lacks %q:\n%s", want, prompt)
		}
	}
}

// barrierWriter answers each writer call only once `want` calls are in flight
// together, so it fails (times out) unless the calls run in parallel.
type barrierWriter struct {
	want    int
	mu      sync.Mutex
	arrived int
	release chan struct{}
	users   []string
}

func (b *barrierWriter) JSON(ctx context.Context, _, user string, _ json.RawMessage) ([]byte, error) {
	b.mu.Lock()
	b.arrived++
	b.users = append(b.users, user)
	if b.arrived == b.want {
		close(b.release)
	}
	b.mu.Unlock()
	select {
	case <-b.release:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	index := strings.TrimSpace(strings.SplitN(strings.SplitN(user, "element_index: ", 2)[1], "\n", 2)[0])
	return []byte(`{"answers":[{"element_index":` + index + `,"value":"answer ` + index + `"}]}`), nil
}
func (b *barrierWriter) Model() string { return "barrier" }
func (b *barrierWriter) Ready() bool   { return true }

func TestWriteAnswersWritesEachFieldInParallel(t *testing.T) {
	writer := &barrierWriter{want: 3, release: make(chan struct{})}
	fields := []typingField{
		{ElementIndex: 1, Question: "Why us?", Role: "textarea"},
		{ElementIndex: 2, Question: "Your AWS experience", Role: "textbox"},
		{ElementIndex: 3, Question: "Your Redshift experience", Role: "textbox"},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	answers, err := New(writer).writeAnswers(ctx, "{}", nil, fields)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range fields {
		if got := answers[field.ElementIndex]; got != fmt.Sprintf("answer %d", field.ElementIndex) {
			t.Errorf("answer %d = %q", field.ElementIndex, got)
		}
	}
	for _, user := range writer.users {
		if !strings.Contains(user, "answered separately") {
			t.Errorf("a writer call does not list the other questions:\n%s", user)
		}
	}
}

// writeClassifier says every text field needs a written answer.
type writeClassifier struct{ fakeClassifier }

func (w *writeClassifier) ClassifyEach(ctx context.Context, instructions string, kinds map[string]string, items map[int]string) (map[int]string, error) {
	if instructions != textFieldInstructions {
		return w.fakeClassifier.ClassifyEach(ctx, instructions, kinds, items)
	}
	out := map[int]string{}
	for id := range items {
		out[id] = FactWrite
	}
	return out, nil
}

// writerFirstPicker holds the choice decision until the writer has been called.
type writerFirstPicker struct{ writing <-chan struct{} }

func (p writerFirstPicker) PickChoices(ctx context.Context, _ string, _ []ChoiceQuestion) (map[int][]string, error) {
	select {
	case <-p.writing:
		return map[int][]string{}, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// signalWriter answers like the writer and closes `called` on its first call.
type signalWriter struct {
	once   sync.Once
	called chan struct{}
}

func (w *signalWriter) JSON(_ context.Context, _, _ string, _ json.RawMessage) ([]byte, error) {
	w.once.Do(func() { close(w.called) })
	return []byte(`{"answers":[{"element_index":5,"value":"Five years on AWS."}]}`), nil
}
func (w *signalWriter) Model() string { return "signal" }
func (w *signalWriter) Ready() bool   { return true }

func TestFastPlanWritesTextWhileChoicesAreStillDeciding(t *testing.T) {
	writer := &signalWriter{called: make(chan struct{})}
	service := New(writer).WithClassifier(&writeClassifier{}).WithPicker(writerFirstPicker{writing: writer.called})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	result, err := service.FastPlan(ctx, "{}", []FormField{
		{ElementIndex: 5, Kind: fieldText, Label: "What is your experience with AWS?", Required: true},
		{ElementIndex: 9, Kind: fieldRadio, Label: "Eligible to work?", Options: []string{"Yes", "No"}},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	actions := result.Plan["actions"].([]any)
	if len(actions) != 1 || actions[0].(map[string]any)["value"] != "Five years on AWS." {
		t.Fatalf("actions = %v, want the written AWS answer", actions)
	}
}

func TestChoiceFieldTellsTheModelThePageIsWaiting(t *testing.T) {
	text := choiceField(FormField{Label: "I agree to the acknowledgement", Kind: fieldToggle, Blocking: true})
	if !strings.HasSuffix(text, blockingNote) {
		t.Fatalf("choice field = %q, want the blocking note", text)
	}
	if strings.Contains(choiceField(FormField{Label: "Opt in", Kind: fieldToggle}), blockingNote) {
		t.Fatal("a field the page is not waiting on carries the blocking note")
	}
}

func TestPersonOnlyFieldsAreNeverWritten(t *testing.T) {
	field := FormField{ElementIndex: 4, Kind: fieldText, Label: "Security code", Required: true}
	if fact, write := textAnswer(parseApplicantFacts("{}"), field, FactPersonOnly); fact != "" || write {
		t.Fatalf("person-only field got fact %q write %v, want neither", fact, write)
	}
}
