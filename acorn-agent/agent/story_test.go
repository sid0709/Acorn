package agent

import (
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/sid0709/acorn/acorn-agent/llm"
)

func usageOf(in, cached, out int) llm.Usage {
	return llm.Usage{InputTokens: in, CachedTokens: cached, OutputTokens: out}
}

func TestAModelStepIsToldAsOneReadableSentence(t *testing.T) {
	entry := stepTrace{
		Step: 9, DurationMs: 9800, Status: StatusWorking, Message: "I’ll fill the experience questions.",
		Actions: []Action{{Kind: KindClick}, {Kind: KindType}, {Kind: KindScroll}},
	}
	calls := []modelCall{
		{Kind: "decision", LatencyMs: 640},
		{Model: "openai/gpt-6-luna", LatencyMs: 6200, Usage: usageOf(10800, 5700, 163)},
	}
	level, line := storyOf("42cd1e8f9a0b", time.Now(), entry, calls)
	if level != slog.LevelInfo {
		t.Fatalf("level = %v", level)
	}
	for _, want := range []string{
		"Run 42cd1e, step 9: looked at the page and asked gpt-6-luna, which took 6.2s (10.8k tokens read, 5.7k of them from cache, 163 written)",
		"1 quick decision took another 640ms", "then sent 3 actions (click, type, scroll).", `It told the applicant: "I’ll fill the experience questions."`,
	} {
		if !strings.Contains(line, want) {
			t.Fatalf("missing %q in %q", want, line)
		}
	}
	if strings.Contains(line, "=") {
		t.Fatalf("the line reads like key=value: %q", line)
	}
}

func TestACheckSaysWhetherThePlanWentOn(t *testing.T) {
	ok := stepTrace{Step: 4, Source: sourceCheck, DurationMs: 1800, Check: &checkTrace{Outcome: checkContinue}, Actions: []Action{{Kind: KindType}}}
	if _, line := storyOf("abcdef12", time.Now(), ok, nil); !strings.Contains(line, "checked the screen (1.8s) and it showed what the plan expected, so the next part went out: 1 action (type).") {
		t.Fatal(line)
	}
	look := stepTrace{Step: 4, Source: sourceCheck, DurationMs: 900, Check: &checkTrace{Outcome: checkLook, Reason: "something may be in the way (0.40)"}}
	if _, line := storyOf("abcdef12", time.Now(), look, nil); !strings.Contains(line, "something may be in the way (0.40), so the model will look for itself.") {
		t.Fatal(line)
	}
}

func TestAStoppedRunIsNewsNotAWarning(t *testing.T) {
	level, line := storyOf("abcdef12", time.Now(), stepTrace{Step: 16, DurationMs: 6900, Error: `call model: Post "https://x": context canceled`}, nil)
	if level != slog.LevelInfo || !strings.Contains(line, "the run was stopped while the model was still working") {
		t.Fatalf("%v %q", level, line)
	}
	level, line = storyOf("abcdef12", time.Now(), stepTrace{Step: 3, DurationMs: 30000, Error: "model request failed (500)"}, nil)
	if level != slog.LevelWarn || !strings.Contains(line, "the model did not answer after 30s") {
		t.Fatalf("%v %q", level, line)
	}
}

func TestTheLastStepSaysHowTheRunEndedAndWhatItCost(t *testing.T) {
	entry := stepTrace{Step: 12, DurationMs: 5000, Status: StatusDone, Usage: Usage{Calls: 12, Checks: 8, Cost: 0.0125}}
	_, line := storyOf("abcdef12", time.Now().Add(-90*time.Second), entry, []modelCall{{Model: "m", LatencyMs: 5000}})
	if !strings.Contains(line, "The model reports the application is done. In all: 12 model calls and 8 screen checks over 1m 30s, costing $0.0125.") {
		t.Fatal(line)
	}
}

func TestTheOpeningSentenceNamesThePageAndTheRules(t *testing.T) {
	line := startStory("abcdef1234", Start{URL: "https://jobs.example/apply", StopBeforeSubmit: true}, 64, false)
	want := `Run abcdef begins on "https://jobs.example/apply" with 64 résumé stacks to choose from, and it will stop before the application is sent (no trace is being saved).`
	if line != want {
		t.Fatalf("got %q", line)
	}
}
