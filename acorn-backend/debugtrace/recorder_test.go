package debugtrace

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/acorn"
)

func TestNewEmptyDirIsOff(t *testing.T) {
	if New("  ") != nil {
		t.Fatal("empty dir should disable capture")
	}
	var r *Recorder
	r.StartRun("u", "x").WriteFile("a.txt", []byte("no-op")) // nil-safe
	if RunFrom(WithRun(context.Background(), r.Latest("u"))) != nil {
		t.Fatal("nil recorder should attach no run")
	}
}

func TestRunCapturesFilesCallsAndSteps(t *testing.T) {
	r := New(t.TempDir())
	run := r.StartRun("user-1", "jobs.example.com Apply: Engineer")
	if !strings.Contains(filepath.Base(run.Dir()), "jobs-example-com-apply-engineer") {
		t.Fatalf("run folder %q should carry the page slug", run.Dir())
	}
	if r.Latest("user-1") != run {
		t.Fatal("StartRun should become the user's latest run")
	}

	run.WriteFile("page.html", []byte("<html></html>"))
	ctx := WithRun(context.Background(), run)
	Tracer()(ctx, acorn.Call{
		Purpose: acorn.PurposeAnswer, Model: "m", System: "sys", User: "usr",
		Schema: json.RawMessage(`{"type":"object"}`), Output: []byte(`{"answers":"+1"}`),
		Err: errors.New("boom"), Duration: 1500 * time.Millisecond,
	})
	Tracer()(context.Background(), acorn.Call{Purpose: acorn.PurposeAnalyze}) // no run: ignored
	run.AppendSteps([]json.RawMessage{json.RawMessage(`{"event":"a"}`), json.RawMessage(`{"event":"b"}`)})

	entries, err := os.ReadDir(run.Dir())
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	want := []string{"01-page.html", "02-ai-qa.md", "steps.ndjson"}
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Fatalf("files = %v, want %v", names, want)
	}

	call, _ := os.ReadFile(filepath.Join(run.Dir(), "02-ai-qa.md"))
	for _, part := range []string{"- error: boom", `"answers": "+1"`, "sys", "usr"} {
		if !strings.Contains(string(call), part) {
			t.Fatalf("call file missing %q:\n%s", part, call)
		}
	}
	steps, _ := os.ReadFile(filepath.Join(run.Dir(), "steps.ndjson"))
	if string(steps) != "{\"event\":\"a\"}\n{\"event\":\"b\"}\n" {
		t.Fatalf("steps = %q", steps)
	}
}

func TestLatestWithoutAnalyzeStartsRun(t *testing.T) {
	r := New(t.TempDir())
	run := r.Latest("user-2")
	if run == nil || !strings.HasSuffix(run.Dir(), "no-analyze") {
		t.Fatalf("Latest without Analyze should open a no-analyze run, got %v", run)
	}
}
