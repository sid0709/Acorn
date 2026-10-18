package openai

import (
	"encoding/json"
	"testing"

	"github.com/sid0709/OpenSeat/backend-core/config"
)

func TestParseChatUsagePrefersBilledCost(t *testing.T) {
	raw := json.RawMessage(`{
		"prompt_tokens": 1000,
		"completion_tokens": 20,
		"total_tokens": 1020,
		"cost": 0.0012,
		"prompt_tokens_details": {"cached_tokens": 400, "cache_write_tokens": 0}
	}`)
	usage, ok := ParseChatUsage(config.OpenRouterModel, raw)
	if !ok || !usage.Priced {
		t.Fatal("expected a priced call")
	}
	if usage.CostNanos != 1_200_000 {
		t.Fatalf("cost = %d nanos, want 1200000", usage.CostNanos)
	}
	if usage.TotalTokens != 1020 || usage.CachedTokens != 400 {
		t.Fatalf("tokens = %+v", usage)
	}
}

func TestParseChatUsageKeepsScientificCost(t *testing.T) {
	raw := json.RawMessage(`{"prompt_tokens": 10, "completion_tokens": 2, "cost": 8.41005e-05}`)
	usage, ok := ParseChatUsage(config.OpenRouterModel, raw)
	if !ok || usage.CostNanos != 84101 {
		t.Fatalf("usage = %+v ok=%v", usage, ok)
	}
}

func TestParseChatUsageFallsBackToLunaRates(t *testing.T) {
	raw := json.RawMessage(`{
		"prompt_tokens": 100,
		"completion_tokens": 20,
		"prompt_tokens_details": {"cached_tokens": 40, "cache_write_tokens": 10}
	}`)
	usage, ok := ParseChatUsage(config.OpenRouterModel, raw)
	if !ok || !usage.Priced {
		t.Fatal("expected a fallback price")
	}
	// plain 50×100 + cached 40×10 + write 10×125 + output 20×500
	if usage.CostNanos != 16650 {
		t.Fatalf("cost = %d, want 16650", usage.CostNanos)
	}
}

func TestLunaRatesMatchPublishedPrices(t *testing.T) {
	if got := lunaCostNanos(1_000_000, 0, 0, 0); got != 100_000_000 {
		t.Fatalf("input = %d", got)
	}
	if got := lunaCostNanos(0, 1_000_000, 0, 0); got != 500_000_000 {
		t.Fatalf("output = %d", got)
	}
	if got := lunaCostNanos(1_000_000, 0, 1_000_000, 0); got != 10_000_000 {
		t.Fatalf("cache read = %d", got)
	}
	if got := lunaCostNanos(1_000_000, 0, 0, 1_000_000); got != 125_000_000 {
		t.Fatalf("cache write = %d", got)
	}
}

func TestFormatUSD(t *testing.T) {
	if got := FormatUSD(1_200_000); got != "0.001200000" {
		t.Fatalf("format = %q", got)
	}
	if got := FormatUSD(100_000_000); got != "0.100000000" {
		t.Fatalf("format = %q", got)
	}
}
