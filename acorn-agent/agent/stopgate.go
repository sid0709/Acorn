package agent

import (
	"fmt"
	"strings"
)

// The applicant is asked last. A model that stops for them (a CAPTCHA, a code, a document) has often
// done so with fillable fields still empty: the optional ones the profile answers, or a part of the
// page it never scrolled to. So the first stop of a run is not accepted at once: the model is sent
// back, with a note, to go through the whole page and do everything that does not need the
// applicant, and only its next stop stands. A stop made while parts of the page are still unseen is
// sent back too, up to Config.StopPasses times in a run.

// stopPassMessage is what the person sees while the agent finishes before asking them.
const stopPassMessage = "Finishing everything else on the page before asking you."

// stopPassWait is how long the agent waits before the model looks again, as the page may still be moving.
const stopPassWaitMs = 300

// holdStop says whether this stop is sent back, and the note that tells the model why.
func (a *Agent) holdStop(s *session, status string, answer reply) (string, bool) {
	if a.cfg.StopPasses <= 0 || s.stopPasses >= a.cfg.StopPasses {
		return "", false
	}
	if status != StatusNeedPerson && status != StatusStuck {
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
