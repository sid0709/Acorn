package acorn

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"sync"
)

// FieldIssueNote is what the page shows about one field it flags (Refill), gathered
// from every issue the field answers, as @acorn/shared/form-fields sends it: the
// issues' ids, the answer the field holds now, whether the page marks it invalid,
// and the messages the page ties to it or shows beside it.
type FieldIssueNote struct {
	ElementIndexes []int    `json:"elementIndexes"`
	Value          string   `json:"value"`
	Invalid        bool     `json:"invalid"`
	LinkedMessages []string `json:"linkedMessages,omitempty"`
	NearbyMessages []string `json:"nearbyMessages,omitempty"`
}

// Refill planners, echoed with a Refill plan so a run's log says which one planned it.
const (
	// RefillPlannerFast plans each flagged field with the decision model (FastPlan).
	RefillPlannerFast = "fast"
	// RefillPlannerConversation is the text-model planner continuing the page's plans.
	RefillPlannerConversation = "conversation"
)

// roleCombobox is a dropdown's role. A blank one the field list leaves out (a custom
// dropdown, whose options exist only once opened) is answered by the runtime's
// dropdown pass, as in a first fill.
const roleCombobox = "combobox"

// invalidNote stands in for the page's message when it marks an answer invalid
// without saying why: the writer still knows the answer was not accepted.
const invalidNote = "The page marked this answer as not accepted."

// textInstructions and textKinds ask the decision model what the page's text with
// a flagged field does: much of it is help the field shows to everyone.
const textInstructions = "After the applicant pressed the form's forward control, the page shows this text with a job-application field. Judge what the text does, whatever its wording."

const (
	textRefuses = "refuses"
	textHelps   = "helps"
)

var textKinds = map[string]string{
	textRefuses: "It says the field's answer is missing, was not accepted, or must change before the form can go on.",
	textHelps:   "It only helps: a format, a limit, a counter, an example, or other guidance the field shows to anyone.",
}

// RefillFlagged plans the fixes for what the page flagged from the flagged fields
// alone, the way a first fill plans a page: each field by the decision model, and a
// typed answer the page refused rewritten by the writer with the page's message in
// view. When that leaves an issue that needs an answer without a step, the
// conversational Refill plans the fixes instead, from the tree and the page's plans.
func (s *Service) RefillFlagged(ctx context.Context, applicant, pureTree string, scan FieldIssueScan, fields []FormField, page map[string]any, history []PlanTurn) (AnalyzeResult, error) {
	result, open, err := s.fastRefill(ctx, applicant, scan, fields, page)
	if err == nil && len(open) == 0 {
		return result, nil
	}
	if err != nil {
		slog.Warn("acorn refill: fast plan failed, planning the conversation", "error", err)
	} else {
		slog.Info("acorn refill: fast plan left issues open, planning the conversation", "open", open)
	}
	return s.Refill(ctx, applicant, pureTree, scan, page, history)
}

// fastRefill plans the flagged fields with the fast planner. open lists the issues
// that need an answer and get no step: the page marks them (invalid, or required
// and still blank), or the decision model read their text as a refusal.
func (s *Service) fastRefill(ctx context.Context, applicant string, scan FieldIssueScan, fields []FormField, page map[string]any) (AnalyzeResult, []int, error) {
	if s.classifier == nil || s.picker == nil {
		return AnalyzeResult{}, nil, ErrFastUnavailable
	}
	if len(scan.Issues) == 0 {
		return AnalyzeResult{}, nil, fmt.Errorf("%w: fieldIssues are required for refill", ErrInvalid)
	}
	marked := map[int]bool{}
	for _, issue := range scan.Issues {
		if issueMarked(issue) {
			marked[issue.ElementIndex] = true
		}
	}
	// The text beside the other fields is read while the marked ones are planned.
	var (
		wg      sync.WaitGroup
		refused map[int]bool
		readErr error
	)
	wg.Add(1)
	go func() {
		defer wg.Done()
		refused, readErr = s.refusedByText(ctx, scan.Issues)
	}()
	first := answering(fields, marked)
	plan, err := s.planFlagged(ctx, applicant, first, page)
	wg.Wait()
	if err != nil {
		return AnalyzeResult{}, nil, err
	}
	if readErr != nil {
		return AnalyzeResult{}, nil, readErr
	}
	if later := without(answering(fields, refused), first); len(later) > 0 {
		more, err := s.planFlagged(ctx, applicant, later, page)
		if err != nil {
			return AnalyzeResult{}, nil, err
		}
		plan = mergePlans(plan, more)
	}
	plan = s.fillPasswords(plan, passwordIssues(scan))
	open := openIssues(scan, union(marked, refused), fields, plan)
	return AnalyzeResult{OK: true, Plan: plan, Model: s.model.Model(), Mode: ModeRefill, RefillPlanner: RefillPlannerFast}, open, nil
}

// issueMarked is an issue the page marks on its own: the control is invalid, or it
// is required and still blank. Text tied to a field may be help it always shows.
func issueMarked(issue FieldIssue) bool {
	return issue.Invalid || (issue.Required && strings.TrimSpace(issue.Value) == "")
}

// refusedByText asks, in one decision, which issues carry text that turns their
// field's answer down (or says one is missing) rather than text that only helps.
// Issues the page already marks need no reading. The decision model reads each
// field's label and text, never the answer it holds.
func (s *Service) refusedByText(ctx context.Context, issues []FieldIssue) (map[int]bool, error) {
	items := map[int]string{}
	for _, issue := range issues {
		if issueMarked(issue) {
			continue
		}
		if text := joinMessages(issue.LinkedMessages, issue.NearbyMessages); text != "" {
			items[issue.ElementIndex] = textQuestion(issue, text)
		}
	}
	refused := map[int]bool{}
	if len(items) == 0 {
		return refused, nil
	}
	kinds, err := s.classifier.ClassifyEach(ctx, textInstructions, textKinds, items)
	if err != nil {
		return nil, fmt.Errorf("read the flagged fields' text: %w", err)
	}
	for index, kind := range kinds {
		if kind == textRefuses {
			refused[index] = true
		}
	}
	return refused, nil
}

// textQuestion is what the decision model reads about one issue's text: the field's
// label, whether it is blank, and the text, never the answer it holds.
func textQuestion(issue FieldIssue, text string) string {
	parts := []string{fmt.Sprintf("Field label: %q", strings.TrimSpace(issue.Label))}
	if strings.TrimSpace(issue.Value) == "" {
		parts = append(parts, "the field is blank")
	} else {
		parts = append(parts, "the field holds an answer")
	}
	if issue.Required {
		parts = append(parts, "required")
	}
	parts = append(parts, fmt.Sprintf("text shown with it: %q", text))
	return strings.Join(parts, "; ")
}

// joinMessages is a field's messages on one line: tied ones first, each once.
func joinMessages(linked, nearby []string) string {
	var out []string
	for _, message := range append(append([]string{}, linked...), nearby...) {
		if message = strings.TrimSpace(message); message != "" && !slices.Contains(out, message) {
			out = append(out, message)
		}
	}
	return strings.Join(out, " | ")
}

// planFlagged plans flagged fields the way a first fill plans them, with the page's
// verdict in view: a blank one is answered even when the profile is silent (the
// page will not go on without it), a typed answer the page refused is rewritten to
// satisfy what the page says, an optional one the profile does not back is cleared,
// and no step types into a field the value the page just refused.
func (s *Service) planFlagged(ctx context.Context, applicant string, fields []FormField, page map[string]any) (Plan, error) {
	if len(fields) == 0 {
		return newPlan(), nil
	}
	asked := make([]FormField, 0, len(fields))
	for _, field := range fields {
		if refusedAnswer(field) == "" {
			field.Required = true
		} else {
			field.Answered = true
		}
		asked = append(asked, field)
	}
	result, err := s.FastPlan(ctx, applicant, asked, page)
	if err != nil {
		return nil, err
	}
	plan := s.retypeRefused(ctx, result.Plan, asked, applicant, page)
	clearUnbacked(plan, asked)
	return dropRefusedTyping(plan, asked), nil
}

// refusedAnswer is the answer a flagged field holds now, which the page refused.
func refusedAnswer(field FormField) string {
	if field.Issue == nil {
		return ""
	}
	return strings.TrimSpace(field.Issue.Value)
}

// refusalNote is what the page says about a field's refused answer, for the writer.
func refusalNote(field FormField) string {
	if field.Issue != nil {
		if text := joinMessages(field.Issue.LinkedMessages, field.Issue.NearbyMessages); text != "" {
			return text
		}
	}
	return invalidNote
}

func isTypedField(field FormField) bool {
	return field.Kind == fieldText || field.Kind == fieldTextarea
}

// retypeRefused has the writer rewrite each typed answer planned for a field whose
// answer the page refused, with the page's message in view, so the new answer
// satisfies it (a format, a length) instead of repeating it.
func (s *Service) retypeRefused(ctx context.Context, plan Plan, fields []FormField, applicant string, page map[string]any) Plan {
	refusedFields := map[int]FormField{}
	for _, field := range fields {
		if refusedAnswer(field) != "" && isTypedField(field) && !isPasswordField(field) {
			refusedFields[field.ElementIndex] = field
		}
	}
	var retype []typingField
	for _, row := range planActions(plan) {
		if !isTypingFill(row) {
			continue
		}
		index, _ := elementIndex(row)
		field, ok := refusedFields[index]
		if !ok {
			continue
		}
		typed := writeFields([]FormField{field})[0]
		typed.Draft, typed.Note = str(row, "value"), refusalNote(field)
		retype = append(retype, typed)
	}
	if len(retype) == 0 {
		return plan
	}
	answers, err := s.writeAnswers(ctx, applicant, page, retype)
	if err != nil {
		slog.Warn("acorn refill: refused answers not rewritten", "error", err)
		return plan
	}
	return overlayTypingFills(plan, answers)
}

// clearUnbacked empties each optional typed field whose refused answer no profile
// fact replaces: leaving it blank is the fix, never an invented value.
func clearUnbacked(plan Plan, fields []FormField) {
	planned := plannedIndexes(plan)
	for _, field := range fields {
		if field.Required || refusedAnswer(field) == "" || !isTypedField(field) || isPasswordField(field) || planned[field.ElementIndex] {
			continue
		}
		plan["actions"] = append(plan["actions"].([]any), map[string]any{
			"action": "clear", "element_index": float64(field.ElementIndex), "element_indexes": nil,
			"expected_label": field.Label, "expected_role": textRole(field), "value": "",
			"file": nil, "reason": nil, "ms": nil,
		})
	}
}

// dropRefusedTyping leaves out a typed step that would send a field the very value
// the page just refused: it would only be refused again. A choice may be clicked
// again (a widget may not have taken the first click), and a password box is not
// judged by what it shows.
func dropRefusedTyping(plan Plan, fields []FormField) Plan {
	refused := map[int]string{}
	for _, field := range fields {
		if answer := refusedAnswer(field); answer != "" && isTypedField(field) && !isPasswordField(field) {
			refused[field.ElementIndex] = answer
		}
	}
	if len(refused) == 0 {
		return plan
	}
	items, _ := plan["actions"].([]any)
	kept := make([]any, 0, len(items))
	for _, item := range items {
		if row, ok := item.(map[string]any); ok && isTypingFill(row) {
			index, _ := elementIndex(row)
			if answer, was := refused[index]; was && sameAnswer(str(row, "value"), answer) {
				continue
			}
		}
		kept = append(kept, item)
	}
	plan["actions"] = kept
	return plan
}

// sameAnswer compares two answers as a person reads them: case and spacing aside.
func sameAnswer(a, b string) bool {
	return strings.EqualFold(strings.Join(strings.Fields(a), " "), strings.Join(strings.Fields(b), " "))
}

// answering are the fields that answer any of these issues.
func answering(fields []FormField, issues map[int]bool) []FormField {
	var out []FormField
	for _, field := range fields {
		if field.Issue != nil && slices.ContainsFunc(field.Issue.ElementIndexes, func(index int) bool { return issues[index] }) {
			out = append(out, field)
		}
	}
	return out
}

// without is fields minus the ones already in planned.
func without(fields, planned []FormField) []FormField {
	var out []FormField
	for _, field := range fields {
		if !slices.ContainsFunc(planned, func(other FormField) bool { return other.ElementIndex == field.ElementIndex }) {
			out = append(out, field)
		}
	}
	return out
}

func union(a, b map[int]bool) map[int]bool {
	out := make(map[int]bool, len(a)+len(b))
	for index := range a {
		out[index] = true
	}
	for index := range b {
		out[index] = true
	}
	return out
}

// mergePlans appends b's steps, and the fields it fills, to a.
func mergePlans(a, b Plan) Plan {
	a["actions"] = append(a["actions"].([]any), b["actions"].([]any)...)
	into := a["validation"].(map[string]any)
	from := b["validation"].(map[string]any)
	into["required_element_indexes"] = append(into["required_element_indexes"].([]any), from["required_element_indexes"].([]any)...)
	return a
}

func plannedIndexes(plan Plan) map[int]bool {
	planned := map[int]bool{}
	for _, row := range planActions(plan) {
		if index, ok := elementIndex(row); ok {
			planned[index] = true
		}
	}
	return planned
}

// fieldPlanned is true when a step targets the field or one of its options.
func fieldPlanned(field FormField, planned map[int]bool) bool {
	return planned[field.ElementIndex] || slices.ContainsFunc(field.OptionIndexes, func(index int) bool { return planned[index] })
}

// openIssues are the issues that need an answer and get no step: no flagged field
// answers them, or the one that does is not planned. A blank custom dropdown the
// field list leaves out is answered by the runtime's dropdown pass instead.
func openIssues(scan FieldIssueScan, needs map[int]bool, fields []FormField, plan Plan) []int {
	planned := plannedIndexes(plan)
	var open []int
	for _, issue := range scan.Issues {
		if !needs[issue.ElementIndex] {
			continue
		}
		by := answering(fields, map[int]bool{issue.ElementIndex: true})
		if len(by) == 0 {
			if roleToken(issue.Role) == roleCombobox && strings.TrimSpace(issue.Value) == "" {
				continue
			}
			open = append(open, issue.ElementIndex)
			continue
		}
		if !slices.ContainsFunc(by, func(field FormField) bool { return fieldPlanned(field, planned) }) {
			open = append(open, issue.ElementIndex)
		}
	}
	return open
}
