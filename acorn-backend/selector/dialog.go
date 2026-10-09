package selector

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/sid0709/OpenSeat/backend-core/jev"
	"github.com/sid0709/OpenSeat/backend-core/openai"
)

// Dialog kinds a page can open (the browser's own boxes, not the page's markup).
const (
	DialogAlert        = "alert"
	DialogConfirm      = "confirm"
	DialogPrompt       = "prompt"
	DialogBeforeUnload = "beforeunload"
)

const (
	dialogQuestion = "accept_dialog"
	// maxDialogMessage bounds the dialog text Jev reads.
	maxDialogMessage = 1000
)

var dialogKinds = map[string]string{
	DialogAlert:        "a message with only an OK button",
	DialogConfirm:      "a question with OK and Cancel",
	DialogPrompt:       "a question asking for text, with OK and Cancel",
	DialogBeforeUnload: "a question asking whether to leave the page, with Leave and Stay",
}

// IsDialogKind says whether kind is one the browser opens.
func IsDialogKind(kind string) bool {
	_, listed := dialogKinds[kind]
	return listed
}

// DialogQuery is a browser dialog that opened while a run was applying.
type DialogQuery struct {
	Kind    string
	Message string
	URL     string
	Title   string
	// LastControl is the control the run clicked last, which likely opened the dialog.
	LastControl string
}

// DialogAnswer says whether to press OK (accept) or Cancel (dismiss).
type DialogAnswer struct {
	Accept     bool
	Confidence float64
	Usage      jev.Usage
}

// DecideDialog has Jev say whether accepting a browser dialog keeps the application
// going. An alert has only OK, so it is accepted without asking.
func (g *Gateway) DecideDialog(ctx context.Context, q DialogQuery) (DialogAnswer, error) {
	kind, listed := dialogKinds[q.Kind]
	if !listed {
		return DialogAnswer{}, fmt.Errorf("%w: unknown dialog kind %q", ErrInvalid, q.Kind)
	}
	if q.Kind == DialogAlert {
		return DialogAnswer{Accept: true, Confidence: 1}, nil
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Page URL: %s\nPage title: %s\n", firstNonEmpty(q.URL, "(unknown)"), firstNonEmpty(q.Title, "(untitled)"))
	if q.LastControl != "" {
		fmt.Fprintf(&b, "The run last clicked: %q\n", clip(q.LastControl, maxControlLine))
	}
	fmt.Fprintf(&b, "The browser opened %s. It says:\n%s\n", kind, clip(q.Message, maxDialogMessage))

	res, err := g.decider.Decide(openai.WithCall(ctx, "dialog"), jev.Request{
		State: b.String(),
		Questions: map[string]jev.Question{dialogQuestion: {
			Type: jev.TypeNoul,
			Instructions: "An automatic run is applying to a job for the applicant, and the page opened this browser dialog. " +
				"Should the run accept it (OK, or Leave) rather than dismiss it (Cancel, or Stay)? Accept when that keeps the " +
				"application going: it confirms the step the run just took, acknowledges a notice, or leaves a page the run chose " +
				"to leave. Dismiss when accepting would withdraw, cancel, delete, or discard the application or its answers, " +
				"sign out, or leave the application unfinished.",
			Criteria: map[string]string{
				"true":  "Accepting keeps the application going.",
				"false": "Accepting would withdraw, cancel, delete, or discard the application or its answers, or abandon it.",
			},
		}},
	})
	if err != nil {
		return DialogAnswer{}, err
	}
	answer := res.Answers[dialogQuestion]
	if answer.Noul == nil {
		return DialogAnswer{}, errors.New("jev returned no dialog answer")
	}
	return DialogAnswer{Accept: *answer.Noul > checkThreshold, Confidence: *answer.Noul, Usage: res.Usage}, nil
}
