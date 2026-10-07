package maillabel

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/mailbox"
	"github.com/sid0709/OpenSeat/backend-core/jev"
)

type scripted struct {
	answer    func(jev.Question) jev.Answer
	inFlight  atomic.Int32
	maxFlight atomic.Int32
	calls     atomic.Int32
}

func (s *scripted) Decide(_ context.Context, req jev.Request) (jev.Response, error) {
	current := s.inFlight.Add(1)
	for {
		old := s.maxFlight.Load()
		if current <= old || s.maxFlight.CompareAndSwap(old, current) {
			break
		}
	}
	time.Sleep(40 * time.Millisecond)
	s.inFlight.Add(-1)
	s.calls.Add(1)
	answers := make(map[string]jev.Answer, len(req.Questions))
	for key, question := range req.Questions {
		answers[key] = s.answer(question)
	}
	return jev.Response{Answers: answers}, nil
}

type recordingApplier struct {
	mu        sync.Mutex
	labels    map[string]string
	inFlight  atomic.Int32
	maxFlight atomic.Int32
	fail      map[string]error
}

func (a *recordingApplier) AddLabel(_ context.Context, messageID, labelID string) error {
	current := a.inFlight.Add(1)
	for {
		old := a.maxFlight.Load()
		if current <= old || a.maxFlight.CompareAndSwap(old, current) {
			break
		}
	}
	time.Sleep(20 * time.Millisecond)
	a.inFlight.Add(-1)
	if err := a.fail[messageID]; err != nil {
		return err
	}
	a.mu.Lock()
	if a.labels == nil {
		a.labels = map[string]string{}
	}
	a.labels[messageID] = labelID
	a.mu.Unlock()
	return nil
}

func guides() []Guide {
	return []Guide{
		{LabelID: "Label_1", Description: "A company confirming an application"},
		{LabelID: "Label_2", Description: "A request to schedule an interview"},
	}
}

func TestRunLabelsInParallelAndSkipsNone(t *testing.T) {
	decider := &scripted{answer: func(question jev.Question) jev.Answer {
		if contains(question.Instructions, "schedule") {
			return jev.Answer{Choice: "Label_2"}
		}
		if contains(question.Instructions, "applied") {
			return jev.Answer{Choice: "Label_1"}
		}
		return jev.Answer{Choice: noneKey}
	}}
	apply := &recordingApplier{}
	mail := make([]Mail, 0, 20)
	for i := 0; i < 20; i++ {
		subject := "hello"
		if i%2 == 0 {
			subject = "please schedule a call"
		} else if i%3 == 0 {
			subject = "you applied"
		}
		mail = append(mail, Mail{ID: id(i), Subject: subject, From: "jobs@example.com", Snippet: subject})
	}
	summary, err := Run(context.Background(), decider, apply, guides(), mail)
	if err != nil {
		t.Fatal(err)
	}
	if decider.maxFlight.Load() < 2 {
		t.Fatalf("jev batches in flight = %d, want at least 2", decider.maxFlight.Load())
	}
	if decider.calls.Load() != 2 {
		t.Fatalf("jev calls = %d, want 2", decider.calls.Load())
	}
	if apply.maxFlight.Load() < 2 {
		t.Fatalf("label writes in flight = %d, want at least 2", apply.maxFlight.Load())
	}
	if summary.Labeled == 0 || summary.Unmatched == 0 {
		t.Fatalf("summary = %+v", summary)
	}
	if summary.Labeled+summary.Unmatched+summary.Failed != len(mail) {
		t.Fatalf("counts = %+v", summary)
	}
	apply.mu.Lock()
	defer apply.mu.Unlock()
	for messageID, labelID := range apply.labels {
		if labelID != "Label_1" && labelID != "Label_2" {
			t.Fatalf("applied %s to %s", labelID, messageID)
		}
	}
}

func TestRunUsesProbabilityWhenChoiceIsMissing(t *testing.T) {
	decider := &scripted{answer: func(jev.Question) jev.Answer {
		return jev.Answer{Choice: "missing", Probabilities: map[string]float64{"Label_1": 0.7, noneKey: 0.2}}
	}}
	apply := &recordingApplier{}
	summary, err := Run(context.Background(), decider, apply, guides(), []Mail{{ID: "m1", Subject: "thanks"}})
	if err != nil {
		t.Fatal(err)
	}
	if summary.Labeled != 1 || apply.labels["m1"] != "Label_1" {
		t.Fatalf("summary = %+v labels = %v", summary, apply.labels)
	}
}

func TestRunKeepsGoingWhenOneWriteFails(t *testing.T) {
	decider := &scripted{answer: func(jev.Question) jev.Answer {
		return jev.Answer{Choice: "Label_1"}
	}}
	apply := &recordingApplier{fail: map[string]error{"m1": errors.New("gmail busy")}}
	summary, err := Run(context.Background(), decider, apply, guides(), []Mail{
		{ID: "m1", Subject: "a"},
		{ID: "m2", Subject: "b"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if summary.Failed != 1 || summary.Labeled != 1 || apply.labels["m2"] != "Label_1" {
		t.Fatalf("summary = %+v labels = %v", summary, apply.labels)
	}
}

func TestRunStopsWhenGmailRefusesTheScope(t *testing.T) {
	decider := &scripted{answer: func(jev.Question) jev.Answer {
		return jev.Answer{Choice: "Label_1"}
	}}
	apply := &recordingApplier{fail: map[string]error{
		"m1": mailbox.ErrGmailScope,
		"m2": mailbox.ErrGmailScope,
	}}
	_, err := Run(context.Background(), decider, apply, guides(), []Mail{
		{ID: "m1", Subject: "a"},
		{ID: "m2", Subject: "b"},
	})
	if !errors.Is(err, mailbox.ErrGmailScope) {
		t.Fatalf("err = %v", err)
	}
}

func TestRunRejectsAnEmptyPage(t *testing.T) {
	_, err := Run(context.Background(), &scripted{}, &recordingApplier{}, guides(), nil)
	if !errors.Is(err, ErrNoMail) {
		t.Fatalf("err = %v", err)
	}
	_, err = Run(context.Background(), &scripted{}, &recordingApplier{}, nil, []Mail{{ID: "m1"}})
	if !errors.Is(err, ErrNoGuides) {
		t.Fatalf("err = %v", err)
	}
}

func id(n int) string {
	return "m" + string(rune('a'+n))
}

func contains(text, part string) bool {
	return len(text) >= len(part) && (text == part || len(part) == 0 || indexOf(text, part) >= 0)
}

func indexOf(text, part string) int {
	for i := 0; i+len(part) <= len(text); i++ {
		if text[i:i+len(part)] == part {
			return i
		}
	}
	return -1
}
