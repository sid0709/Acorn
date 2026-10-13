package mailcode

import (
	"context"
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

func (r *rankInOrder) PickSecret(_ context.Context, _ selector.MailAsk, _ string, _ []selector.SecretCandidate) (selector.SecretPick, error) {
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

func TestFindKeepsClockSkewAllowance(t *testing.T) {
	result, _ := find(t, []mailbox.Message{mail("555555", clicked.Add(-arrivalSkew/2))})
	if result.Value != "555555" {
		t.Fatalf("value %q, want an email within the skew to count", result.Value)
	}
}
