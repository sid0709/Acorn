package httpkit

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/backend-core/requestid"
)

const (
	RequestIDHeader = "X-Request-ID"
	errorLogLimit   = 512
)

type contextKey int

const requestRecordKey contextKey = 1

// requestRecord is the mutable per-request bag Logging stores on the context.
type requestRecord struct {
	id       string
	userID   string
	panicErr string
	stack    string
}

func recordFrom(ctx context.Context) *requestRecord {
	rec, _ := ctx.Value(requestRecordKey).(*requestRecord)
	return rec
}

// RequestID returns the request ID from the context, or "" if none is set.
func RequestID(ctx context.Context) string {
	if rec := recordFrom(ctx); rec != nil {
		return rec.id
	}
	return ""
}

// SetUserID records the authenticated user for the request log line.
// Session and role middleware should call this once they resolve the user.
func SetUserID(ctx context.Context, userID string) {
	if rec := recordFrom(ctx); rec != nil {
		rec.userID = userID
	}
}

func generateRequestID() string {
	var bytes [8]byte
	_, _ = rand.Read(bytes[:])
	return hex.EncodeToString(bytes[:])
}

// Wrap orders Recovery inside Logging so a panic still has a request id and
// produces one structured log line. All service mains should call this.
func Wrap(logger *slog.Logger, reporter ErrorReporter, next http.Handler) http.Handler {
	return Logging(logger, Recovery(reporter, next))
}

// Logging assigns a request id, captures status and latency, and writes one
// structured JSON line. Recovery must sit inside it so panics still log.
func Logging(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		requestID := r.Header.Get(RequestIDHeader)
		if requestID == "" {
			requestID = generateRequestID()
		}
		rec := &requestRecord{id: requestID}
		ctx := requestid.With(context.WithValue(r.Context(), requestRecordKey, rec), requestID)
		r = r.WithContext(ctx)
		w.Header().Set(RequestIDHeader, requestID)

		wrapped := &responseWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(wrapped, r)

		status := wrapped.status
		if rec.panicErr != "" {
			status = http.StatusInternalServerError
		}
		attrs := []any{
			"request_id", requestID,
			"method", r.Method,
			"path", r.URL.RequestURI(),
			"status", status,
			"latency_ms", time.Since(start).Milliseconds(),
		}
		if rec.userID != "" {
			attrs = append(attrs, "user_id", rec.userID)
		}
		if detail := errorDetail(wrapped.errBody.String()); status >= 400 && detail != "" {
			attrs = append(attrs, "error", detail)
		}
		if rec.panicErr != "" {
			attrs = append(attrs, "error", rec.panicErr, "stack", rec.stack)
			logger.Error("request", attrs...)
			return
		}
		if status >= 400 {
			logger.Warn("request", attrs...)
			return
		}
		logger.Info("request", attrs...)
	})
}

func errorDetail(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	var body struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if json.Unmarshal([]byte(raw), &body) == nil {
		if text := strings.TrimSpace(body.Error); text != "" {
			return clipLog(text)
		}
		if text := strings.TrimSpace(body.Message); text != "" {
			return clipLog(text)
		}
	}
	return clipLog(raw)
}

func clipLog(text string) string {
	if len(text) <= errorLogLimit {
		return text
	}
	return text[:errorLogLimit] + "…"
}

type responseWriter struct {
	http.ResponseWriter
	status  int
	wrote   bool
	errBody bytes.Buffer
}

func (w *responseWriter) WriteHeader(status int) {
	if !w.wrote {
		w.status = status
		w.wrote = true
		w.ResponseWriter.WriteHeader(status)
	}
}

func (w *responseWriter) Write(b []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	if w.status >= 400 && w.errBody.Len() < errorLogLimit {
		remain := errorLogLimit - w.errBody.Len()
		chunk := b
		if len(chunk) > remain {
			chunk = chunk[:remain]
		}
		_, _ = w.errBody.Write(chunk)
	}
	return w.ResponseWriter.Write(b)
}

func (w *responseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func (w *responseWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errNoHijacker
	}
	return h.Hijack()
}

var errNoHijacker = errors.New("httpkit: ResponseWriter does not implement http.Hijacker")
