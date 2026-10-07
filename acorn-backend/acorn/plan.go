package acorn

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const (
	kindApplicationAI = "application_ai"
	kindWorkplaceAI   = "workplace_ai"
	kindOther         = "other"
)

var (
	fencedJSON = regexp.MustCompile("(?is)```(?:json)?\\s*(.*?)```")
	yesLike    = regexp.MustCompile(`(?i)^(yes|y|true|i consent|i agree|agree|consent|i do consent)$`)
	consentish = regexp.MustCompile(`(?i)^(i\s+)?(consent|agree)\b`)

	typingRoles = map[string]bool{"textbox": true, "textarea": true, "searchbox": true, "text": true, "input": true, "spinbutton": true}
	choiceRoles = map[string]bool{"combobox": true, "listbox": true, "select": true, "radio": true, "checkbox": true, "switch": true, "option": true, "menuitem": true, "button": true}
	roleSplit   = regexp.MustCompile(`[\s,/|:]+`)
)

// Plan is the model's action plan, kept as loose JSON like the extension reads it.
type Plan = map[string]any

// jsonObject finds the JSON object in a model reply, which may be fenced or wrapped in prose.
func jsonObject(text string) (string, error) {
	trimmed := strings.TrimSpace(text)
	if strings.HasPrefix(trimmed, "{") {
		return trimmed, nil
	}
	if match := fencedJSON.FindStringSubmatch(trimmed); match != nil {
		return strings.TrimSpace(match[1]), nil
	}
	start, end := strings.Index(trimmed, "{"), strings.LastIndex(trimmed, "}")
	if start >= 0 && end > start {
		return trimmed[start : end+1], nil
	}
	return "", errors.New("model returned no JSON object")
}

func decodeObject(text string, dest any) error {
	object, err := jsonObject(text)
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(object), dest)
}

func validatePlan(plan Plan) error {
	for _, key := range []string{"goal", "actions", "forbidden_actions", "validation", "unresolved_items"} {
		if _, ok := plan[key]; !ok {
			return fmt.Errorf("plan missing required field: %s", key)
		}
	}
	if _, ok := plan["actions"].([]any); !ok {
		return errors.New("plan actions and forbidden_actions must be arrays")
	}
	if _, ok := plan["forbidden_actions"].([]any); !ok {
		return errors.New("plan actions and forbidden_actions must be arrays")
	}
	validation, ok := plan["validation"].(map[string]any)
	if !ok {
		return errors.New("plan validation must be an object")
	}
	if _, ok := validation["required_element_indexes"].([]any); !ok {
		return errors.New("validation.required_element_indexes must be an array")
	}
	if _, ok := validation["stop_before_submit"].(bool); !ok {
		return errors.New("validation.stop_before_submit must be a boolean")
	}
	if _, ok := plan["unresolved_items"].([]any); !ok {
		return errors.New("unresolved_items must be an array")
	}
	return nil
}

func planActions(plan Plan) []map[string]any {
	items, _ := plan["actions"].([]any)
	actions := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if row, ok := item.(map[string]any); ok {
			actions = append(actions, row)
		}
	}
	return actions
}

func elementIndex(row map[string]any) (int, bool) {
	number, ok := row["element_index"].(float64)
	return int(number), ok
}

func str(row map[string]any, key string) string {
	value, _ := row[key].(string)
	return value
}

// identityQuestion is one planned field whose question may be about the applicant being an AI.
type identityQuestion struct {
	ElementIndex int
	Role         string
	Question     string
}

func collectIdentityQuestions(plan Plan) []identityQuestion {
	var fields []identityQuestion
	seen := map[int]bool{}
	for _, row := range planActions(plan) {
		index, ok := elementIndex(row)
		if !ok || seen[index] {
			continue
		}
		question := strings.TrimSpace(str(row, "expected_label"))
		if question == "" {
			continue
		}
		seen[index] = true
		fields = append(fields, identityQuestion{ElementIndex: index, Role: str(row, "expected_role"), Question: question})
	}
	return fields
}

// applyApplicantIdentity flips a yes/consent answer to No on questions that ask
// whether the applicant used or consents to automated tools.
func applyApplicantIdentity(plan Plan, applicationAI map[int]bool) Plan {
	if len(applicationAI) == 0 {
		return plan
	}
	for _, row := range planActions(plan) {
		index, ok := elementIndex(row)
		if !ok || !applicationAI[index] {
			continue
		}
		value, isString := row["value"].(string)
		if !isString {
			continue
		}
		trimmed := strings.TrimSpace(value)
		if trimmed != "" && (yesLike.MatchString(trimmed) || consentish.MatchString(trimmed)) {
			row["value"] = "No"
		}
	}
	return plan
}

func parseApplicationAI(text string, fields []identityQuestion) (map[int]bool, error) {
	allowed := map[int]bool{}
	for _, field := range fields {
		allowed[field.ElementIndex] = true
	}
	var parsed struct {
		Classifications []struct {
			ElementIndex float64 `json:"element_index"`
			Kind         string  `json:"kind"`
		} `json:"classifications"`
	}
	if err := decodeObject(text, &parsed); err != nil {
		return nil, err
	}
	indexes := map[int]bool{}
	for _, row := range parsed.Classifications {
		index := int(row.ElementIndex)
		if allowed[index] && row.Kind == kindApplicationAI {
			indexes[index] = true
		}
	}
	return indexes, nil
}

func identityUserPrompt(fields []identityQuestion) string {
	blocks := make([]string, 0, len(fields))
	for _, field := range fields {
		role := field.Role
		if role == "" {
			role = "(none)"
		}
		blocks = append(blocks, fmt.Sprintf("element_index: %d\nrole: %s\nquestion: %s", field.ElementIndex, role, field.Question))
	}
	return strings.TrimSpace("Questions:\n" + strings.Join(blocks, "\n\n") + "\n\nReturn json with one classifications[].kind per element_index.")
}

// typingField is a planned text field a writer may rewrite.
type typingField struct {
	ElementIndex int
	Question     string
	Role         string
	Draft        string
	// Note is the page's validation message for the previous answer (Refill only).
	Note string
	// Limits bound the answer: a maxlength, or the page's counter or hint under the field.
	Limits string
}

func roleToken(role string) string {
	token := roleSplit.Split(strings.ToLower(strings.TrimSpace(role)), 2)[0]
	return strings.TrimPrefix(token, "role=")
}

func isTypingFill(row map[string]any) bool {
	if str(row, "action") != "fill" {
		return false
	}
	if _, ok := elementIndex(row); !ok {
		return false
	}
	role, ok := row["expected_role"].(string)
	if !ok {
		return false
	}
	token := roleToken(role)
	return token != "" && !choiceRoles[token] && typingRoles[token]
}

func typingFields(plan Plan) []typingField {
	var fields []typingField
	seen := map[int]bool{}
	for _, row := range planActions(plan) {
		if !isTypingFill(row) {
			continue
		}
		index, _ := elementIndex(row)
		if seen[index] {
			continue
		}
		seen[index] = true
		question := strings.TrimSpace(str(row, "expected_label"))
		if question == "" {
			question = fmt.Sprintf("Field %d", index)
		}
		fields = append(fields, typingField{ElementIndex: index, Question: question, Role: roleToken(str(row, "expected_role")), Draft: str(row, "value")})
	}
	return fields
}

// proseDraftMinWords marks a one-line field as prose: a planner draft this long is a
// written answer, not a fact.
const proseDraftMinWords = 8

// proseFields keeps the fields that need a written answer: a textarea, or a draft
// long enough to be prose. Short facts (names, dates, phone numbers) stay as the
// planner wrote them, so the writer only runs when there is prose to write.
func proseFields(fields []typingField) []typingField {
	out := fields[:0:0]
	for _, field := range fields {
		if field.Role == "textarea" || len(strings.Fields(field.Draft)) >= proseDraftMinWords {
			out = append(out, field)
		}
	}
	return out
}

func overlayTypingFills(plan Plan, values map[int]string) Plan {
	if len(values) == 0 {
		return plan
	}
	for _, row := range planActions(plan) {
		if !isTypingFill(row) {
			continue
		}
		index, _ := elementIndex(row)
		if next := strings.TrimSpace(values[index]); next != "" {
			row["value"] = next
		}
	}
	return plan
}

func parseProseAnswers(text string, allowed map[int]bool) (map[int]string, error) {
	var parsed struct {
		Answers []struct {
			ElementIndex any    `json:"element_index"`
			Value        string `json:"value"`
		} `json:"answers"`
	}
	if err := decodeObject(text, &parsed); err != nil {
		return nil, err
	}
	answers := map[int]string{}
	for _, row := range parsed.Answers {
		var index int
		switch value := row.ElementIndex.(type) {
		case float64:
			index = int(value)
		case string:
			if _, err := fmt.Sscanf(strings.TrimSpace(value), "%d", &index); err != nil {
				continue
			}
		default:
			continue
		}
		if allowed != nil && !allowed[index] {
			continue
		}
		if value := strings.TrimSpace(row.Value); value != "" {
			answers[index] = value
		}
	}
	return answers, nil
}

// jobContext is the title and company of the bound job, when the extension sent one.
func jobContext(page map[string]any) string {
	job, _ := page["job"].(map[string]any)
	var parts []string
	for _, key := range []string{"title", "company", "companyName"} {
		if value, ok := job[key].(string); ok && strings.TrimSpace(value) != "" {
			parts = append(parts, key+": "+strings.TrimSpace(value))
		}
	}
	return strings.Join(parts, "\n")
}

func proseUserPrompt(applicant string, fields []typingField, page map[string]any) string {
	blocks := make([]string, 0, len(fields))
	for _, field := range fields {
		draft := strings.TrimSpace(field.Draft)
		if draft == "" {
			draft = "(none)"
		}
		block := fmt.Sprintf("element_index: %d\nrole: %s\nquestion: %s\ndraft: %s", field.ElementIndex, field.Role, field.Question, draft)
		if limits := strings.TrimSpace(field.Limits); limits != "" {
			block += "\nfield limits: " + limits
		}
		if note := strings.TrimSpace(field.Note); note != "" {
			block += "\npage error: " + note
		}
		blocks = append(blocks, block)
	}
	job := ""
	if context := jobContext(page); context != "" {
		job = "Job context:\n" + context + "\n\n"
	}
	return strings.TrimSpace("PROFILE JSON:\n" + applicant + "\n\n" + job +
		"Typing fields (answer every element_index):\n" + strings.Join(blocks, "\n\n") +
		"\n\nReturn json with one answers[].value per field.")
}

// qaFieldIndex is the single field a Q&A question is written as.
const qaFieldIndex = 1

// analyzeUserPrompt orders the request for the provider's prompt cache: the
// applicant (the same on every call for this account) comes right after the
// fixed system prompt, then the page tree, and the page details that change on
// every call (URL, capture time) come last.
func analyzeUserPrompt(applicant, pureTree string, page map[string]any) string {
	return strings.TrimSpace("Applicant data:\n" + applicant + "\n\nPure Tree:\n" + pureTree + "\n\n" + pageBlock(page) + analyzeUserTail)
}

func pageBlock(page map[string]any) string {
	if len(page) == 0 {
		return ""
	}
	return "Page:\n" + indentedJSON(page) + "\n\n"
}

// indentedJSON is JSON.stringify(value, null, 2): readable, with no HTML escaping.
func indentedJSON(value any) string {
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		return "{}"
	}
	return strings.TrimRight(out.String(), "\n")
}
