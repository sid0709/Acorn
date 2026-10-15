package acornapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/sid0709/OpenSeat/acorn-backend/acorn"
	"github.com/sid0709/OpenSeat/backend-core/openai"
)

func TestModelErrorCodeTellsApartWhatThePersonCanFix(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"no key", openai.ErrMissingOpenRouterKey, CodeNoKey},
		{"no credits", &openai.StatusError{Status: 402, Text: "model request failed: insufficient credits"}, CodeNoCredits},
		{"rejected key", &openai.StatusError{Status: 401, Text: "model request failed: bad key"}, CodeInvalidKey},
		{"forbidden", &openai.StatusError{Status: 403, Text: "model request failed (403)"}, CodeInvalidKey},
		{"rate limited", &openai.StatusError{Status: 429, Text: "model request failed (429)"}, CodeRateLimited},
		{"provider down", &openai.StatusError{Status: 503, Text: "model request failed (503)"}, CodeProviderDown},
		{"wrapped", fmt.Errorf("plan: %w", &openai.StatusError{Status: 402, Text: "x"}), CodeNoCredits},
		{"timeout", context.DeadlineExceeded, CodeModelTimeout},
		{"model not configured", acorn.ErrModelUnavailable, CodeModelUnavailable},
		{"nothing to say", errors.New("something else"), ""},
	}
	for _, c := range cases {
		if got := modelErrorCode(c.err); got != c.want {
			t.Errorf("%s: code = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestACodedFailureCarriesItsCodeAndStatus(t *testing.T) {
	rec := httptest.NewRecorder()
	writeAcornError(rec, "/acorn/ai-analyze", &openai.StatusError{Status: 402, Text: "out of credits"})
	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want 402", rec.Code)
	}
	if body := rec.Body.String(); !contains(body, `"code":"openrouter_no_credits"`) {
		t.Fatalf("body = %s, want the no-credits code", body)
	}
	body := errorBody(&openai.StatusError{Status: 429, Text: "slow down"})
	if body["code"] != CodeRateLimited || body["ok"] != false {
		t.Fatalf("errorBody = %v", body)
	}
	if _, has := errorBody(errors.New("plain"))["code"]; has {
		t.Fatalf("an error with nothing to act on must carry no code")
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
