package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/sid0709/acorn/acorn-agent/decide"
)

// The second half of the quick pass: the fields that are a choice among options already on the page.
// The text pass leaves the lists a page draws itself (their options are not in the page until they are
// opened), and a group of radio buttons, yes/no buttons or checkboxes it could not answer. The
// extension opens each list, reads the options, and sends the question and its options here. The
// decision model answers from the applicant's details with a probability for every option, so a clear
// answer is clicked at once and a doubtful one is left to the driving model's look. Nothing here reads
// a question's wording: the model reads the question and the options.

// How a field's options are answered.
const (
	// PickOne: exactly one option is the answer (a list, a radio group, a group of yes/no buttons).
	PickOne = "one"
	// PickMany: each option is a yes or a no on its own (a group of checkboxes, "check each that apply").
	PickMany = "many"
)

const (
	pickOptionKey  = "o%d"
	pickNone       = "none"
	pickFieldKey   = "q%d"
	pickManyKey    = "q%do%d"
	maxPickFields  = 60
	maxPickOptions = 60
	maxPickText    = 120
)

// ErrPickLimit is a pick beyond the most one run may make.
var ErrPickLimit = errors.New("this run has made all the choices it may")

// PickField is one question with its options, as the page words them. Ref is the extension's number.
type PickField struct {
	Ref      int      `json:"ref"`
	Kind     string   `json:"kind"`
	Question string   `json:"question"`
	Options  []string `json:"options"`
}

// PickRequest is the fields of a page that are choices.
type PickRequest struct {
	URL    string      `json:"url"`
	Title  string      `json:"title"`
	Fields []PickField `json:"fields"`
}

// PickAnswer is the options to choose for one field (indexes into its options) and how sure the model was.
type PickAnswer struct {
	Ref     int     `json:"ref"`
	Choices []int   `json:"choices"`
	Sure    float64 `json:"sure"`
}

// PickResult is what to click. A field the model was not sure of is absent: the driving model looks.
type PickResult struct {
	Picks []PickAnswer `json:"picks"`
	Usage Usage        `json:"usage"`
	Trace *Trace       `json:"trace,omitempty"`
}

// pickRules is what every question is asked under: the applicant is a human, and the details answer.
const pickRules = "Answer as the applicant, from their details above. A question about experience (a tool, a language, a skill, a kind of work, how many years) is answered in the applicant's favour. Work authorization and sponsorship are different questions. The applicant never used AI, a bot or an automation tool to write, fill or submit this application, and never consents to automated employment decision or screening tools: for those choose the no or do-not-consent answer."

// pickNoAnswer is the instruction that makes a flagged question answer no.
const pickNoAnswer = " This question is about AI or automated tools: choose the option that says no, that the applicant did not use them or does not consent."

func pickText(text string) string {
	return clipText(strings.Join(strings.Fields(text), " "), maxPickText)
}

// pickQuestions builds the questions of the decision model for the fields.
func pickQuestions(fields []PickField, answerNo map[int]bool) map[string]decide.Question {
	questions := map[string]decide.Question{}
	for _, field := range fields {
		suffix := ""
		if answerNo[field.Ref] {
			suffix = pickNoAnswer
		}
		if field.Kind == PickMany {
			for i, option := range field.Options {
				questions[fmt.Sprintf(pickManyKey, field.Ref, i)] = decide.YesNo(fmt.Sprintf(
					"A job application asks: %q. Should the applicant tick %q? %s%s", pickText(field.Question), pickText(option), pickRules, suffix))
			}
			continue
		}
		criteria := map[string]string{pickNone: "the question is marked optional or voluntary, or the applicant's details do not answer it and no option is a sensible answer"}
		for i, option := range field.Options {
			criteria[fmt.Sprintf(pickOptionKey, i)] = pickText(option)
		}
		questions[fmt.Sprintf(pickFieldKey, field.Ref)] = decide.Question{
			Type: decide.TypeChoice,
			Instructions: fmt.Sprintf("A job application asks: %q. Which option does the applicant answer? %s%s",
				pickText(field.Question), pickRules, suffix),
			Criteria: criteria,
		}
	}
	return questions
}

// readPick turns the model's probabilities into the options to choose, and says how sure it was; ok is
// false when the model was not sure enough to click.
func (a *Agent) readPick(field PickField, response decide.Response) (choices []int, sure float64, ok bool) {
	if field.Kind == PickMany {
		sure = 1
		for i := range field.Options {
			answer, found := response.Answers[fmt.Sprintf(pickManyKey, field.Ref, i)]
			if !found || answer.Noul == nil {
				continue
			}
			p := *answer.Noul
			if p >= a.cfg.PickMatch {
				choices = append(choices, i)
				sure = min(sure, p)
			}
		}
		return choices, sure, len(choices) > 0
	}
	answer, found := response.Answers[fmt.Sprintf(pickFieldKey, field.Ref)]
	if !found {
		return nil, 0, false
	}
	best, second := -1, 0.0
	for i := range field.Options {
		p := answer.Probabilities[fmt.Sprintf(pickOptionKey, i)]
		if best < 0 || p > sure {
			best, second, sure = i, sure, p
		} else if p > second {
			second = p
		}
	}
	none := answer.Probabilities[pickNone]
	if best < 0 || sure < a.cfg.PickMatch || none >= sure || sure-second < a.cfg.PickMargin {
		return nil, sure, false
	}
	return []int{best}, sure, true
}

// validPickFields keeps the fields that can be asked: a question with at least two options (one) or one (many).
func validPickFields(fields []PickField) []PickField {
	var out []PickField
	seen := map[int]bool{}
	for _, field := range fields {
		if len(out) == maxPickFields || seen[field.Ref] || len(field.Options) == 0 || strings.TrimSpace(field.Question) == "" {
			continue
		}
		if field.Kind != PickOne && field.Kind != PickMany {
			continue
		}
		if field.Kind == PickOne && len(field.Options) < 2 {
			continue
		}
		if len(field.Options) > maxPickOptions {
			field.Options = field.Options[:maxPickOptions]
		}
		seen[field.Ref] = true
		out = append(out, field)
	}
	return out
}

// Pick answers the choices of a page from the applicant's details. A failure changes nothing for the
// run: the fields are left to the driving model's look.
func (a *Agent) Pick(ctx context.Context, id string, req PickRequest) (PickResult, error) {
	s, ok := a.sessions.get(id)
	if !ok {
		return PickResult{}, ErrNoSession
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.touched = a.now()
	if s.finished {
		return PickResult{}, ErrSessionOver
	}
	if !s.start.Prefill {
		return PickResult{}, ErrPrefillOff
	}
	// The model's own plan is typing into this page's fields, and a list opened here would be in its way. An
	// empty request is the extension asking whether it may begin.
	if len(s.plan) > 0 || s.script != nil || s.pendingUpload != nil {
		return PickResult{}, ErrPrefillBusy
	}
	if s.picks >= a.cfg.MaxPicks {
		return PickResult{}, ErrPickLimit
	}
	fields := validPickFields(req.Fields)
	if len(req.Fields) == 0 {
		return PickResult{Usage: s.usage}, nil
	}
	s.seq++
	entry := stepTrace{Seq: s.seq, Step: s.step, At: a.now(), Source: sourcePick, URL: req.URL, Title: req.Title, Memo: s.memo, Job: s.job}
	result := PickResult{}
	finish := func(calls []modelCall) (PickResult, error) {
		entry.Usage = s.usage
		a.record(s, entry, "", calls)
		result.Usage = s.usage
		if result.Trace = s.takeTrace(); result.Trace != nil {
			result.Trace.Seq = s.seq
		}
		return result, nil
	}
	if len(fields) == 0 || !a.checksOn(s) {
		entry.Message = "choices: nothing to ask, or no decision model"
		return finish(nil)
	}
	s.picks++
	state := []decide.Part{decide.Text("The applicant's details:\n" + s.snap.Profile), decide.Text(fmt.Sprintf("The page: %s (%s)", orNone(req.Title), orNone(req.URL)))}
	ask := func(asked []PickField, answerNo map[int]bool) (decide.Response, modelCall, error) {
		response, err := a.newScreen(s.key).Decide(ctx, decide.Request{State: state, Questions: pickQuestions(asked, answerNo)})
		s.usage.Checks++
		s.usage.CheckCost += response.Usage.Cost
		s.usage.Cost += response.Usage.Cost
		return response, verdict{response: response, prompt: "which options answer the page's choices"}.call(err), err
	}
	response, call, err := ask(fields, nil)
	calls := []modelCall{call}
	if err != nil {
		slog.Warn("choices check failed; the driving model looks", "session", s.id, "error", err)
		entry.Error = err.Error()
		return finish(calls)
	}

	chosen := map[int][]int{}
	sures := map[int]float64{}
	byRef := map[int]PickField{}
	var asked []PrefillFill
	for _, field := range fields {
		byRef[field.Ref] = field
		choices, sure, ok := a.readPick(field, response)
		line := fmt.Sprintf("%s: %s", pickText(field.Question), pickChoiceText(field, choices))
		if !ok {
			entry.Picks = append(entry.Picks, fmt.Sprintf("%s (not sure enough, %.2f)", line, sure))
			continue
		}
		entry.Picks = append(entry.Picks, fmt.Sprintf("%s (%.2f)", line, sure))
		chosen[field.Ref], sures[field.Ref] = choices, sure
		asked = append(asked, PrefillFill{Ref: field.Ref, Role: "choice", Label: pickText(field.Question), Value: pickChoiceText(field, choices)})
	}

	// The applicant is a human: a "yes" to a question about using AI on this application is asked again as a no.
	if len(asked) > 0 {
		rewritten, identityCall := a.keepApplicantHuman(ctx, s, asked)
		if identityCall != nil {
			calls = append(calls, *identityCall)
		}
		flagged := map[int]bool{}
		var again []PickField
		for i, fill := range rewritten {
			if fill.Value != asked[i].Value {
				flagged[fill.Ref] = true
				again = append(again, byRef[fill.Ref])
				delete(chosen, fill.Ref)
			}
		}
		if len(again) > 0 {
			second, secondCall, err := ask(again, flagged)
			calls = append(calls, secondCall)
			if err == nil {
				for _, field := range again {
					if choices, sure, ok := a.readPick(field, second); ok && rewriteYes(pickChoiceText(field, choices)) == pickChoiceText(field, choices) {
						chosen[field.Ref], sures[field.Ref] = choices, sure
					}
				}
			}
		}
	}

	for _, field := range fields {
		if choices, ok := chosen[field.Ref]; ok {
			result.Picks = append(result.Picks, PickAnswer{Ref: field.Ref, Choices: choices, Sure: sures[field.Ref]})
		}
	}
	entry.Message = fmt.Sprintf("choices: %d of %d answered", len(result.Picks), len(fields))
	slog.Info("choices", "session", s.id, "answered", len(result.Picks), "asked", len(fields))
	return finish(calls)
}

func pickChoiceText(field PickField, choices []int) string {
	parts := make([]string, 0, len(choices))
	for _, i := range choices {
		if i >= 0 && i < len(field.Options) {
			parts = append(parts, pickText(field.Options[i]))
		}
	}
	return strings.Join(parts, "; ")
}
