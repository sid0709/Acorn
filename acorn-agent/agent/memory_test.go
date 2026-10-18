package agent

import (
	"context"
	"strings"
	"testing"

	"github.com/sid0709/acorn/acorn-agent/applicant"
)

func TestARunStartedFromMemoryHasWhatTheStoppedRunKnew(t *testing.T) {
	a := newTestAgent(t, &scriptedModel{}, &fixedDecider{}, DefaultConfig())
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{Memory: &Memory{
		Memo: "name and email are in; on the work history step", Job: "Backend engineer at Example",
		JD: "We need a Go developer.", Resume: "Go", FormReady: true,
	}})
	if err != nil {
		t.Fatal(err)
	}
	s, _ := a.sessions.get(started.SessionID)
	if s.memo == "" || s.job == "" || s.jd != "We need a Go developer." || s.resume != "Go" || !s.formReady {
		t.Fatalf("the run does not hold what it was given: memo=%q job=%q jd=%q resume=%q ready=%v", s.memo, s.job, s.jd, s.resume, s.formReady)
	}
	if s.jdChecks != 1 {
		t.Fatalf("a job description that is known must not be looked for again: jdChecks=%d", s.jdChecks)
	}
	if len(s.notes) != 1 || !strings.Contains(s.notes[0], "no longer held") {
		t.Fatalf("the model is not told the history is gone: %v", s.notes)
	}
	got, err := a.Memory(started.SessionID)
	if err != nil || got.JD != "We need a Go developer." || got.Resume != "Go" || !got.FormReady {
		t.Fatalf("memory = %+v err = %v", got, err)
	}
}

func TestMemoryIsBoundedAndAFreshRunHasNone(t *testing.T) {
	a := newTestAgent(t, &scriptedModel{}, &fixedDecider{}, DefaultConfig())
	huge := strings.Repeat("x", 200_000)
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{Memory: &Memory{Memo: huge, Job: huge, JD: huge}})
	if err != nil {
		t.Fatal(err)
	}
	got, _ := a.Memory(started.SessionID)
	if len(got.Memo) > maxMemoChars+8 || len(got.Job) > maxJobChars+8 || len(got.JD) > maxJDChars+8 {
		t.Fatalf("memory from outside is not bounded: %d %d %d", len(got.Memo), len(got.Job), len(got.JD))
	}
	fresh := start(t, a)
	empty, err := a.Memory(fresh)
	if err != nil || empty != (Memory{}) {
		t.Fatalf("a fresh run holds %+v err=%v", empty, err)
	}
	if len(mustSession(t, a, fresh).notes) != 0 {
		t.Fatal("a fresh run is told it was continued")
	}
	if _, err := a.Memory("nope"); err == nil {
		t.Fatal("an unknown session has a memory")
	}
}

func mustSession(t *testing.T, a *Agent, id string) *session {
	t.Helper()
	s, ok := a.sessions.get(id)
	if !ok {
		t.Fatal("no session")
	}
	return s
}
