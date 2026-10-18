package mailcode

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/mailbox"
	"github.com/sid0709/OpenSeat/acorn-backend/selector"
)

// rankInOrder ranks the emails as listed, all equally likely, as Jev may when
// two emails from one sender look alike.
type rankInOrder struct{ ranked int }

func (r *rankInOrder) RankMail(_ context.Context, _ selector.MailAsk, items []selector.MailItem) (selector.MailRank, error) {
	r.ranked = len(items)
	out := make([]selector.Ranked, len(items))
	for i, item := range items {
		out[i] = selector.Ranked{ID: item.ID, Probability: 0.9}
	}
	return selector.MailRank{Ranked: out}, nil
}

func (r *rankInOrder) PickSecret(_ context.Context, _ selector.MailAsk, _, _ string, _ []selector.SecretCandidate) (selector.SecretPick, error) {
	return selector.SecretPick{Found: true, Index: 0}, nil
}

type inbox struct{ messages []mailbox.Message }

func (b inbox) Recent(context.Context, int) ([]mailbox.Message, error) { return b.messages, nil }

func (b inbox) Open(_ context.Context, id string) (mailbox.FullMessage, error) {
	return mailbox.FullMessage{ID: id, Subject: "code", Text: "Your one-time pass code is " + id}, nil
}

var clicked = time.Date(2026, 10, 13, 13, 0, 38, 0, time.UTC)

func mail(id string, at time.Time) mailbox.Message {
	return mailbox.Message{ID: id, Sender: "Site", SenderEmail: "no-reply@site.test", Subject: "code", ReceivedAt: at}
}

func find(t *testing.T, messages []mailbox.Message) (Result, *rankInOrder) {
	t.Helper()
	decide := &rankInOrder{}
	result, err := Find(context.Background(), decide, inbox{messages}, Query{
		Ask:   selector.MailAsk{Kind: selector.VerifyEmailCode},
		Since: clicked,
	})
	if err != nil {
		t.Fatal(err)
	}
	return result, decide
}

func TestFindWaitsWhenOnlyEarlierEmailsExist(t *testing.T) {
	result, decide := find(t, []mailbox.Message{mail("320319", clicked.Add(-2*time.Minute))})
	if result.Status != StatusPending || result.Value != "" {
		t.Fatalf("status %q value %q, want pending with no value", result.Status, result.Value)
	}
	if decide.ranked != 0 {
		t.Fatalf("Jev was asked about %d emails, want none", decide.ranked)
	}
}

func TestFindPrefersTheNewestEmailAfterTheStep(t *testing.T) {
	result, _ := find(t, []mailbox.Message{
		mail("394659", clicked.Add(20*time.Second)),
		mail("111111", clicked.Add(5*time.Second)),
		mail("320319", clicked.Add(-2*time.Minute)),
	})
	if result.Status != StatusFound || result.Value != "394659" {
		t.Fatalf("status %q value %q, want found 394659", result.Status, result.Value)
	}
}

func TestFindOpensNewestEvenWhenRankedLast(t *testing.T) {
	result, _ := find(t, []mailbox.Message{
		mail("111111", clicked.Add(5*time.Second)),
		mail("394659", clicked.Add(20*time.Second)),
	})
	if result.Value != "394659" {
		t.Fatalf("value %q, want the newest, 394659", result.Value)
	}
}

func TestFindPrefersNewestAmongSeveralPlausibleSenders(t *testing.T) {
	decide := &rankInOrder{}
	result, err := Find(context.Background(), decide, inbox{[]mailbox.Message{
		mail("111111", clicked.Add(5*time.Second)),
		func() mailbox.Message {
			m := mail("394659", clicked.Add(25*time.Second))
			m.Sender, m.SenderEmail, m.Subject = "Acme Jobs", "jobs@acme.test", "verify"
			return m
		}(),
	}}, Query{
		Ask:   selector.MailAsk{Kind: selector.VerifyEmailCode},
		Since: clicked,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Value != "394659" {
		t.Fatalf("value %q, want the latest arrival 394659", result.Value)
	}
}

func TestFindKeepsClockSkewAllowance(t *testing.T) {
	result, _ := find(t, []mailbox.Message{mail("555555", clicked.Add(-arrivalSkew/2))})
	if result.Value != "555555" {
		t.Fatalf("value %q, want an email within the skew to count", result.Value)
	}
}

// A code set apart in its own element, in a mixed-case code that has no digit, among a sentence
// that holds a date-like word: the recorded failure picked the "18th" in the sentence because the
// real code was never offered.
const greenhouseLike = `<html><head><title>Security code</title><style>.x{}</style></head><body>
<p>Hi Stanley, thanks for applying. Applications close on the 18th of the month.</p>
<p>Copy and paste this code into the security code field on your application:</p>
<table><tr><td><h1>qGEZpnBb</h1></td></tr></table>
<p>The code expires in 10 minutes.</p></body></html>`

func TestACodeStandingAloneIsOfferedWhateverItsLettersAndDigits(t *testing.T) {
	found := codeCandidates(mailbox.FullMessage{HTML: greenhouseLike})
	if len(found) == 0 || found[0].Value != "qGEZpnBb" || !found[0].Alone {
		t.Fatalf("candidates %+v: the code standing alone must come first", found)
	}
	if want := `The code is "qGEZpnBb".`; found[0].Description != want {
		t.Fatalf("description %q, want %q", found[0].Description, want)
	}
	// What is inside a sentence is offered after it, and not as standing alone.
	for _, candidate := range found[1:] {
		if candidate.Alone {
			t.Fatalf("%q is inside a sentence", candidate.Value)
		}
	}
}

func TestAnElementIsLeftToItsInnermostChildAndWrappersAreNotCodes(t *testing.T) {
	got := htmlElementTexts(`<div><table><tr><td><span>AB12CD34</span></td></tr></table><p>Some words here that are long enough to be a sentence</p></div>`)
	if len(got) < 1 || got[0] != "AB12CD34" {
		t.Fatalf("elements %q", got)
	}
	n := 0
	for _, text := range got {
		if text == "AB12CD34" {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("the same text came out %d times", n)
	}
	// A code split into boxes is one code: the parent's text is the code, no child's is.
	split := elementTexts(mailbox.FullMessage{HTML: `<div><span>qGEZ</span><span>pnBb</span></div>`})
	if !slices.Contains(split, "qGEZpnBb") {
		t.Fatalf("a code split into boxes is not offered whole: %q", split)
	}
}

func TestAPlainTextEmailOffersItsShortLinesAndTheTokensOfItsSentences(t *testing.T) {
	found := codeCandidates(mailbox.FullMessage{Text: "Hello,\nYour code is below.\nqGEZpnBb\nIt expires in ten minutes. Reference Ab3dEf9x."})
	values := map[string]bool{}
	for _, candidate := range found {
		values[candidate.Value] = true
	}
	for _, want := range []string{"qGEZpnBb", "Ab3dEf9x"} {
		if !values[want] {
			t.Fatalf("candidates %v lack %q", values, want)
		}
	}
	if values["Hello"] || values["below"] {
		t.Fatalf("ordinary words offered: %v", values)
	}
}

// pickAlone picks the candidate the email sets apart, as a decision model reads the descriptions.
type pickAlone struct{ rankInOrder }

func (p *pickAlone) PickSecret(_ context.Context, _ selector.MailAsk, _, _ string, candidates []selector.SecretCandidate) (selector.SecretPick, error) {
	for i, candidate := range candidates {
		if strings.Contains(candidate.Description, `"qGEZpnBb"`) {
			return selector.SecretPick{Found: true, Index: i}, nil
		}
	}
	return selector.SecretPick{Best: -1}, nil
}

type htmlInbox struct{ inbox }

func (b htmlInbox) Open(_ context.Context, id string) (mailbox.FullMessage, error) {
	return mailbox.FullMessage{ID: id, Subject: "Security code", HTML: greenhouseLike}, nil
}

func TestFindUsesTheCodeTheEmailSetsApart(t *testing.T) {
	result, err := Find(context.Background(), &pickAlone{}, htmlInbox{inbox{[]mailbox.Message{mail("m1", clicked.Add(5*time.Second))}}}, Query{
		Ask: selector.MailAsk{Kind: selector.VerifyEmailCode}, Since: clicked,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusFound || result.Value != "qGEZpnBb" {
		t.Fatalf("status %q value %q, want found qGEZpnBb", result.Status, result.Value)
	}
}

func TestAnEmailAlreadyUsedIsNotReadAgain(t *testing.T) {
	result, err := Find(context.Background(), &rankInOrder{}, inbox{[]mailbox.Message{mail("394659", clicked.Add(20*time.Second))}}, Query{
		Ask: selector.MailAsk{Kind: selector.VerifyEmailCode}, Since: clicked, Exclude: []string{"394659"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusPending {
		t.Fatalf("status %q: an email whose code was already typed must wait for a newer one", result.Status)
	}
}
