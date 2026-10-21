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
// sign-in to one) and a file only ever comes from this computer. The prompt says so, and the model
// that drives the run sees the screen; this check reads only a description of a control taken from
// the page, so it never overrides that model: a control the decision model takes for such a source
// is clicked as planned, and the model is told the doubt in the result, to judge from the screen (a
// live run was locked out of a plain location box for seven steps when a description was misread).
// A window or frame a click opened is another matter: it is an outcome, not a guess, so one that is
// more likely than not an online file source or another service's sign-in is closed, and the model
// is told. There is no list of services in code: the model judges what a control or page is, and
// no tunable cutoff: "more likely than not" is the one reading of a yes/no answer.
//
// The same check keeps the run from signing in through another service's account (single sign-on
// through a social network, an e-mail or search provider, a work platform): the applicant's own
// e-mail and password are used, and a window that would start one is closed.
//
// A third question keeps the run from filling the form from anything but a résumé file: a saved
// profile or earlier application kept at the job board or another service, an account that is
// connected or signed in to fetch the applicant's details ("Autofill my application", "Apply with
// X"). Unlike the other two, this one refuses the control itself: the prompt already forbids such a
// button, a recorded run pressed one anyway, landed on the job board's own sign-in and typed the
// job's address into its e-mail box; the click is the harm, so it is not made. The one autofill that
// is allowed is the page reading a résumé file uploaded from this computer, and the question says so.

const (
	askOnlineSource  = "online_source"
	askSingleSignOn  = "single_sign_on"
	askOtherAutofill = "other_autofill"
	// Why a click was refused: it reached an online file source, another service's sign-in, or an
	// autofill from anything but a résumé file.
	CauseOnlineSource  = "online_source"
	CauseSingleSignOn  = "single_sign_on"
	CauseOtherAutofill = "other_autofill"
	// Kinds of thing the extension asks about.
	VetControl = "control"
	VetWindow  = "window"
	VetFrame   = "frame"
	// maxVetText bounds each piece of a description.
	maxVetText = 240
	// likely is the one reading of a yes/no answer: more likely than not.
	likely = 0.5
)

// VetTarget describes what is about to be clicked (VetControl), or a window or frame a click
// opened (VetWindow, VetFrame). The extension reads it from the page; nothing in it is a
// judgment.
type VetTarget struct {
	Kind string `json:"kind"`
	// A control: its tag and what it says of itself, and whether it sits in a component that
	// holds a file input (where the buttons that attach a file live).
	Tag             string `json:"tag,omitempty"`
	Type            string `json:"type,omitempty"`
	Role            string `json:"role,omitempty"`
	Text            string `json:"text,omitempty"`
	Label           string `json:"label,omitempty"`
	Title           string `json:"title,omitempty"`
	Alt             string `json:"alt,omitempty"`
	LinkHost        string `json:"linkHost,omitempty"`
	IDClass         string `json:"idClass,omitempty"`
	InFileComponent bool   `json:"inFileComponent,omitempty"`
	// A window or frame: where it went and what it shows.
	URL     string `json:"url,omitempty"`
	Title2  string `json:"windowTitle,omitempty"`
	Excerpt string `json:"excerpt,omitempty"`
	// PageURL is the page the click was on.
	PageURL string `json:"pageUrl,omitempty"`
}

// VetVerdict says whether to go ahead. A control is never blocked: Hint carries the doubt, for the
// model to weigh against the screen. A window or frame is blocked when it is more likely than not what
// the applicant has not allowed.
type VetVerdict struct {
	Blocked     bool    `json:"blocked"`
	Probability float64 `json:"probability"`
	// Cause is what it looks like: CauseOnlineSource or CauseSingleSignOn.
	Cause string `json:"cause,omitempty"`
	// Reason is for the model and the person, in plain words, when Blocked.
	Reason string `json:"reason,omitempty"`
	// Hint is for the model, when a control it is about to click looks like something the applicant
	// has not allowed: the click goes ahead, and the model judges from the screen.
	Hint string `json:"hint,omitempty"`
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
	switch t.Kind {
	case VetWindow, VetFrame:
		what := "A new browser window"
		if t.Kind == VetFrame {
			what = "A new frame inside the page"
		}
		out.WriteString(what + " opened after a click on a job application page.\n")
		field("Address", t.URL)
		field("Title", t.Title2)
		field("Text on it", t.Excerpt)
	default:
		out.WriteString("A control on a job application page that is about to be clicked.\n")
		field("Element", t.Tag)
		field("Type", t.Type)
		field("Role", t.Role)
		field("Text", t.Text)
		field("Label", t.Label)
		field("Title", t.Title)
		field("Image description", t.Alt)
		field("Link goes to", t.LinkHost)
		field("Id and classes", t.IDClass)
		if t.InFileComponent {
			out.WriteString("It sits in a file upload component.\n")
		}
	}
	field("On the page", t.PageURL)
	return out.String()
}

func (t VetTarget) question() jev.Question {
	subject := "control"
	if t.Kind != VetControl {
		subject = "window or frame"
	}
	return jev.Question{
		Type: jev.TypeNoul,
		Instructions: "Is this " + subject + " a way to choose, import or sign in to a file from an online service or cloud storage " +
			"(a cloud drive, a file-sharing service, an account of such a service), or a way to type or paste a document's text instead of uploading a file from the computer? " +
			"Answer yes only for such a source. A button that opens the computer's own file picker, a form field, a navigation button, a submit button, " +
			"or a page of the employer's own application is not one.",
		Criteria: map[string]string{"true": "it uses an online file source or pasted text", "false": "it does not"},
	}
}

// signOnQuestion asks whether a control, window or frame signs in with another service's account.
func (t VetTarget) signOnQuestion() jev.Question {
	subject := "control"
	if t.Kind != VetControl {
		subject = "window or frame"
	}
	return jev.Question{
		Type: jev.TypeNoul,
		Instructions: "Is this " + subject + " a way to sign in or sign up with an account of another service " +
			"(single sign-on through a social network, an e-mail or search provider, a developer or work platform), " +
			"instead of the employer's own e-mail and password form? " +
			"Answer yes only for such a button, link, window or page. The employer's own sign-in, sign-up, continue or submit buttons, " +
			"the fields of a form, and a page of the employer's own application are not one.",
		Criteria: map[string]string{"true": "it signs in through another service's account", "false": "it does not"},
	}
}

// autofillQuestion asks whether a control, window or frame fills the application from anything but a
// résumé file uploaded from this computer.
func (t VetTarget) autofillQuestion() jev.Question {
	subject := "control"
	if t.Kind != VetControl {
		subject = "window or frame"
	}
	return jev.Question{
		Type: jev.TypeNoul,
		Instructions: "Is this " + subject + " a way to fill in the application from somewhere other than a résumé file uploaded from this computer: " +
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

// Hints for the model about a control that goes ahead though it looks like something not allowed.
const (
	hintOnlineSource = "a checker read this control's description as an online file source or a place to paste a document's text; " +
		"Acorn only ever attaches a file from this computer with upload, so if the screen shows that is what it is, leave it and use the file upload instead"
	hintSingleSignOn = "a checker read this control's description as a sign-in through another service's account, which Acorn never uses; " +
		"if the screen shows that is what it is, close what it opened and use the employer's own e-mail and password form"
	// reasonOtherAutofill is why an autofill from elsewhere is refused, for the model and the person.
	reasonOtherAutofill = "it fills the application from a saved profile or another service, and only a résumé file from this computer may fill it; " +
		"fill the fields from the applicant's details instead"
)

// Vet judges something the extension is about to click, or has just had opened.
func (a *Agent) Vet(ctx context.Context, id string, target VetTarget) (VetVerdict, error) {
	s, ok := a.sessions.get(id)
	if !ok {
		return VetVerdict{}, ErrNoSession
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.touched = a.now()
	state := target.state()
	if cached, ok := s.vetted[state]; ok {
		return cached, nil
	}
	started := a.now()
	res, err := a.decideText(ctx, s, "what the control or frame is", jev.Request{
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
		// An autofill from a saved profile or another service is refused outright, so it comes first: it
		// often looks like a sign-in too, and the sign-in reading would only hint.
		case autofill >= likely:
			verdict.Cause, verdict.Probability = CauseOtherAutofill, autofill
		case verdict.Probability >= likely:
			verdict.Cause = CauseOnlineSource
		case signOn >= likely:
			verdict.Cause, verdict.Probability = CauseSingleSignOn, signOn
		}
		// A control goes ahead with the doubt told to the model, except an autofill from elsewhere, which is
		// refused; a window or frame that opened is closed.
		switch {
		case verdict.Cause == "":
		case verdict.Cause == CauseOtherAutofill:
			verdict.Blocked, verdict.Reason = true, reasonOtherAutofill
		case target.Kind == VetControl && verdict.Cause == CauseOnlineSource:
			verdict.Hint = hintOnlineSource
		case target.Kind == VetControl:
			verdict.Hint = hintSingleSignOn
		case verdict.Cause == CauseOnlineSource:
			verdict.Blocked, verdict.Reason = true, "it looks like an online file source or a place to paste text"
		default:
			verdict.Blocked, verdict.Reason = true, "it signs in through another service's account, and Acorn never does; use the employer's own e-mail and password"
		}
	}
	if failed != "" {
		// Nothing is blocked on a check that could not be made: a failed check must not stop a click or
		// close a page the application opened.
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
