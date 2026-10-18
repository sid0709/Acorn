package agent

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"strings"
	"text/template"

	"github.com/sid0709/acorn/acorn-agent/applicant"
	"github.com/sid0709/acorn/acorn-agent/llm"
)

// A quick text pass. Before the model looks at a page, the extension serializes the page's DOM and
// sends it as text (Oak's "pure tree": one line per element, `tag[id] attributes "text"`). One call
// that reads text only answers the page's plain fields from the same applicant details, and the
// extension types the answers with the same real mouse and keyboard the model's own actions use. The
// next look is told what was filled, so that look checks and repairs instead of discovering.
// Everything the pass cannot do (a list the page draws itself, an upload, a field that already holds a
// value) is left to the model's own look.

//go:embed prompts/prefill.md
var prefillTemplateText string

var prefillTemplate = template.Must(template.New("prefill").Parse(prefillTemplateText))

// What a fill does to its field. The names are Oak's plan actions.
const (
	// FillText puts the value in a text box, or chooses it in a native list.
	FillText = "fill"
	// FillGroup picks the option of a radio group or a checkbox group that reads as the value; the
	// field named is any member of the group.
	FillGroup = "select_radio"
)

// Limits of one pass.
const (
	// maxPrefillTreeChars bounds the page one pass is asked about, so one call stays bounded.
	maxPrefillTreeChars = 300_000
	// maxPrefillLine bounds the labels and values the next look is told about.
	maxPrefillLine = 80
	// maxPrefillNoteLines bounds how many fields the next look is told one by one.
	maxPrefillNoteLines = 40
)

// Errors a caller can tell apart.
var (
	// ErrPrefillOff is a pass asked for by a run that did not turn it on.
	ErrPrefillOff = errors.New("the quick text pass is off for this run")
	// ErrPrefillLimit is a pass beyond the most one run may make.
	ErrPrefillLimit = errors.New("this run has made all the quick text passes it may")
	// ErrPrefillBusy is a pass asked for while the model's own plan is still being carried out: the
	// plan would type into the same fields. The caller asks again at a later look.
	ErrPrefillBusy = errors.New("the model's plan is still being carried out")
	// ErrBadPrefill is a request the agent cannot read.
	ErrBadPrefill = errors.New("the page is not usable")
)

// PrefillRequest is the page the run is on, serialized.
type PrefillRequest struct {
	URL   string `json:"url"`
	Title string `json:"title"`
	// Tree is the page as lines of `tag[id] attributes "text"`, indented by depth.
	Tree string `json:"tree"`
}

// PrefillFill is one field to fill and with what. Ref is the number the field has in the tree.
type PrefillFill struct {
	Ref    int    `json:"ref"`
	Action string `json:"action"`
	// Label is the question the field answers, as the model read it from the page.
	Label string `json:"label,omitempty"`
	// Role is what kind of control the model took it for ("textbox", "combobox", "radio").
	Role  string `json:"role,omitempty"`
	Value string `json:"value,omitempty"`
}

// PrefillPlan is what the extension types.
type PrefillPlan struct {
	Fills []PrefillFill `json:"fills"`
	// Dropped says which answers the agent refused and why, for the log.
	Dropped []string `json:"dropped,omitempty"`
	Usage   Usage    `json:"usage"`
	Trace   *Trace   `json:"trace,omitempty"`
}

// PrefillLine is one field in a report: its label, and what was typed or why it was not.
type PrefillLine struct {
	Label string `json:"label"`
	Value string `json:"value,omitempty"`
	Error string `json:"error,omitempty"`
}

// PrefillReport is what the extension did with a plan, told to the model at its next look.
type PrefillReport struct {
	Filled []PrefillLine `json:"filled,omitempty"`
	Failed []PrefillLine `json:"failed,omitempty"`
}

const prefillSchemaName = "prefill"

var prefillSchema = json.RawMessage(`{
  "type": "object",
  "additionalProperties": false,
  "required": ["fills"],
  "properties": {
    "fills": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["element_index", "action", "expected_label", "expected_role", "value"],
        "properties": {
          "element_index": {"type": "integer"},
          "action": {"type": "string", "enum": ["fill", "select_radio"]},
          "expected_label": {"type": "string"},
          "expected_role": {"type": "string"},
          "value": {"type": "string"}
        }
      }
    }
  }
}`)

type prefillReply struct {
	Fills []struct {
		ElementIndex  int    `json:"element_index"`
		Action        string `json:"action"`
		ExpectedLabel string `json:"expected_label"`
		ExpectedRole  string `json:"expected_role"`
		Value         string `json:"value"`
	} `json:"fills"`
}

type prefillPromptData struct {
	Profile string
	Token   string
	Today   string
}

// prefillSystem is the standing instruction of the pass, with the applicant's details.
func prefillSystem(snapshot applicant.Snapshot, today string) (string, error) {
	var out strings.Builder
	err := prefillTemplate.Execute(&out, prefillPromptData{
		Profile: snapshot.Profile,
		Token:   applicant.AccountPasswordToken,
		Today:   today,
	})
	if err != nil {
		return "", fmt.Errorf("build prefill prompt: %w", err)
	}
	return out.String(), nil
}

// prefillReminder closes the user message. Its last sentences, on who the applicant is, are Oak's,
// word for word.
const prefillReminder = `Generate the fills JSON now. Answer the plain fields you can identify, including voluntary/EEO questions; do not omit optional fields the applicant's details answer. Prefer applicant profile facts over none/not-applicable/decline options when the profile answers the question. For unrelated/ambiguous questions, choose the most plausible concrete answer — never use {{...}} placeholders. Fill as the human applicant: never answer that they used AI/automation to write, fill, or submit this application; never identify as a bot; never consent to automated employment decision / screening tools (choose no / do not consent). Workplace AI/LLM tool-use questions (which tools, frequency, impact on work) are experience questions — do not answer those with "I have not used AI".`

// prefillUser is the page, then the reminder.
func prefillUser(req PrefillRequest) string {
	return fmt.Sprintf("Page: %s (%s)\n\nPure Tree:\n%s\n\n%s", orNone(req.Title), orNone(req.URL), req.Tree, prefillReminder)
}

// Prefill answers the plain fields of the page the run is on, in model calls that read text only.
// A failure here changes nothing for the run: the caller goes on to the model's own look.
func (a *Agent) Prefill(ctx context.Context, id string, req PrefillRequest) (PrefillPlan, error) {
	s, ok := a.sessions.get(id)
	if !ok {
		return PrefillPlan{}, ErrNoSession
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.touched = a.now()
	if s.finished {
		return PrefillPlan{}, ErrSessionOver
	}
	if !s.start.Prefill {
		return PrefillPlan{}, ErrPrefillOff
	}
	if s.prefills >= a.cfg.MaxPrefills {
		return PrefillPlan{}, ErrPrefillLimit
	}
	// Chunks of a plan not yet sent, a dropdown being set, or an upload waiting on the person are the
	// model's own work on this page's fields: typing a draft into them would be typed over (or onto).
	if len(s.plan) > 0 || s.script != nil || s.pendingUpload != nil {
		return PrefillPlan{}, ErrPrefillBusy
	}
	nodes, err := readTree(req.Tree)
	if err != nil {
		return PrefillPlan{}, err
	}
	system, err := prefillSystem(s.snap, a.now().Format("2006-01-02"))
	if err != nil {
		return PrefillPlan{}, err
	}

	s.prefills++
	s.seq++
	messages := []llm.Message{
		{Role: llm.RoleSystem, Text: system},
		{Role: llm.RoleUser, Text: prefillUser(req)},
	}
	resp, err := a.newModel(s.key).Complete(ctx, llm.Request{Messages: messages, SchemaName: prefillSchemaName, Schema: prefillSchema})
	s.charge(resp.Usage)
	calls := []modelCall{{
		Messages: traceMessages(messages), Content: resp.Content, FinishReason: resp.FinishReason, Model: resp.Model,
		Usage: resp.Usage, LatencyMs: resp.Latency.Milliseconds(), HTTPAttempts: resp.Attempts,
	}}
	entry := stepTrace{
		Seq: s.seq, Step: s.step, At: a.now(), Source: sourcePrefill, URL: req.URL, Title: req.Title,
		Memo: s.memo, Job: s.job, Usage: s.usage,
	}
	fail := func(err error) (PrefillPlan, error) {
		calls[len(calls)-1].Error = err.Error()
		entry.Error, entry.Usage = err.Error(), s.usage
		a.record(s, entry, "", calls)
		return PrefillPlan{}, err
	}
	if err != nil {
		return fail(err)
	}
	fills, dropped, err := readPrefill(resp.Content, nodes)
	if err != nil {
		return fail(err)
	}

	// The applicant is a human: a question about AI or automated tools is classified by what it asks,
	// and a "yes" to the ones about this application becomes a "no" (identity.go).
	if len(fills) > 0 {
		var identityCall *modelCall
		fills, identityCall = a.keepApplicantHuman(ctx, s, fills)
		if identityCall != nil {
			calls = append(calls, *identityCall)
		}
	}

	entry.Message = fmt.Sprintf("quick text pass: %d fields answered", len(fills))
	entry.Dropped, entry.Usage = dropped, s.usage
	a.record(s, entry, "", calls)
	slog.Info("prefill", "session", s.id, "fills", len(fills), "dropped", len(dropped))
	plan := PrefillPlan{Fills: fills, Dropped: dropped, Usage: s.usage}
	if plan.Trace = s.takeTrace(); plan.Trace != nil {
		plan.Trace.Seq = s.seq
	}
	return plan, nil
}

// charge adds one model call to the run's use.
func (s *session) charge(usage llm.Usage) {
	s.usage.Calls++
	s.usage.InputTokens += usage.InputTokens
	s.usage.OutputTokens += usage.OutputTokens
	s.usage.CachedTokens += usage.CachedTokens
	s.usage.Cost += usage.Cost
}

// treeNode is what a line of the serialized page says of its element: its tag and, for an input,
// its type. That is all the agent reads of the page itself; the rest is the model's.
type treeNode struct {
	tag, inputType string
}

var (
	treeLine = regexp.MustCompile(`^\s*([a-z][a-z0-9-]*)\[(\d+)\](.*)$`)
	typeAttr = regexp.MustCompile(`(?:^|\s)type=("[^"]*"|\S+)`)
)

// readTree numbers the elements of a serialized page: it refuses a page that is empty, too large, or
// has no numbered element, and says what each numbered element is.
func readTree(tree string) (map[int]treeNode, error) {
	if strings.TrimSpace(tree) == "" {
		return nil, fmt.Errorf("%w: it is empty", ErrBadPrefill)
	}
	if len(tree) > maxPrefillTreeChars {
		return nil, fmt.Errorf("%w: %d characters is more than the %d one pass reads", ErrBadPrefill, len(tree), maxPrefillTreeChars)
	}
	nodes := map[int]treeNode{}
	for _, line := range strings.Split(tree, "\n") {
		match := treeLine.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		id, err := strconv.Atoi(match[2])
		if err != nil {
			continue
		}
		node := treeNode{tag: match[1]}
		if typed := typeAttr.FindStringSubmatch(match[3]); typed != nil {
			node.inputType = strings.ToLower(strings.Trim(typed[1], `"`))
		}
		nodes[id] = node
	}
	if len(nodes) == 0 {
		return nil, fmt.Errorf("%w: it has no numbered element", ErrBadPrefill)
	}
	return nodes, nil
}

// readPrefill reads the model's fills and keeps those that are safe to type. Each is held to the
// element it names: a value only goes where that element takes it, and the account password is never
// typed here. Whether the field is still empty, and which options it has, only the page knows: the
// extension checks those as it types.
func readPrefill(content string, nodes map[int]treeNode) ([]PrefillFill, []string, error) {
	content = strings.TrimSpace(content)
	if start := strings.IndexByte(content, '{'); start > 0 {
		content = content[start:]
	}
	var parsed prefillReply
	if err := json.NewDecoder(strings.NewReader(content)).Decode(&parsed); err != nil {
		return nil, nil, fmt.Errorf("the model's answer is not the requested JSON: %w", err)
	}
	var fills []PrefillFill
	var dropped []string
	done := map[int]bool{}
	for _, in := range parsed.Fills {
		label := clipText(strings.TrimSpace(in.ExpectedLabel), maxPrefillLine)
		node, known := nodes[in.ElementIndex]
		switch {
		case !known:
			dropped = append(dropped, fmt.Sprintf("element %d: no such element", in.ElementIndex))
			continue
		case done[in.ElementIndex]:
			dropped = append(dropped, fmt.Sprintf("element %d (%s): answered twice", in.ElementIndex, label))
			continue
		}
		value := strings.TrimSpace(in.Value)
		if why := checkFill(node, in.Action, value); why != "" {
			dropped = append(dropped, fmt.Sprintf("element %d (%s): %s", in.ElementIndex, label, why))
			continue
		}
		done[in.ElementIndex] = true
		fills = append(fills, PrefillFill{Ref: in.ElementIndex, Action: in.Action, Label: label, Role: strings.TrimSpace(in.ExpectedRole), Value: value})
	}
	return fills, dropped, nil
}

// typedInput is whether an input type is one a person types a word into.
func typedInput(inputType string) bool {
	switch inputType {
	case "", "text", "email", "tel", "url", "number":
		return true
	}
	return false
}

// checkFill is why a fill cannot be made to an element, or "" when it can.
func checkFill(node treeNode, action, value string) string {
	if value == "" {
		return "there is nothing to put in"
	}
	if strings.Contains(value, applicant.AccountPasswordToken) {
		return "the account password is not typed here"
	}
	if len([]rune(value)) > maxTypeChars {
		return "the text is too long"
	}
	switch action {
	case FillText:
		switch {
		case node.tag == "textarea" || node.tag == "select":
			return ""
		case node.tag == "input" && typedInput(node.inputType):
			return ""
		}
		return fmt.Sprintf("a %s is not a plain field to fill", describeNode(node))
	case FillGroup:
		if node.tag == "input" && (node.inputType == "radio" || node.inputType == "checkbox") {
			return ""
		}
		return fmt.Sprintf("a %s is not a radio button or a checkbox", describeNode(node))
	}
	return fmt.Sprintf("%q is not an action of this pass", action)
}

func describeNode(node treeNode) string {
	if node.inputType != "" {
		return node.tag + " (" + node.inputType + ")"
	}
	return node.tag
}

// prefillNote is what the model's next look is told about the pass: a draft to check against the
// screenshot, never a fact. Values are shown so the model can compare them with what it sees.
func prefillNote(report *PrefillReport) string {
	if report == nil || (len(report.Filled) == 0 && len(report.Failed) == 0) {
		return ""
	}
	var out strings.Builder
	out.WriteString("A quick pass typed a first draft into this page's plain fields before you looked. It is a draft from the same applicant details, not proof: check each answer against the screenshot, correct what is wrong, and do not retype what is right. Fields it does not list were not touched.")
	if len(report.Filled) > 0 {
		out.WriteString(" Filled: ")
		out.WriteString(prefillLines(report.Filled, func(line PrefillLine) string {
			return fmt.Sprintf("%s = %q", clipText(line.Label, maxPrefillLine), clipText(line.Value, maxPrefillLine))
		}))
		out.WriteString(".")
	}
	if len(report.Failed) > 0 {
		out.WriteString(" Could not fill: ")
		out.WriteString(prefillLines(report.Failed, func(line PrefillLine) string {
			return fmt.Sprintf("%s (%s)", clipText(line.Label, maxPrefillLine), clipText(line.Error, maxPrefillLine))
		}))
		out.WriteString(".")
	}
	return out.String()
}

func prefillLines(lines []PrefillLine, render func(PrefillLine) string) string {
	parts := make([]string, 0, len(lines))
	for _, line := range lines {
		parts = append(parts, render(line))
	}
	return prefillList(parts)
}

// prefillList joins the items of a note, and says how many more there were past the bound.
func prefillList(items []string) string {
	shown := items
	if len(shown) > maxPrefillNoteLines {
		shown = shown[:maxPrefillNoteLines]
	}
	text := strings.Join(shown, "; ")
	if more := len(items) - len(shown); more > 0 {
		text += fmt.Sprintf("; and %d more", more)
	}
	return text
}

// learnPrefill tells the model's next look what the quick text pass did. The note waits in the
// run's notes until the model looks, so a look the agent answers itself does not lose it. Fields
// that were found and typed prove the page is the application form, so the search for it ends.
func (a *Agent) learnPrefill(s *session, obs Observation) {
	if obs.Prefill == nil || !s.start.Prefill {
		return
	}
	if note := prefillNote(obs.Prefill); note != "" {
		s.notes = append(s.notes, note)
	}
	if len(obs.Prefill.Filled) > 0 {
		s.formReady = true
	}
}
