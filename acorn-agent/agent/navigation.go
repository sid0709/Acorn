package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/sid0709/acorn/acorn-agent/decide"
	"github.com/sid0709/acorn/acorn-agent/llm"
	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

const (
	askFormReady = "form_ready"
	// maxNavScrolls is how many scroll-only steps run before Luna is asked anyway.
	maxNavScrolls = 4
	// navScrollViewportFraction is how far down one navigation scroll moves, as a fraction of the viewport height.
	navScrollViewportFraction = 0.75
)

// sourceNav marks a step that scrolled toward the application form without calling the driving model.
const sourceNav = "nav"

func formReadyQuestion() map[string]decide.Question {
	return map[string]decide.Question{
		askFormReady: decide.YesNo(
			"Can the applicant take the next step toward submitting this job application on this screen: " +
				"either an application form with fields to fill (name, email, résumé upload, and similar), " +
				"or a clear Apply, Submit application, Easy Apply, or Continue control that starts or advances the application? " +
				"Answer no if the page is only a job description or marketing content and the likely next step is scrolling to find Apply or the form.",
		),
	}
}

func formReady(ctx context.Context, screen Screen, screenshot string) (float64, decide.Response, error) {
	response, err := screen.Decide(ctx, decide.Request{State: checkState(screenshot), Questions: formReadyQuestion()})
	if err != nil {
		return 0, response, err
	}
	answer, ok := response.Answers[askFormReady]
	if !ok || answer.Noul == nil {
		return 0, response, fmt.Errorf("the checker gave no answer to %q", askFormReady)
	}
	return *answer.Noul, response, nil
}

func navScrollAction(number, attempt int, viewport Viewport) Action {
	dy := float64(viewport.Height) * navScrollViewportFraction
	// A scroll turns the wheel at a point, so it has one: the middle of the screen.
	x, y := float64(viewport.Width)/2, float64(viewport.Height)/2
	return Action{
		ID:   fmt.Sprintf("s%dn%d", number, attempt),
		Kind: KindScroll,
		X:    &x,
		Y:    &y,
		DY:   dy,
	}
}

// navigateGate says whether the gate may look now. It only runs before the driving model has
// looked: once the model drives, it finds its own way, and a note the extension attached (an
// emailed code) is for the model, not for a scroll that never asks it.
func (a *Agent) navigateGate(s *session, obs Observation, surveyScreens int) bool {
	if !a.checksOn(s) || a.newScreen == nil || surveyScreens > 0 || s.formReady || len(obs.Notes) > 0 {
		return false
	}
	if len(s.plan) > 0 || s.verify != "" || s.pendingUpload != nil {
		return false
	}
	return true
}

// tryNavigate scrolls toward the application form when the screen decision model says it is not
// visible yet, without calling the driving model. It reports true when a scroll step was sent.
func (a *Agent) tryNavigate(ctx context.Context, s *session, obs Observation, surveyScreens int, results []ActionResult, sig []uint8, stale int) (Step, bool) {
	if !a.navigateGate(s, obs, surveyScreens) {
		return Step{}, false
	}
	if s.navScrolls >= maxNavScrolls {
		s.formReady = true
		return Step{}, false
	}
	screen := a.newScreen(s.key)
	ready, response, err := formReady(ctx, screen, obs.Screenshot)
	s.usage.Checks++
	s.usage.CheckCost += response.Usage.Cost
	s.usage.Cost += response.Usage.Cost
	if err != nil {
		slog.Warn(runName(s.id)+": could not tell whether the application form is open, so the model will look.", plainlog.ErrorKey, err)
		s.formReady = true
		return Step{}, false
	}
	if ready >= a.cfg.CheckMatch {
		s.formReady = true
		if s.navScrolls > 0 {
			// The form begins about here; the job description above it is not looked through before sending.
			s.cover.floor = max(0, obs.Viewport.ScrollY-float64(obs.Viewport.Height)/2)
			s.notes = append(s.notes, "The page was scrolled automatically to find the application. Scroll back toward the top and fill required fields in order before Submit.")
		}
		return Step{}, false
	}
	number := s.step + 1
	s.navScrolls++
	s.step = number
	s.carried = nil
	s.stale, s.lastSig = stale, sig
	action := navScrollAction(number, s.navScrolls, obs.Viewport)
	step := Step{
		Status:  StatusWorking,
		Message: s.message,
		Actions: []Action{action},
		Number:  number,
		Usage:   s.usage,
	}
	entry := stepTrace{
		Seq: s.seq, Step: number, At: a.now(), Source: sourceNav, URL: obs.URL, Title: obs.Title,
		Viewport: obs.Viewport, Focus: obs.Focus, Notes: obs.Notes, Results: results, Stale: stale,
		Status: step.Status, Message: step.Message, Actions: step.Actions, Usage: s.usage,
	}
	a.record(s, entry, obs.Screenshot, []modelCall{navDecisionCall(response, nil)})
	return step, true
}

func navDecisionCall(response decide.Response, err error) modelCall {
	answers, _ := json.Marshal(response.Answers)
	call := modelCall{
		Kind:      "decision",
		Messages:  []tracedMessage{{Role: "state", Text: "form-ready gate", Images: 1}},
		Content:   string(answers),
		Model:     response.Model,
		Usage:     llm.Usage{InputTokens: response.Usage.InputTokens, OutputTokens: response.Usage.OutputTokens, Cost: response.Usage.Cost},
		LatencyMs: response.Latency.Milliseconds(),
	}.timed(response.StartedAt, response.Requests)
	if err != nil {
		call.Error = err.Error()
	}
	return call
}
