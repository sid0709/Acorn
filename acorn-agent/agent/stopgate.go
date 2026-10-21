package agent

import (
	"fmt"
	"log/slog"
	"strings"
)

// The applicant is asked last. A model that stops for them (a CAPTCHA, a code, a document) has often
// done so with fillable fields still empty: the optional ones the profile answers, or a part of the
// page it never scrolled to. So the first stop of a run is not accepted at once: the model is sent
// back, with a note, to go through the whole page and do everything that does not need the
// applicant, and only its next stop stands. A stop made while parts of the page are still unseen is
// sent back too, up to Config.StopPasses times in a run.
//
// The page itself can say that nothing is left: it reports which of its controls are empty and which
// it marked invalid. When none is invalid and every empty control appeared after the click that sent
// the page went through (the boxes of a code, a check that the applicant is a person), the stop stands
// at once: what is empty is the applicant's part, and the page accepted the rest before it asked.

// stopPassMessage is what the person sees while the agent finishes before asking them.
const stopPassMessage = "Finishing everything else on the page before asking you."

// stopPassWait is how long the agent waits before the model looks again, as the page may still be moving.
const stopPassWaitMs = 300

// commitState is the click that sends the page, as the plan kept it: which controls the page had when it
// was planned, and whether it went through.
type commitState struct {
	id       string
	url      string
	controls map[string]bool
	done     bool
}

// noteCommitPlanned remembers the click that sends the page when the plan keeps one, and which controls
// the page had then: a control that appears once that click went through is the applicant's to fill.
func (s *session) noteCommitPlanned(planned []Action, obs Observation) {
	for _, action := range planned {
		if !action.Commit {
			continue
		}
		controls := make(map[string]bool, len(obs.Marks))
		for _, mark := range obs.Marks {
			controls[mark.ID] = true
		}
		s.commit = commitState{id: action.ID, url: withoutFragment(obs.URL), controls: controls}
		return
	}
}

// noteCommitResults records that the click that sends the page went through, when its result came.
func (s *session) noteCommitResults(results []ActionResult) {
	if s.commit.id == "" || s.commit.done {
		return
	}
	for _, result := range results {
		if result.ID == s.commit.id && result.OK {
			s.commit.done = true
		}
	}
}

// nothingLeftToFill is whether the page says so: no control is marked invalid, and every control it
// reports empty appeared after the click that sent the page went through on this page. A look that
// does not report the page's controls says nothing, and the stop is sent back as before.
func (s *session) nothingLeftToFill(obs Observation) bool {
	if len(obs.Marks) == 0 {
		return false
	}
	sent := s.commit.done && s.commit.url == withoutFragment(obs.URL)
	for _, mark := range obs.Marks {
		if mark.Invalid {
			return false
		}
		if mark.Empty == nil || !*mark.Empty {
			continue
		}
		if !sent || s.commit.controls[mark.ID] {
			return false
		}
	}
	return true
}

// holdStop says whether this stop is sent back, and the note that tells the model why.
func (a *Agent) holdStop(s *session, status string, answer reply, obs Observation) (string, bool) {
	if a.cfg.StopPasses <= 0 || s.stopPasses >= a.cfg.StopPasses {
		return "", false
	}
	if status != StatusNeedPerson && status != StatusStuck {
		return "", false
	}
	if s.nothingLeftToFill(obs) {
		slog.Info(runName(s.id) + ": the stop stands at once: the page reports nothing left to fill but what appeared after it was sent.")
		return "", false
	}
	// The first stop always goes back once; later ones only while some of the page has not been seen.
	if s.stopPasses > 0 && len(s.cover.gaps()) == 0 {
		return "", false
	}
	s.stopPasses++
	reason := ""
	if answer.Stop != nil {
		reason = strings.TrimSpace(answer.Stop.Reason)
	}
	return fmt.Sprintf("You asked to stop for the applicant (%s), but the applicant is asked last. Before anyone is asked, go through the whole page from its top: fill every field you can from the applicant's details, optional ones too wherever those details answer them, and do every other action that does not need the applicant. The note under the screenshot says which parts of the page you have not looked at; look at them. Say in your observation what you checked. Report need_person again only when nothing fillable is left.", orOther(reason)), true
}

func orOther(reason string) string {
	if reason == "" {
		return "no reason given"
	}
	return reason
}
