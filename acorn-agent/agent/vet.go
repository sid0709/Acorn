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
)

// The applicant has not allowed online file sources (a cloud drive, a file-sharing service, a
// sign-in to one) and a file only ever comes from this computer. The prompt says so, but a
// model can slip, so the extension asks the server about what is about to be clicked, and about
// a window or frame that a click opened, and the server asks the decision model. There is no
// list of services in code: the model judges what a control or page is. A control it is unsure
// about (a probability of VetBlock or more) is blocked, and so is any control inside a
// file-upload component when it cannot be checked. A window or frame that cannot be checked is
// let be, since a failed check must not close every page the application opens.
//
// The same check keeps the run from signing in through another service's account (single sign-on
// through a social network, an e-mail or search provider, a work platform): the applicant's own
// e-mail and password are used, and a button or window that would start one is refused or closed.

const (
	askOnlineSource = "online_source"
	askSingleSignOn = "single_sign_on"
	// Why a click was refused: it reached an online file source, or another service's sign-in.
	CauseOnlineSource = "online_source"
	CauseSingleSignOn = "single_sign_on"
	// Kinds of thing the extension asks about.
	VetControl = "control"
	VetWindow  = "window"
	VetFrame   = "frame"
	// maxVetText bounds each piece of a description.
	maxVetText = 240
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

// VetVerdict says whether to go ahead.
type VetVerdict struct {
	Blocked     bool    `json:"blocked"`
	Probability float64 `json:"probability"`
	// Cause is why it was blocked: CauseOnlineSource or CauseSingleSignOn.
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

func (t VetTarget) questions() map[string]jev.Question {
	return map[string]jev.Question{askOnlineSource: t.question(), askSingleSignOn: t.signOnQuestion()}
}

func (a *Agent) signOnBlockAbove() float64 {
	if a.cfg.SingleSignOnBlock > 0 {
		return a.cfg.SingleSignOnBlock
	}
	return 0.5
}

func (a *Agent) vetBlockAbove() float64 {
	if a.cfg.VetBlock > 0 {
		return a.cfg.VetBlock
	}
	return 0.3
}

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
	res, err := a.newDecider(s.key).Decide(ctx, jev.Request{
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
		if verdict.Probability >= a.vetBlockAbove() {
			verdict.Blocked, verdict.Cause = true, CauseOnlineSource
		}
	}
	// Signing in through another service is judged by its own question; a checker that gave no
	// answer to it leaves the control as the first question judged it.
	signOn := 0.0
	if failed == "" {
		if other, ok := res.Answers[askSingleSignOn]; ok && other.Noul != nil {
			signOn = *other.Noul
		}
		if !verdict.Blocked && signOn >= a.signOnBlockAbove() {
			verdict.Blocked, verdict.Cause, verdict.Probability = true, CauseSingleSignOn, signOn
			verdict.Reason = "it signs in through another service's account, and Acorn never does; use the employer's own e-mail and password"
		}
	}
	if failed != "" {
		// Only a control in a file-upload component is blocked when it cannot be checked.
		verdict.Blocked = target.Kind == VetControl && target.InFileComponent
		if verdict.Blocked {
			verdict.Cause = CauseOnlineSource
		}
		verdict.Reason = "could not be checked"
		slog.Warn("vet failed", "session", s.id, "kind", target.Kind, "blocked", verdict.Blocked, "error", failed)
	}
	if verdict.Blocked && verdict.Reason == "" {
		verdict.Reason = "it looks like an online file source or a place to paste text"
	}
	if failed == "" {
		if s.vetted == nil {
			s.vetted = map[string]VetVerdict{}
		}
		s.vetted[state] = verdict
	}
	a.recordVet(s.id, vetLine{
		At: started, Kind: target.Kind, State: state, Probability: verdict.Probability, Blocked: verdict.Blocked,
		SingleSignOn: signOn, Error: failed, LatencyMs: a.now().Sub(started).Milliseconds(),
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
	Error        string  `json:"error,omitempty"`
	LatencyMs    int64   `json:"latencyMs"`
}

func (a *Agent) recordVet(sessionID string, line vetLine) {
	if !a.trace.enabled() {
		return
	}
	dir, err := a.trace.folder(sessionID)
	if err != nil {
		slog.Warn("vet not written", "session", sessionID, "error", err)
		return
	}
	raw, err := json.Marshal(line)
	if err == nil {
		err = appendLine(filepath.Join(dir, "vets.jsonl"), string(raw))
	}
	if err != nil {
		slog.Warn("vet not written", "session", sessionID, "error", err)
	}
}
