package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"math/big"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/backend-core/config"
)

const (
	// Published OpenRouter rates for openai/gpt-6-luna, in nanodollars per token.
	// Used only when a response omits usage.cost. A present cost is the amount
	// OpenRouter charged and replaces these rates.
	lunaInputNanosPerToken      int64 = 100 // $0.10 / 1,000,000
	lunaOutputNanosPerToken     int64 = 500 // $0.50 / 1,000,000
	lunaCacheReadNanosPerToken  int64 = 10  // $0.01 / 1,000,000
	lunaCacheWriteNanosPerToken int64 = 125 // $0.125 / 1,000,000
	nanosPerDollar                    = 1_000_000_000
	// maxStoredRequest is how much of the provider request the usage history keeps.
	maxStoredRequest = 512 << 10
	maxPrettyRequest = 1 << 20
)

// Usage is one model call. CostNanos is USD × 1e9. Duration is from the send
// until the response body, including the last token, has arrived. Tokens and cost
// are summed over every attempt, since a failed attempt is still billed.
type Usage struct {
	Model            string
	PromptTokens     int
	CompletionTokens int
	CachedTokens     int
	CacheWriteTokens int
	TotalTokens      int
	CostNanos        int64
	Priced           bool
	Duration         time.Duration
	// Attempts is how many requests the call sent; 0 when it never reached the provider.
	Attempts int
	// HTTPStatus is the last attempt's status; 0 when no response arrived.
	HTTPStatus int
	// FinishReason is the provider's finish_reason ("stop", "length", …), when it sends one.
	FinishReason string
	// Step is the product step named with WithCall, when the caller named one.
	Step string
	// Request is the JSON sent to the provider, without the API key.
	Request string
	// Response is the provider response body, clipped for usage history detail views.
	Response string
	Error    string
	// ErrorKind is one of the ErrorKind* values when Error is set.
	ErrorKind string
}

// Add sums another attempt's tokens and cost into u.
func (u *Usage) Add(other Usage) {
	u.PromptTokens += other.PromptTokens
	u.CompletionTokens += other.CompletionTokens
	u.CachedTokens += other.CachedTokens
	u.CacheWriteTokens += other.CacheWriteTokens
	u.TotalTokens += other.TotalTokens
	u.CostNanos += other.CostNanos
	u.Priced = u.Priced || other.Priced
	if other.Model != "" {
		u.Model = other.Model
	}
}

type recorderKey struct{}

// Recorder stores one call. It must not block the model call for long.
type Recorder func(Usage)

// WithRecorder returns a context that Note reports billed calls to.
func WithRecorder(ctx context.Context, record Recorder) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, recorderKey{}, record)
}

// StoredResponse is the provider response, pretty-printed and clipped, for the usage history.
func StoredResponse(body []byte) string {
	return storedBodyText(body)
}

// StoredRequest is the provider request, pretty-printed and clipped, for the usage history.
func StoredRequest(body []byte) string {
	return storedBodyText(body)
}

func storedBodyText(body []byte) string {
	pretty := body
	if len(body) > 0 && len(body) <= maxPrettyRequest {
		var buf bytes.Buffer
		if json.Indent(&buf, body, "", "  ") == nil {
			pretty = buf.Bytes()
		}
	}
	text := string(pretty)
	if len(text) <= maxStoredRequest {
		return text
	}
	return text[:maxStoredRequest] + "\n\n… truncated"
}

// Note reports a model call when the context has a recorder. A call without one
// is logged, so a handler that forgot its recorder shows up instead of vanishing
// from usage history.
func Note(ctx context.Context, usage Usage) {
	if ctx == nil {
		ctx = context.Background()
	}
	if usage.Step == "" {
		usage.Step = callName(ctx)
	}
	if usage.Error != "" && usage.ErrorKind == "" {
		usage.ErrorKind = ErrorKindProvider
	}
	record, _ := ctx.Value(recorderKey{}).(Recorder)
	if record == nil {
		slog.WarnContext(ctx, "model call not recorded", "model", usage.Model, "step", usage.Step)
		return
	}
	record(usage)
}

// FormatUSD renders nanodollars as a fixed 9-decimal dollar string.
func FormatUSD(nanos int64) string {
	if nanos < 0 {
		nanos = 0
	}
	return strings.TrimSpace(strings.Join([]string{
		itoa(nanos / nanosPerDollar),
		pad9(nanos % nanosPerDollar),
	}, "."))
}

func itoa(n int64) string {
	return big.NewInt(n).String()
}

func pad9(n int64) string {
	raw := itoa(n)
	if len(raw) >= 9 {
		return raw
	}
	return strings.Repeat("0", 9-len(raw)) + raw
}

// ParseChatUsage reads an OpenRouter chat usage object. Cost is the billed USD
// when usage.cost is present; otherwise GPT-6 Luna's published rates apply.
func ParseChatUsage(model string, raw json.RawMessage) (Usage, bool) {
	if len(strings.TrimSpace(string(raw))) == 0 || string(raw) == "null" {
		return Usage{}, false
	}
	var body struct {
		PromptTokens     int             `json:"prompt_tokens"`
		CompletionTokens int             `json:"completion_tokens"`
		TotalTokens      int             `json:"total_tokens"`
		Cost             json.RawMessage `json:"cost"`
		PromptDetails    *struct {
			CachedTokens     int `json:"cached_tokens"`
			CacheWriteTokens int `json:"cache_write_tokens"`
		} `json:"prompt_tokens_details"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return Usage{}, false
	}
	cached, write := 0, 0
	if body.PromptDetails != nil {
		cached = body.PromptDetails.CachedTokens
		write = body.PromptDetails.CacheWriteTokens
	}
	total := body.TotalTokens
	if total == 0 {
		total = body.PromptTokens + body.CompletionTokens
	}
	usage := Usage{
		Model:            model,
		PromptTokens:     body.PromptTokens,
		CompletionTokens: body.CompletionTokens,
		CachedTokens:     cached,
		CacheWriteTokens: write,
		TotalTokens:      total,
	}
	if cost, ok := nanosFromJSON(body.Cost); ok {
		usage.CostNanos = cost
		usage.Priced = true
		return usage, true
	}
	if model == config.OpenRouterModel && (body.PromptTokens > 0 || body.CompletionTokens > 0) {
		usage.CostNanos = lunaCostNanos(body.PromptTokens, body.CompletionTokens, cached, write)
		usage.Priced = true
		return usage, true
	}
	if total == 0 && !usage.Priced {
		return Usage{}, false
	}
	return usage, true
}

// NanosFromUSD converts a dollar amount to nanodollars, rounding half away from zero.
func NanosFromUSD(dollars float64) int64 {
	rat := new(big.Rat).SetFloat64(dollars)
	if rat == nil || rat.Sign() < 0 {
		return 0
	}
	rat.Mul(rat, big.NewRat(nanosPerDollar, 1))
	return roundRat(rat)
}

func nanosFromJSON(raw json.RawMessage) (int64, bool) {
	if len(strings.TrimSpace(string(raw))) == 0 || string(raw) == "null" {
		return 0, false
	}
	var number json.Number
	if err := json.Unmarshal(raw, &number); err != nil {
		return 0, false
	}
	return nanosFromDecimal(number.String())
}

func nanosFromDecimal(raw string) (int64, bool) {
	rat, ok := new(big.Rat).SetString(strings.TrimSpace(raw))
	if !ok || rat.Sign() < 0 {
		return 0, false
	}
	rat.Mul(rat, big.NewRat(nanosPerDollar, 1))
	return roundRat(rat), true
}

func roundRat(rat *big.Rat) int64 {
	num := new(big.Int).Set(rat.Num())
	den := new(big.Int).Set(rat.Denom())
	quo, rem := new(big.Int).QuoRem(num, den, new(big.Int))
	twice := new(big.Int).Mul(rem, big.NewInt(2))
	if twice.Cmp(den) >= 0 {
		quo.Add(quo, big.NewInt(1))
	}
	if !quo.IsInt64() {
		return 0
	}
	return quo.Int64()
}

// lunaCostNanos prices a GPT-6 Luna call from token counts.
// Cached and cache-write tokens are subsets of the prompt and are not also billed as input.
func lunaCostNanos(prompt, completion, cached, cacheWrite int) int64 {
	if prompt < 0 {
		prompt = 0
	}
	if completion < 0 {
		completion = 0
	}
	if cached < 0 {
		cached = 0
	}
	if cacheWrite < 0 {
		cacheWrite = 0
	}
	if cached > prompt {
		cached = prompt
	}
	remain := prompt - cached
	if cacheWrite > remain {
		cacheWrite = remain
	}
	plain := remain - cacheWrite
	return int64(plain)*lunaInputNanosPerToken +
		int64(cached)*lunaCacheReadNanosPerToken +
		int64(cacheWrite)*lunaCacheWriteNanosPerToken +
		int64(completion)*lunaOutputNanosPerToken
}
