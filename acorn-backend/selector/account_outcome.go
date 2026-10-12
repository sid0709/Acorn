package selector

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/sid0709/OpenSeat/backend-core/jev"
	"github.com/sid0709/OpenSeat/backend-core/openai"
)

// How a site answered an account step the run sent.
const (
	// OutcomeAccepted: the site took the step and went on.
	OutcomeAccepted = "accepted"
	// OutcomeRefused: the site said no (wrong password, account exists, locked, a flagged field).
	OutcomeRefused = "refused"
	// OutcomeNotSent: nothing was sent; the click only changed which account form shows.
	OutcomeNotSent = "not_sent"
)

const (
	outcomeQuestion = "account_outcome"
	// maxOutcomeLines bounds the new lines and page messages one outcome reads.
	maxOutcomeLines = 20
)

// accountSent says, for each account goal, what the run's click sent.
var accountSent = map[string]string{
	AccountSignIn: "a sign-in form (the applicant's email and the account password)",
	AccountCreate: "a form that creates a new account (the applicant's email and a new password)",
	AccountReset:  "a password-recovery form (asking for a reset, or saving a new password)",
}

var accountOutcomes = map[string]string{
	OutcomeAccepted: "The site took it and went on: the applicant is signed in, the account was created, the reset was sent or " +
		"the new password was saved, the page now asks to verify by email, or it shows the next part of the same step " +
		"(a password page after the email).",
	OutcomeRefused: "The site refused it: the page says the email or password is wrong, the account already exists, is " +
		"locked, or is unknown, the password breaks the site's rules, or it marks a field of that form as invalid.",
	OutcomeNotSent: "Nothing was sent: the click only switched which account form the page shows, or the page shows the " +
		"same form with nothing new about it.",
}

// AccountOutcomeQuery is the page after the run sent one account step.
type AccountOutcomeQuery struct {
	// Sent is the account goal the click sent (an Account* goal).
	Sent string
	// BeforeURL and BeforeTitle are the page the form was sent from.
	BeforeURL   string
	BeforeTitle string
	URL         string
	Title       string
	Text        string
	// NewText are the lines the page shows now that it did not before the click.
	NewText []string
	// PageMessages are the page's own alerts and messages now.
	PageMessages []string
	// Flagged is how many fields the page marks invalid now.
	Flagged int
}

// AccountOutcome is how the site answered.
type AccountOutcome struct {
	Outcome    string
	Confidence float64
	Usage      jev.Usage
}

// JudgeAccountOutcome has Jev say whether the site took the account step the run
// sent, refused it, or never got it. One decision; it reads what the page says,
// never a field's value.
func (g *Gateway) JudgeAccountOutcome(ctx context.Context, q AccountOutcomeQuery) (AccountOutcome, error) {
	sent, ok := accountSent[q.Sent]
	if !ok {
		return AccountOutcome{}, fmt.Errorf("%w: unknown account step %q", ErrInvalid, q.Sent)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "The run sent %s from the page %q (%s).\n", sent, firstNonEmpty(q.BeforeTitle, "(untitled)"),
		firstNonEmpty(q.BeforeURL, "(unknown)"))
	fmt.Fprintf(&b, "Page now: %q (%s)\n", firstNonEmpty(q.Title, "(untitled)"), firstNonEmpty(q.URL, "(unknown)"))
	if q.Flagged > 0 {
		fmt.Fprintf(&b, "Fields the page marks invalid now: %d\n", q.Flagged)
	}
	for _, message := range firstN(q.PageMessages, maxOutcomeLines) {
		fmt.Fprintf(&b, "Page message: %s\n", clip(message, maxControlLine))
	}
	if lines := firstN(q.NewText, maxOutcomeLines); len(lines) > 0 {
		b.WriteString("\nText that appeared since the run sent it:\n")
		for _, line := range lines {
			fmt.Fprintf(&b, "- %s\n", clip(line, maxControlLine))
		}
	}
	b.WriteString("\nPage text:\n")
	b.WriteString(clipEnds(q.Text, maxPageText))

	res, err := g.decider.Decide(openai.WithCall(ctx, "account-outcome"), jev.Request{
		State: b.String(),
		Questions: map[string]jev.Question{outcomeQuestion: {
			Type: jev.TypeChoice,
			Instructions: "An automatic run applying to a job just sent an account form on the applicant's behalf. " +
				"How did the site answer it? Judge by what the page says and shows now, whatever its wording.",
			Criteria: accountOutcomes,
		}},
	})
	if err != nil {
		return AccountOutcome{}, err
	}
	answer, ok := res.Answers[outcomeQuestion]
	if !ok {
		return AccountOutcome{}, errors.New("jev returned no account outcome")
	}
	if _, listed := accountOutcomes[answer.Choice]; !listed {
		return AccountOutcome{}, fmt.Errorf("jev returned an unknown account outcome %q", answer.Choice)
	}
	return AccountOutcome{Outcome: answer.Choice, Confidence: answer.Confidence, Usage: res.Usage}, nil
}

// firstN keeps at most n items.
func firstN(items []string, n int) []string {
	if len(items) > n {
		return items[:n]
	}
	return items
}
