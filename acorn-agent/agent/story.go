package agent

import (
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// What the terminal says about a run is told as it happens, one sentence per entry, so a person
// watching can follow it without opening the trace: what the agent looked at, who it asked, how
// long that took, and what it decided to do next. The trace files keep every number.

// maxActionsNamed is how many actions a sentence names before it says "and so on".
const maxActionsNamed = 6

// maxMessageChars bounds the model's line to the person that a sentence quotes.
const maxMessageChars = 100

// runName is how a run is called in a sentence: "Run 42cd1e".
func runName(id string) string { return "Run " + plainlog.Short(id) }

// storyOf is the terminal's sentence for one entry of a run and how loud it is. started is when
// the run began, for the total in the sentence that ends it.
func storyOf(runID string, started time.Time, entry stepTrace, calls []modelCall) (slog.Level, string) {
	head := fmt.Sprintf("%s, step %d", runName(runID), entry.Step)
	took := time.Duration(entry.DurationMs) * time.Millisecond
	if entry.Error != "" {
		if strings.Contains(entry.Error, "context canceled") {
			return slog.LevelInfo, fmt.Sprintf("%s: the run was stopped while the model was still working on the answer (%s in).", head, plainlog.Seconds(took))
		}
		return slog.LevelWarn, fmt.Sprintf("%s: the model did not answer after %s. The run can try the same step again.", head, plainlog.Seconds(took))
	}
	var what string
	switch entry.Source {
	case sourceCheck:
		what = checkStory(entry, took)
	case sourceChoose:
		what = fmt.Sprintf("worked on a dropdown (%s)%s", plainlog.Seconds(took), actionsSentence(entry.Actions, ", sending "))
	case sourceNav:
		what = fmt.Sprintf("looked for the application form (%s)%s", plainlog.Seconds(took), actionsSentence(entry.Actions, " and sent "))
	case sourcePicker:
		what = "attached the résumé at the file picker that the last click opened"
	case sourceAsk:
		what = "waited for the applicant's answer"
	default:
		what = driveStory(entry, calls, took)
	}
	line := head + ": " + what
	if len(entry.Dropped) > 0 {
		line += fmt.Sprintf(" %s set aside.", plainlog.Count(len(entry.Dropped), "planned action"))
	}
	if entry.Status != "" && entry.Status != StatusWorking {
		line += " " + endStory(entry.Status, entry.Message, entry.Usage, time.Since(started))
	}
	return slog.LevelInfo, line + quotedMessage(entry)
}

// driveStory is a step the driving model answered: how long it took and what it planned.
func driveStory(entry stepTrace, calls []modelCall, took time.Duration) string {
	var model, quick time.Duration
	var asked, decisions int
	var answered modelCall
	for _, call := range calls {
		if call.Kind == "decision" {
			decisions++
			quick += time.Duration(call.LatencyMs) * time.Millisecond
			continue
		}
		asked++
		model += time.Duration(call.LatencyMs) * time.Millisecond
		answered = call
	}
	line := "looked at the page"
	if asked > 0 {
		line += fmt.Sprintf(" and asked %s, which took %s (%s tokens read, %s of them from cache, %s written)",
			modelName(answered.Model), plainlog.Seconds(model), tokens(answered.Usage.InputTokens), tokens(answered.Usage.CachedTokens), tokens(answered.Usage.OutputTokens))
	}
	if decisions > 0 {
		line += fmt.Sprintf("; %s took another %s", plainlog.Count(decisions, "quick decision"), plainlog.Seconds(quick))
	}
	if asked == 0 && decisions == 0 {
		line += fmt.Sprintf(" (%s)", plainlog.Seconds(took))
	}
	if entry.Status == "" || entry.Status == StatusWorking {
		if len(entry.Actions) == 0 {
			return line + ", and nothing needed doing yet."
		}
		return line + ", then sent " + actionList(entry.Actions) + "."
	}
	return line + "."
}

// checkStory is a step where the decision model looked at the screen to carry a plan on.
func checkStory(entry stepTrace, took time.Duration) string {
	check := entry.Check
	if check == nil {
		return fmt.Sprintf("checked the screen (%s).", plainlog.Seconds(took))
	}
	line := fmt.Sprintf("checked the screen (%s) and ", plainlog.Seconds(took))
	switch check.Outcome {
	case checkContinue:
		if len(entry.Actions) > 0 {
			return line + "it showed what the plan expected, so the next part went out: " + actionList(entry.Actions) + "."
		}
		return line + "it showed what the plan expected, and that was the end of the plan."
	case checkWait:
		return line + "the page still looked like it was loading, so it waited a moment."
	}
	reason := strings.TrimSpace(check.Reason)
	if check.Error != "" {
		reason = "the check itself failed"
	}
	if reason == "" {
		reason = "it was not sure of the screen"
	}
	return line + reason + ", so the model will look for itself."
}

// endStory is the sentence that closes a run: how it ended and what it cost.
func endStory(status, message string, usage Usage, total time.Duration) string {
	how := map[string]string{
		StatusDone:       "The model reports the application is done.",
		StatusNeedPerson: "The model needs the applicant to take over.",
		StatusStuck:      "The model is stuck.",
	}[status]
	if how == "" {
		how = "The run is over."
	}
	return fmt.Sprintf("%s In all: %s and %s over %s, costing $%.4f.",
		how, plainlog.Count(usage.Calls, "model call"), plainlog.Count(usage.Checks, "screen check"), plainlog.Seconds(total), usage.Cost)
}

// quotedMessage is the line the model gave the applicant, in quotes at the end of a sentence.
func quotedMessage(entry stepTrace) string {
	message := strings.TrimSpace(entry.Message)
	if message == "" || entry.Source == sourceCheck {
		return ""
	}
	message = clipText(message, maxMessageChars)
	if !strings.HasSuffix(message, ".") && !strings.HasSuffix(message, "!") && !strings.HasSuffix(message, "?") {
		message += "."
	}
	return fmt.Sprintf(" It told the applicant: \"%s\"", message)
}

// actionList names the actions of a plan: "3 actions (click, type, scroll)".
func actionList(actions []Action) string {
	names := make([]string, 0, len(actions))
	for _, action := range actions {
		if len(names) == maxActionsNamed {
			names = append(names, "and so on")
			break
		}
		names = append(names, strings.ReplaceAll(action.Kind, "_", " "))
	}
	return fmt.Sprintf("%s (%s)", plainlog.Count(len(actions), "action"), strings.Join(names, ", "))
}

// actionsSentence is an action list led by a joining phrase, or nothing when there are none.
func actionsSentence(actions []Action, lead string) string {
	if len(actions) == 0 {
		return ""
	}
	return lead + actionList(actions)
}

// modelName is a model id without its maker's prefix: "gpt-6-luna" for "openai/gpt-6-luna".
func modelName(id string) string {
	if id == "" {
		return "the model"
	}
	if i := strings.LastIndex(id, "/"); i >= 0 {
		return id[i+1:]
	}
	return id
}

// tokens is a token count a person reads at a glance: 840, or 10.8k.
func tokens(n int) string {
	if n < 1000 {
		return fmt.Sprint(n)
	}
	return fmt.Sprintf("%.1fk", float64(n)/1000)
}

// startStory is the sentence that opens a run: where it is and what it can use.
func startStory(id string, start Start, stacks int, tracing bool) string {
	line := fmt.Sprintf("%s begins on %q with %s to choose from", runName(id), start.URL, plainlog.Count(stacks, "résumé stack"))
	if start.StopBeforeSubmit {
		line += ", and it will stop before the application is sent"
	}
	if !tracing {
		line += " (no trace is being saved)"
	}
	return line + "."
}

// vetOutcome is the end of the sentence about a file-source check that failed: what happened to
// the control it was about.
func vetOutcome(blocked bool) string {
	if blocked {
		return ", so the control stays blocked"
	}
	return ", so the control is allowed"
}
