package agent

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/sid0709/acorn/acorn-agent/decide"
)

// A page is planned in one answer and carried out in one batch; what used to follow was a second call to the
// driving model, to look at the page again and press the button that sends it (or goes on). When the photos
// confirm what the plan did, that call is not needed:
//
//   - The plan's own click that sends the page was held (sendgate.go holdForList) because the to-do list still
//     had empty fields, the ones the plan was filling. After the batch, when nothing failed, no dropdown was
//     left without an answer, no field's fill went unverified, every zone's photo showed its fields as planned
//     (review.go) and the to-do list has no field left empty, the agent presses that click itself.
//   - After a click that sends the application went through, the decision model reads the screenshot: when it
//     shows the application received (or that the applicant had already applied, donegate.go), the run ends
//     done there.
//
// Anything less sure goes to the driving model as before, told what Acorn did.

// heldSend is the click a plan held while the to-do list still had empty fields, and what followed it.
type heldSend struct {
	url     string
	planGen int
	actions []Action
}

// sourceAutosend marks an entry where the agent pressed the held click itself, and sourceConfirm one where
// it read the page after a send.
const (
	sourceAutosend = "autosend"
	sourceConfirm  = "confirm"
)

// planConfirmed is whether the photos confirm everything the current plan filled, on this page.
func (s *session) planConfirmed(obs Observation) bool {
	if s.probeUnsure || len(s.retry) > 0 || s.expectURL != withoutFragment(obs.URL) {
		return false
	}
	for zone := range s.expect {
		if !s.reviewed[zone] {
			return false
		}
	}
	return len(s.emptyFieldsOn(obs.URL)) == 0
}

// pressHeldSend presses the click the plan held, when the photos confirm the plan. The session is locked.
func (a *Agent) pressHeldSend(s *session, obs Observation, results []ActionResult, sig []uint8) (Step, bool) {
	held := s.heldSend
	if held == nil || held.planGen != s.planGen || held.url != withoutFragment(obs.URL) {
		return Step{}, false
	}
	s.heldSend = nil
	if failedResults(obs.Results) != "" || s.sendRefused || !s.planConfirmed(obs) {
		return Step{}, false
	}
	sends := false
	for _, action := range held.actions {
		sends = sends || action.Commit == CommitSend
	}
	if sends && s.start.StopBeforeSubmit {
		return Step{}, false
	}
	s.noteCommitPlanned(held.actions, obs)
	s.notePressed(held.actions, obs)
	s.carried = withoutChoose(results)
	s.stale, s.lastSig = 0, sig
	for _, action := range held.actions {
		s.byID[action.ID] = action
	}
	step := Step{Status: StatusWorking, Message: s.message, Actions: held.actions, Number: s.step, Usage: s.usage}
	a.record(s, stepTrace{
		Seq: s.seq, Step: s.step, At: a.now(), Source: sourceAutosend, URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport,
		Focus: obs.Focus, Notes: obs.Notes, Results: obs.Results, Memo: s.memo, Job: s.job,
		Status: step.Status, Message: step.Message, Actions: step.Actions, Usage: s.usage,
	}, obs.Screenshot, nil)
	slog.Info(runName(s.id) + ": every field the plan filled is confirmed by its photo, so the held click that sends the page is pressed without asking the model.")
	return step, true
}

// confirmSent reads the page after the click that sends the application went through: when it shows the
// application received, or that the applicant had already applied, the run ends done. Otherwise the driving
// model looks, as before. The session is locked.
func (a *Agent) confirmSent(ctx context.Context, s *session, obs Observation) (Step, bool) {
	s.commit = commitState{}
	if !a.checksOn(s) || s.start.StopBeforeSubmit {
		return Step{}, false
	}
	response, err := a.newScreen(s.keys()).Decide(ctx, decide.Request{State: humanCheckState(obs), Questions: sentQuestion()})
	s.usage.Checks++
	s.usage.CheckCost += response.Usage.Cost
	s.usage.Cost += response.Usage.Cost
	call := verdict{response: response, prompt: "the page shows the application received"}.call(err)
	if err != nil {
		s.reviews.calls = append(s.reviews.calls, call)
		return Step{}, false
	}
	sure, already := 0.0, false
	if answer, ok := response.Answers[askSent]; ok && answer.Noul != nil {
		sure = *answer.Noul
	}
	if answer, ok := response.Answers[askAlready]; ok && answer.Noul != nil {
		already = *answer.Noul >= likely
	}
	if sure < a.cfg.DoneConfirm {
		s.reviews.calls = append(s.reviews.calls, call)
		s.notes = append(s.notes, fmt.Sprintf("Acorn pressed the button that sends the application; a checker reading the page is %.0f%% sure it shows the application received. Look at the page and do what it needs.", sure*100))
		return Step{}, false
	}
	message := "The page confirmed the application was received."
	if already {
		message = "The page says the application was already received."
	}
	s.finished, s.stoppedFor, s.alreadyApplied = true, message, already
	step := Step{Status: StatusDone, Message: message, Number: s.step, Usage: s.usage, AlreadyApplied: already}
	a.record(s, stepTrace{
		Seq: s.seq, Step: s.step, At: a.now(), Source: sourceConfirm, URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport,
		Focus: obs.Focus, Notes: obs.Notes, Results: obs.Results, Memo: s.memo, Job: s.job,
		Status: step.Status, Message: step.Message, Usage: s.usage,
	}, obs.Screenshot, []modelCall{call})
	slog.Info(runName(s.id) + ": " + strings.ToLower(message[:1]) + message[1:] + " The run ends without asking the model.")
	return step, true
}
