package agent

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/sid0709/acorn/acorn-agent/llm"
)

// tracer writes a run to disk when a trace folder is set, so a run can be debugged without
// guessing: the screenshot the model was shown, the same screenshot with every action drawn
// on it, what the model was sent and answered, what the server made of the answer, and how
// it went (time, tokens, cost, errors). A folder of these is also a recorded run to replay
// against a change to the agent. Typed secrets are never written. The folder holds the
// applicant's pages, so it stays on this machine.
//
// One folder per run, in the order the run's steps were asked (a retried step is its own
// numbered entry, so a failure is never overwritten):
//
//	session.json   the run's start: page, model, limits, the résumés on offer
//	system.txt     the standing prompt the model was given
//	NNN.jpg        the screenshot the model saw
//	NNN.marked.jpg the same screenshot with each action's point drawn and numbered
//	NNN.json       what the page reported, what the model decided, what was sent back
//	NNN.model.json every model call of the step: messages, raw answer, tokens, cost, time
//	timeline.txt   one line per entry, to read a run at a glance
type tracer struct {
	dir string
}

// sourceCheck marks an entry the decision model answered, with no call to the driving model.
const sourceCheck = "check"

// sourcePicker marks an entry where the agent uploaded the résumé at a click that opened a
// file picker, with no call to the driving model.
const sourcePicker = "picker"

// sourcePrefill marks an entry where the quick text pass answered the page's plain fields, with no
// look by the driving model.
const sourcePrefill = "prefill"

// sourceReview and sourceAdvance mark entries where the DOM-first loop reviewed the page after the first
// draft, or picked the control that continues the application, with no look by the driving model.
const (
	sourceReview  = "review"
	sourceAdvance = "advance"
)

// sourceAsk marks an entry where the run waited on the person's answer, or acted on it.
const sourceAsk = "ask"

// stepTrace is one entry of the run.
type stepTrace struct {
	Seq  int `json:"seq"`
	Step int `json:"step"`
	// Source is "check" when the decision model carried the plan on; empty when the driving
	// model looked.
	Source string `json:"source,omitempty"`
	// Survey is the survey the model was shown, written as images; SurveyScreens counts them.
	Survey        []SurveyScreen `json:"-"`
	SurveyScreens int            `json:"surveyScreens,omitempty"`
	Check         *checkTrace    `json:"check,omitempty"`
	// Advance is what the decision model was asked about the controls of a clean page, and what it said.
	Advance     *advanceTrace  `json:"advance,omitempty"`
	At          time.Time      `json:"at"`
	URL         string         `json:"url"`
	Title       string         `json:"title"`
	Viewport    Viewport       `json:"viewport"`
	Focus       *Focus         `json:"focus,omitempty"`
	Notes       []string       `json:"notes,omitempty"`
	Results     []ActionResult `json:"results,omitempty"`
	Stale       int            `json:"stale"`
	Observation string         `json:"observation"`
	Memo        string         `json:"memo"`
	Job         string         `json:"job"`
	Status      string         `json:"status"`
	Message     string         `json:"message"`
	Stop        *StopInfo      `json:"stop,omitempty"`
	Actions     []Action       `json:"actions"`
	Dropped     []string       `json:"dropped,omitempty"`
	// Error is why the step produced no answer (the model failed, the observation was refused).
	Error string `json:"error,omitempty"`
	// Usage is the run's model use up to and including this step.
	Usage Usage `json:"usage"`
}

// tracedMessage is one message sent to the model, with its images counted, not embedded.
type tracedMessage struct {
	Role   string `json:"role"`
	Text   string `json:"text"`
	Images int    `json:"images"`
}

// modelCall is one call of the step to the model.
type modelCall struct {
	// Kind is "decision" for a check by the decision model; empty for the driving model.
	Kind string `json:"kind,omitempty"`
	// Repair marks the second call, which tells the model its first answer was refused.
	Repair       bool            `json:"repair,omitempty"`
	Messages     []tracedMessage `json:"messages"`
	Content      string          `json:"content"`
	FinishReason string          `json:"finishReason,omitempty"`
	Model        string          `json:"model,omitempty"`
	Usage        llm.Usage       `json:"usage"`
	LatencyMs    int64           `json:"latencyMs"`
	// HTTPAttempts is how many requests the call sent (a rate limit is retried).
	HTTPAttempts int    `json:"httpAttempts"`
	Error        string `json:"error,omitempty"`
}

func traceMessages(messages []llm.Message) []tracedMessage {
	out := make([]tracedMessage, len(messages))
	for i, message := range messages {
		out[i] = tracedMessage{Role: message.Role, Text: message.Text, Images: len(message.Images)}
	}
	return out
}

func (t *tracer) enabled() bool { return t != nil && t.dir != "" }

func (t *tracer) folder(sessionID string) (string, error) {
	dir := filepath.Join(t.dir, sessionID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("make trace folder: %w", err)
	}
	return dir, nil
}

// marshalJSON is the indented JSON a trace file holds.
func marshalJSON(value any) ([]byte, error) {
	var data bytes.Buffer
	encoder := json.NewEncoder(&data)
	encoder.SetIndent("", "  ")
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, fmt.Errorf("encode trace file: %w", err)
	}
	return data.Bytes(), nil
}

// traceEntryFile is one file of a trace, before it is written or returned.
type traceEntryFile struct {
	name string
	data []byte
	// ship marks a file the extension cannot make itself, so it goes back with the step.
	ship bool
	// image marks a file that is a picture, sent as base64.
	image bool
}

// bundle is the part of files that goes back to the extension.
func bundle(files []traceEntryFile, timeline string) *Trace {
	out := &Trace{Files: []TraceFile{}, Timeline: timeline}
	for _, file := range files {
		switch {
		case !file.ship:
		case file.image:
			out.Files = append(out.Files, TraceFile{Name: file.name, Data: base64.StdEncoding.EncodeToString(file.data)})
		default:
			out.Files = append(out.Files, TraceFile{Name: file.name, Text: string(file.data)})
		}
	}
	return out
}

// writeFiles puts files in the run's trace folder.
func (t *tracer) writeFiles(sessionID string, files []traceEntryFile) error {
	dir, err := t.folder(sessionID)
	if err != nil {
		return err
	}
	for _, file := range files {
		if err := os.WriteFile(filepath.Join(dir, file.name), file.data, 0o600); err != nil {
			return fmt.Errorf("write %s: %w", file.name, err)
		}
	}
	return nil
}

// sessionTrace is the run's start.
type sessionTrace struct {
	Started time.Time `json:"started"`
	Start   Start     `json:"start"`
	Model   string    `json:"model"`
	// ScreenModel is the decision model that checks the screen, empty when none does.
	ScreenModel string   `json:"screenModel,omitempty"`
	Config      Config   `json:"config"`
	Resumes     []string `json:"resumeStacks"`
	Documents   []string `json:"otherDocuments"`
}

// recordSession writes the run's start and the prompt the model is given, and returns them for
// the extension when it asked for the trace (want). The prompt shows the applicant's profile
// with secrets as placeholders, as the model reads it.
func (t *tracer) recordSession(sessionID, system string, info sessionTrace, want bool) (*Trace, error) {
	if !t.enabled() && !want {
		return nil, nil
	}
	session, err := marshalJSON(info)
	if err != nil {
		return nil, err
	}
	files := []traceEntryFile{
		{name: "system.txt", data: []byte(system), ship: true},
		{name: "session.json", data: session, ship: true},
	}
	var failure error
	if t.enabled() {
		failure = t.writeFiles(sessionID, files)
	}
	if !want {
		return nil, failure
	}
	return bundle(files, ""), failure
}

// entryFiles is every file of one entry: what the page reported and the model decided, every model
// call, the screenshot and the same screenshot with each action drawn on it, and a survey's.
func entryFiles(entry stepTrace, screenshot string, calls []modelCall) ([]traceEntryFile, error) {
	// The caller's actions go on to the extension; the copy written here hides secrets.
	entry.Actions = append([]Action(nil), entry.Actions...)
	for i, action := range entry.Actions {
		if action.Secret {
			entry.Actions[i].Text = fmt.Sprintf("[%d secret characters]", len([]rune(action.Text)))
		}
	}
	name := fmt.Sprintf("%03d", entry.Seq)
	entryJSON, err := marshalJSON(entry)
	if err != nil {
		return nil, err
	}
	files := []traceEntryFile{{name: name + ".json", data: entryJSON, ship: true}}
	if len(calls) > 0 {
		callsJSON, err := marshalJSON(calls)
		if err != nil {
			return nil, err
		}
		files = append(files, traceEntryFile{name: name + ".model.json", data: callsJSON, ship: true})
	}
	if comma := strings.IndexByte(screenshot, ','); comma >= 0 {
		extension := "jpg"
		if strings.Contains(screenshot[:comma], "png") {
			extension = "png"
		}
		if raw, err := base64.StdEncoding.DecodeString(screenshot[comma+1:]); err == nil {
			files = append(files, traceEntryFile{name: name + "." + extension, data: raw, image: true})
		}
		if marked, err := markScreenshot(screenshot, entry.Actions); err == nil && hasPoint(entry.Actions) {
			files = append(files, traceEntryFile{name: name + ".marked.jpg", data: marked, ship: true, image: true})
		}
	}
	for i, screen := range entry.Survey {
		raw, ok := decodeDataURL(screen.Screenshot)
		if !ok {
			continue
		}
		stem := fmt.Sprintf("%s.survey%d", name, i+1)
		files = append(files, traceEntryFile{name: stem + ".jpg", data: raw, image: true})
		var here []Action
		for _, action := range entry.Actions {
			if action.ScrollTo != nil && *action.ScrollTo == screen.ScrollY {
				here = append(here, action)
			}
		}
		if marked, err := markScreenshot(screen.Screenshot, here); err == nil && hasPoint(here) {
			files = append(files, traceEntryFile{name: stem + ".marked.jpg", data: marked, ship: true, image: true})
		}
	}
	return files, nil
}

// record writes one entry to the trace folder when there is one, and returns it for the extension
// when the run asked for the trace (want). A write that fails is returned for the caller to log;
// it never stops the run.
func (t *tracer) record(sessionID string, entry stepTrace, screenshot string, calls []modelCall, want bool) (*Trace, error) {
	if !t.enabled() && !want {
		return nil, nil
	}
	files, err := entryFiles(entry, screenshot, calls)
	if err != nil {
		return nil, err
	}
	line := timelineLine(entry, calls)
	var failure error
	if t.enabled() {
		failure = t.writeFiles(sessionID, files)
		if dir, err := t.folder(sessionID); err == nil {
			if err := appendLine(filepath.Join(dir, "timeline.txt"), line); err != nil && failure == nil {
				failure = err
			}
		}
	}
	if !want {
		return nil, failure
	}
	return bundle(files, line+"\n"), failure
}

func hasPoint(actions []Action) bool {
	for _, action := range actions {
		if action.X != nil && action.Y != nil {
			return true
		}
	}
	return false
}

func timelineLine(entry stepTrace, calls []modelCall) string {
	var latency int64
	for _, call := range calls {
		latency += call.LatencyMs
	}
	parts := make([]string, len(entry.Actions))
	for i, action := range entry.Actions {
		parts[i] = describe(action)
	}
	status := entry.Status
	if entry.Check != nil {
		status = "check:" + entry.Check.Outcome
	}
	line := fmt.Sprintf("%03d step %d %-14s %5dms $%.4f", entry.Seq, entry.Step, status, latency, entry.Usage.Cost)
	if entry.Check != nil {
		line += fmt.Sprintf(" match=%.2f blocked=%.2f loading=%.2f", entry.Check.Matches, entry.Check.Blocked, entry.Check.Loading)
	}
	if entry.Stale > 0 {
		line += fmt.Sprintf(" stale=%d", entry.Stale)
	}
	if entry.Error != "" {
		line += " ERROR: " + clipText(entry.Error, 160)
	}
	line += " | " + clipText(entry.Message, 140)
	if len(parts) > 0 {
		line += " | " + strings.Join(parts, "; ")
	}
	if len(entry.Dropped) > 0 {
		line += " | DROPPED: " + strings.Join(entry.Dropped, "; ")
	}
	return line
}

func appendLine(path, line string) error {
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open timeline: %w", err)
	}
	defer file.Close()
	if _, err := file.WriteString(line + "\n"); err != nil {
		return fmt.Errorf("write timeline: %w", err)
	}
	return nil
}
