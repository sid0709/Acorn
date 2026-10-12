// Package debugtrace is Acorn's process capture. Every Analyze opens a run folder
// holding the page, the trees the planner read, each model prompt and answer, every
// decision, the plan, and the extension's step trace for that fill.
//
// Locally the folders are written to a directory. A deployed server keeps them in a
// Store (MongoDB) per tab session for SessionRetention, so a report can carry the
// whole session; nothing else reads them. Passwords never reach it: the extension
// and the planner redact them before anything is captured.
package debugtrace

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	// runTimeLayout prefixes run folders so they sort by start time.
	runTimeLayout = "20060102-150405"
	// storedRunTimeLayout names a run kept only in the Store, to the millisecond, so
	// two runs of one tab never share a name.
	storedRunTimeLayout = "20060102-150405.000"
	// maxSlug bounds the page-derived part of a run folder name.
	maxSlug = 48
	// stepLogName is the extension's NDJSON trace inside a run folder.
	stepLogName = "steps.ndjson"
	dirMode     = 0o755
	fileMode    = 0o644
)

var unsafeSlug = regexp.MustCompile(`[^a-z0-9]+`)

// Recorder owns the capture. A nil Recorder records nothing.
type Recorder struct {
	dir   string
	store Store

	mu     sync.Mutex
	latest map[string]*Run
}

// New returns a Recorder writing under dir and into store (either may be absent),
// or nil when both are (capture off).
func New(dir string, store Store) *Recorder {
	dir = strings.TrimSpace(dir)
	if dir == "" && store == nil {
		return nil
	}
	return &Recorder{dir: dir, store: store, latest: map[string]*Run{}}
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
	// dir is the run's folder on disk; empty when capture is only stored.
	dir string
	// key and name file the run in the Store: whose tab session, and which folder.
	key   string
	name  string
	store Store

	mu   sync.Mutex
	next int
}

// StartRun opens a new run folder for a tab session's Analyze and makes it its latest.
// key is whose session it is (the user and the tab).
func (r *Recorder) StartRun(key, label string) *Run {
	if r == nil {
		return nil
	}
	now := time.Now()
	slug := slugify(label)
	run := &Run{key: key, store: r.store}
	if r.dir != "" {
		name := now.Format(runTimeLayout)
		if slug != "" {
			name += "-" + slug
		}
		run.name = uniqueName(r.dir, name)
		run.dir = filepath.Join(r.dir, run.name)
		if err := os.MkdirAll(run.dir, dirMode); err != nil {
			slog.Warn("debug capture: create run", "dir", run.dir, "error", err)
			if r.store == nil {
				return nil
			}
			run.dir = ""
		}
	} else {
		run.name = now.UTC().Format(storedRunTimeLayout)
		if slug != "" {
			run.name += "-" + slug
		}
	}
	r.mu.Lock()
	r.latest[key] = run
	r.mu.Unlock()
	slog.Debug("debug capture: run started", "run", run.name)
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

// Current is the user's current run, or nil when they have none. It does not open a run.
func (r *Recorder) Current(userID string) *Run {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.latest[userID]
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
// The returned name is empty when the run is nil or nothing could be written.
func (run *Run) WriteFile(name string, data []byte) string {
	if run == nil {
		return ""
	}
	run.mu.Lock()
	run.next++
	seq := run.next
	run.mu.Unlock()
	file := fmt.Sprintf("%02d-%s", seq, name)
	written := run.save(file, seq, data)
	if run.dir != "" {
		if err := os.WriteFile(filepath.Join(run.dir, file), data, fileMode); err != nil {
			slog.Warn("debug capture: write", "file", file, "error", err)
		} else {
			written = true
		}
	}
	if !written {
		return ""
	}
	return file
}

// save hands one file to the Store in the background, so capture never holds the
// request up. False when the run keeps no Store.
func (run *Run) save(name string, seq int, data []byte) bool {
	if run.store == nil {
		return false
	}
	file := File{
		Key: run.key, Run: run.name, Seq: seq, Name: name,
		Data: append([]byte(nil), data...), At: time.Now().UTC(),
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), saveTimeout)
		defer cancel()
		if err := run.store.Save(ctx, file); err != nil {
			slog.Warn("debug capture: store", "file", file.Name, "error", err)
		}
	}()
	return true
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

// Artifact is one file in a run folder.
type Artifact struct {
	Name string
	Data []byte
}

// Snapshot reads the run folder. Files larger than maxFile bytes are left out.
// A nil run or a maxFile below 1 yields no files.
func (run *Run) Snapshot(maxFile int) ([]Artifact, error) {
	if run == nil || maxFile < 1 || run.dir == "" {
		return nil, nil
	}
	run.mu.Lock()
	defer run.mu.Unlock()
	entries, err := os.ReadDir(run.dir)
	if err != nil {
		return nil, fmt.Errorf("read debug run: %w", err)
	}
	files := make([]Artifact, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		info, err := entry.Info()
		if err != nil || info.Size() == 0 || info.Size() > int64(maxFile) {
			continue
		}
		data, err := os.ReadFile(filepath.Join(run.dir, name))
		if err != nil {
			return nil, fmt.Errorf("read debug run %s: %w", name, err)
		}
		if len(data) == 0 || len(data) > maxFile {
			continue
		}
		files = append(files, Artifact{Name: name, Data: data})
	}
	return files, nil
}

// Session is everything captured for one tab session (key), each file named
// run/NN-name so the folders stay apart. From the Store when there is one (every
// run kept within SessionRetention), else the session's current folder on disk.
// Files larger than maxFile bytes are left out.
func (r *Recorder) Session(ctx context.Context, key string, maxFile int) ([]Artifact, error) {
	if r == nil || maxFile < 1 {
		return nil, nil
	}
	if r.store == nil {
		run := r.Current(key)
		files, err := run.Snapshot(maxFile)
		for i := range files {
			files[i].Name = path.Join(run.name, files[i].Name)
		}
		return files, err
	}
	ctx, cancel := context.WithTimeout(ctx, loadTimeout)
	defer cancel()
	stored, err := r.store.Session(ctx, key, time.Now().Add(-SessionRetention))
	if err != nil {
		return nil, err
	}
	return sessionArtifacts(stored, maxFile), nil
}

// sessionArtifacts lays stored files out as folders, in capture order. A run's step
// trace was stored a batch at a time; its batches join into one steps.ndjson.
func sessionArtifacts(stored []File, maxFile int) []Artifact {
	var files []Artifact
	steps := map[string]int{}
	for _, file := range stored {
		if len(file.Data) == 0 || len(file.Data) > maxFile {
			continue
		}
		if file.Name == stepLogName {
			if at, ok := steps[file.Run]; ok {
				if len(files[at].Data)+len(file.Data) <= maxFile {
					files[at].Data = append(files[at].Data, file.Data...)
				}
				continue
			}
			steps[file.Run] = len(files)
		}
		files = append(files, Artifact{Name: path.Join(file.Run, file.Name), Data: file.Data})
	}
	return files
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
	run.save(stepLogName, run.next, []byte(b.String()))
	if run.dir == "" {
		return
	}
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
