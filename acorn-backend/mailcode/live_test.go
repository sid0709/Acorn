package mailcode

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/sid0709/OpenSeat/acorn-backend/mailbox"
	"github.com/sid0709/OpenSeat/acorn-backend/selector"
	"github.com/sid0709/OpenSeat/backend-core/jev"
)

// liveKeyEnv names the environment variable that turns on the tests that call the real decision
// model. They are skipped without it, so the suite never needs a key or the network.
const liveKeyEnv = "ACORN_LIVE_JEV_KEY"

const liveFooter = `<p>© 2026 Greenhouse Software, Inc. 18 West 18th Street, 11th Floor, New York, NY 10011, USA</p>`

type oneMail struct {
	inbox
	message mailbox.FullMessage
}

func (b oneMail) Open(context.Context, string) (mailbox.FullMessage, error) { return b.message, nil }

// TestLiveTheRealModelFindsTheCodeOrLink runs secretIn against the real decision model on emails shaped
// like the ones sites send, and says what was chosen and how sure the model was.
func TestLiveTheRealModelFindsTheCodeOrLink(t *testing.T) {
	key := os.Getenv(liveKeyEnv)
	if key == "" {
		t.Skip(liveKeyEnv + " is not set")
	}
	gateway := selector.New(jev.New(key))
	cases := []struct {
		name    string
		kind    string
		message mailbox.FullMessage
		want    string
	}{
		{"mixed-case letters in their own element", selector.VerifyEmailCode,
			mailbox.FullMessage{Subject: "Security code for your application to Reddit", HTML: greenhouseLike + liveFooter}, "qGEZpnBb"},
		{"digits in their own element", selector.VerifyEmailCode,
			mailbox.FullMessage{Subject: "Your verification code", HTML: `<div><p>Hi Sam,</p><p>Your verification code is below. It expires on March 12th at 9am.</p><div style="font-size:32px">482913</div><p>If you did not ask for this, ignore it. Order 20481 ships soon.</p></div>`}, "482913"},
		{"a code written in a sentence of a plain email", selector.VerifyEmailCode,
			mailbox.FullMessage{Subject: "Confirm your sign-in", Text: "Hello Sam,\nUse the code Ab3dEf9x to finish signing in. It is valid for 10 minutes.\nThanks,\nThe Team"}, "Ab3dEf9x"},
		{"a verify button among other links", selector.VerifyEmailLink,
			mailbox.FullMessage{Subject: "Verify your email", HTML: `<p>Welcome to Acme.</p><p><a href="https://acme.test/verify?token=abc123">Verify email address</a></p><p><a href="https://acme.test/unsubscribe?u=9">Unsubscribe</a> · <a href="https://acme.test/privacy">Privacy</a></p>`}, "https://acme.test/verify?token=abc123"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// A real page's text starts with the job posting, far from the code field.
			page := strings.Repeat("Senior Software Engineer. Build advertiser-facing systems in Python with LLM tool calling, distributed systems and observability. ", 12)
			ask := selector.MailAsk{Kind: c.kind, Title: "Job Application", PageText: page + "A verification was sent to the applicant's email. Enter it to confirm. Security code"}
			value, opened, _, _, err := secretIn(context.Background(), gateway, oneMail{message: c.message}, ask, selector.Ranked{ID: "m1", Probability: 0.95}, c.message.Subject)
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("pick %+v picked %d fallback %v", opened.Pick, opened.Picked, opened.Fallback)
			if value != c.want {
				t.Fatalf("value %q, want %q", value, c.want)
			}
		})
	}
}
