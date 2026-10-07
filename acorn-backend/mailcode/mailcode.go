// Package mailcode finds the verification code or link a job site emailed the
// applicant. TypeSafe Jev ranks the newest emails, then picks the code or link
// among the ones the best email holds; nothing is matched on wording. When the
// best email holds none, the second best is opened; after that the search stops.
package mailcode

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/mailbox"
	"github.com/sid0709/OpenSeat/acorn-backend/selector"
	"github.com/sid0709/OpenSeat/backend-core/jev"
)

const (
	// RecentMessages is how many of the newest inbox emails are read.
	RecentMessages = 20
	// MaxOpened is how many of the best-ranked emails are opened before the search stops.
	MaxOpened = 2
	// arrivalSkew lets an email stamped a little before the site's step still count.
	arrivalSkew = 2 * time.Minute
	// maxRuledOut bounds the email ids a caller can hand back as already judged.
	maxRuledOut = 200
)

// Statuses a search ends in.
const (
	// StatusFound carries the code or link.
	StatusFound = "found"
	// StatusPending means no email from the site has arrived yet; look again later.
	StatusPending = "pending"
	// StatusNotFound means the site's best emails hold no code or link: stop.
	StatusNotFound = "not_found"
)

// ErrInvalid is a request the caller should fix, not retry.
var ErrInvalid = errors.New("invalid mail verification request")

// Selector is the decision model's side. *selector.Gateway is the real one.
type Selector interface {
	RankMail(ctx context.Context, ask selector.MailAsk, items []selector.MailItem) (selector.MailRank, error)
	PickSecret(ctx context.Context, ask selector.MailAsk, subject string, candidates []selector.SecretCandidate) (selector.SecretPick, error)
}

// Reader reads the applicant's mailbox.
type Reader interface {
	// Recent lists the newest n inbox emails, newest first.
	Recent(ctx context.Context, n int) ([]mailbox.Message, error)
	Open(ctx context.Context, id string) (mailbox.FullMessage, error)
}

// Query is the step a site is waiting on.
type Query struct {
	Ask selector.MailAsk
	// Since is when the site was asked to send the email; zero reads every recent email.
	Since time.Time
	// RuledOut are emails an earlier search already judged unrelated to this step.
	RuledOut []string
}

// Result is how a search ended. Value is set only when Status is StatusFound.
type Result struct {
	Status    string
	Value     string
	MessageID string
	// RuledOut grows by the emails this search judged unrelated; the caller sends it back next time.
	RuledOut []string
	// Opened is how many emails were opened.
	Opened int
	Calls  int
	Usage  jev.Usage
}

// Find looks for the code or link the site sent.
func Find(ctx context.Context, decide Selector, mail Reader, q Query) (Result, error) {
	if !selector.IsMailVerification(q.Ask.Kind) {
		return Result{}, fmt.Errorf("%w: kind must be %s or %s", ErrInvalid, selector.VerifyEmailCode, selector.VerifyEmailLink)
	}
	if len(q.RuledOut) > maxRuledOut {
		q.RuledOut = q.RuledOut[len(q.RuledOut)-maxRuledOut:]
	}
	result := Result{Status: StatusPending, RuledOut: slices.Clone(q.RuledOut)}

	recent, err := mail.Recent(ctx, RecentMessages)
	if err != nil {
		return result, fmt.Errorf("read recent mail: %w", err)
	}
	items, subjects := fresh(recent, q)
	if len(items) == 0 {
		return result, nil
	}

	rank, err := decide.RankMail(ctx, q.Ask, items)
	if err != nil {
		return result, fmt.Errorf("rank mail: %w", err)
	}
	result.add(rank.Usage)
	if rank.None {
		for _, item := range items {
			result.RuledOut = append(result.RuledOut, item.ID)
		}
		return result, nil
	}

	for _, ranked := range rank.Ranked[:min(MaxOpened, len(rank.Ranked))] {
		value, usage, called, err := secretIn(ctx, decide, mail, q.Ask, ranked.ID, subjects[ranked.ID])
		result.Opened++
		if called {
			result.add(usage)
		}
		if err != nil {
			return result, err
		}
		if value != "" {
			result.Status, result.Value, result.MessageID = StatusFound, value, ranked.ID
			return result, nil
		}
	}
	result.Status = StatusNotFound
	return result, nil
}

// fresh are the recent emails that arrived since the site's step and were not
// already judged unrelated, as Jev reads them.
func fresh(recent []mailbox.Message, q Query) ([]selector.MailItem, map[string]string) {
	ruledOut := make(map[string]bool, len(q.RuledOut))
	for _, id := range q.RuledOut {
		ruledOut[id] = true
	}
	var items []selector.MailItem
	subjects := map[string]string{}
	for _, message := range recent {
		if ruledOut[message.ID] {
			continue
		}
		if !q.Since.IsZero() && message.ReceivedAt.Before(q.Since.Add(-arrivalSkew)) {
			continue
		}
		from := message.Sender
		if message.SenderEmail != "" {
			from += " <" + message.SenderEmail + ">"
		}
		items = append(items, selector.MailItem{
			ID: message.ID, From: from, Subject: message.Subject, Snippet: message.Snippet, ReceivedAt: message.ReceivedAt,
		})
		subjects[message.ID] = message.Subject
	}
	return items, subjects
}

// secretIn opens one email and asks Jev which of its codes or links the page
// wants. "" when the email holds none; called is false when Jev was not asked.
func secretIn(ctx context.Context, decide Selector, mail Reader, ask selector.MailAsk, id, subject string) (string, jev.Usage, bool, error) {
	message, err := mail.Open(ctx, id)
	if err != nil {
		return "", jev.Usage{}, false, fmt.Errorf("open mail: %w", err)
	}
	found := codeCandidates(message)
	if ask.Kind == selector.VerifyEmailLink {
		found = linkCandidates(message)
	}
	if len(found) == 0 {
		return "", jev.Usage{}, false, nil
	}
	candidates := make([]selector.SecretCandidate, len(found))
	for i, candidate := range found {
		candidates[i] = selector.SecretCandidate{Description: candidate.Description}
	}
	pick, err := decide.PickSecret(ctx, ask, firstNonEmpty(message.Subject, subject), candidates)
	if err != nil {
		return "", jev.Usage{}, false, fmt.Errorf("pick from mail: %w", err)
	}
	if !pick.Found || pick.Index >= len(found) {
		return "", pick.Usage, true, nil
	}
	return found[pick.Index].Value, pick.Usage, true, nil
}

func (r *Result) add(usage jev.Usage) {
	r.Calls++
	r.Usage.InputTokens += usage.InputTokens
	r.Usage.OutputTokens += usage.OutputTokens
	r.Usage.Cost += usage.Cost
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
