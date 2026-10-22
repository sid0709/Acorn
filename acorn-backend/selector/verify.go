package selector

import (
	"context"
	"errors"
	"fmt"

	"github.com/sid0709/acorn/acorn-backend/jev"
	"github.com/sid0709/acorn/acorn-backend/openai"
)

const (
	verifyQuestion = "verify_mail"
	verifyKey      = "verification"
	// maxVerifyBody bounds the plain text of one arriving email that Jev reads.
	maxVerifyBody = 3000
)

// VerifyMail is what Jev reads of an arriving email: who sent it, its subject, and its plain text.
type VerifyMail struct {
	From    string
	Subject string
	Body    string
}

// VerifyVerdict is Jev's answer about one email. Confidence is the probability that the email
// exists to deliver a verification code or link; Verification is whether Jev chose that answer.
type VerifyVerdict struct {
	Verification bool
	Confidence   float64
	Usage        jev.Usage
}

// ClassifyVerificationMail asks whether an arriving email exists to deliver a one-time code, or a
// link the recipient must open, to finish an account action: verify an email address, create or
// confirm an account, sign in, or reset or recover a password.
// The question describes what the email is for; it quotes no site and no wording.
func (g *Gateway) ClassifyVerificationMail(ctx context.Context, mail VerifyMail) (VerifyVerdict, error) {
	if mail.Subject == "" && mail.Body == "" {
		return VerifyVerdict{}, fmt.Errorf("%w: an email with a subject or a body is required", ErrInvalid)
	}
	state := "An email that just arrived in a person's inbox.\nSender: " + clip(mail.From, maxMailField) +
		"\nSubject: " + clip(mail.Subject, maxMailField) + "\nText:\n" + clip(mail.Body, maxVerifyBody)
	res, err := g.decider.Decide(openai.WithCall(ctx, "mail-verify"), jev.Request{
		State: state,
		Questions: map[string]jev.Question{verifyQuestion: {
			Type: jev.TypeChoice,
			Instructions: "Does this email exist to deliver a one-time code, or a link the recipient must open, to finish " +
				"an account action: verify an email address, create or confirm an account, sign in, or reset or recover " +
				"a password? Judge by what the email is for, not by who sent it.",
			Criteria: map[string]string{
				verifyKey: "The email's purpose is to give the recipient a one-time code, or a link to open, that verifies " +
					"an email address, creates or confirms an account, completes a sign-in, or resets or recovers a password.",
				noControlKey: "The email's purpose is anything else: information, a receipt or order, a message from a " +
					"person, marketing, a newsletter, or an alert.",
			},
		}},
	})
	if err != nil {
		return VerifyVerdict{}, err
	}
	answer, ok := res.Answers[verifyQuestion]
	if !ok {
		return VerifyVerdict{}, errors.New("jev returned no verification answer")
	}
	verdict := VerifyVerdict{Verification: answer.Choice == verifyKey, Usage: res.Usage}
	if p, ok := answer.Probabilities[verifyKey]; ok {
		verdict.Confidence = p
	} else if verdict.Verification {
		verdict.Confidence = answer.Confidence
	}
	return verdict, nil
}
