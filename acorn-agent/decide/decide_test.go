package decide

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/sid0709/OpenSeat/acorn-agent/llm"
)

const okBody = `{"model":"m-20261006","answers":{"matches":{"type":"noul","noul":0.93}},"usage":{"input_tokens":1109,"output_tokens":0,"cost":0.000111}}`

func TestDecideSendsTheStateAsPartsAndReadsTheAnswer(t *testing.T) {
	var got map[string]any
	var auth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = w.Write([]byte(okBody))
	}))
	defer server.Close()

	res, err := New("sk-test", "openai/gpt-6-luna-decisions", server.URL).Decide(context.Background(), Request{
		State:     []Part{Text("the page"), Image("data:image/jpeg;base64,AAAA")},
		Questions: map[string]Question{"matches": YesNo("does it match")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer sk-test" || got["model"] != "openai/gpt-6-luna-decisions" {
		t.Fatalf("auth=%q body=%v", auth, got)
	}
	parts := got["state"].([]any)
	image := parts[1].(map[string]any)
	if parts[0].(map[string]any)["type"] != "text" || image["type"] != "image_url" ||
		image["image_url"].(map[string]any)["url"] != "data:image/jpeg;base64,AAAA" {
		t.Fatalf("state = %v", parts)
	}
	question := got["questions"].(map[string]any)["matches"].(map[string]any)
	if question["type"] != "noul" || question["criteria"].(map[string]any)["true"] == nil {
		t.Fatalf("question = %v", question)
	}
	if answer := res.Answers["matches"]; answer.Noul == nil || *answer.Noul != 0.93 {
		t.Fatalf("answer = %+v", answer)
	}
	if res.Usage.InputTokens != 1109 || res.Usage.Cost != 0.000111 || res.Model != "m-20261006" || res.Latency <= 0 {
		t.Fatalf("response = %+v", res)
	}
}

func TestDecideNeedsAKey(t *testing.T) {
	_, err := New(" ", "m", "http://unused").Decide(context.Background(), Request{})
	if !errors.Is(err, llm.ErrNoKey) {
		t.Fatalf("err = %v", err)
	}
}

func TestDecideRetriesAProviderFailureOnce(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"error":{"message":"OpenAI refused to answer question \"matches\"","code":502}}`))
			return
		}
		_, _ = w.Write([]byte(okBody))
	}))
	defer server.Close()
	if _, err := New("k", "m", server.URL).Decide(context.Background(), Request{}); err != nil || calls.Load() != 2 {
		t.Fatalf("err=%v calls=%d", err, calls.Load())
	}
}

func TestDecideDoesNotRetryAnOutOfCreditsAnswer(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusPaymentRequired)
		_, _ = w.Write([]byte(`{"error":{"message":"no credits"}}`))
	}))
	defer server.Close()
	_, err := New("k", "m", server.URL).Decide(context.Background(), Request{})
	var status *llm.StatusError
	if !errors.As(err, &status) || status.Status != 402 || calls.Load() != 1 {
		t.Fatalf("err=%v calls=%d", err, calls.Load())
	}
	if llm.Code(err) != llm.CodeNoCredits {
		t.Fatalf("code = %q", llm.Code(err))
	}
}
