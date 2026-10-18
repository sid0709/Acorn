package agent

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/sid0709/acorn/acorn-agent/applicant"
)

func traceFileNamed(trace *Trace, name string) (TraceFile, bool) {
	if trace == nil {
		return TraceFile{}, false
	}
	for _, file := range trace.Files {
		if file.Name == name {
			return file, true
		}
	}
	return TraceFile{}, false
}

func TestARunThatAsksForItsTraceGetsItBackWithNothingWrittenToDisk(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("looking", nil, click(10, 20, nil))}}
	cfg := DefaultConfig()
	a := newTestAgent(t, model, &fixedDecider{}, cfg)
	started, err := a.Start(context.Background(), "key", applicant.Auth{}, Start{URL: "https://jobs.example/apply", Title: "Apply", Trace: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := traceFileNamed(started.Trace, "system.txt"); !ok {
		t.Fatalf("the start carries no system.txt: %+v", started.Trace)
	}
	if session, ok := traceFileNamed(started.Trace, "session.json"); !ok || !strings.Contains(session.Text, "jobs.example") {
		t.Fatalf("session.json: %+v", session)
	}
	step := stepOK(t, a, started.SessionID, observation(shot(t, 40)))
	if step.Trace == nil || step.Trace.Timeline == "" {
		t.Fatalf("the step carries no trace: %+v", step.Trace)
	}
	if step.Trace.Seq != 1 {
		t.Fatalf("seq %d, want 1", step.Trace.Seq)
	}
	entry, ok := traceFileNamed(step.Trace, "001.json")
	if !ok || !strings.Contains(entry.Text, `"url": "https://jobs.example/apply"`) {
		t.Fatalf("001.json: %+v", entry)
	}
	calls, ok := traceFileNamed(step.Trace, "001.model.json")
	if !ok || !strings.Contains(calls.Text, "latencyMs") {
		t.Fatalf("001.model.json: %+v", calls)
	}
	if marked, ok := traceFileNamed(step.Trace, "001.marked.jpg"); !ok || marked.Data == "" {
		t.Fatalf("the marked screenshot is missing: %+v", step.Trace.Files)
	}
	if _, ok := traceFileNamed(step.Trace, "001.jpg"); ok {
		t.Fatal("the plain screenshot is sent back, but the extension took it itself")
	}
	if entries, _ := os.ReadDir(a.cfg.TraceDir); len(entries) != 0 {
		t.Fatalf("the server wrote %d entries to disk", len(entries))
	}
}

func TestARunThatDoesNotAskGetsNoTrace(t *testing.T) {
	model := &scriptedModel{replies: []string{plan("looking", nil, click(10, 20, nil))}}
	a := newTestAgent(t, model, &fixedDecider{}, DefaultConfig())
	id := start(t, a)
	if step := stepOK(t, a, id, observation(shot(t, 40))); step.Trace != nil {
		t.Fatalf("an unasked trace came back: %+v", step.Trace)
	}
}

func TestATraceKeepsASecretOutOfWhatItReturns(t *testing.T) {
	entry := stepTrace{Seq: 1, Step: 1, Actions: []Action{{ID: "a1", Kind: KindType, Text: "hunter2-password", Secret: true}}}
	files, err := entryFiles(entry, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range bundle(files, "").Files {
		if strings.Contains(file.Text, "hunter2-password") {
			t.Fatalf("%s holds the secret: %s", file.Name, file.Text)
		}
	}
}
