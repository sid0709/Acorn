package openai

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

func capture(t *testing.T, fn func()) string {
	t.Helper()
	var buf bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(plainlog.New(&buf, slog.LevelDebug)))
	defer slog.SetDefault(previous)
	fn()
	return buf.String()
}

func TestAnAnsweredCallIsOneSentenceWithTimeTokensAndCost(t *testing.T) {
	out := capture(t, func() {
		LogProvider(context.Background(), "decision", "openai/gpt-6-luna", 200, 1, 1617, time.Now().Add(-640*time.Millisecond),
			Usage{PromptTokens: 693, CachedTokens: 100, CompletionTokens: 39, TotalTokens: 732, CostNanos: 29106, Priced: true}, nil, "", false)
	})
	for _, want := range []string{"Asked openai/gpt-6-luna for a quick decision and it answered in ", "693 tokens in (100 from cache), 39 out, $0.000029."} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in %q", want, out)
		}
	}
	if strings.Contains(out, "=") {
		t.Fatalf("the line still reads like key=value: %q", out)
	}
}

func TestAFailedCallSaysWhyAndWhetherItWillBeAskedAgain(t *testing.T) {
	out := capture(t, func() {
		LogProvider(WithCall(context.Background(), "analyze"), "chat", "m", 429, 2, 10, time.Now(), Usage{}, errors.New("rate limited"), "3", true)
	})
	for _, want := range []string{"Heads up: Could not get an answer from m for the analyze step on try 2", "(it replied 429)", "ask again after the pause it asked for (3)", ": rate limited"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in %q", want, out)
		}
	}
}

func TestACallNobodyRecordsIsOnlyADebugNote(t *testing.T) {
	var buf bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(plainlog.New(&buf, slog.LevelInfo)))
	defer slog.SetDefault(previous)
	Note(context.Background(), Usage{Model: "m", Step: "s"})
	if buf.Len() != 0 {
		t.Fatalf("an unrecorded call was shown: %q", buf.String())
	}
}
