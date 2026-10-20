package openai

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/sid0709/acorn/acorn-backend/plainlog"
	"github.com/sid0709/acorn/acorn-backend/requestid"
)

const logTextLimit = 500

type callKey struct{}

// WithCall names the product step that is about to call the model, so the log
// can tell analyze, recommend, and résumé steps apart.
func WithCall(ctx context.Context, name string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return ctx
	}
	return context.WithValue(ctx, callKey{}, name)
}

// CallName is the name WithCall gave ctx's call, or "" when none.
func CallName(ctx context.Context) string { return callName(ctx) }

func callName(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	name, _ := ctx.Value(callKey{}).(string)
	return name
}

// LogProvider writes one line for a provider attempt, as a sentence: who was asked, for what, how
// long it took and what it cost, or why it did not answer. The prompt stays out of the log.
func LogProvider(ctx context.Context, kind, model string, status, attempt, requestBytes int, started time.Time, usage Usage, err error, retryAfter string, willRetry bool) {
	if ctx == nil {
		ctx = context.Background()
	}
	name := callName(ctx)
	if name == "" {
		name = kind
	}
	took := plainlog.Seconds(time.Since(started))
	try := ""
	if attempt > 1 {
		try = fmt.Sprintf(" on try %d", attempt)
	}
	if err != nil || status >= 400 || status == 0 {
		line := fmt.Sprintf("Could not get an answer from %s for %s%s after %s", model, askedFor(name), try, took)
		if status > 0 {
			line += fmt.Sprintf(" (it replied %d)", status)
		}
		if willRetry {
			line += ", so Acorn will ask again"
			if retryAfter != "" {
				line += " after the pause it asked for (" + retryAfter + ")"
			}
		}
		slog.Warn(line+".", "request_id", requestid.From(ctx), plainlog.ErrorKey, errorText(err))
		return
	}
	line := fmt.Sprintf("Asked %s for %s%s and it answered in %s", model, askedFor(name), try, took)
	if usage.TotalTokens > 0 || usage.Priced {
		line += fmt.Sprintf(": %d tokens in (%d from cache), %d out", usage.PromptTokens, usage.CachedTokens, usage.CompletionTokens)
		if usage.Priced {
			line += ", $" + shortUSD(usage.CostNanos)
		}
	}
	slog.Info(line + ".")
}

// askedFor is what a model call was for, in words: the step that made it, or the kind of call.
func askedFor(name string) string {
	switch name {
	case "decision":
		return "a quick decision"
	case "chat":
		return "a reply"
	}
	return "the " + name + " step"
}

// errorText is why a call failed, clipped, or "" when nothing is known.
func errorText(err error) string {
	if err == nil {
		return ""
	}
	return clipLog(err.Error())
}

// shortUSD is nanodollars as dollars to six decimals, which is where a model call's cost shows.
func shortUSD(nanos int64) string {
	return fmt.Sprintf("%.6f", float64(max(nanos, 0))/1e9)
}

func clipLog(text string) string {
	text = strings.TrimSpace(text)
	if utf8.RuneCountInString(text) <= logTextLimit {
		return text
	}
	runes := []rune(text)
	return string(runes[:logTextLimit]) + "…"
}
