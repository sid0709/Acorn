package openai

import (
	"context"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/sid0709/OpenSeat/backend-core/httpkit"
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

func callName(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	name, _ := ctx.Value(callKey{}).(string)
	return name
}

// LogProvider writes one line for a provider attempt. The prompt stays out of the log.
func LogProvider(ctx context.Context, kind, model string, status, attempt, requestBytes int, started time.Time, usage Usage, err error, retryAfter string, willRetry bool) {
	if ctx == nil {
		ctx = context.Background()
	}
	level := slog.LevelInfo
	if err != nil || status >= 400 || status == 0 {
		level = slog.LevelWarn
	}
	name := callName(ctx)
	if name == "" {
		name = kind
	}
	attrs := []any{
		"request_id", httpkit.RequestID(ctx),
		"kind", kind,
		"name", name,
		"model", model,
		"status", status,
		"attempt", attempt,
		"duration_ms", time.Since(started).Milliseconds(),
		"request_bytes", requestBytes,
	}
	if usage.TotalTokens > 0 || usage.Priced {
		attrs = append(attrs,
			"prompt_tokens", usage.PromptTokens,
			"completion_tokens", usage.CompletionTokens,
			"cached_tokens", usage.CachedTokens,
			"cache_write_tokens", usage.CacheWriteTokens,
			"total_tokens", usage.TotalTokens,
			"cost", FormatUSD(usage.CostNanos),
			"priced", usage.Priced,
		)
	}
	if err != nil {
		attrs = append(attrs, "error", clipLog(err.Error()))
	}
	if willRetry {
		attrs = append(attrs, "retry", true)
		if retryAfter != "" {
			attrs = append(attrs, "retry_after", retryAfter)
		}
	}
	slog.Log(ctx, level, "acorn model", attrs...)
}

func clipLog(text string) string {
	text = strings.TrimSpace(text)
	if utf8.RuneCountInString(text) <= logTextLimit {
		return text
	}
	runes := []rune(text)
	return string(runes[:logTextLimit]) + "…"
}
