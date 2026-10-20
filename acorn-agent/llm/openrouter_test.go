package llm

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const okBody = `{"model":"openai/gpt-6-luna","choices":[{"message":{"content":"{\"a\":1}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":120,"completion_tokens":8,"cost":0.0004}}`

func TestCompleteSendsImagesSchemaAndKey(t *testing.T) {
	var got map[string]any
	var auth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		if r.URL.Path != "/chat/completions" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Error(err)
		}
		_, _ = w.Write([]byte(okBody))
	}))
	defer server.Close()

	client := NewOpenRouter("sk-test", "openai/gpt-6-luna", server.URL+"/", "low")
	resp, err := client.Complete(context.Background(), Request{
		Messages: []Message{
			{Role: RoleSystem, Text: "rules"},
			{Role: RoleUser, Text: "look", Images: []string{"data:image/jpeg;base64,AAAA"}},
		},
		SchemaName: "step",
		Schema:     json.RawMessage(`{"type":"object"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Content != `{"a":1}` || resp.Usage.InputTokens != 120 || resp.Usage.Cost != 0.0004 {
		t.Fatalf("response = %+v", resp)
	}
	if auth != "Bearer sk-test" {
		t.Fatalf("auth = %q", auth)
	}
	messages := got["messages"].([]any)
	if system := messages[0].(map[string]any); system["content"] != "rules" {
		t.Fatalf("a text message must send plain content: %v", system)
	}
	parts := messages[1].(map[string]any)["content"].([]any)
	image := parts[1].(map[string]any)
	if image["type"] != "image_url" || image["image_url"].(map[string]any)["url"] != "data:image/jpeg;base64,AAAA" {
		t.Fatalf("image part = %v", image)
	}
	format := got["response_format"].(map[string]any)
	schema := format["json_schema"].(map[string]any)
	if format["type"] != "json_schema" || schema["name"] != "step" || schema["strict"] != true {
		t.Fatalf("response_format = %v", format)
	}
	if got["reasoning"].(map[string]any)["effort"] != "low" || got["usage"].(map[string]any)["include"] != true {
		t.Fatalf("reasoning/usage = %v %v", got["reasoning"], got["usage"])
	}
}

func TestCompleteWithoutReasoningOrSchemaOmitsThem(t *testing.T) {
	var got map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = w.Write([]byte(okBody))
	}))
	defer server.Close()
	_, err := NewOpenRouter("k", "m", server.URL, "").Complete(context.Background(), Request{Messages: []Message{{Role: RoleUser, Text: "hi"}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := got["reasoning"]; ok {
		t.Fatal("reasoning was sent")
	}
	if _, ok := got["response_format"]; ok {
		t.Fatal("response_format was sent")
	}
}

func TestCompleteRetriesARateLimitAndSumsUsage(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"message":"slow down"},"usage":{"prompt_tokens":50,"completion_tokens":0}}`))
			return
		}
		_, _ = w.Write([]byte(okBody))
	}))
	defer server.Close()
	resp, err := NewOpenRouter("k", "m", server.URL, "").Complete(context.Background(), Request{Messages: []Message{{Role: RoleUser, Text: "hi"}}})
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 || resp.Usage.InputTokens != 170 {
		t.Fatalf("calls=%d usage=%+v", calls.Load(), resp.Usage)
	}
}

func TestCompleteDoesNotRetryABadRequestAndNamesIt(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusPaymentRequired)
		_, _ = w.Write([]byte(`{"error":{"message":"insufficient credits"}}`))
	}))
	defer server.Close()
	_, err := NewOpenRouter("k", "m", server.URL, "").Complete(context.Background(), Request{Messages: []Message{{Role: RoleUser, Text: "hi"}}})
	var status *StatusError
	if !errors.As(err, &status) || status.Status != 402 || calls.Load() != 1 {
		t.Fatalf("err=%v calls=%d", err, calls.Load())
	}
	if Code(err) != CodeNoCredits || !strings.Contains(err.Error(), "insufficient credits") {
		t.Fatalf("code=%q err=%v", Code(err), err)
	}
}

func TestCompleteWithoutAKey(t *testing.T) {
	_, err := NewOpenRouter(" ", "m", "http://unused", "").Complete(context.Background(), Request{})
	if !errors.Is(err, ErrNoKey) || Code(err) != CodeNoKey {
		t.Fatalf("err=%v", err)
	}
}

func TestCodeNamesEachFailure(t *testing.T) {
	cases := map[string]error{
		CodeInvalidKey:  &StatusError{Status: 401},
		CodeRateLimited: &StatusError{Status: 429},
		CodeBadRequest:  &StatusError{Status: 400},
		CodeModelError:  &StatusError{Status: 503},
		CodeCancelled:   context.Canceled,
		CodeNetwork:     errors.New("connection reset"),
	}
	for want, err := range cases {
		if got := Code(err); got != want {
			t.Errorf("Code(%v) = %q, want %q", err, got, want)
		}
	}
	if Code(nil) != "" {
		t.Error("Code(nil) is not empty")
	}
}

func TestCompleteReadsCachedTokens(t *testing.T) {
	body := `{"model":"m","choices":[{"message":{"content":"{}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1000,"completion_tokens":10,"cost":0.0001,"prompt_tokens_details":{"cached_tokens":640,"cache_write_tokens":128}}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()
	resp, err := NewOpenRouter("k", "m", server.URL, "").Complete(context.Background(), Request{Messages: []Message{{Role: RoleUser, Text: "hi"}}})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Usage.CachedTokens != 640 || resp.Usage.CacheWriteTokens != 128 {
		t.Fatalf("usage = %+v", resp.Usage)
	}
}

func TestCompleteTimesEachRequest(t *testing.T) {
	const providerWait = 60 * time.Millisecond
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(providerWait)
		_, _ = w.Write([]byte(`{"id":"gen-1","provider":"Acme","model":"m","choices":[{"message":{"content":"{}"},"finish_reason":"stop"}],"usage":{}}`))
	}))
	defer server.Close()

	client := NewOpenRouter("sk-test", "m", server.URL, "")
	resp, err := client.Complete(context.Background(), Request{Messages: []Message{{Role: RoleUser, Text: "look"}}})
	if err != nil {
		t.Fatal(err)
	}
	if resp.StartedAt.IsZero() || len(resp.Requests) != 1 {
		t.Fatalf("a call must say when it began and time its request: %+v", resp)
	}
	request := resp.Requests[0]
	if request.WaitMs < providerWait.Milliseconds()-5 || request.TotalMs < request.WaitMs {
		t.Fatalf("the provider's wait must be its own figure: %+v", request)
	}
	if request.Provider != "Acme" || request.GenerationID != "gen-1" || request.Status != 200 || request.RequestBytes == 0 || request.ResponseBytes == 0 {
		t.Fatalf("request = %+v", request)
	}
}

func TestCompleteTimesTheRetryDelay(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(okBody))
	}))
	defer server.Close()

	client := NewOpenRouter("sk-test", "m", server.URL, "")
	resp, err := client.Complete(context.Background(), Request{Messages: []Message{{Role: RoleUser, Text: "look"}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Requests) != 2 || resp.Requests[0].Status != 503 || resp.Requests[1].Status != 200 || resp.Requests[1].BackoffMs <= 0 {
		t.Fatalf("the second request must carry the wait before it: %+v", resp.Requests)
	}
}
