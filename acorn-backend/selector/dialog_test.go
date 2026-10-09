package selector

import (
	"context"
	"errors"
	"testing"

	"github.com/sid0709/OpenSeat/backend-core/jev"
)

// An alert has only OK: it is accepted without a decision.
func TestDecideDialogAcceptsAnAlertWithoutAsking(t *testing.T) {
	decider := &scriptedDecider{}
	answer, err := New(decider).DecideDialog(context.Background(), DialogQuery{Kind: DialogAlert, Message: "Uploaded"})
	if err != nil || !answer.Accept || decider.last.State != "" {
		t.Fatalf("answer = %+v err = %v asked = %q, want accepted without asking", answer, err, decider.last.State)
	}
}

func TestDecideDialogAsksJevOnAConfirm(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{dialogQuestion: {Noul: yes(0.1)}}}
	answer, err := New(decider).DecideDialog(context.Background(), DialogQuery{
		Kind: DialogConfirm, Message: "Withdraw your application?", LastControl: "Withdraw",
	})
	if err != nil || answer.Accept {
		t.Fatalf("answer = %+v err = %v, want dismissed", answer, err)
	}
}

func TestDecideDialogRejectsAnUnknownKind(t *testing.T) {
	_, err := New(&scriptedDecider{}).DecideDialog(context.Background(), DialogQuery{Kind: "popup"})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
}
