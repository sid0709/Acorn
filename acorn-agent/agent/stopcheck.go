package agent

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/sid0709/acorn/acorn-agent/applicant"
	"github.com/sid0709/acorn/acorn-agent/decide"
)

// The applicant is asked only for what only they can do: pass a real challenge that proves a person is
// there, give a code or follow a link sent to them, provide a document only they have, or give an
// identity number the profile lacks. A model that stops for them is held to that. Its stop stands when
// the decision model, reading the screen, is sure the page asks for the thing the stop names; a stop the
// screen does not show (a field that says to leave it blank, a badge that only mentions bots, a control
// greyed out for the moment a page takes to submit) is sent back with a note, so the model goes on. A
// stop whose reason no screen can confirm (other, page_problem) is sent back too. Nothing here reads
// a page's words: the decision model answers questions about what is needed, and a stop that comes
// again after StopOverridePasses sends back stands, as does one the check could not make.

const askHumanRequired = "human_required"

// What the screen may show that needs the applicant.
const (
	needNone     = "none"
	needCaptcha  = "captcha"
	needCode     = "code"
	needLink     = "link"
	needDocument = "document"
	needIdentity = "identity"
)

// stopNeeds is what the screen must show for each reason the model may give.
var stopNeeds = map[string]string{
	StopCaptcha:          needCaptcha,
	StopVerification:     needCode,
	StopVerificationLink: needLink,
	StopDocument:         needDocument,
	StopIdentity:         needIdentity,
}

func humanRequiredQuestion() decide.Question {
	return decide.Question{
		Type:         decide.TypeChoice,
		Instructions: "A job application is stopped on this page, waiting for the applicant to do something only they can do. Does the page need one of these from the applicant? Choose none when it needs none of them, for example when the page only shows a form to fill in, a field to leave blank, a notice about bots, or a control that is greyed out while the page works.",
		Criteria: map[string]string{
			needCaptcha:  "a real challenge that proves a person is there is showing and has not been passed: a CAPTCHA, reCAPTCHA or hCaptcha widget, a picture or puzzle to solve, an 'I'm not a robot' box to tick. Not a small badge that only says a page is protected, not a field that says to leave it blank, not text that merely talks about bots or humans.",
			needCode:     "the page asks for a code that was sent to the applicant's email or phone, and has a box for it",
			needLink:     "the page says a link was sent to the applicant's email that they must open to go on",
			needDocument: "the page requires a file to be uploaded that is not a résumé or a cover letter and that only the applicant has: a diploma, a transcript, a certificate, an ID scan, a work permit",
			needIdentity: "the page requires an identity number that only the applicant has, such as a Social Security, passport or driver's license number, and it is required to go on",
			needNone:     "the page needs none of these from the applicant",
		},
	}
}

// stopSentBack is what the model is told when a stop is sent back, by what the stop said.
func stopSentBack(reason string) string {
	switch reason {
	case StopCaptcha:
		return "A check of the screen found no CAPTCHA or other challenge that needs a person on this page: a field that says to leave it blank, a badge, or text about bots or humans is not one. Do not stop for the applicant. A control greyed out right after you pressed it is usually the page still submitting: wait a moment and look again. Otherwise find what is left to do on the page and do it."
	case StopSignIn:
		return "The profile holds the account password: type " + applicant.AccountPasswordToken + " (with secret set) in the password fields, and the real password is typed in its place. Do not stop for the applicant for a password."
	case StopOther, StopPageProblem, "":
		return "Only a real CAPTCHA or similar challenge, a code or link sent to the applicant, a document only they have, or an identity number the profile lacks needs the applicant. Whatever stopped you is something to work out: look at the whole page, do what is left, and if a control is greyed out right after you pressed it, wait a moment and look again."
	}
	return "A check of the screen did not find that this page needs that from the applicant. Do not stop for the applicant. Only a real CAPTCHA or similar challenge, a code or link sent to them, a document only they have, or an identity number the profile lacks needs them: find what is left on the page and do it, and if a control is greyed out right after you pressed it, wait a moment and look again."
}

// holdUnneededStop sends a stop for the applicant back when the screen does not show the need. It says
// whether it did, and the note that tells the model why.
func (a *Agent) holdUnneededStop(ctx context.Context, s *session, obs Observation, status string, answer reply) (string, bool) {
	// A run configured to accept every stop at once (StopPasses 0) accepts them here too.
	if status != StatusNeedPerson || a.cfg.StopPasses <= 0 || s.overrides >= a.cfg.StopOverridePasses {
		return "", false
	}
	reason := ""
	if answer.Stop != nil {
		reason = answer.Stop.Reason
	}
	need, confirmable := stopNeeds[reason]
	switch {
	case confirmable:
		// The screen must show it.
		if !a.checksOn(s) || obs.Screenshot == "" {
			return "", false
		}
		if confirmed, ok := a.screenShowsNeed(ctx, s, obs, need, reason); !ok || confirmed {
			return "", false
		}
	case reason == StopSignIn:
		// Without an account password in the profile only the applicant can go on.
		if s.snap.Secrets[applicant.AccountPasswordToken] == "" {
			return "", false
		}
	case reason == StopOther || reason == StopPageProblem || reason == "":
		// Nothing a screen shows makes these a need for the applicant.
	default:
		return "", false
	}
	s.overrides++
	slog.Info("stop for the applicant sent back", "session", s.id, "reason", reason, "sentBack", s.overrides)
	return stopSentBack(reason), true
}

// screenShowsNeed asks the decision model whether the page needs what the stop says. confirmed is true when it
// is sure; ok is false when the question could not be answered (the stop then stands).
func (a *Agent) screenShowsNeed(ctx context.Context, s *session, obs Observation, need, reason string) (confirmed, ok bool) {
	response, err := a.newScreen(s.key).Decide(ctx, decide.Request{
		State:     reviewState(obs.Screenshot, obs.Viewport, nil),
		Questions: map[string]decide.Question{askHumanRequired: humanRequiredQuestion()},
	})
	s.usage.Checks++
	s.usage.CheckCost += response.Usage.Cost
	s.usage.Cost += response.Usage.Cost
	call := verdict{response: response, prompt: "does the page need the applicant: " + reason}.call(err)
	s.seq++
	entry := stepTrace{Seq: s.seq, Step: s.step, At: a.now(), Source: sourceStopCheck, URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport, Memo: s.memo, Job: s.job}
	defer func() {
		entry.Usage = s.usage
		a.record(s, entry, obs.Screenshot, []modelCall{call})
	}()
	if err != nil {
		slog.Warn("stop check failed; the stop stands", "session", s.id, "error", err)
		entry.Error = err.Error()
		return false, false
	}
	answer := response.Answers[askHumanRequired]
	sure := answer.Probabilities[need]
	entry.Message = fmt.Sprintf("stop check: %s asked, screen says %s (%s %.2f, none %.2f)", reason, answer.Choice, need, sure, answer.Probabilities[needNone])
	return sure >= a.cfg.StopConfirm, true
}
