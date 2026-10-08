// Package mailcode finds the verification code or link a job site emailed the
// applicant. Each look lists the newest inbox emails (their rows only: sender,
// subject, plain-text preview, time) and, when that list changed since the last
// look, TypeSafe Jev judges all of them together. Only the email Jev picks is
// opened, and Jev then picks the code or link among the ones it holds; nothing is
// matched on wording. When the best email holds none, the second best is opened;
// after that the search stops.
package mailcode

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"strconv"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/mailbox"
	"github.com/sid0709/OpenSeat/acorn-backend/selector"
	"github.com/sid0709/OpenSeat/backend-core/jev"
)

const (
	// RecentMessages is how many of the newest inbox emails each look reads.
	RecentMessages = 10
	// MaxOpened is how many of the best-ranked emails are opened before the search stops.
	MaxOpened = 2
	// arrivalSkew lets an email stamped a little before the site's step still count as after it.
	arrivalSkew = 2 * time.Minute
	// minOpenProbability is the least chance Jev must give an email before it is opened.
	minOpenProbability = 0.05
	// confidentMail is the chance at or above which Jev's pick of the email is trusted
	// enough to take its most probable link or code when Jev answers none of them.
	confidentMail = 0.5
)

// Statuses a search ends in.
const (
	// StatusFound carries the code or link.
	StatusFound = "found"
	// StatusPending means no email holds it yet: look again later.
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
	// Since is when the site was asked to send the email; zero when unknown.
	Since time.Time
	// Seen is the Seen of the last look: when the newest emails are still the same,
	// Jev is not asked again.
	Seen string
}

// Judged is one email Jev weighed, for the debug trace.
type Judged struct {
	ID          string
	From        string
	Subject     string
	After       bool
	Probability float64
}

// Opened is one email the search opened, for the debug trace (never the values).
type Opened struct {
	ID         string
	Subject    string
	Candidates []string
	Picked     int
	Fallback   bool
	// Unconfirmed is true when the picked value was not found written in the email.
	Unconfirmed bool
}

// Result is how a look ended. Value is set only when Status is StatusFound.
type Result struct {
	Status    string
	Value     string
	MessageID string
	// Seen names the newest emails this look read; the caller sends it back next time.
	Seen string
	// Unchanged is true when the emails were the same as last time and Jev was not asked.
	Unchanged bool
	// Emails are the newest emails this look read, newest first; Probability is set once judged.
	Emails []Judged
	// Judged is every email Jev weighed, most probable first.
	Judged []Judged
	// Opened is every email opened, in order.
	Opened []Opened
	Calls  int
	Usage  jev.Usage
}

// Find takes one look at the newest emails for the code or link the site sent.
func Find(ctx context.Context, decide Selector, mail Reader, q Query) (Result, error) {
	if !selector.IsMailVerification(q.Ask.Kind) {
		return Result{}, fmt.Errorf("%w: kind must be %s or %s", ErrInvalid, selector.VerifyEmailCode, selector.VerifyEmailLink)
	}
	recent, err := mail.Recent(ctx, RecentMessages)
	if err != nil {
		return Result{Status: StatusPending, Seen: q.Seen}, fmt.Errorf("read recent mail: %w", err)
	}
	items, subjects := mailItems(recent, q.Since)
	result := Result{Status: StatusPending, Seen: seenOf(recent), Emails: listed(items)}
	if len(recent) == 0 {
		return result, nil
	}
	if result.Seen == q.Seen {
		result.Unchanged = true
		return result, nil
	}

	rank, err := decide.RankMail(ctx, q.Ask, items)
	if err != nil {
		return result, fmt.Errorf("rank mail: %w", err)
	}
	result.add(rank.Usage)
	result.Judged = judged(items, rank)
	result.Emails = withProbabilities(result.Emails, result.Judged)
	if rank.None {
		return result, nil
	}

	for _, ranked := range rank.Ranked[:min(MaxOpened, len(rank.Ranked))] {
		if ranked.Probability < minOpenProbability {
			break
		}
		value, opened, usage, called, err := secretIn(ctx, decide, mail, q.Ask, ranked, subjects[ranked.ID])
		result.Opened = append(result.Opened, opened)
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

// seenOf names a list of emails by their ids, so two looks can tell whether anything arrived.
func seenOf(messages []mailbox.Message) string {
	h := fnv.New64a()
	for _, message := range messages {
		h.Write([]byte(message.ID))
		h.Write([]byte{0})
	}
	return strconv.FormatUint(h.Sum64(), 36)
}

// mailItems are the emails as Jev reads them: their list rows only, each marked
// with whether it arrived after the site was asked to send.
func mailItems(recent []mailbox.Message, since time.Time) ([]selector.MailItem, map[string]string) {
	items := make([]selector.MailItem, 0, len(recent))
	subjects := make(map[string]string, len(recent))
	for _, message := range recent {
		from := message.Sender
		if message.SenderEmail != "" {
			from += " <" + message.SenderEmail + ">"
		}
		items = append(items, selector.MailItem{
			ID: message.ID, From: from, Subject: message.Subject, Snippet: message.Snippet,
			ReceivedAt: message.ReceivedAt,
			After:      !since.IsZero() && !message.ReceivedAt.Before(since.Add(-arrivalSkew)),
			AfterKnown: !since.IsZero(),
		})
		subjects[message.ID] = message.Subject
	}
	return items, subjects
}

func judged(items []selector.MailItem, rank selector.MailRank) []Judged {
	byID := make(map[string]selector.MailItem, len(items))
	for _, item := range items {
		byID[item.ID] = item
	}
	out := make([]Judged, 0, len(rank.Ranked))
	for _, ranked := range rank.Ranked {
		item := byID[ranked.ID]
		out = append(out, Judged{ID: item.ID, From: item.From, Subject: item.Subject, After: item.After, Probability: ranked.Probability})
	}
	return out
}

// secretIn opens one email and asks Jev which of its codes or links the page
// wants. "" when the email holds none; called is false when Jev was not asked.
// When Jev was sure of the email but answers none of its links or codes, its
// most probable one is taken: the email itself is the site's answer.
func secretIn(ctx context.Context, decide Selector, mail Reader, ask selector.MailAsk, ranked selector.Ranked, subject string) (string, Opened, jev.Usage, bool, error) {
	opened := Opened{ID: ranked.ID, Subject: subject, Picked: -1}
	message, err := mail.Open(ctx, ranked.ID)
	if err != nil {
		return "", opened, jev.Usage{}, false, fmt.Errorf("open mail: %w", err)
	}
	found := codeCandidates(message)
	if ask.Kind == selector.VerifyEmailLink {
		found = linkCandidates(message)
	}
	candidates := make([]selector.SecretCandidate, len(found))
	for i, candidate := range found {
		candidates[i] = selector.SecretCandidate{Description: candidate.Description}
		opened.Candidates = append(opened.Candidates, candidate.Description)
	}
	if len(found) == 0 {
		return "", opened, jev.Usage{}, false, nil
	}
	pick, err := decide.PickSecret(ctx, ask, firstNonEmpty(message.Subject, subject), candidates)
	if err != nil {
		return "", opened, jev.Usage{}, false, fmt.Errorf("pick from mail: %w", err)
	}
	index := -1
	switch {
	case pick.Found && pick.Index < len(found):
		index = pick.Index
	case ranked.Probability >= confidentMail && pick.Best >= 0 && pick.Best < len(found):
		index, opened.Fallback = pick.Best, true
	}
	opened.Picked = index
	if index < 0 {
		return "", opened, pick.Usage, true, nil
	}
	// Jev chose a number; the value is read from the email by code, and confirmed
	// once more to be written in this email before the run uses it.
	value := found[index].Value
	if !confirmed(message, value) {
		opened.Unconfirmed = true
		return "", opened, pick.Usage, true, nil
	}
	return value, opened, pick.Usage, true, nil
}

// listed are the emails as the sidebar shows them: sender and subject.
func listed(items []selector.MailItem) []Judged {
	out := make([]Judged, len(items))
	for i, item := range items {
		out[i] = Judged{ID: item.ID, From: item.From, Subject: item.Subject, After: item.After}
	}
	return out
}

// withProbabilities puts Jev's judgment on each listed email.
func withProbabilities(emails, judged []Judged) []Judged {
	byID := make(map[string]float64, len(judged))
	for _, j := range judged {
		byID[j.ID] = j.Probability
	}
	for i := range emails {
		emails[i].Probability = byID[emails[i].ID]
	}
	return emails
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
