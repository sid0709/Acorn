package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"path/filepath"
	"strings"
	"time"

	"github.com/sid0709/acorn/acorn-backend/jev"
	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// The applicant has not allowed online file sources (a cloud drive, a file-sharing service, a
// sign-in to one), another service's sign-in (single sign-on through a social network, an e-mail or
// search provider, a work platform), or an autofill from anything but a résumé file uploaded from
// this computer (a saved profile or earlier application kept at the job board or another service,
// an account connected or signed in to fetch the applicant's details: "Autofill my application",
// "Apply with" a service). The prompt says so, and the model that drives the run sees the screen and
// chooses what to click: nothing here judges a control before it is clicked. A window or frame a
// click opened is another matter: it is an outcome, not a guess, so one that is more likely than not
// one of those is closed, and the model is told. There is no list of services in code: the decision
// model judges what a page is, and no tunable cutoff: "more likely than not" is the one reading of a
// yes/no answer.
//
// Until 2.10.0 the control under the pointer was described from the page and judged the same way
// before every click, and an autofill from elsewhere refused the click. A description alone misled
// the decision model: in a recorded Greenhouse run the options "Indeed", "Linkedin" and "Glassdoor"
// of "How did you learn about this job?" and the form's own container were judged such an autofill
// (0.55 to 0.76), the refusal was cached for the run, and one click was refused 33 times over 854 s
// while the fields planned below it were never reached. Only the model, which sees the screen,
// decides now; the prompt tells it that it is the one check, and what a slip opens is closed here.

const (
	askOnlineSource  = "online_source"
	askSingleSignOn  = "single_sign_on"
	askOtherAutofill = "other_autofill"
	// Why a window or frame was closed: it is an online file source, another service's sign-in, or an
	// autofill from anything but a résumé file.
	CauseOnlineSource  = "online_source"
	CauseSingleSignOn  = "single_sign_on"
	CauseOtherAutofill = "other_autofill"
	// Kinds of thing the extension asks about: a window a click opened, or a frame that appeared in the page.
	VetWindow = "window"
	VetFrame  = "frame"
	// maxVetText bounds each piece of a description.
	maxVetText = 240
	// likely is the one reading of a yes/no answer: more likely than not.
	likely = 0.5
)

// VetTarget describes a window or frame a click opened (VetWindow, VetFrame). The extension reads it
// from the page; nothing in it is a judgment.
type VetTarget struct {
	Kind string `json:"kind"`
	// Where it went and what it shows.
	URL     string `json:"url,omitempty"`
	Title2  string `json:"windowTitle,omitempty"`
	Excerpt string `json:"excerpt,omitempty"`
	// PageURL is the page the click was on.
	PageURL string `json:"pageUrl,omitempty"`
}

// VetVerdict says whether to go ahead: a window or frame is blocked (closed) when it is more likely
// than not what the applicant has not allowed.
type VetVerdict struct {
	Blocked     bool    `json:"blocked"`
	Probability float64 `json:"probability"`
	// Cause is what it looks like: one of the Cause* values.
	Cause string `json:"cause,omitempty"`
	// Reason is for the model and the person, in plain words, when Blocked.
	Reason string `json:"reason,omitempty"`
}

func clipField(text string) string {
	return clipText(strings.Join(strings.Fields(text), " "), maxVetText)
}

// state is the description the decision model reads.
func (t VetTarget) state() string {
	var out strings.Builder
	field := func(name, value string) {
		if value = clipField(value); value != "" {
			fmt.Fprintf(&out, "%s: %s\n", name, value)
		}
	}
	what := "A new browser window"
	if t.Kind == VetFrame {
		what = "A new frame inside the page"
	}
	out.WriteString(what + " opened after a click on a job application page.\n")
	field("Address", t.URL)
	field("Title", t.Title2)
	field("Text on it", t.Excerpt)
	field("On the page", t.PageURL)
	return out.String()
}

// question asks whether a window or frame is an online file source or a place to paste a document's text.
func (t VetTarget) question() jev.Question {
	return jev.Question{
		Type: jev.TypeNoul,
		Instructions: "Is this window or frame a way to choose, import or sign in to a file from an online service or cloud storage " +
			"(a cloud drive, a file-sharing service, an account of such a service), or a way to type or paste a document's text instead of uploading a file from the computer? " +
			"Answer yes only for such a source. A button that opens the computer's own file picker, a form field, a navigation button, a submit button, " +
			"or a page of the employer's own application is not one.",
		Criteria: map[string]string{"true": "it uses an online file source or pasted text", "false": "it does not"},
	}
}

// signOnQuestion asks whether a window or frame signs in with another service's account.
func (t VetTarget) signOnQuestion() jev.Question {
	return jev.Question{
		Type: jev.TypeNoul,
		Instructions: "Is this window or frame a way to sign in or sign up with an account of another service " +
			"(single sign-on through a social network, an e-mail or search provider, a developer or work platform), " +
			"instead of the employer's own e-mail and password form? " +
			"Answer yes only for such a button, link, window or page. The employer's own sign-in, sign-up, continue or submit buttons, " +
			"the fields of a form, and a page of the employer's own application are not one.",
		Criteria: map[string]string{"true": "it signs in through another service's account", "false": "it does not"},
	}
}

// autofillQuestion asks whether a window or frame fills the application from anything but a résumé
// file uploaded from this computer.
func (t VetTarget) autofillQuestion() jev.Question {
	return jev.Question{
		Type: jev.TypeNoul,
		Instructions: "Is this window or frame a way to fill in the application from somewhere other than a résumé file uploaded from this computer: " +
			"a profile or an earlier application saved at the job board or at another service, an account of another service that is connected, " +
			"linked or signed in to fetch the applicant's details, or a page that asks for such a sign-in or a code to do so? " +
			"Answer yes for such a button, link, window or page (\"Autofill my application\", \"Use my saved application\", \"Apply with\" a service, \"Import profile\"). " +
			"Answer no for an upload or button that reads a résumé file from the computer (\"Autofill from résumé\", \"Upload résumé\"), " +
			"for the fields of the form, for navigation, continue or submit buttons, and for a page of the employer's own application.",
		Criteria: map[string]string{"true": "it fills the application from a saved profile or another service", "false": "it does not"},
	}
}

func (t VetTarget) questions() map[string]jev.Question {
	return map[string]jev.Question{askOnlineSource: t.question(), askSingleSignOn: t.signOnQuestion(), askOtherAutofill: t.autofillQuestion()}
}

// Why a window or frame was closed, for the model and the person.
const (
	reasonOnlineSource  = "it looks like an online file source or a place to paste text"
	reasonSingleSignOn  = "it signs in through another service's account, and Acorn never does; use the employer's own e-mail and password"
	reasonOtherAutofill = "it fills the application from a saved profile or another service, and only a résumé file from this computer may fill it; " +
		"fill the fields from the applicant's details instead"
	// reasonNotJudged answers a kind this server does not judge (an older extension asking about a
	// control before a click): it goes ahead.
	reasonNotJudged = "only a window or frame is judged"
)

// Vet judges a window a click opened, or a frame that appeared in the page. Anything else goes ahead
// without a question.
func (a *Agent) Vet(ctx context.Context, id string, target VetTarget) (VetVerdict, error) {
	s, ok := a.sessions.get(id)
	if !ok {
		return VetVerdict{}, ErrNoSession
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.touched = a.now()
	if target.Kind != VetWindow && target.Kind != VetFrame {
		return VetVerdict{Reason: reasonNotJudged}, nil
	}
	state := target.state()
	if cached, ok := s.vetted[state]; ok {
		return cached, nil
	}
	started := a.now()
	res, err := a.decideText(ctx, s, "what the window or frame is", jev.Request{
		State:     state,
		Questions: target.questions(),
	})
	s.usage.Checks++
	s.usage.CheckCost += res.Usage.Cost
	s.usage.Cost += res.Usage.Cost

	verdict := VetVerdict{}
	failed := ""
	answer, found := res.Answers[askOnlineSource]
	switch {
	case err != nil:
		failed = err.Error()
	case !found || answer.Noul == nil:
		failed = "the decision model gave no answer"
	default:
		verdict.Probability = *answer.Noul
	}
	signOn, autofill := 0.0, 0.0
	if failed == "" {
		if other, ok := res.Answers[askSingleSignOn]; ok && other.Noul != nil {
			signOn = *other.Noul
		}
		if other, ok := res.Answers[askOtherAutofill]; ok && other.Noul != nil {
			autofill = *other.Noul
		}
		switch {
		// An autofill from elsewhere often looks like a sign-in too, so it is read first.
		case autofill >= likely:
			verdict.Cause, verdict.Probability, verdict.Reason = CauseOtherAutofill, autofill, reasonOtherAutofill
		case verdict.Probability >= likely:
			verdict.Cause, verdict.Reason = CauseOnlineSource, reasonOnlineSource
		case signOn >= likely:
			verdict.Cause, verdict.Probability, verdict.Reason = CauseSingleSignOn, signOn, reasonSingleSignOn
		}
		verdict.Blocked = verdict.Cause != ""
	}
	if failed != "" {
		// Nothing is blocked on a check that could not be made: a failed check must not close a page the
		// application opened.
		verdict.Reason = "could not be checked"
		slog.Warn(runName(s.id)+": could not check a "+target.Kind+" for online file sources, so it is let be.", plainlog.ErrorKey, failed)
	}
	if failed == "" {
		if s.vetted == nil {
			s.vetted = map[string]VetVerdict{}
		}
		s.vetted[state] = verdict
	}
	a.recordVet(s.id, vetLine{
		At: started, Kind: target.Kind, State: state, Probability: verdict.Probability, Blocked: verdict.Blocked,
		SingleSignOn: signOn, OtherAutofill: autofill, Error: failed, LatencyMs: a.now().Sub(started).Milliseconds(),
	})
	return verdict, nil
}

// vetLine is one decision, appended to vets.jsonl in the trace.
type vetLine struct {
	At          time.Time `json:"at"`
	Kind        string    `json:"kind"`
	State       string    `json:"state"`
	Probability float64   `json:"probability"`
	Blocked     bool      `json:"blocked"`
	// SingleSignOn is the probability the decision model gave that it signs in through another service.
	SingleSignOn float64 `json:"singleSignOn"`
	// OtherAutofill is the probability it fills the application from a saved profile or another service.
	OtherAutofill float64 `json:"otherAutofill"`
	Error         string  `json:"error,omitempty"`
	LatencyMs     int64   `json:"latencyMs"`
}

func (a *Agent) recordVet(sessionID string, line vetLine) {
	if !a.trace.enabled() {
		return
	}
	dir, err := a.trace.folder(sessionID)
	if err != nil {
		slog.Warn(runName(sessionID)+": the record of a file-source check could not be saved.", plainlog.ErrorKey, err)
		return
	}
	raw, err := json.Marshal(line)
	if err == nil {
		err = appendLine(filepath.Join(dir, "vets.jsonl"), string(raw))
	}
	if err != nil {
		slog.Warn(runName(sessionID)+": the record of a file-source check could not be saved.", plainlog.ErrorKey, err)
	}
}
