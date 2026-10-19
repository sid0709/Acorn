package llm

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
)

// OpenAI's own API reports no cost: the usage has token counts, the cached ones in prompt_tokens_details.
const openAIBody = `{"model":"gpt-6-luna","choices":[{"message":{"content":"{\"a\":1}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":20000,"completion_tokens":200,"prompt_tokens_details":{"cached_tokens":15000}}}`

var testPrices = Prices{Input: 0.10, Cached: 0.01, CacheWrite: 0.125, Output: 0.50}

func TestPricesCostEachKindOfTokenAtItsOwnRate(t *testing.T) {
	// 5,000 plain input, 15,000 read from the cache, 200 out, at $/M: 0.0005 + 0.00015 + 0.0001.
	got := testPrices.Cost(Usage{InputTokens: 20000, CachedTokens: 15000, OutputTokens: 200})
	if math.Abs(got-0.00075) > 1e-9 {
		t.Fatalf("cost = %v, want 0.00075", got)
	}
	// Tokens written to the cache are billed at the write rate, not as plain input.
	written := testPrices.Cost(Usage{InputTokens: 1000, CacheWriteTokens: 1000})
	if math.Abs(written-0.000125) > 1e-9 {
		t.Fatalf("cache write cost = %v, want 0.000125", written)
	}
}

func TestOpenAIAsksForReasoningItsOwnWayAndPricesTheCall(t *testing.T) {
	var got map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Error(err)
		}
		_, _ = w.Write([]byte(openAIBody))
	}))
	defer server.Close()
	client := NewOpenAI("sk-proj-x", "gpt-6-luna", server.URL, "none", testPrices)
	resp, err := client.Complete(context.Background(), Request{Messages: []Message{{Role: RoleUser, Text: "hi"}}})
	if err != nil {
		t.Fatal(err)
	}
	if got["reasoning_effort"] != "none" || got["reasoning"] != nil || got["usage"] != nil {
		t.Fatalf("OpenAI takes reasoning_effort and no usage option: %v", got)
	}
	if resp.Provider != ProviderOpenAI || resp.RequestBytes == 0 {
		t.Fatalf("response = %+v", resp)
	}
	if math.Abs(resp.Usage.Cost-0.00075) > 1e-9 || resp.Usage.CachedTokens != 15000 {
		t.Fatalf("usage = %+v: the call is priced from the rates, with its cached tokens", resp.Usage)
	}
}

func TestOpenRouterStillSendsItsOwnFieldsAndKeepsTheReportedCostAndProvider(t *testing.T) {
	var got map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = w.Write([]byte(`{"model":"openai/gpt-6-luna","provider":"Azure","choices":[{"message":{"content":"{}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":1,"cost":0.0042}}`))
	}))
	defer server.Close()
	resp, err := NewOpenRouter("k", "openai/gpt-6-luna", server.URL, "low").Complete(context.Background(), Request{Messages: []Message{{Role: RoleUser, Text: "hi"}}})
	if err != nil {
		t.Fatal(err)
	}
	if got["reasoning"] == nil || got["reasoning_effort"] != nil || got["usage"] == nil {
		t.Fatalf("OpenRouter takes reasoning and the usage option: %v", got)
	}
	if resp.Provider != ProviderOpenRouter || resp.Served != "Azure" || resp.Usage.Cost != 0.0042 {
		t.Fatalf("response = %+v", resp)
	}
}
