package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/sid0709/acorn/acorn-agent/decide"
)

// The second half of the DOM-first loop: a page that reviewed clean goes on to its next control. The
// extension lists the page's buttons from the DOM; the decision model picks, among those that exist,
// the one that continues the application, and says whether it is the one that sends it. Nothing here
// decides from a button's wording: the model reads the list and the screenshot.

// What an advance tells the extension to do.
const (
	// AdvanceClick: click the control named.
	AdvanceClick = "click"
	// AdvanceReady: the control that sends the application was found and the run is to stop before it.
	AdvanceReady = "ready_to_submit"
	// AdvanceNone: no control was found with enough certainty; the driving model looks.
	AdvanceNone = "none"
)

// Questions of an advance.
const (
	askAdvance     = "advance"
	askFinal       = "final"
	advanceNone    = "none"
	candidateKeyFn = "c%d"
)

// maxAdvanceCandidates bounds the controls one advance is asked about, and maxCandidateText each one's text.
const (
	maxAdvanceCandidates = 40
	maxCandidateText     = 80
)

// ErrAdvanceLimit is an advance beyond the most one run may make.
var ErrAdvanceLimit = errors.New("this run has made all the advances it may")

// AdvanceCandidate is one control of the page that could be pressed, as the page words it.
type AdvanceCandidate struct {
	// Ref is the extension's number for it, meaningless here.
	Ref  int    `json:"ref"`
	Text string `json:"text"`
	// Kind is "submit" for a submit input or button, else "button".
	Kind string `json:"kind"`
	// InForm is whether it sits inside a form element.
	InForm bool `json:"inForm,omitempty"`
}

// AdvanceRequest is the page that reviewed clean, with the controls on it.
type AdvanceRequest struct {
	URL        string             `json:"url"`
	Title      string             `json:"title"`
	Screenshot string             `json:"screenshot"`
	Candidates []AdvanceCandidate `json:"candidates"`
}

// AdvanceResult is what to do about the page.
type AdvanceResult struct {
	Action string `json:"action"`
	Ref    int    `json:"ref,omitempty"`
	Text   string `json:"text,omitempty"`
	// Submit is whether the control sends the application rather than moving to another step.
	Submit bool `json:"submit,omitempty"`
	// Step ends the run when it is ready to submit and the applicant wants to review first.
	Step  *Step  `json:"step,omitempty"`
	Usage Usage  `json:"usage"`
	Trace *Trace `json:"trace,omitempty"`
}

// candidateList is the controls as the decision model reads them, and the criteria that name each.
func candidateList(candidates []AdvanceCandidate) (string, map[string]string, map[string]AdvanceCandidate) {
	var lines []string
	criteria := map[string]string{advanceNone: "none of these controls moves the application on"}
	byKey := map[string]AdvanceCandidate{}
	for i, candidate := range candidates {
		key := fmt.Sprintf(candidateKeyFn, i)
		text := clipText(strings.Join(strings.Fields(candidate.Text), " "), maxCandidateText)
		description := fmt.Sprintf("%s %q", candidate.Kind, text)
		if candidate.InForm {
			description += " (in the form)"
		}
		criteria[key] = description
		byKey[key] = candidate
		lines = append(lines, key+": "+description)
	}
	return "Controls on the page:\n" + strings.Join(lines, "\n"), criteria, byKey
}

// finalCriteria is the same controls, with a "none" that says no control sends the application.
func finalCriteria(criteria map[string]string) map[string]string {
	out := make(map[string]string, len(criteria))
	for key, description := range criteria {
		out[key] = description
	}
	out[advanceNone] = "none of these controls sends the application: the application has more steps after this page"
	return out
}

// Advance picks the control that continues the application. A failure here changes nothing for the
// run: the caller goes on to the driving model's own look.
func (a *Agent) Advance(ctx context.Context, id string, req AdvanceRequest) (AdvanceResult, error) {
	s, ok := a.sessions.get(id)
	if !ok {
		return AdvanceResult{}, ErrNoSession
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.touched = a.now()
	if s.finished {
		return AdvanceResult{}, ErrSessionOver
	}
	if !s.start.Prefill {
		return AdvanceResult{}, ErrPrefillOff
	}
	if s.advances >= a.cfg.MaxAdvances {
		return AdvanceResult{}, ErrAdvanceLimit
	}
	candidates := req.Candidates
	if len(candidates) > maxAdvanceCandidates {
		candidates = candidates[:maxAdvanceCandidates]
	}
	s.seq++
	entry := stepTrace{Seq: s.seq, Step: s.step, At: a.now(), Source: sourceAdvance, URL: req.URL, Title: req.Title, Memo: s.memo, Job: s.job}
	result := AdvanceResult{Action: AdvanceNone}
	finish := func(call *modelCall) (AdvanceResult, error) {
		entry.Usage = s.usage
		var calls []modelCall
		if call != nil {
			calls = append(calls, *call)
		}
		a.record(s, entry, req.Screenshot, calls)
		result.Usage = s.usage
		if result.Trace = s.takeTrace(); result.Trace != nil {
			result.Trace.Seq = s.seq
		}
		if result.Step != nil {
			result.Step.Usage = s.usage
		}
		return result, nil
	}
	if len(candidates) == 0 || !a.checksOn(s) || req.Screenshot == "" {
		entry.Message = "advance: no control to choose from, or no decision model"
		return finish(nil)
	}

	s.advances++
	listing, criteria, byKey := candidateList(candidates)
	state := append(checkState(req.Screenshot), decide.Text(listing))
	response, err := a.newScreen(s.key).Decide(ctx, decide.Request{State: state, Questions: map[string]decide.Question{
		askAdvance: {
			Type:         decide.TypeChoice,
			Instructions: "This is a job application form that has been filled in. Which control moves the application on: to the next step, or to send it when it is the last? Choose none when none of them does, for example a control that clears, saves a draft, goes back, or only opens help.",
			Criteria:     criteria,
		},
		askFinal: {
			Type:         decide.TypeChoice,
			Instructions: "This is a job application form. Which control sends the whole application, so that nothing more has to be filled in after it? Choose none when the application has more steps after this page.",
			Criteria:     finalCriteria(criteria),
		},
	}})
	s.usage.Checks++
	s.usage.CheckCost += response.Usage.Cost
	s.usage.Cost += response.Usage.Cost
	call := verdict{response: response, prompt: "which control continues the application"}.call(err)
	if err != nil {
		slog.Warn("advance check failed; the driving model looks", "session", s.id, "error", err)
		entry.Error = err.Error()
		return finish(&call)
	}
	next := response.Answers[askAdvance]
	chosen, sure := next.Choice, next.Probabilities[next.Choice]
	candidate, found := byKey[chosen]
	if chosen == advanceNone || !found || sure < a.cfg.AdvanceMatch {
		entry.Message = fmt.Sprintf("advance: no control chosen with enough certainty (%s %.2f)", chosen, sure)
		return finish(&call)
	}
	final := response.Answers[askFinal]
	submit := final.Choice == chosen && final.Probabilities[chosen] >= a.cfg.AdvanceFinal
	result.Ref, result.Text, result.Submit = candidate.Ref, candidate.Text, submit
	entry.Message = fmt.Sprintf("advance: %q (%.2f, submit=%t)", clipText(candidate.Text, maxCandidateText), sure, submit)
	if submit && s.start.StopBeforeSubmit {
		message := "The application is filled in and ready to submit."
		result.Action = AdvanceReady
		s.finished, s.stoppedFor = true, message
		s.plan, s.verify, s.planned, s.sent, s.parts = nil, "", 0, 0, 0
		result.Step = &Step{Status: StatusDone, Message: message, Actions: []Action{}, Number: s.step, Usage: s.usage}
		entry.Status = StatusDone
		return finish(&call)
	}
	result.Action = AdvanceClick
	return finish(&call)
}
