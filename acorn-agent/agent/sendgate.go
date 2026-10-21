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
// unless the model read fields as empty on its last survey: then it is sent back to fill them first, as
// a stop for the applicant is (stopgate.go), with the same number of passes and the same rule that a pass
// which filled none of them is the last.
//
// What this guard cannot catch: a send the model marked "next" or left unmarked, a form that submits on
// Enter in a field (the prompt tells the model not to submit by keyboard), and a page that sends itself
// when its last field is filled. The agent reads only what the model says of its clicks.

// readyMessage is the run's last line when the agent ended it at the control that sends the application.
const readyMessage = "Ready to submit: every field is filled, and the application was not sent."

// readyPassMessage is what the person sees while the model fills what it read as empty.
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
// names the fields the model read as empty on its last survey (fields.go). It uses the passes a stop
// for the applicant has (Config.StopPasses, counted in session.stopPasses), and the rule that a pass which
// filled none of the fields is the last (session.fieldHold), so a model that will not fill a field does
// not go round for ever. A page the model read no empty field on says nothing, and the run ends ready.
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
		slog.Warn(fmt.Sprintf("%s: the run ends ready to submit though %s read as empty: the last pass filled none of them (%s).",
			runName(s.id), plainlog.Count(len(left), "field"), quoted(left)))
		return "", false
	}
	s.fieldHold = fieldHold{url: url, left: left}
	s.stopPasses++
	// The model is shown the whole page again, so it finds the fields it is told to fill.
	s.surveyAgain = true
	slog.Info(fmt.Sprintf("%s: the ready stop is sent back: %s read as empty that the run can fill (%s).",
		runName(s.id), plainlog.Count(len(left), "field"), quoted(left)))
	return readyHoldNote(left), true
}

// readyHoldNote tells the model which fields it read as empty before it may stop.
func readyHoldNote(left []string) string {
	return fmt.Sprintf("You stopped at the control that sends the application, but you read these fields as still empty: %s. "+
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

// maxListHolds is how many times on one page the click that sends it or goes on is held for fields the
// to-do list still has empty: a field the model cannot fill does not keep the page from being sent for ever.
const maxListHolds = 3

// listHold counts the holds of holdForList on one page.
type listHold struct {
	url   string
	count int
}

// holdForList takes the clicks that send the page or go on to its next step ("commit") out of a plan while
// the to-do list (fields.go: the model's reading of the pictures, as the photo reviews corrected it) still has
// a required field empty on the page, even one the same plan fills: the click goes out on a later look, once
// a survey shows the list clear. A recorded run planned the sponsorship answer and Submit together, the answer
// missed its box, and Submit was pressed with the box empty. It says whether it held one.
func (a *Agent) holdForList(s *session, planned *[]Action, dropped *[]string, obs Observation) bool {
	left := s.emptyFieldsOn(obs.URL)
	if len(left) == 0 {
		return false
	}
	kept, held := withoutCommits(*planned)
	if len(held) == 0 {
		return false
	}
	url := withoutFragment(obs.URL)
	if s.listHold.url != url {
		s.listHold = listHold{url: url}
	}
	if s.listHold.count >= maxListHolds {
		slog.Warn(fmt.Sprintf("%s: the click that sends the page goes out though the to-do list still has %s empty (%s): it was held %d times on this page.",
			runName(s.id), plainlog.Count(len(left), "field"), quoted(left), s.listHold.count))
		return false
	}
	s.listHold.count++
	*planned = kept
	*dropped = append(*dropped, fmt.Sprintf("the click that sends the page or goes on was held back (%s with it): the to-do list still has %s empty",
		plainlog.Count(len(held)-1, "later action"), plainlog.Count(len(left), "field")))
	s.notes = append(s.notes, listHoldNote(left))
	s.surveyAgain = true
	slog.Info(fmt.Sprintf("%s: the click that sends the page was held back: the to-do list still has %s empty (%s).",
		runName(s.id), plainlog.Count(len(left), "field"), quoted(left)))
	return true
}

// listHoldNote tells the model why the click that sends the page was not made.
func listHoldNote(left []string) string {
	return fmt.Sprintf("Acorn did not press the button that sends this page or goes on: your to-do list still has these required fields empty: %s. "+
		"The rest of your plan ran. Look at each of them on the survey; when the list shows every required field filled, press the button, alone or after what is left.", quoted(left))
}
