package acorn

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
)

// ModeFast is the decision-model planner: Jev classifies and picks, the text
// model only writes free-text answers. Any other mode plans with the text model.
const ModeFast = "fast"

// ErrFastUnavailable means the service has no decision model; plan with Analyze instead.
var ErrFastUnavailable = fmt.Errorf("%w: fast planning needs the decision model", ErrInvalid)

// FormField kinds the extension sends (see @acorn/shared/form-fields).
const (
	fieldText     = "text"
	fieldTextarea = "textarea"
	fieldSelect   = "select"
	fieldRadio    = "radio"
	fieldCheckbox = "checkbox"
	fieldToggle   = "toggle"
	fieldButtons  = "buttons"
	fieldFile     = "file"
)

// toggleCheck / toggleLeave are a single checkbox's two answers.
const (
	toggleCheck = "Check this box"
	toggleLeave = "Leave this box unchecked"
)

// FormField is one control the extension found on the page.
type FormField struct {
	ElementIndex int    `json:"elementIndex"`
	Kind         string `json:"kind"`
	Label        string `json:"label"`
	Section      string `json:"section"`
	InputType    string `json:"inputType"`
	Autocomplete string `json:"autocomplete"`
	Placeholder  string `json:"placeholder"`
	Name         string `json:"name"`
	// MaxLength is the control's native maxlength; 0 when it sets none.
	MaxLength int `json:"maxLength,omitempty"`
	// Notes is short text the page shows after a text field: a counter ("0/300"), a format hint.
	Notes    []string `json:"notes,omitempty"`
	Required bool     `json:"required"`
	Options  []string `json:"options"`
	// OptionIndexes are the node ids of Options, in the same order, when known: a
	// step then targets the chosen option itself.
	OptionIndexes []int `json:"optionIndexes,omitempty"`
	// Answered is true when the page already shows an answer.
	Answered bool `json:"answered,omitempty"`
}

// ChoiceQuestion is one choice field the decision model answers from the profile.
type ChoiceQuestion struct {
	ElementIndex int
	Field        string
	Options      []string
	Multiple     bool
}

// ChoicePicker answers choice fields straight from their options. The
// SelectorGateway (Jev) is the real one; it never routes them through Facts.
type ChoicePicker interface {
	PickChoices(ctx context.Context, applicant string, questions []ChoiceQuestion) (map[int][]string, error)
}

const (
	textFieldInstructions = "Which applicant profile fact fills this job-application text field? Read the form section too: a field about someone else (a reference, an emergency contact, a referrer) is never the applicant's own fact. Choose write when it asks for a written answer, and skip when no profile fact answers it."
	fileFieldInstructions = "What does this job-application file upload field want?"
)

// subjectInstructions ask, per text field, whose detail it is — on its own, so a
// matching label ("First Name") cannot outweigh its section ("References").
const subjectInstructions = "Whose information does this job-application field ask for? Read the form section first."

const (
	subjectApplicant = "applicant"
	subjectOther     = "other_person"
)

var subjectKinds = map[string]string{
	subjectApplicant: "The applicant's own information.",
	subjectOther:     "Someone else's information: a reference, an emergency contact, a referrer, or a supervisor.",
}

// File field kinds. Only résumé and autofill fields get the résumé upload.
const (
	fileResume      = "resume"
	fileAutofill    = "autofill"
	fileCoverLetter = "cover_letter"
	fileOther       = "other"
)

var fileKinds = map[string]string{
	fileResume:      "The application's résumé or CV document.",
	fileAutofill:    "A drop zone that parses a résumé to pre-fill the form — not the résumé field itself.",
	fileCoverLetter: "A cover letter.",
	fileOther:       "Any other document: transcript, portfolio, certificate, or additional files.",
}

// resumeFieldInstructions pick the one résumé field among several résumé-like
// uploads. Judged one at a time, a parse-to-prefill drop zone reads like a
// résumé field; side by side, the field the application submits stands out.
const resumeFieldInstructions = "Which of these upload fields is where the application submits its résumé? Not a drop zone that only reads a résumé to pre-fill the form."

// WithPicker returns a copy that answers choice fields with the decision model.
func (s *Service) WithPicker(picker ChoicePicker) *Service {
	next := *s
	next.picker = picker
	return &next
}

// FastPlan plans a fill from the extension's field list without the planner prompt:
// file fields and free-text fields are classified by the decision model, text
// facts come from the profile's heuristic callers, choice fields are picked by
// the decision model from their own options, and only "write" fields reach the
// text model. Custom dropdowns (options unknown until opened) are left to the
// runtime's leftover pass.
func (s *Service) FastPlan(ctx context.Context, applicant string, fields []FormField, page map[string]any) (AnalyzeResult, error) {
	if s.classifier == nil || s.picker == nil {
		return AnalyzeResult{}, ErrFastUnavailable
	}
	if len(fields) == 0 {
		return AnalyzeResult{}, fmt.Errorf("%w: formFields are required", ErrInvalid)
	}
	texts, files, choices := splitFields(fields)

	var (
		wg                    sync.WaitGroup
		textKinds, fileTypes  map[int]string
		subjects              map[int]string
		picks                 map[int][]string
		written               map[int]string
		textErr, fileErr, err error
	)
	// Multi-line fields almost always want a written answer: start the writer now,
	// alongside the decision model, instead of after it.
	if prose := writeFields(textareas(texts)); len(prose) > 0 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var writeErr error
			if written, writeErr = s.writeAnswers(ctx, applicant, page, prose); writeErr != nil {
				slog.Warn("acorn fast plan: early written answers skipped", "error", writeErr)
			}
		}()
	}
	wg.Add(4)
	go func() {
		defer wg.Done()
		textKinds, textErr = s.classifier.ClassifyEach(ctx, textFieldInstructions, factKinds(), describeAll(texts))
	}()
	go func() {
		defer wg.Done()
		var subjectErr error
		if subjects, subjectErr = s.classifier.ClassifyEach(ctx, subjectInstructions, subjectKinds, describeAll(texts)); subjectErr != nil {
			slog.Warn("acorn fast plan: field subjects unclassified", "error", subjectErr)
		}
	}()
	go func() {
		defer wg.Done()
		fileTypes, fileErr = s.classifier.ClassifyEach(ctx, fileFieldInstructions, fileKinds, describeAll(files))
	}()
	go func() {
		defer wg.Done()
		picks, err = s.picker.PickChoices(ctx, applicant, choiceQuestions(choices))
	}()
	wg.Wait()
	if textErr != nil && len(texts) > 0 {
		return AnalyzeResult{}, fmt.Errorf("classify text fields: %w", textErr)
	}
	if fileErr != nil {
		slog.Warn("acorn fast plan: file fields unclassified", "error", fileErr)
	}
	if err != nil {
		slog.Warn("acorn fast plan: choice fields left to the runtime", "error", err)
	}

	plan := newPlan()
	s.settleResumeField(ctx, files, fileTypes)
	addResumeUpload(plan, files, fileTypes)
	for index, subject := range subjects {
		if subject == subjectOther {
			textKinds[index] = FactOtherPerson
		}
	}
	s.addTextFills(ctx, plan, texts, textKinds, written, applicant, page)
	addChoiceFills(plan, choices, picks)
	return AnalyzeResult{OK: true, Plan: plan, Model: s.model.Model(), Mode: ModeFast}, nil
}

func splitFields(fields []FormField) (texts, files, choices []FormField) {
	for _, field := range fields {
		switch field.Kind {
		case fieldText, fieldTextarea:
			texts = append(texts, field)
		case fieldFile:
			files = append(files, field)
		case fieldSelect, fieldRadio, fieldCheckbox, fieldToggle, fieldButtons:
			if len(field.Options) > 0 || field.Kind == fieldToggle {
				choices = append(choices, field)
			}
		}
	}
	return texts, files, choices
}

// describe is what the decision model reads about a field: its label and the
// attributes that name it — never the applicant's data.
func describe(field FormField) string {
	var parts []string
	if section := strings.TrimSpace(field.Section); section != "" {
		parts = append(parts, fmt.Sprintf("Form section: %q", section))
	}
	parts = append(parts, fmt.Sprintf("Field label: %q", strings.TrimSpace(field.Label)))
	for _, attr := range [][2]string{
		{"input type", field.InputType}, {"autocomplete", field.Autocomplete},
		{"placeholder", field.Placeholder}, {"name", field.Name},
	} {
		if strings.TrimSpace(attr[1]) != "" {
			parts = append(parts, fmt.Sprintf("%s: %q", attr[0], strings.TrimSpace(attr[1])))
		}
	}
	if field.Kind == fieldTextarea {
		parts = append(parts, "multi-line")
	}
	if notes := fieldNotes(field); notes != "" {
		parts = append(parts, fmt.Sprintf("text under the field: %q", notes))
	}
	if field.Required {
		parts = append(parts, "required")
	}
	return strings.Join(parts, "; ")
}

// fieldNotes is the page's own text after a field, joined for one line.
func fieldNotes(field FormField) string {
	notes := make([]string, 0, len(field.Notes))
	for _, note := range field.Notes {
		if note = strings.TrimSpace(note); note != "" {
			notes = append(notes, note)
		}
	}
	return strings.Join(notes, " | ")
}

// fieldLimits is what bounds a written answer: the native maxlength and the page's
// text under the field, where many forms state a limit they enforce ("0/300").
func fieldLimits(field FormField) string {
	var parts []string
	if field.MaxLength > 0 {
		parts = append(parts, fmt.Sprintf("max %d characters", field.MaxLength))
	}
	if notes := fieldNotes(field); notes != "" {
		parts = append(parts, "text under the field: "+notes)
	}
	return strings.Join(parts, "; ")
}

func describeAll(fields []FormField) map[int]string {
	items := make(map[int]string, len(fields))
	for _, field := range fields {
		items[field.ElementIndex] = describe(field)
	}
	return items
}

func choiceQuestions(fields []FormField) []ChoiceQuestion {
	out := make([]ChoiceQuestion, 0, len(fields))
	for _, field := range fields {
		options := field.Options
		if field.Kind == fieldToggle {
			options = []string{toggleCheck, toggleLeave}
		}
		out = append(out, ChoiceQuestion{
			ElementIndex: field.ElementIndex, Field: choiceField(field), Options: options,
			Multiple: field.Kind == fieldCheckbox,
		})
	}
	return out
}

func newPlan() Plan {
	return Plan{
		"goal":              "Fill the application from the applicant profile and stop before submission",
		"actions":           []any{},
		"forbidden_actions": []any{},
		"validation":        map[string]any{"required_element_indexes": []any{}, "stop_before_submit": true},
		"unresolved_items":  []any{},
	}
}

// addAction appends one step in the shape the extension's plan runner reads.
func addAction(plan Plan, action string, field FormField, role, value string, file *string) {
	row := map[string]any{
		"action": action, "element_index": float64(field.ElementIndex), "element_indexes": nil,
		"expected_label": field.Label, "expected_role": role, "value": value,
		"file": nil, "reason": nil, "ms": nil,
	}
	if file != nil {
		row["file"] = *file
	}
	plan["actions"] = append(plan["actions"].([]any), row)
	validation := plan["validation"].(map[string]any)
	validation["required_element_indexes"] = append(validation["required_element_indexes"].([]any), float64(field.ElementIndex))
}

// settleResumeField leaves one résumé field when several uploads were classified
// as résumé or autofill: the decision model compares them in one question, the
// pick becomes the résumé field and the others the autofill zone. An upload to a
// parse-to-prefill zone makes the site rewrite the form under the fill, so a
// mistaken résumé kind there is never uploaded alongside the real field.
func (s *Service) settleResumeField(ctx context.Context, files []FormField, kinds map[int]string) {
	candidates := map[int]string{}
	for _, field := range files {
		if kind := kinds[field.ElementIndex]; kind == fileResume || kind == fileAutofill {
			candidates[field.ElementIndex] = describe(field)
		}
	}
	if len(candidates) < 2 {
		return
	}
	picked, err := s.classifier.PickOne(ctx, resumeFieldInstructions, candidates)
	if err != nil {
		slog.Warn("acorn fast plan: résumé field not settled", "error", err)
		return
	}
	for index := range candidates {
		kinds[index] = fileAutofill
	}
	kinds[picked] = fileResume
}

// addResumeUpload attaches the résumé to every résumé field, or to the autofill
// drop zone only when the form has no résumé field. Uploads run before any other
// step, so a parse zone's prefill is overwritten by the planned answers.
func addResumeUpload(plan Plan, files []FormField, kinds map[int]string) {
	recommended := "recommended_resume"
	for _, want := range []string{fileResume, fileAutofill} {
		added := false
		for _, field := range files {
			if kinds[field.ElementIndex] == want {
				addAction(plan, "resume_upload", field, "file", "", &recommended)
				added = true
			}
		}
		if added {
			return
		}
	}
}

// requiredNote tells the decision model a choice field cannot be left unanswered:
// a required box is submitted only when checked.
const requiredNote = " — required: the form cannot be submitted without it"

// choiceField is what the decision model reads about a choice field.
func choiceField(field FormField) string {
	if field.Required {
		return fieldWithSection(field) + requiredNote
	}
	return fieldWithSection(field)
}

// fieldWithSection is a field's label with its form section, for the decision model.
func fieldWithSection(field FormField) string {
	if section := strings.TrimSpace(field.Section); section != "" {
		return field.Label + " (form section: " + section + ")"
	}
	return field.Label
}

// blankKinds leave a field empty (or, when it is required, have the writer answer it).
var blankKinds = map[string]bool{FactSkip: true, FactOtherPerson: true, FactUnknownDetail: true}

func textRole(field FormField) string {
	if field.Kind == fieldTextarea {
		return "textarea"
	}
	return "textbox"
}

func textareas(fields []FormField) []FormField {
	var out []FormField
	for _, field := range fields {
		if field.Kind == fieldTextarea {
			out = append(out, field)
		}
	}
	return out
}

// writeFields is how the writer reads fields: the label plus its form section.
func writeFields(fields []FormField) []typingField {
	out := make([]typingField, 0, len(fields))
	for _, field := range fields {
		question := strings.TrimSpace(field.Label)
		if section := strings.TrimSpace(field.Section); section != "" {
			question += " (form section: " + section + ")"
		}
		out = append(out, typingField{ElementIndex: field.ElementIndex, Question: question, Role: textRole(field), Limits: fieldLimits(field)})
	}
	return out
}

// addTextFills fills profile facts, keeps blanks blank, and uses the writer's
// answers for "write" fields — reusing the early answers for multi-line fields.
func (s *Service) addTextFills(ctx context.Context, plan Plan, fields []FormField, kinds map[int]string, written map[int]string, applicant string, page map[string]any) {
	profile := parseApplicantFacts(applicant)
	var write []FormField
	for _, field := range fields {
		kind := kinds[field.ElementIndex]
		if kind != FactWrite && !blankKinds[kind] && kind != "" {
			if value := factValue(profile, kind); value != "" {
				addAction(plan, "fill", field, textRole(field), value, nil)
				continue
			}
			kind = FactSkip
		}
		// Another person's details are never made up: the applicant fills those.
		if kind == FactOtherPerson {
			continue
		}
		// A required field the profile cannot answer still gets a written answer.
		if kind != FactWrite && !(blankKinds[kind] && field.Required) {
			continue
		}
		if answer := strings.TrimSpace(written[field.ElementIndex]); answer != "" {
			addAction(plan, "fill", field, textRole(field), answer, nil)
			continue
		}
		write = append(write, field)
	}
	if len(write) == 0 {
		return
	}
	answers, err := s.writeAnswers(ctx, applicant, page, writeFields(write))
	if err != nil {
		slog.Warn("acorn fast plan: written answers skipped", "error", err)
		return
	}
	for _, field := range write {
		if answer := strings.TrimSpace(answers[field.ElementIndex]); answer != "" {
			addAction(plan, "fill", field, textRole(field), answer, nil)
		}
	}
}

func addChoiceFills(plan Plan, fields []FormField, picks map[int][]string) {
	for _, field := range fields {
		chosen := picks[field.ElementIndex]
		if len(chosen) == 0 {
			continue
		}
		if addOptionSteps(plan, field, chosen) {
			continue
		}
		value, role := strings.Join(chosen, ", "), field.Kind
		if field.Kind == fieldToggle {
			value = map[bool]string{true: "true", false: "false"}[chosen[0] == toggleCheck]
			role = fieldCheckbox
		}
		addAction(plan, "select_radio", field, role, value, nil)
	}
}

// addOptionSteps targets the chosen option's own node when the field knows its
// options' nodes, so the runtime clicks that exact option instead of searching the
// field for its label. A checkbox field gets one step per box to check, and one
// per box to clear when the page already shows answers. False when the field's
// option nodes are unknown (the runtime then finds the option by label).
func addOptionSteps(plan Plan, field FormField, chosen []string) bool {
	if field.Kind == fieldSelect || len(field.OptionIndexes) == 0 || len(field.OptionIndexes) != len(field.Options) {
		return false
	}
	nodes := make(map[string]int, len(field.Options))
	for i, label := range field.Options {
		nodes[label] = field.OptionIndexes[i]
	}
	for _, label := range chosen {
		if _, listed := nodes[label]; !listed {
			return false
		}
	}
	if field.Kind != fieldCheckbox {
		addOptionAction(plan, field, nodes[chosen[0]], chosen[0], field.Label)
		return true
	}
	picked := make(map[string]bool, len(chosen))
	for _, label := range chosen {
		picked[label] = true
	}
	for _, label := range field.Options {
		if picked[label] || field.Answered {
			addOptionAction(plan, field, nodes[label], strconv.FormatBool(picked[label]), label)
		}
	}
	return true
}

// addOptionAction is one select_radio step on an option node of field.
func addOptionAction(plan Plan, field FormField, node int, value, label string) {
	option := field
	option.ElementIndex, option.Label = node, label
	addAction(plan, "select_radio", option, field.Kind, value, nil)
}
