package selector

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/backend-core/jev"
	"github.com/sid0709/OpenSeat/backend-core/openai"
)

const (
	mailQuestion   = "mail"
	secretQuestion = "secret"
	mailKeyPrefix  = "mail"
	secretPrefix   = "candidate"

	// maxMailField bounds a sender, subject, or preview line Jev reads.
	maxMailField = 300
	// maxMailPageText bounds the page copy sent with a mail decision.
	maxMailPageText = 1500
	// maxSecretContext bounds the email text around one candidate.
	maxSecretContext = 240
	// mailTimeLayout is how received times are written for Jev.
	mailTimeLayout = "2006-01-02 15:04 MST"
)

// MailAsk is the verification step a site is waiting on.
type MailAsk struct {
	// Kind is VerifyEmailCode or VerifyEmailLink.
	Kind     string
	URL      string
	Title    string
	PageText string
	Now      time.Time
}

// MailItem is one recent email, as its list row shows it.
type MailItem struct {
	ID         string
	From       string
	Subject    string
	Snippet    string
	ReceivedAt time.Time
	// After is true when the email arrived after the site was asked to send it;
	// AfterKnown is false when the run does not know when that was.
	After      bool
	AfterKnown bool
}

// MailRank orders the emails by Jev's probability that the site sent it for
// this step. None is true when Jev chose that no listed email was.
type MailRank struct {
	Ranked []Ranked
	None   bool
	Usage  jev.Usage
}

// SecretCandidate is one code or link an email holds. Description is all Jev
// reads: a code is masked in its own context, a link is shown without its
// query string, so the secret itself never reaches the model.
type SecretCandidate struct {
	Description string
}

// SecretPick is the candidate Jev chose; Found is false when it chose none.
type SecretPick struct {
	Index      int
	Found      bool
	Confidence float64
	// Best is the most probable candidate even when Jev chose none, and BestP its probability.
	Best  int
	BestP float64
	Usage jev.Usage
}

// IsMailVerification says whether kind is a verification the applicant's mail can answer.
func IsMailVerification(kind string) bool {
	return kind == VerifyEmailCode || kind == VerifyEmailLink
}

// RankMail asks which recent email the site sent for this verification step.
func (g *Gateway) RankMail(ctx context.Context, ask MailAsk, items []MailItem) (MailRank, error) {
	if !IsMailVerification(ask.Kind) || len(items) == 0 {
		return MailRank{}, fmt.Errorf("%w: a mail verification kind and emails are required", ErrInvalid)
	}
	if limit := jev.MaxChoiceOptions - 1; len(items) > limit {
		items = items[:limit]
	}
	criteria := map[string]string{
		noControlKey: "None of these emails was sent by this job site for this step.",
	}
	for i, item := range items {
		criteria[fmt.Sprintf("%s_%d", mailKeyPrefix, i)] = describeMail(item)
	}
	res, err := g.decider.Decide(openai.WithCall(ctx, "mail-rank"), jev.Request{
		State: mailState(ask),
		Questions: map[string]jev.Question{mailQuestion: {
			Type: jev.TypeChoice,
			Instructions: "Which of these emails carries the link or code for the step the page is waiting on? " +
				"The email may come from the job site or from the hiring platform it runs on, under either name. " +
				"Match its subject and preview to the step (verifying the email, activating the account, resetting " +
				"the password, a security code), and prefer one that arrived after the site was asked to send it, " +
				"most recent first. Choose none only when no email could be it.",
			Criteria: criteria,
		}},
	})
	if err != nil {
		return MailRank{}, err
	}
	answer, ok := res.Answers[mailQuestion]
	if !ok {
		return MailRank{}, errors.New("jev returned no email answer")
	}
	rank := MailRank{None: answer.Choice == noControlKey, Usage: res.Usage}
	for i, item := range items {
		key := fmt.Sprintf("%s_%d", mailKeyPrefix, i)
		rank.Ranked = append(rank.Ranked, Ranked{ID: item.ID, Probability: answer.Probabilities[key]})
		if key == answer.Choice {
			// Jev's own choice leads a tie.
			rank.Ranked[i].Probability += tieBreak
		}
	}
	sort.SliceStable(rank.Ranked, func(i, j int) bool { return rank.Ranked[i].Probability > rank.Ranked[j].Probability })
	return rank, nil
}

// tieBreak lifts Jev's chosen email above another with the same probability.
const tieBreak = 1e-9

// PickSecret asks which of the email's codes or links is the one the page wants.
func (g *Gateway) PickSecret(ctx context.Context, ask MailAsk, subject string, candidates []SecretCandidate) (SecretPick, error) {
	if !IsMailVerification(ask.Kind) || len(candidates) == 0 {
		return SecretPick{}, fmt.Errorf("%w: a mail verification kind and candidates are required", ErrInvalid)
	}
	if limit := jev.MaxChoiceOptions - 1; len(candidates) > limit {
		candidates = candidates[:limit]
	}
	instructions := "Which of these is the one-time verification code in this email, the code the page asks the applicant to enter? " +
		"Each candidate is shown as [CODE] inside the email's own words. Choose none when the email holds no such code."
	none := "The email holds no verification code for this step."
	if ask.Kind == VerifyEmailLink {
		instructions = "Which link in this email must the applicant open to go on with the step the page is waiting on " +
			"(verify the email address, activate the account, or reset the password)? Never pick an unsubscribe, privacy, " +
			"help, or social link. Choose none when the email holds no such link."
		none = "The email holds no link for this step."
	}
	criteria := map[string]string{noControlKey: none}
	for i, candidate := range candidates {
		criteria[fmt.Sprintf("%s_%d", secretPrefix, i)] = clip(candidate.Description, maxSecretContext)
	}
	state := mailState(ask) + "\nEmail subject: " + clip(subject, maxMailField)
	res, err := g.decider.Decide(openai.WithCall(ctx, "mail-secret"), jev.Request{
		State: state,
		Questions: map[string]jev.Question{secretQuestion: {
			Type: jev.TypeChoice, Instructions: instructions, Criteria: criteria,
		}},
	})
	if err != nil {
		return SecretPick{}, err
	}
	answer, ok := res.Answers[secretQuestion]
	if !ok {
		return SecretPick{}, errors.New("jev returned no candidate answer")
	}
	pick := SecretPick{Confidence: answer.Confidence, Best: -1, Usage: res.Usage}
	for i := range candidates {
		key := fmt.Sprintf("%s_%d", secretPrefix, i)
		if answer.Choice == key {
			pick.Index, pick.Found = i, true
		}
		if p := answer.Probabilities[key]; p > pick.BestP {
			pick.Best, pick.BestP = i, p
		}
	}
	return pick, nil
}

func mailState(ask MailAsk) string {
	want := "a verification code sent to the applicant's email"
	if ask.Kind == VerifyEmailLink {
		want = "the applicant to open a link sent to their email"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "A job site's page is waiting for %s.\n", want)
	fmt.Fprintf(&b, "Page URL: %s\nPage title: %s\n", firstNonEmpty(ask.URL, "(unknown)"), firstNonEmpty(ask.Title, "(untitled)"))
	if !ask.Now.IsZero() {
		fmt.Fprintf(&b, "Time now: %s\n", ask.Now.UTC().Format(mailTimeLayout))
	}
	if text := strings.TrimSpace(ask.PageText); text != "" {
		b.WriteString("Page text:\n" + clip(text, maxMailPageText) + "\n")
	}
	return b.String()
}

func describeMail(item MailItem) string {
	arrived := ""
	if item.AfterKnown {
		arrived = " (before the site was asked)"
		if item.After {
			arrived = " (after the site was asked)"
		}
	}
	return fmt.Sprintf("From: %s · Subject: %s · Received: %s%s · Preview: %s",
		clip(item.From, maxMailField), clip(item.Subject, maxMailField),
		item.ReceivedAt.UTC().Format(mailTimeLayout), arrived, clip(item.Snippet, maxMailField))
}
