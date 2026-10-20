package httpkit

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func parseLogLine(t *testing.T, raw string) map[string]any {
	t.Helper()
	raw = strings.TrimSpace(raw)
	if raw == "" {
		t.Fatal("no log output")
	}
	lines := strings.Split(raw, "\n")
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want 1:\n%s", len(lines), raw)
	}
	var entry map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &entry); err != nil {
		t.Fatalf("failed to parse log JSON: %v", err)
	}
	return entry
}

func TestWrapLogging(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))

	handler := Wrap(logger, nil, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("got status %d, want %d", rec.Code, http.StatusOK)
	}
	if rec.Header().Get(RequestIDHeader) == "" {
		t.Error("X-Request-ID header not set")
	}

	entry := parseLogLine(t, buf.String())
	if msg, _ := entry["msg"].(string); !strings.HasPrefix(msg, "GET /test answered 200 in ") {
		t.Errorf("got line %q, want a sentence about GET /test answering 200", msg)
	}
}

func TestWrapReuseRequestID(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))
	existingID := "test-request-id-123"

	handler := Wrap(logger, nil, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set(RequestIDHeader, existingID)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get(RequestIDHeader); got != existingID {
		t.Errorf("got X-Request-ID header %q, want %q", got, existingID)
	}
	entry := parseLogLine(t, buf.String())
	if entry["request_id"] != existingID {
		t.Errorf("got request_id %v, want %q", entry["request_id"], existingID)
	}
}

func TestSetUserID(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))
	userID := "user-123"

	handler := Wrap(logger, nil, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		SetUserID(r.Context(), userID)
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	entry := parseLogLine(t, buf.String())
	if msg, _ := entry["msg"].(string); !strings.Contains(msg, " for user-1") {
		t.Errorf("got line %q, want it to say whom the request was for", msg)
	}
}

func TestWrapHandlerNeverWritesIsLogged200(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))

	handler := Wrap(logger, nil, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("got status %d, want %d", rec.Code, http.StatusOK)
	}
	entry := parseLogLine(t, buf.String())
	if msg, _ := entry["msg"].(string); !strings.Contains(msg, "answered 200") {
		t.Errorf("got line %q, want a 200", msg)
	}
}

func TestGenerateRequestID(t *testing.T) {
	id := generateRequestID()
	if len(id) != 16 {
		t.Errorf("got request ID length %d, want 16", len(id))
	}
	for _, c := range id {
		if !strings.ContainsRune("0123456789abcdef", c) {
			t.Errorf("request ID %q contains non-hex character %q", id, c)
		}
	}
	if id == generateRequestID() {
		t.Error("two generated request IDs are the same")
	}
}

func TestTurnedAwayAndFailedRequestsSayWhyAndAreNotInfo(t *testing.T) {
	for status, level := range map[int]string{http.StatusUnauthorized: "WARN", http.StatusBadGateway: "ERROR"} {
		var buf bytes.Buffer
		logger := slog.New(slog.NewJSONHandler(&buf, nil))
		handler := Wrap(logger, nil, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			WriteError(w, status, "no way in")
		}))
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/acorn/auth/me", nil))
		entry := parseLogLine(t, buf.String())
		if entry["level"] != level || entry["error"] != "no way in" || entry["request_id"] == nil {
			t.Errorf("status %d: got %v", status, entry)
		}
	}
}

func TestQuietRequestsAreOnlyLoggedForDebugging(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))
	handler := Wrap(logger, nil, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	for _, path := range []string{"/health", "/acorn/socket.io/?EIO=4"} {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, path, nil))
	}
	if buf.Len() != 0 {
		t.Fatalf("quiet requests were logged: %s", buf.String())
	}
}
