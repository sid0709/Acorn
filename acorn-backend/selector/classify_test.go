package selector

import (
	"context"
	"errors"
	"testing"

	"github.com/sid0709/OpenSeat/backend-core/jev"
)

// fakeDecider answers every call with answer and keeps the last request.
type fakeDecider struct {
	answer jev.Answer
	last   jev.Request
}

func (f *fakeDecider) Decide(_ context.Context, req jev.Request) (jev.Response, error) {
	f.last = req
	return jev.Response{Answers: map[string]jev.Answer{pickOneQuestion: f.answer}}, nil
}

func (f *fakeDecider) Model() string { return "fake" }

var uploads = map[int]string{25: "Autofill from resume", 39: "Resume; required"}

func TestPickOneAsksOneQuestionAcrossItems(t *testing.T) {
	decider := &fakeDecider{answer: jev.Answer{Choice: itemKey(39)}}
	id, err := New(decider).PickOne(context.Background(), "which?", uploads)
	if err != nil {
		t.Fatal(err)
	}
	if id != 39 {
		t.Fatalf("picked %d, want 39", id)
	}
	question := decider.last.Questions[pickOneQuestion]
	if len(decider.last.Questions) != 1 || len(question.Criteria) != len(uploads) {
		t.Fatalf("asked %d questions with %d options, want 1 with %d", len(decider.last.Questions), len(question.Criteria), len(uploads))
	}
}

func TestPickOneFallsBackToMostProbableItem(t *testing.T) {
	decider := &fakeDecider{answer: jev.Answer{Choice: "unlisted", Probabilities: map[string]float64{itemKey(25): 0.2, itemKey(39): 0.8}}}
	id, err := New(decider).PickOne(context.Background(), "which?", uploads)
	if err != nil {
		t.Fatal(err)
	}
	if id != 39 {
		t.Fatalf("picked %d, want 39", id)
	}
}

func TestPickOneRejectsNoItems(t *testing.T) {
	if _, err := New(&fakeDecider{}).PickOne(context.Background(), "which?", nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
}
