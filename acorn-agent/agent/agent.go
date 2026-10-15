package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/acorn-agent/applicant"
	"github.com/sid0709/OpenSeat/acorn-agent/llm"
)

// sizeTolerance is how many pixels a screenshot may differ from the viewport it is sent with
// (a rounding of the page's size).
const sizeTolerance = 1

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// Errors a caller can tell apart.
var (
	// ErrNoSession is a session id that is unknown or has expired.
	ErrNoSession = errors.New("no such session: it ended or expired")
	// ErrSessionOver is a step sent after the run already ended.
	ErrSessionOver = errors.New("this run has already ended")
	// ErrBadObservation is a step the agent cannot read.
	ErrBadObservation = errors.New("the observation is not usable")
)

// Config bounds one run. Every field has a default in DefaultConfig.
type Config struct {
	// MaxSteps is the most steps one run may take.
	MaxSteps int
	// MaxActions is the most actions one step may send.
	MaxActions int
	// KeepTurns is how many recent steps the model sees in full; older ones are folded.
	KeepTurns int
	// KeepImages is how many of the newest steps keep their screenshot.
	KeepImages int
	// HistoryTokens is the estimated size the model's history may reach before the oldest
	// steps are folded early.
	HistoryTokens int
	// MaxStale is how many steps in a row the screen may stay the same before the run is
	// declared stuck without asking the model again.
	MaxStale int
	// SessionTTL is how long an untouched session is kept.
	SessionTTL time.Duration
	// TraceDir, when set, records every step to disk.
	TraceDir string
}

// DefaultConfig is the bounds a run has when nothing else is set.
func DefaultConfig() Config {
	return Config{
		MaxSteps:      150,
		MaxActions:    6,
		KeepTurns:     8,
		KeepImages:    3,
		HistoryTokens: 30_000,
		MaxStale:      6,
		SessionTTL:    time.Hour,
	}
}

// Agent runs applications. It holds no state beyond its live sessions, so any number of
// runs go at once, each on its own session and its own model calls.
type Agent struct {
	cfg        Config
	applicants *applicant.Store
	newModel   func(key string) llm.Model
	newDecider func(key string) Decider
	sessions   *store
	trace      *tracer
	now        func() time.Time
}

// New is an agent over the applicant's data. newModel builds the model that drives a run
// and newDecider the model that chooses among existing things; both are given the run's key.
func New(cfg Config, applicants *applicant.Store, newModel func(key string) llm.Model, newDecider func(key string) Decider) *Agent {
	now := time.Now
	return &Agent{
		cfg:        cfg,
		applicants: applicants,
		newModel:   newModel,
		newDecider: newDecider,
		sessions:   newStore(cfg.SessionTTL, now),
		trace:      &tracer{dir: cfg.TraceDir},
		now:        now,
	}
}

// Sessions is how many runs are live.
func (a *Agent) Sessions() int { return a.sessions.len() }

// Start opens a run on the page the person is looking at. key is their OpenRouter key.
func (a *Agent) Start(ctx context.Context, key string, start Start) (Started, error) {
	snap, err := a.applicants.Snapshot(ctx)
	if err != nil {
		return Started{}, err
	}
	// The server's own key comes first (the caller passes it); the profile's is the last resort.
	if strings.TrimSpace(key) == "" {
		key = strings.TrimSpace(snap.APIKey)
	}
	if key == "" {
		return Started{}, llm.ErrNoKey
	}
	now := a.now()
	system, err := systemPrompt(start, snap, a.cfg.MaxActions, now)
	if err != nil {
		return Started{}, err
	}
	id, err := newSessionID()
	if err != nil {
		return Started{}, err
	}
	a.sessions.add(&session{
		id: id, key: key, start: start, snap: snap, system: system,
		created: now, touched: now,
	})
	stacks, documents := catalog(snap.Resumes)
	if err := a.trace.recordSession(id, system, sessionTrace{
		Started: now, Start: start, Model: a.modelName(key), Config: a.cfg, Resumes: stacks, Documents: documents,
	}); err != nil {
		slog.Warn("trace not written", "session", id, "error", err)
	}
	slog.Info("run started", "session", id, "url", start.URL, "stopBeforeSubmit", start.StopBeforeSubmit,
		"stacks", len(stacks), "trace", a.trace.enabled())
	infos := make([]ResumeInfo, len(snap.Resumes))
	for i, resume := range snap.Resumes {
		infos[i] = ResumeInfo{ID: resume.ID, FileName: resume.FileName, Size: resume.Size}
	}
	return Started{SessionID: id, Resumes: infos}, nil
}

// End drops a session once the run is over.
func (a *Agent) End(id string) { a.sessions.remove(id) }

// ResumeFile is one résumé file of a live session, for the extension to put in a file input.
func (a *Agent) ResumeFile(ctx context.Context, sessionID, resumeID string) (applicant.Resume, []byte, error) {
	if _, ok := a.sessions.get(sessionID); !ok {
		return applicant.Resume{}, nil, ErrNoSession
	}
	return a.applicants.Resume(ctx, resumeID)
}

// Step reads one observation and answers with what to do next.
func (a *Agent) Step(ctx context.Context, id string, obs Observation) (Step, error) {
	s, ok := a.sessions.get(id)
	if !ok {
		return Step{}, ErrNoSession
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.touched = a.now()
	if s.finished {
		return Step{}, ErrSessionOver
	}
	s.seq++
	if obs.Viewport.Width <= 0 || obs.Viewport.Height <= 0 {
		return Step{}, fmt.Errorf("%w: the viewport has no size", ErrBadObservation)
	}
	sig, width, height, err := signature(obs.Screenshot)
	if err != nil {
		err = fmt.Errorf("%w: %v", ErrBadObservation, err)
		a.record(s, stepTrace{Seq: s.seq, Step: s.step + 1, At: a.now(), URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport, Error: err.Error(), Usage: s.usage}, "", nil)
		return Step{}, err
	}
	// The model measures coordinates in the image it is shown. If the image is not the size
	// the viewport says, every point it gives would land somewhere else on the page.
	if abs(width-obs.Viewport.Width) > sizeTolerance || abs(height-obs.Viewport.Height) > sizeTolerance {
		err = fmt.Errorf("%w: the screenshot is %dx%d pixels but the viewport says %dx%d",
			ErrBadObservation, width, height, obs.Viewport.Width, obs.Viewport.Height)
		a.record(s, stepTrace{Seq: s.seq, Step: s.step + 1, At: a.now(), URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport, Error: err.Error(), Usage: s.usage}, obs.Screenshot, nil)
		return Step{}, err
	}
	if s.step >= a.cfg.MaxSteps {
		return a.endWithTrace(s, obs, 0, StatusStuck, fmt.Sprintf("The run reached its limit of %d steps.", a.cfg.MaxSteps)), nil
	}
	// A page that did not move after actions is evidence the model needs, and a run that
	// never moves is not worth more model calls.
	stale := 0
	if s.step > 0 && unchanged(sig, s.lastSig) {
		stale = s.stale + 1
	}
	if stale >= a.cfg.MaxStale {
		return a.endWithTrace(s, obs, stale, StatusStuck, fmt.Sprintf("The page did not change for %d steps in a row.", stale)), nil
	}

	number := s.step + 1
	text := observationText(number, a.cfg.MaxSteps, obs, s.memo, s.job, stale)
	messages := append([]llm.Message{{Role: llm.RoleSystem, Text: s.system}},
		s.history(a.cfg.KeepTurns, a.cfg.KeepImages, a.cfg.HistoryTokens)...)
	messages = append(messages, llm.Message{Role: llm.RoleUser, Text: text, Images: []string{obs.Screenshot}})

	entry := stepTrace{
		Seq: s.seq, Step: number, At: a.now(), URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport,
		Focus: obs.Focus, Notes: obs.Notes, Results: obs.Results, Stale: stale,
	}
	answer, content, usage, calls, err := a.ask(ctx, s, messages)
	s.usage.Calls++
	s.usage.InputTokens += usage.InputTokens
	s.usage.OutputTokens += usage.OutputTokens
	s.usage.Cost += usage.Cost
	entry.Usage = s.usage
	if err != nil {
		entry.Error, entry.Memo, entry.Job = err.Error(), s.memo, s.job
		a.record(s, entry, obs.Screenshot, calls)
		return Step{}, err
	}
	// Only a step the model answered counts: a retry of a failed call sends the same screen.
	s.step, s.stale, s.lastSig = number, stale, sig
	s.memo = clipText(strings.TrimSpace(answer.Memo), maxMemoChars)
	if job := strings.TrimSpace(answer.Job); job != "" {
		s.job = clipText(job, maxJobChars)
	}

	actions, dropped := checkActions(number, answer.Actions, obs.Viewport, a.cfg.MaxActions)
	actions = fillSecrets(actions, s.snap.Secrets)
	actions, dropped = a.resolveUploads(ctx, s, actions, dropped)
	status := answer.Status
	if status != StatusWorking {
		actions = nil
	} else if len(actions) == 0 {
		// A working run with nothing valid to do waits and looks again; the repeat check
		// ends it if the page never changes.
		dropped = append(dropped, "no usable action; waiting before the next look")
		actions = []Action{{ID: fmt.Sprintf("s%da1", number), Kind: KindWait, Ms: 1000}}
	}

	s.turns = append(s.turns, turn{
		number:  number,
		text:    text,
		image:   obs.Screenshot,
		answer:  content,
		summary: summaryLine(number, answer, actions),
	})
	step := Step{
		Status: status, Message: strings.TrimSpace(answer.Message), Actions: actions,
		Number: number, Usage: s.usage, Dropped: dropped,
	}
	entry.Observation, entry.Memo, entry.Job = answer.Observation, s.memo, s.job
	entry.Status, entry.Message, entry.Actions, entry.Dropped = status, step.Message, actions, dropped
	a.record(s, entry, obs.Screenshot, calls)
	if status != StatusWorking {
		s.finished = true
	}
	return step, nil
}

// record writes one entry of the run to the trace and one line to the server's log.
func (a *Agent) record(s *session, entry stepTrace, screenshot string, calls []modelCall) {
	var latency int64
	for _, call := range calls {
		latency += call.LatencyMs
	}
	level := slog.LevelInfo
	if entry.Error != "" {
		level = slog.LevelWarn
	}
	slog.Log(context.Background(), level, "step", "session", s.id, "seq", entry.Seq, "number", entry.Step,
		"status", entry.Status, "actions", len(entry.Actions), "dropped", len(entry.Dropped),
		"stale", entry.Stale, "ms", latency, "calls", entry.Usage.Calls, "cost", entry.Usage.Cost,
		"message", clipText(entry.Message, 140), "error", entry.Error)
	if err := a.trace.record(s.id, entry, screenshot, calls); err != nil {
		slog.Warn("trace not written", "session", s.id, "error", err)
	}
}

// endWithTrace finishes a run the agent itself gave up on, and records why.
func (a *Agent) endWithTrace(s *session, obs Observation, stale int, status, message string) Step {
	s.finished = true
	a.record(s, stepTrace{
		Seq: s.seq, Step: s.step + 1, At: a.now(), URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport,
		Focus: obs.Focus, Notes: obs.Notes, Results: obs.Results, Stale: stale, Memo: s.memo, Job: s.job,
		Status: status, Message: message, Usage: s.usage,
	}, obs.Screenshot, nil)
	return Step{Status: status, Message: message, Number: s.step, Usage: s.usage}
}

// ask sends the request and reads the answer. An answer that is not the requested JSON is
// sent back to the model once with the reason, as a person would be told what was wrong.
// Every call is returned for the trace, whether or not it was accepted.
func (a *Agent) ask(ctx context.Context, s *session, messages []llm.Message) (reply, string, llm.Usage, []modelCall, error) {
	model := a.newModel(s.key)
	var total llm.Usage
	var calls []modelCall
	var lastErr error
	sent := messages
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := model.Complete(ctx, llm.Request{Messages: messages, SchemaName: replySchemaName, Schema: replySchema})
		total.Add(resp.Usage)
		call := modelCall{
			Repair: attempt > 0, Messages: traceMessages(sent), Content: resp.Content, FinishReason: resp.FinishReason,
			Model: resp.Model, Usage: resp.Usage, LatencyMs: resp.Latency.Milliseconds(), HTTPAttempts: resp.Attempts,
		}
		if err != nil {
			call.Error = err.Error()
			return reply{}, "", total, append(calls, call), err
		}
		parsed, err := parseReply(resp.Content)
		if err == nil {
			return parsed, strings.TrimSpace(resp.Content), total, append(calls, call), nil
		}
		call.Error = "refused: " + err.Error()
		calls = append(calls, call)
		lastErr = err
		if resp.FinishReason == "length" {
			err = fmt.Errorf("%w; the answer was cut off, so keep it shorter", err)
		}
		// The repair call is shown with only what it added to the conversation.
		sent = []llm.Message{
			{Role: llm.RoleAssistant, Text: resp.Content},
			{Role: llm.RoleUser, Text: "That answer was not accepted: " + err.Error() + ". Answer again with only the JSON object."},
		}
		messages = append(messages, sent...)
	}
	return reply{}, "", total, calls, lastErr
}

// modelName is the id of the model a run with this key is driven by.
func (a *Agent) modelName(key string) string {
	if model := a.newModel(key); model != nil {
		return model.Name()
	}
	return ""
}

// resolveUploads chooses the file for each upload action. What it had to say about a choice
// that was not clean goes into dropped, the step's list of things the log should show.
func (a *Agent) resolveUploads(ctx context.Context, s *session, actions []Action, dropped []string) ([]Action, []string) {
	var kept []Action
	for _, action := range actions {
		if action.Kind != KindUpload {
			kept = append(kept, action)
			continue
		}
		resume, note, err := a.pickResume(ctx, s, action.Resume)
		if err != nil {
			dropped = append(dropped, fmt.Sprintf("upload %s: %v", action.ID, err))
			continue
		}
		if note != "" {
			dropped = append(dropped, "note: "+note)
		}
		action.Resume, action.FileName = resume.ID, resume.FileName
		kept = append(kept, action)
	}
	return kept, dropped
}

func summaryLine(number int, answer reply, actions []Action) string {
	parts := make([]string, len(actions))
	for i, action := range actions {
		parts[i] = describe(action)
	}
	line := fmt.Sprintf("step %d: %s", number, strings.TrimSpace(answer.Message))
	if len(parts) > 0 {
		line += " [" + strings.Join(parts, "; ") + "]"
	}
	return line
}

// fillSecrets types a secret in place of its placeholder. The model only ever reads and
// writes the placeholder, so the secret is in no prompt, no history and no trace; an action
// that carries one is marked secret.
func fillSecrets(actions []Action, secrets map[string]string) []Action {
	for i, action := range actions {
		if action.Kind != KindType {
			continue
		}
		for token, value := range secrets {
			if strings.Contains(action.Text, token) {
				actions[i].Text = strings.ReplaceAll(actions[i].Text, token, value)
				actions[i].Secret = true
			}
		}
	}
	return actions
}
