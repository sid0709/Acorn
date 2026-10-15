package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/acorn-agent/decide"
	"github.com/sid0709/OpenSeat/acorn-agent/llm"
)

// The driving model plans a whole screen at once and says, at the end of each run of actions it
// is sure of, what the screen should then show. A decision model (cheap and quick, because it
// answers with probabilities and writes no text) looks at the screenshot after that run. When
// the screen matches, the next run goes out without the driving model looking again; when it
// does not, or anything is in the way, the driving model looks and decides. The driving model
// is the only one that ever plans or recovers: the checker only says yes or no.

// Screen is the decision model that reads a screenshot. *decide.Client is the real one.
type Screen interface {
	Decide(ctx context.Context, req decide.Request) (decide.Response, error)
	Name() string
}

// Questions asked of every screenshot, and the keys their answers come back under.
const (
	askMatches = "matches"
	askBlocked = "blocked"
	askLoading = "loading"
)

// chunk is a run of planned actions and what the screen should show once it has run.
type chunk struct {
	actions []Action
	// expect is the model's own words for that; empty means the model asked to look first.
	expect string
}

// splitPlan cuts a plan into runs. A run ends at an action the model put a check on, or
// after limit actions when it did not, so no run goes unchecked for longer than that.
func splitPlan(actions []Action, limit int) []chunk {
	var out []chunk
	var current []Action
	for _, action := range actions {
		current = append(current, action)
		if action.Check != "" || (limit > 0 && len(current) == limit) {
			out = append(out, chunk{actions: current, expect: action.Check})
			current = nil
		}
	}
	if len(current) > 0 {
		out = append(out, chunk{actions: current})
	}
	return out
}

// verdict is what the checker made of a screenshot.
type verdict struct {
	matches, blocked, loading float64
	response                  decide.Response
	prompt                    string
}

// checkState is what the checker is told beside the screenshot.
func checkState(screenshot string) []decide.Part {
	return []decide.Part{
		decide.Text("A screenshot of a web page the applicant's browser is on."),
		decide.Image(screenshot),
	}
}

// checkQuestions are the three things asked about a screenshot, in the model's own words for
// what it expected.
func checkQuestions(expect string) map[string]decide.Question {
	return map[string]decide.Question{
		askMatches: decide.YesNo("Someone has just typed and clicked on this page. They expected the page to now show: " + expect + ". Does the screenshot show that?"),
		askBlocked: decide.YesNo("Is the page blocked by something other than the form itself: a popup, dialog or overlay covering the form, a CAPTCHA, a sign-in wall, or a page-level error such as 'something went wrong'? A small validation message beside a form field does not count."),
		askLoading: decide.YesNo("Is the page still loading or changing: a spinner, a progress bar, or a blank or half-drawn page?"),
	}
}

// look asks the checker about a screenshot.
func look(ctx context.Context, screen Screen, screenshot, expect string) (verdict, error) {
	questions := checkQuestions(expect)
	response, err := screen.Decide(ctx, decide.Request{State: checkState(screenshot), Questions: questions})
	out := verdict{response: response, prompt: expect}
	if err != nil {
		return out, err
	}
	for key, target := range map[string]*float64{askMatches: &out.matches, askBlocked: &out.blocked, askLoading: &out.loading} {
		answer, ok := response.Answers[key]
		if !ok || answer.Noul == nil {
			return out, fmt.Errorf("the checker gave no answer to %q", key)
		}
		*target = *answer.Noul
	}
	return out, nil
}

// Outcomes of a check.
const (
	checkContinue = "continue"
	checkWait     = "wait"
	checkLook     = "model"
)

// judge decides what a verdict means: carry on with the plan, wait for the page, or give
// the screenshot to the driving model.
func (a *Agent) judge(v verdict, loadWaits int) (outcome, reason string) {
	cfg := a.cfg
	switch {
	case v.matches >= cfg.CheckMatch && v.blocked <= cfg.CheckBlocked && v.loading <= cfg.CheckLoading:
		return checkContinue, ""
	case v.loading >= cfg.CheckLoadingWait && loadWaits < cfg.MaxLoadWaits:
		return checkWait, fmt.Sprintf("the page looks like it is still loading (%.2f)", v.loading)
	case v.blocked > cfg.CheckBlocked:
		return checkLook, fmt.Sprintf("something may be in the way (%.2f)", v.blocked)
	case v.loading > cfg.CheckLoading:
		return checkLook, fmt.Sprintf("the page may still be loading (%.2f)", v.loading)
	}
	return checkLook, fmt.Sprintf("the screen may not show what was expected (%.2f)", v.matches)
}

// checkTrace is a check as the trace shows it.
type checkTrace struct {
	Expect    string  `json:"expect"`
	Matches   float64 `json:"matches"`
	Blocked   float64 `json:"blocked"`
	Loading   float64 `json:"loading"`
	Outcome   string  `json:"outcome"`
	Reason    string  `json:"reason,omitempty"`
	Model     string  `json:"model,omitempty"`
	LatencyMs int64   `json:"latencyMs"`
	Error     string  `json:"error,omitempty"`
}

// call is the check as a model call, for the trace.
func (v verdict) call(err error) modelCall {
	answers, _ := json.Marshal(v.response.Answers)
	call := modelCall{
		Kind:      "decision",
		Messages:  []tracedMessage{{Role: "state", Text: "expected: " + v.prompt, Images: 1}},
		Content:   string(answers),
		Model:     v.response.Model,
		Usage:     llm.Usage{InputTokens: v.response.Usage.InputTokens, OutputTokens: v.response.Usage.OutputTokens, Cost: v.response.Usage.Cost},
		LatencyMs: v.response.Latency.Milliseconds(),
	}
	if err != nil {
		call.Error = err.Error()
	}
	return call
}

// checksOn is whether this run uses the checker.
func (a *Agent) checksOn(s *session) bool {
	return a.newScreen != nil && a.cfg.ChunkActions > 0 && !s.checksOff
}

// takePlan stores a new plan and returns the first run to send. A run the model did not put
// a check on ends the plan there: the model looks next. Without a checker a plan is cut to
// the few actions that are safe to send without looking.
func (a *Agent) takePlan(s *session, actions []Action, dropped []string) ([]Action, []string) {
	s.plan, s.verify, s.loadWaits, s.parts = nil, "", 0, 0
	s.planned, s.sent = len(actions), 0
	if len(actions) == 0 {
		return nil, dropped
	}
	if !a.checksOn(s) {
		if limit := a.cfg.UncheckedActions; limit > 0 && len(actions) > limit {
			dropped = append(dropped, fmt.Sprintf("%d actions were not sent: only %d run without a check", len(actions)-limit, limit))
			actions = actions[:limit]
		}
		s.sent, s.parts = len(actions), 1
		return actions, dropped
	}
	return a.sendRun(s, splitPlan(actions, a.cfg.ChunkActions), dropped)
}

// sendRun sends the first of the runs and keeps the rest only if the screen can be checked
// after it.
func (a *Agent) sendRun(s *session, runs []chunk, dropped []string) ([]Action, []string) {
	first, rest := runs[0], runs[1:]
	s.sent += len(first.actions)
	s.parts++
	if len(rest) > 0 && first.expect == "" {
		skipped := 0
		for _, run := range rest {
			skipped += len(run.actions)
		}
		dropped = append(dropped, fmt.Sprintf("%d planned actions were not sent: the run before them had no check, so the model looks first", skipped))
		s.notes = append(s.notes, fmt.Sprintf("You planned %d actions: %d ran. The rest did not run because the actions before them had no check; look at the screen and plan again.", s.planned, s.sent))
		rest = nil
	}
	s.plan = rest
	s.verify = ""
	if len(rest) > 0 {
		s.verify = first.expect
	}
	return first.actions, dropped
}

// abandon drops the rest of the plan and tells the model why on its next look.
func (a *Agent) abandon(s *session, reason string) {
	left := s.planned - s.sent
	s.plan, s.verify = nil, ""
	if s.planned == 0 {
		return
	}
	s.notes = append(s.notes, fmt.Sprintf("You planned %d actions: %d ran, %d did not. %s", s.planned, s.sent, left, reason))
}

// continuePlan runs the next part of the model's plan if the screen shows what the model
// expected, without calling the model. It reports false when the model must look instead.
// results are the results of every action sent since the model last looked.
func (a *Agent) continuePlan(ctx context.Context, s *session, obs Observation, results []ActionResult, sig []uint8, stale int) (Step, bool) {
	if s.verify == "" || len(s.plan) == 0 || !a.checksOn(s) {
		return Step{}, false
	}
	entry := stepTrace{
		Seq: s.seq, Step: s.step, At: a.now(), Source: sourceCheck, URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport,
		Focus: obs.Focus, Notes: obs.Notes, Results: obs.Results, Stale: stale,
	}
	expect := s.verify
	if failed := failedResults(obs.Results); failed != "" {
		a.abandon(s, "The last actions failed: "+failed+".")
		return Step{}, false
	}
	// A page that is loading may look the same for a moment; anything else that did not move
	// is not what the model expected.
	if stale > 0 && s.loadWaits == 0 {
		a.abandon(s, "The screen did not change after them, so it is not what you expected.")
		return Step{}, false
	}
	verdict, err := look(ctx, a.newScreen(s.key), obs.Screenshot, expect)
	s.usage.Checks++
	s.usage.CheckCost += verdict.response.Usage.Cost
	s.usage.Cost += verdict.response.Usage.Cost
	check := checkTrace{
		Expect: expect, Matches: verdict.matches, Blocked: verdict.blocked, Loading: verdict.loading,
		Model: verdict.response.Model, LatencyMs: verdict.response.Latency.Milliseconds(),
	}
	if err != nil {
		// A checker that fails is not worth asking again this run; the model looks instead.
		s.checksOff = true
		check.Outcome, check.Error = checkLook, err.Error()
		entry.Check, entry.Usage = &check, s.usage
		a.record(s, entry, obs.Screenshot, []modelCall{verdict.call(err)})
		a.abandon(s, "The screen could not be checked, so the rest of your plan did not run.")
		slog.Warn("screen check failed; the run goes on without checks", "session", s.id, "error", err)
		return Step{}, false
	}
	outcome, reason := a.judge(verdict, s.loadWaits)
	check.Outcome, check.Reason = outcome, reason
	entry.Check, entry.Usage = &check, s.usage
	switch outcome {
	case checkContinue:
		s.carried = results
		s.stale, s.lastSig = 0, sig
		s.loadWaits = 0
		actions, dropped := a.sendRun(s, s.plan, nil)
		step := Step{Status: StatusWorking, Message: s.message, Actions: actions, Number: s.step, Usage: s.usage, Dropped: dropped}
		entry.Status, entry.Message, entry.Actions, entry.Dropped = step.Status, step.Message, actions, dropped
		entry.Memo, entry.Job = s.memo, s.job
		a.record(s, entry, obs.Screenshot, []modelCall{verdict.call(nil)})
		return step, true
	case checkWait:
		s.loadWaits++
		s.stale, s.lastSig = stale, sig
		wait := Action{ID: fmt.Sprintf("s%dw%d", s.step, s.loadWaits), Kind: KindWait, Ms: int(a.cfg.LoadWait / time.Millisecond)}
		s.carried = results
		step := Step{Status: StatusWorking, Message: s.message, Actions: []Action{wait}, Number: s.step, Usage: s.usage}
		entry.Status, entry.Message, entry.Actions = step.Status, step.Message, step.Actions
		entry.Memo, entry.Job = s.memo, s.job
		a.record(s, entry, obs.Screenshot, []modelCall{verdict.call(nil)})
		return step, true
	}
	a.record(s, entry, obs.Screenshot, []modelCall{verdict.call(nil)})
	a.abandon(s, "The checker did not confirm the screen showed what you expected ("+expect+"): "+reason+".")
	return Step{}, false
}

// failedResults names the actions that failed, or is empty.
func failedResults(results []ActionResult) string {
	var failed []string
	for _, result := range results {
		if !result.OK {
			failed = append(failed, strings.TrimSpace(result.ID+" "+result.Error))
		}
	}
	return strings.Join(failed, "; ")
}

// screenName is the checker's model id, for the trace.
func (a *Agent) screenName(key string) string {
	if a.newScreen == nil {
		return ""
	}
	if screen := a.newScreen(key); screen != nil {
		return screen.Name()
	}
	return ""
}
