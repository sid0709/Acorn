package agent

import (
	"fmt"
	"log/slog"
	"strings"

	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// A run that is asked to stop before sending (Start.StopBeforeSubmit, or the server's own switch,
// Config.StopBeforeSubmit) must never send an application, and the prompt alone cannot promise that: a
// sentence in it is advice, not a guard. So the model names what each click does beyond the click
// (Action.Commit: "next" goes on to another page of the form, "send" sends the application to the
// employer; it judges which from the screen, no button's wording is matched here), and in such a run a
// "send" click, and everything planned after it, is taken out of the plan before the plan leaves the
// server. A "next" click goes out as usual: the run fills every page of the form and stops only at the
// control that sends it. When nothing but the send was planned (the page is complete, in the model's
// judgment), or when the model itself reports done, the run ends as ready to submit (Step.ReadyToSubmit),
// unless the page still reports required fields empty: then the model is sent back to fill them first, as
// a stop for the applicant is (stopgate.go), with the same number of passes and the same rule that a pass
// which filled none of them is the last.
//
// What this guard cannot catch: a send the model marked "next" or left unmarked, a form that submits on
// Enter in a field (the prompt tells the model not to submit by keyboard), and a page that sends itself
// when its last field is filled. The agent reads only what the model says of its clicks.

// readyMessage is the run's last line when the agent ended it at the control that sends the application.
const readyMessage = "Ready to submit: every field is filled, and the application was not sent."

// readyPassMessage is what the person sees while the model fills what the page still reports empty.
const readyPassMessage = "Finishing the required fields before stopping at Submit."

// withoutSend is the plan up to the first click the model marked as the one that sends the application:
// that click and everything planned after it are held.
func withoutSend(planned []Action) (kept, held []Action) {
	for i, action := range planned {
		if action.Commit == CommitSend {
			return planned[:i], planned[i:]
		}
	}
	return planned, nil
}

// holdSend takes the click that sends the application, and what follows it, out of the plan of a run
// asked to stop before sending. It reports whether one was held, and says so in dropped for the log. When
// other actions remain, they go out and the model is told why the send did not, so it plans the send
// again, alone, once the page is complete.
func (a *Agent) holdSend(s *session, planned *[]Action, dropped *[]string) bool {
	if !s.start.StopBeforeSubmit {
		return false
	}
	kept, held := withoutSend(*planned)
	if len(held) == 0 {
		return false
	}
	*planned = kept
	*dropped = append(*dropped, fmt.Sprintf("the click that sends the application was held back (%s with it): this run stops before sending",
		plainlog.Count(len(held)-1, "later action")))
	if len(kept) > 0 {
		s.notes = append(s.notes, sendHeldNote(held[0]))
	}
	slog.Info(fmt.Sprintf("%s: the click that sends the application was held back: the run stops before sending.", runName(s.id)))
	return true
}

// sendHeldNote tells the model that the send was not pressed while the rest of its plan ran.
func sendHeldNote(send Action) string {
	what := "the click that sends the application"
	if label := strings.TrimSpace(send.Label); label != "" {
		what = fmt.Sprintf("%q", label)
	}
	return fmt.Sprintf("Acorn did not press %s: the applicant wants to review before sending. The rest of your plan ran. "+
		"When the page is complete, plan that click again on its own, marked \"send\", and Acorn ends the run as ready to submit without pressing it.", what)
}

// holdReady says whether a run about to end as ready to submit is sent back instead, with the note that
// names the required fields the page still reports empty (or marked invalid). It uses the passes a stop
// for the applicant has (Config.StopPasses, counted in session.stopPasses), and the rule that a pass which
// filled none of the fields is the last (session.fieldHold), so a model that will not fill a field does
// not go round for ever. A look that reports no controls says nothing, and the run ends ready.
func (a *Agent) holdReady(s *session, obs Observation) (string, bool) {
	if a.cfg.StopPasses <= 0 || s.stopPasses >= a.cfg.StopPasses {
		return "", false
	}
	left := s.emptyFieldsOn(obs.URL)
	if len(left) == 0 {
		return "", false
	}
	url := withoutFragment(obs.URL)
	if s.fieldHold.url == url && len(left) >= len(s.fieldHold.left) {
		slog.Warn(fmt.Sprintf("%s: the run ends ready to submit though the page reports %s empty: the last pass filled none of them (%s).",
			runName(s.id), plainlog.Count(len(left), "required field"), quoted(left)))
		return "", false
	}
	s.fieldHold = fieldHold{url: url, left: left}
	s.stopPasses++
	// The model is shown the whole page again, so it finds the fields it is told to fill.
	s.surveyAgain = true
	slog.Info(fmt.Sprintf("%s: the ready stop is sent back: the page reports %s empty that the run can fill (%s).",
		runName(s.id), plainlog.Count(len(left), "required field"), quoted(left)))
	return readyHoldNote(left), true
}

// readyHoldNote tells the model which required fields the page still reports empty before it may stop.
func readyHoldNote(left []string) string {
	return fmt.Sprintf("You stopped at the control that sends the application, but the page still reports these required fields empty: %s. "+
		"Fill each of them now from the applicant's details, with the answer most applicants give where the details say nothing, all in one plan. "+
		"Then stop again at that control without pressing it.", quoted(left))
}

// isUnavailableKind is whether a kind is one the model may name with StopJobUnavailable.
func isUnavailableKind(kind string) bool {
	switch kind {
	case UnavailableExpired, UnavailableNoOnlineApply, UnavailableNotAJob:
		return true
	}
	return false
}
