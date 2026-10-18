package agent

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/sid0709/OpenSeat/acorn-agent/decide"
)

// "Done" means the page confirmed that the application was received. A model can say it without that
// being so: a recorded run stopped with the form still open, the résumé not attached and nothing
// submitted, because it had decided the posting's location requirement excluded the applicant, and
// the run was shown to the person as "Application sent!". So the agent does not take the model's
// word. It asks the decision model whether the screen confirms a sent application; when it does not,
// the model is sent back to submit or to say plainly why it did not, and a run that still ends "done"
// without the page's confirmation is reported as one that could not confirm, never as sent.

const askSent = "application_sent"

// donePassMessage is what the person sees while the agent makes the model look again.
const donePassMessage = "The page has not confirmed the application was sent; looking again."

// sentQuestion asks whether the screen shows a sent application.
func sentQuestion() map[string]decide.Question {
	return map[string]decide.Question{askSent: decide.YesNo(
		"Does this screen confirm that a job application was just submitted and received, for example a thank-you or confirmation message? " +
			"Answer no for a form that is still open or has fields to fill, an error message, a page that asks for something more, or a job posting.")}
}

// holdDone checks a "done" the model gave. It reports a note and true when the run must not end yet
// (the model looks again), and, when the passes are used up, ends the run as stuck instead.
func (a *Agent) holdDone(ctx context.Context, s *session, obs Observation, answer *reply) (string, bool) {
	if answer.Status != StatusDone || s.start.StopBeforeSubmit || !a.checksOn(s) || a.cfg.DonePasses < 0 {
		return "", false
	}
	response, err := a.newScreen(s.key).Decide(ctx, decide.Request{State: checkState(obs.Screenshot), Questions: sentQuestion()})
	s.usage.Checks++
	s.usage.CheckCost += response.Usage.Cost
	s.usage.Cost += response.Usage.Cost
	if err != nil {
		// A checker that cannot answer is not a reason to refuse the model's word.
		slog.Warn("sent check failed; the run's own word stands", "session", s.id, "error", err)
		return "", false
	}
	sure := 0.0
	if answer, ok := response.Answers[askSent]; ok && answer.Noul != nil {
		sure = *answer.Noul
	}
	if sure >= a.cfg.DoneConfirm {
		return "", false
	}
	if s.donePasses >= a.cfg.DonePasses {
		answer.Status = StatusStuck
		answer.Stop = &StopInfo{
			Reason:  StopPageProblem,
			Problem: "The page never showed that the application was sent, so Acorn cannot call it done.",
			Action:  "Look at the page: if the form is still open, finish and submit it yourself, then press Continue or Run again.",
		}
		answer.Message = "The application was not confirmed as sent."
		s.stopPasses = a.cfg.StopPasses // this stop is already the end: it is not sent back again
		return "", false
	}
	s.donePasses++
	return fmt.Sprintf("You reported done, but the screen does not show that the application was sent (a checker read it, %.0f%% sure it did). Done means the page confirmed receipt. If the form is still open, fill what is left and submit it. If you decided not to apply, do not report done: a posting's own requirements (a place to live, a degree, years of experience) are not a reason to leave an application unsent, the applicant chose this job, so submit it. If something outside the form stops you, say so with need_person.", sure*100), true
}
