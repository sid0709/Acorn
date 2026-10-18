package debugtrace

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/sid0709/acorn/acorn-backend/acorn"
)

func TestNewEmptyDirIsOff(t *testing.T) {
	if New("  ", nil) != nil {
		t.Fatal("empty dir should disable capture")
	}
	var r *Recorder
	r.StartRun("u", "x").WriteFile("a.txt", []byte("no-op")) // nil-safe
	if RunFrom(WithRun(context.Background(), r.Latest("u"))) != nil {
		t.Fatal("nil recorder should attach no run")
	}
}

func TestRunCapturesFilesCallsAndSteps(t *testing.T) {
	r := New(t.TempDir(), nil)
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
	Tracer()(context.Background(), acorn.Call{Purpose: acorn.PurposeAnswer}) // no run: ignored
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
	r := New(t.TempDir(), nil)
	run := r.Latest("user-2")
	if run == nil || !strings.HasSuffix(run.Dir(), "no-analyze") {
		t.Fatalf("Latest without Analyze should open a no-analyze run, got %v", run)
	}
}

// memoryStore is a Store held in memory.
type memoryStore struct {
	mu    sync.Mutex
	files []File
}

func (m *memoryStore) Save(_ context.Context, file File) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.files = append(m.files, file)
	return nil
}

func (m *memoryStore) Session(_ context.Context, key string, since time.Time) ([]File, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []File
	for _, file := range m.files {
		if file.Key == key && !file.At.Before(since) {
			out = append(out, file)
		}
	}
	return out, nil
}

func (m *memoryStore) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.files)
}

// A stored session carries every run of the tab, each in its own folder, with a
// run's step-trace batches joined into one steps.ndjson; other tabs stay apart.
func TestSessionCarriesEveryRunOfTheTab(t *testing.T) {
	store := &memoryStore{}
	r := New("", store)
	first := r.StartRun("user/tab-a", "jobs.example.com Apply")
	first.WriteFile("page.json", []byte(`{"url":"a"}`))
	first.AppendSteps([]json.RawMessage{json.RawMessage(`{"event":"one"}`)})
	first.AppendSteps([]json.RawMessage{json.RawMessage(`{"event":"two"}`)})
	time.Sleep(2 * time.Millisecond)
	second := r.StartRun("user/tab-a", "jobs.example.com Review")
	second.WriteFile("plan.json", []byte(`{}`))
	r.StartRun("user/tab-b", "other").WriteFile("page.json", []byte(`{}`))

	deadline := time.Now().Add(2 * time.Second)
	for store.count() < 5 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	files, err := r.Session(context.Background(), "user/tab-a", 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]string{}
	runs := map[string]bool{}
	for _, file := range files {
		byName[filepath.Base(file.Name)] = string(file.Data)
		runs[filepath.Dir(file.Name)] = true
	}
	if len(runs) != 2 {
		t.Fatalf("runs = %v, want the tab's two runs and not the other tab's", runs)
	}
	if got := byName["steps.ndjson"]; !strings.Contains(got, "one") || !strings.Contains(got, "two") {
		t.Fatalf("steps.ndjson = %q, want both batches", got)
	}
	if _, ok := byName["01-plan.json"]; !ok {
		t.Fatalf("files = %v, want the second run's plan", byName)
	}
}
