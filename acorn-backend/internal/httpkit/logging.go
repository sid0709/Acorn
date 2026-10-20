package httpkit

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/sid0709/acorn/acorn-backend/plainlog"
	"github.com/sid0709/acorn/acorn-backend/requestid"
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
// produces one log line. All service mains should call this.
func Wrap(logger *slog.Logger, reporter ErrorReporter, next http.Handler) http.Handler {
	return Logging(logger, Recovery(reporter, next))
}

// Logging assigns a request id, captures status and latency, and writes one
// sentence. Recovery must sit inside it so panics still log.
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
		took := time.Since(start)
		who := ""
		if rec.userID != "" {
			who = " for " + plainlog.Short(rec.userID)
		}
		path := r.URL.Path
		detail := errorDetail(wrapped.errBody.String())
		switch {
		case rec.panicErr != "":
			logger.Error(fmt.Sprintf("%s %s crashed after %s%s: %s", r.Method, path, plainlog.Seconds(took), who, rec.panicErr),
				"request_id", requestID, plainlog.StackKey, rec.stack)
		case status >= http.StatusInternalServerError:
			logger.Error(fmt.Sprintf("%s %s failed with %d after %s%s", r.Method, path, status, plainlog.Seconds(took), who),
				"request_id", requestID, plainlog.ErrorKey, detail)
		case status >= http.StatusBadRequest:
			logger.Warn(fmt.Sprintf("%s %s was turned away with %d after %s%s", r.Method, path, status, plainlog.Seconds(took), who),
				"request_id", requestID, plainlog.ErrorKey, detail)
		case isQuiet(path):
			logger.Debug(fmt.Sprintf("%s %s answered %d in %s%s", r.Method, path, status, plainlog.Seconds(took), who))
		case took >= slowRequest:
			logger.Info(fmt.Sprintf("%s %s answered %d in %s%s, which is slow", r.Method, path, status, plainlog.Seconds(took), who))
		default:
			logger.Info(fmt.Sprintf("%s %s answered %d in %s%s", r.Method, path, status, plainlog.Seconds(took), who))
		}
	})
}

// slowRequest is how long a request may take before its line says it was slow.
const slowRequest = 2 * time.Second

// quietPaths are requests that happen all the time and say nothing new (the extension's socket
// reconnecting, the deploy's health check): their lines are kept for debugging only.
var quietPaths = []string{"/health", "/acorn/socket.io/"}

func isQuiet(path string) bool {
	for _, quiet := range quietPaths {
		if strings.HasPrefix(path, quiet) {
			return true
		}
	}
	return false
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
