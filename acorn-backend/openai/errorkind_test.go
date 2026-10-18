package openai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestClassifyError(t *testing.T) {
	parseErr := fmt.Errorf("read model response: %w", json.Unmarshal([]byte("{"), &map[string]any{}))
	cases := []struct {
		name   string
		err    error
		status int
		want   string
	}{
		{"nil", nil, 200, ""},
		{"cancelled", fmt.Errorf("post: %w", context.Canceled), 0, ErrorKindCancelled},
		{"deadline", context.DeadlineExceeded, 0, ErrorKindTimeout},
		{"no key", ErrMissingOpenRouterKey, 0, ErrorKindNoAPIKey},
		{"empty", ErrEmptyResponse, 200, ErrorKindEmptyResponse},
		{"parse", parseErr, 200, ErrorKindParse},
		{"rate limited", errors.New("x"), 429, ErrorKindRateLimited},
		{"auth", errors.New("x"), 401, ErrorKindAuth},
		{"bad request", errors.New("x"), 400, ErrorKindBadRequest},
		{"provider", errors.New("x"), 502, ErrorKindProvider},
		{"gateway timeout", errors.New("x"), 504, ErrorKindTimeout},
		{"network", errors.New("dial"), 0, ErrorKindNetwork},
	}
	for _, tc := range cases {
		if got := ClassifyError(tc.err, tc.status); got != tc.want {
			t.Errorf("%s: ClassifyError = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func recordInto(got *[]Usage) context.Context {
	return WithRecorder(context.Background(), func(u Usage) { *got = append(*got, u) })
}

func TestJSONSumsEveryAttemptAndNotesOnce(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"usage":{"prompt_tokens":10,"completion_tokens":0,"cost":0.001}}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"cost":0.002}}`))
	}))
	t.Cleanup(server.Close)
	var got []Usage
	if _, err := New("key", "m", server.URL).JSON(recordInto(&got), "s", "u", json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("noted %d calls, want 1", len(got))
	}
	u := got[0]
	if u.Attempts != 2 || u.PromptTokens != 20 || u.CompletionTokens != 5 || u.CostNanos != 3_000_000 {
		t.Fatalf("usage = %+v", u)
	}
	if u.Error != "" || u.ErrorKind != "" || u.HTTPStatus != 200 || u.FinishReason != "stop" {
		t.Fatalf("outcome = %+v", u)
	}
}

func TestJSONNotesNonRetryableFailureKind(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"bad key"}}`))
	}))
	t.Cleanup(server.Close)
	var got []Usage
	if _, err := New("key", "m", server.URL).JSON(recordInto(&got), "s", "u", json.RawMessage(`{}`)); err == nil {
		t.Fatal("want error")
	}
	if len(got) != 1 || got[0].ErrorKind != ErrorKindAuth || got[0].Attempts != 1 || got[0].HTTPStatus != 401 {
		t.Fatalf("usage = %+v", got)
	}
}

func TestJSONWithoutKeyNotesTheFailure(t *testing.T) {
	var got []Usage
	if _, err := OpenRouter("").JSON(recordInto(&got), "s", "u", json.RawMessage(`{}`)); !errors.Is(err, ErrMissingOpenRouterKey) {
		t.Fatalf("err = %v", err)
	}
	if len(got) != 1 || got[0].ErrorKind != ErrorKindNoAPIKey || got[0].Attempts != 0 {
		t.Fatalf("usage = %+v", got)
	}
}

func TestNoteCarriesTheStepName(t *testing.T) {
	var got []Usage
	Note(WithCall(recordInto(&got), "analyze"), Usage{Model: "m"})
	if len(got) != 1 || got[0].Step != "analyze" {
		t.Fatalf("usage = %+v", got)
	}
}
