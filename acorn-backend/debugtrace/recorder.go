// Package debugtrace is Acorn's local debug capture. With a directory set, every
// Analyze opens a run folder holding the page, the trees the planner read, each model
// prompt and answer, the plan, and the extension's step trace for that fill.
//
// It writes applicant data and page HTML to disk, so it is for local runs only.
package debugtrace

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	// runTimeLayout prefixes run folders so they sort by start time.
	runTimeLayout = "20060102-150405"
	// maxSlug bounds the page-derived part of a run folder name.
	maxSlug = 48
	// stepLogName is the extension's NDJSON trace inside a run folder.
	stepLogName = "steps.ndjson"
	dirMode     = 0o755
	fileMode    = 0o644
)

var unsafeSlug = regexp.MustCompile(`[^a-z0-9]+`)

// Recorder owns the capture directory. A nil Recorder records nothing.
type Recorder struct {
	dir string

	mu     sync.Mutex
	latest map[string]*Run
}

// New returns a Recorder writing under dir, or nil when dir is empty (capture off).
func New(dir string) *Recorder {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return nil
	}
	return &Recorder{dir: dir, latest: map[string]*Run{}}
}

// Dir is where runs are written.
func (r *Recorder) Dir() string {
	if r == nil {
		return ""
	}
	return r.dir
}

// Run is one fill: the Analyze that started it and every call after it.
type Run struct {
	dir string

	mu   sync.Mutex
	next int
}

// StartRun opens a new run folder for a user's Analyze and makes it their latest.
func (r *Recorder) StartRun(userID, label string) *Run {
	if r == nil {
		return nil
	}
	name := time.Now().Format(runTimeLayout)
	if slug := slugify(label); slug != "" {
		name += "-" + slug
	}
	dir := filepath.Join(r.dir, uniqueName(r.dir, name))
	if err := os.MkdirAll(dir, dirMode); err != nil {
		slog.Warn("debug capture: create run", "dir", dir, "error", err)
		return nil
	}
	run := &Run{dir: dir}
	r.mu.Lock()
	r.latest[userID] = run
	r.mu.Unlock()
	slog.Info("debug capture: run started", "dir", dir)
	return run
}

// Latest is the user's current run, or a new one when they have not analyzed yet.
func (r *Recorder) Latest(userID string) *Run {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	run := r.latest[userID]
	r.mu.Unlock()
	if run != nil {
		return run
	}
	return r.StartRun(userID, "no-analyze")
}

type runKey struct{}

// WithRun attaches a run to a request so model calls land in it.
func WithRun(ctx context.Context, run *Run) context.Context {
	if run == nil {
		return ctx
	}
	return context.WithValue(ctx, runKey{}, run)
}

// RunFrom is the run attached to ctx, if any.
func RunFrom(ctx context.Context) *Run {
	run, _ := ctx.Value(runKey{}).(*Run)
	return run
}

// Dir is the run's folder.
func (run *Run) Dir() string {
	if run == nil {
		return ""
	}
	return run.dir
}

// WriteFile saves one artifact as NN-name, numbered in capture order.
// The returned name is empty when the run is nil or the write fails.
func (run *Run) WriteFile(name string, data []byte) string {
	if run == nil {
		return ""
	}
	run.mu.Lock()
	run.next++
	file := fmt.Sprintf("%02d-%s", run.next, name)
	run.mu.Unlock()
	if err := os.WriteFile(filepath.Join(run.dir, file), data, fileMode); err != nil {
		slog.Warn("debug capture: write", "file", file, "error", err)
		return ""
	}
	return file
}

// WriteJSON saves v indented.
func (run *Run) WriteJSON(name string, v any) {
	if run == nil {
		return
	}
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		data = []byte(fmt.Sprintf("marshal %s: %v", name, err))
	}
	run.WriteFile(name, data)
}

// AppendSteps adds the extension's trace lines to steps.ndjson, one JSON value per line.
func (run *Run) AppendSteps(lines []json.RawMessage) {
	if run == nil || len(lines) == 0 {
		return
	}
	var b strings.Builder
	for _, line := range lines {
		b.WriteString(strings.TrimSpace(string(line)))
		b.WriteByte('\n')
	}
	run.mu.Lock()
	defer run.mu.Unlock()
	f, err := os.OpenFile(filepath.Join(run.dir, stepLogName), os.O_CREATE|os.O_APPEND|os.O_WRONLY, fileMode)
	if err != nil {
		slog.Warn("debug capture: open step log", "error", err)
		return
	}
	defer f.Close()
	if _, err := f.WriteString(b.String()); err != nil {
		slog.Warn("debug capture: append step log", "error", err)
	}
}

func slugify(label string) string {
	slug := strings.Trim(unsafeSlug.ReplaceAllString(strings.ToLower(label), "-"), "-")
	if len(slug) > maxSlug {
		slug = strings.TrimRight(slug[:maxSlug], "-")
	}
	return slug
}

// uniqueName adds a counter when two runs start in the same second.
func uniqueName(dir, name string) string {
	candidate := name
	for i := 2; ; i++ {
		if _, err := os.Stat(filepath.Join(dir, candidate)); os.IsNotExist(err) {
			return candidate
		}
		candidate = fmt.Sprintf("%s-%d", name, i)
	}
}
