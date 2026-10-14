package acorn

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
)

// refillDecider stands in for the decision model on a refill: text fields are the
// facts `facts` names (by element index), the page's text does what `text` says,
// every field is the applicant's own, and choices are `picks`.
type refillDecider struct {
	facts   map[int]string
	text    map[int]string
	picks   map[int][]string
	textErr error

	mu        sync.Mutex
	textItems map[int]string
}

func (d *refillDecider) ClassifyEach(_ context.Context, instructions string, _ map[string]string, items map[int]string) (map[int]string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := map[int]string{}
	switch instructions {
	case textFieldInstructions:
		for id := range items {
			if kind, ok := d.facts[id]; ok {
				out[id] = kind
			}
		}
	case subjectInstructions:
		for id := range items {
			out[id] = subjectApplicant
		}
	case textInstructions:
		if d.textErr != nil {
			return nil, d.textErr
		}
		d.textItems = items
		for id := range items {
			out[id] = d.text[id]
		}
	}
	return out, nil
}

func (d *refillDecider) PickOne(context.Context, string, map[int]string) (int, error) {
	return 0, errors.New("no résumé fields here")
}

func (d *refillDecider) PickChoices(_ context.Context, _ string, questions []ChoiceQuestion) (map[int][]string, error) {
	out := map[int][]string{}
	for _, question := range questions {
		if pick, ok := d.picks[question.ElementIndex]; ok {
			out[question.ElementIndex] = pick
		}
	}
	return out, nil
}

const refillApplicant = `{"settings":{"email":"jordan@example.com","phone":"4243207354"}}`

// conversationPlan is what the conversational Refill planner answers in these tests.
const conversationPlan = `{"goal":"g","actions":[
 {"action":"fill","element_index":6,"element_indexes":null,"expected_label":"Phone","expected_role":"textbox","value":"+1 424-320-7354","file":null,"reason":null,"ms":null}
],"forbidden_actions":[],"validation":{"required_element_indexes":[6],"stop_before_submit":true},"unresolved_items":[]}`

// flagged is one field the page flags, with its issue under the same id.
func flagged(field FormField, issue FieldIssue) (FormField, FieldIssue) {
	issue.ElementIndex, issue.Label = field.ElementIndex, field.Label
	field.Issue = &FieldIssueNote{
		ElementIndexes: []int{issue.ElementIndex}, Value: issue.Value, Invalid: issue.Invalid,
		LinkedMessages: issue.LinkedMessages, NearbyMessages: issue.NearbyMessages,
	}
	return field, issue
}

func refill(t *testing.T, model *fakeModel, decider *refillDecider, pairs ...func() (FormField, FieldIssue)) AnalyzeResult {
	t.Helper()
	fields := []FormField{}
	var scan FieldIssueScan
	for _, pair := range pairs {
		field, issue := pair()
		fields = append(fields, field)
		scan.Issues = append(scan.Issues, issue)
	}
	service := New(model)
	if decider != nil {
		service = service.WithClassifier(decider).WithPicker(decider)
	}
	result, err := service.RefillFlagged(context.Background(), refillApplicant, "tree", scan, fields, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Mode != ModeRefill {
		t.Fatalf("mode = %q, want %q", result.Mode, ModeRefill)
	}
	return result
}

func stepsOf(plan Plan) map[int]map[string]any {
	steps := map[int]map[string]any{}
	for _, row := range planActions(plan) {
		index, _ := elementIndex(row)
		steps[index] = row
	}
	return steps
}

func TestRefillFlaggedFillsAMissingFieldWithoutTheConversation(t *testing.T) {
	model := &fakeModel{}
	email := func() (FormField, FieldIssue) {
		return flagged(FormField{ElementIndex: 4, Kind: fieldText, Label: "Email", InputType: "email", Required: true},
			FieldIssue{Role: "textbox", Required: true, Invalid: true})
	}
	result := refill(t, model, &refillDecider{facts: map[int]string{4: "email"}}, email)

	if result.RefillPlanner != RefillPlannerFast {
		t.Fatalf("planner = %q, want %q", result.RefillPlanner, RefillPlannerFast)
	}
	if got := stepsOf(result.Plan)[4]["value"]; got != "jordan@example.com" {
		t.Fatalf("email = %v, want the profile's", got)
	}
	if len(model.calls) != 0 {
		t.Fatalf("the text model was called %d times, want none", len(model.calls))
	}
}

func TestRefillFlaggedRewritesARefusedTypedAnswerWithThePageMessage(t *testing.T) {
	const message = "Enter a phone number like (555) 555-5555"
	model := &fakeModel{replies: []string{`{"answers":[{"element_index":6,"value":"(424) 320-7354"}]}`}}
	phone := func() (FormField, FieldIssue) {
		return flagged(FormField{ElementIndex: 6, Kind: fieldText, Label: "Phone", InputType: "tel"},
			FieldIssue{Role: "textbox", Value: "4243207354", Invalid: true, LinkedMessages: []string{message}})
	}
	result := refill(t, model, &refillDecider{facts: map[int]string{6: "phone"}}, phone)

	if result.RefillPlanner != RefillPlannerFast {
		t.Fatalf("planner = %q, want %q", result.RefillPlanner, RefillPlannerFast)
	}
	if got := stepsOf(result.Plan)[6]["value"]; got != "(424) 320-7354" {
		t.Fatalf("phone = %v, want the rewritten answer", got)
	}
	if len(model.calls) != 1 || !strings.Contains(model.calls[0], "page error: "+message) {
		t.Fatalf("writer calls = %v, want one with the page's message", model.calls)
	}
}

func TestRefillFlaggedFallsBackWhenItCanOnlyRepeatARefusedAnswer(t *testing.T) {
	model := &fakeModel{replies: []string{
		`{"answers":[{"element_index":6,"value":"4243207354"}]}`,
		conversationPlan,
	}}
	phone := func() (FormField, FieldIssue) {
		return flagged(FormField{ElementIndex: 6, Kind: fieldText, Label: "Phone", InputType: "tel"},
			FieldIssue{Role: "textbox", Value: "4243207354", Invalid: true})
	}
	result := refill(t, model, &refillDecider{facts: map[int]string{6: "phone"}}, phone)

	if result.RefillPlanner != RefillPlannerConversation {
		t.Fatalf("planner = %q, want the conversation", result.RefillPlanner)
	}
	if got := stepsOf(result.Plan)[6]["value"]; got != "+1 424-320-7354" {
		t.Fatalf("phone = %v, want the conversation's answer", got)
	}
}

func TestRefillFlaggedLeavesHelpTextAlone(t *testing.T) {
	const answer = "Because the team ships hiring tools."
	model := &fakeModel{}
	decider := &refillDecider{text: map[int]string{8: textHelps}}
	why := func() (FormField, FieldIssue) {
		return flagged(FormField{ElementIndex: 8, Kind: fieldTextarea, Label: "Why us?"},
			FieldIssue{Role: "textarea", Value: answer, NearbyMessages: []string{"0/300"}})
	}
	result := refill(t, model, decider, why)

	if result.RefillPlanner != RefillPlannerFast || len(planActions(result.Plan)) != 0 {
		t.Fatalf("planner %q planned %v, want nothing", result.RefillPlanner, planActions(result.Plan))
	}
	if strings.Contains(decider.textItems[8], answer) {
		t.Fatalf("the decision model read the field's answer: %q", decider.textItems[8])
	}
	if len(model.calls) != 0 {
		t.Fatalf("the text model was called %d times, want none", len(model.calls))
	}
}

// A page with no ARIA says a field is missing in plain text beside it.
func TestRefillFlaggedAnswersABlankFieldItsTextSaysIsMissing(t *testing.T) {
	email := func() (FormField, FieldIssue) {
		return flagged(FormField{ElementIndex: 4, Kind: fieldText, Label: "Email", InputType: "email"},
			FieldIssue{Role: "textbox", NearbyMessages: []string{"This field is required"}})
	}
	decider := &refillDecider{facts: map[int]string{4: "email"}, text: map[int]string{4: textRefuses}}
	result := refill(t, &fakeModel{}, decider, email)

	if got := stepsOf(result.Plan)[4]["value"]; got != "jordan@example.com" {
		t.Fatalf("email = %v, want the profile's", got)
	}
}

func TestRefillFlaggedClearsAnOptionalAnswerTheProfileDoesNotBack(t *testing.T) {
	middle := func() (FormField, FieldIssue) {
		return flagged(FormField{ElementIndex: 9, Kind: fieldText, Label: "Middle name"},
			FieldIssue{Role: "textbox", Value: "N/A", Invalid: true})
	}
	result := refill(t, &fakeModel{}, &refillDecider{facts: map[int]string{9: FactSkip}}, middle)

	actions := planActions(result.Plan)
	if result.RefillPlanner != RefillPlannerFast || len(actions) != 1 || actions[0]["action"] != "clear" {
		t.Fatalf("planner %q planned %v, want one clear", result.RefillPlanner, actions)
	}
}

func TestRefillFlaggedLeavesABlankCustomDropdownToTheRuntime(t *testing.T) {
	scan := FieldIssueScan{Issues: []FieldIssue{{ElementIndex: 12, Label: "Country", Role: "combobox", Required: true}}}
	service := New(&fakeModel{}).WithClassifier(&refillDecider{}).WithPicker(&refillDecider{})
	result, err := service.RefillFlagged(context.Background(), refillApplicant, "tree", scan, []FormField{}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.RefillPlanner != RefillPlannerFast || len(planActions(result.Plan)) != 0 {
		t.Fatalf("planner %q planned %v, want nothing for the runtime's dropdown", result.RefillPlanner, planActions(result.Plan))
	}
}

func TestRefillFlaggedPlansTheConversationWithoutTheDecisionModel(t *testing.T) {
	phone := func() (FormField, FieldIssue) {
		return flagged(FormField{ElementIndex: 6, Kind: fieldText, Label: "Phone"},
			FieldIssue{Role: "textbox", Required: true})
	}
	result := refill(t, &fakeModel{replies: []string{conversationPlan}}, nil, phone)

	if result.RefillPlanner != RefillPlannerConversation {
		t.Fatalf("planner = %q, want the conversation", result.RefillPlanner)
	}
}

func TestRefillFlaggedPlansTheConversationWhenTheTextCannotBeRead(t *testing.T) {
	phone := func() (FormField, FieldIssue) {
		return flagged(FormField{ElementIndex: 6, Kind: fieldText, Label: "Phone"},
			FieldIssue{Role: "textbox", Value: "4243207354", NearbyMessages: []string{"Invalid"}})
	}
	decider := &refillDecider{textErr: errors.New("jev down")}
	result := refill(t, &fakeModel{replies: []string{conversationPlan}}, decider, phone)

	if result.RefillPlanner != RefillPlannerConversation {
		t.Fatalf("planner = %q, want the conversation", result.RefillPlanner)
	}
}
