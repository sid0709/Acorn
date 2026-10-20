// Package httpapi serves the agent to the extension: open a run, send a screenshot and
// get actions back, fetch the résumé file to upload, end the run. Handlers parse and
// respond; the work is in package agent.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/sid0709/acorn/acorn-agent/agent"
	"github.com/sid0709/acorn/acorn-agent/applicant"
	"github.com/sid0709/acorn/acorn-agent/llm"
	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

const (
	// KeyHeader carries the person's OpenRouter key when the extension has one; without it
	// the server's own key is used.
	KeyHeader = "X-OpenRouter-Key"
	// HandlerMsHeader is how long the server spent on a request (milliseconds, from the request's
	// headers arriving to the answer's first byte), and ServerTimeHeader the server's clock then
	// (unix milliseconds). The extension reads both to split a call's time into the server's and
	// the network's.
	HandlerMsHeader  = "X-Agent-Handler-Ms"
	ServerTimeHeader = "X-Agent-Server-Time"
	// BasePath prefixes every route.
	BasePath = "/agent/v1"
	// maxBodyBytes bounds one request: a screenshot as base64 plus a little JSON.
	maxBodyBytes = 16 << 20
	// extensionScheme is the origin scheme of a browser extension.
	extensionScheme = "chrome-extension://"
	// stepTimeout bounds one step: a model call, its retries and the repair.
	stepTimeout = 5 * time.Minute
	// vetTimeout bounds one check of a control or window: a click waits for it.
	vetTimeout = 20 * time.Second
	// locateTimeout bounds finding a target again on a screenshot: an action waits for it.
	locateTimeout = 10 * time.Second
)

// Options configure the server.
type Options struct {
	// DefaultKey is the OpenRouter key used when a request brings none.
	DefaultKey string
	// Origins are the web origins allowed to call the server besides browser extensions.
	Origins []string
	// ModelName is reported by the health route.
	ModelName string
	// Source is where the applicant is read from ("files" or "backend"), reported by the health route.
	Source string
	// MaxModelCalls bounds the steps being worked on at once; 0 means no bound.
	MaxModelCalls int
}

// Server is the HTTP front of the agent.
type Server struct {
	agent *agent.Agent
	opts  Options
	slots chan struct{}
}

// New is a server over the agent.
func New(a *agent.Agent, opts Options) *Server {
	s := &Server{agent: a, opts: opts}
	if opts.MaxModelCalls > 0 {
		s.slots = make(chan struct{}, opts.MaxModelCalls)
	}
	return s
}

// Handler is the server's routes with cross-origin handling and request logging.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+BasePath+"/health", s.health)
	mux.HandleFunc("POST "+BasePath+"/sessions", s.start)
	mux.HandleFunc("POST "+BasePath+"/sessions/{id}/step", s.step)
	mux.HandleFunc("POST "+BasePath+"/sessions/{id}/continue", s.continueRun)
	mux.HandleFunc("GET "+BasePath+"/sessions/{id}/memory", s.memory)
	mux.HandleFunc("POST "+BasePath+"/sessions/{id}/vet", s.vet)
	mux.HandleFunc("POST "+BasePath+"/sessions/{id}/locate", s.locate)
	mux.HandleFunc("POST "+BasePath+"/sessions/{id}/shots", s.shots)
	mux.HandleFunc("GET "+BasePath+"/sessions/{id}/resume", s.resume)
	mux.HandleFunc("DELETE "+BasePath+"/sessions/{id}", s.end)
	return s.cors(logged(mux))
}

// Response is every error body: the raw message and a code that stays the same.
type errorBody struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "model": s.opts.ModelName, "sessions": s.agent.Sessions(), "hasKey": s.opts.DefaultKey != "",
		"source": s.opts.Source,
	})
}

func (s *Server) start(w http.ResponseWriter, r *http.Request) {
	var start agent.Start
	if !decode(w, r, &start) {
		return
	}
	ctx, timing := applicant.WithTiming(r.Context())
	started, err := s.agent.Start(ctx, s.key(r), applicant.Auth{Token: bearerToken(r)}, start)
	setServerTiming(w, timing)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, started)
}

func (s *Server) step(w http.ResponseWriter, r *http.Request) {
	var obs agent.Observation
	if !decode(w, r, &obs) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), stepTimeout)
	defer cancel()
	if !s.acquire(ctx) {
		writeError(w, ctx.Err())
		return
	}
	defer s.release()
	step, err := s.agent.Step(ctx, r.PathValue("id"), obs)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, step)
}

func (s *Server) continueRun(w http.ResponseWriter, r *http.Request) {
	continued, err := s.agent.Continue(r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, continued)
}

func (s *Server) memory(w http.ResponseWriter, r *http.Request) {
	memory, err := s.agent.Memory(r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, memory)
}

func (s *Server) vet(w http.ResponseWriter, r *http.Request) {
	var target agent.VetTarget
	if !decode(w, r, &target) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), vetTimeout)
	defer cancel()
	verdict, err := s.agent.Vet(ctx, r.PathValue("id"), target)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, verdict)
}

func (s *Server) locate(w http.ResponseWriter, r *http.Request) {
	var request agent.LocateRequest
	if !decode(w, r, &request) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), locateTimeout)
	defer cancel()
	found, err := s.agent.Locate(ctx, r.PathValue("id"), request)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, found)
}

func (s *Server) shots(w http.ResponseWriter, r *http.Request) {
	var upload agent.ShotUpload
	if !decode(w, r, &upload) {
		return
	}
	if err := s.agent.ReceiveShot(r.Context(), r.PathValue("id"), upload); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) resume(w http.ResponseWriter, r *http.Request) {
	ctx, timing := applicant.WithTiming(r.Context())
	info, data, err := s.agent.ResumeFile(ctx, r.PathValue("id"), r.URL.Query().Get("id"))
	setServerTiming(w, timing)
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", info.ContentType)
	w.Header().Set("X-File-Name", info.FileName)
	_, _ = w.Write(data)
}

// setServerTiming tells the caller what the backend calls under this request cost.
func setServerTiming(w http.ResponseWriter, timing *applicant.Timing) {
	if value := timing.ServerTiming(); value != "" {
		w.Header().Set(applicant.ServerTimingHeader, value)
	}
}

func (s *Server) end(w http.ResponseWriter, r *http.Request) {
	s.agent.End(r.PathValue("id"))
	w.WriteHeader(http.StatusNoContent)
}

// bearerToken is the person's Acorn session the extension sends with the start of a run.
func bearerToken(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(header) > len("Bearer ") && strings.EqualFold(header[:len("Bearer ")], "Bearer ") {
		return strings.TrimSpace(header[len("Bearer "):])
	}
	return ""
}

func (s *Server) key(r *http.Request) string {
	if key := strings.TrimSpace(r.Header.Get(KeyHeader)); key != "" {
		return key
	}
	return s.opts.DefaultKey
}

// acquire takes a place among the steps being worked on, or reports that the wait was cut short.
func (s *Server) acquire(ctx context.Context) bool {
	if s.slots == nil {
		return true
	}
	select {
	case s.slots <- struct{}{}:
		return true
	case <-ctx.Done():
		return false
	}
}

func (s *Server) release() {
	if s.slots != nil {
		<-s.slots
	}
}

// decode reads the JSON body, bounded. It answers the error itself and reports false.
func decode(w http.ResponseWriter, r *http.Request, into any) bool {
	body := http.MaxBytesReader(w, r.Body, maxBodyBytes)
	defer func() { _, _ = io.Copy(io.Discard, body) }()
	if err := json.NewDecoder(body).Decode(into); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "the request is not valid JSON: " + err.Error(), Code: "bad_json"})
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Warn("Could not finish writing an answer to the extension.", plainlog.ErrorKey, err)
	}
}

// writeError maps a failure to a status and a stable code beside its raw text.
func writeError(w http.ResponseWriter, err error) {
	status, code := http.StatusBadGateway, llm.Code(err)
	switch {
	case errors.Is(err, agent.ErrNoSession):
		status, code = http.StatusNotFound, "no_session"
	case errors.Is(err, agent.ErrSessionOver):
		status, code = http.StatusConflict, "run_over"
	case errors.Is(err, agent.ErrBadObservation):
		status, code = http.StatusBadRequest, "bad_observation"
	case errors.Is(err, applicant.ErrSignedOut):
		status, code = http.StatusUnauthorized, "signed_out"
	case errors.Is(err, applicant.ErrBackend):
		status, code = http.StatusBadGateway, "backend_unreachable"
	case errors.Is(err, applicant.ErrNoProfile):
		status, code = http.StatusUnprocessableEntity, "no_profile"
	case errors.Is(err, agent.ErrFallbackResume):
		status, code = http.StatusUnprocessableEntity, "bad_fallback_resume"
	case errors.Is(err, applicant.ErrNoResume):
		status, code = http.StatusNotFound, "no_resume"
	case code == llm.CodeNoKey || code == llm.CodeInvalidKey:
		status = http.StatusUnauthorized
	case code == llm.CodeNoCredits:
		status = http.StatusPaymentRequired
	case code == llm.CodeRateLimited:
		status = http.StatusTooManyRequests
	case code == llm.CodeCancelled:
		status = http.StatusRequestTimeout
	}
	if code == "" {
		code = "error"
	}
	if status >= http.StatusInternalServerError {
		slog.Error("A request to the agent failed ("+code+").", plainlog.ErrorKey, err)
	}
	writeJSON(w, status, errorBody{Error: err.Error(), Code: code})
}

// cors lets the extension and the configured origins call the server.
func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); s.allowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, "+KeyHeader)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Expose-Headers", strings.Join([]string{"X-File-Name", HandlerMsHeader, ServerTimeHeader, applicant.ServerTimingHeader}, ", "))
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) allowed(origin string) bool {
	if origin == "" {
		return false
	}
	if strings.HasPrefix(origin, extensionScheme) {
		return true
	}
	for _, allowed := range s.opts.Origins {
		if allowed == origin {
			return true
		}
	}
	return false
}

// logged records each request's method, path, status and time, and nothing of its body. It also
// tells the caller how long the server spent (HandlerMsHeader) and what its clock read
// (ServerTimeHeader, unix milliseconds), so a slow call can be split into the server's time and the
// network's, and a skew between the two clocks can be seen.
func logged(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK, started: started}
		next.ServeHTTP(recorder, r)
		slog.Debug(fmt.Sprintf("%s %s answered %d in %s.", r.Method, r.URL.Path, recorder.status, plainlog.Seconds(time.Since(started))))
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status  int
	started time.Time
	sent    bool
}

// stamp writes the timing headers once, before the first byte of the answer.
func (r *statusRecorder) stamp() {
	if r.sent {
		return
	}
	r.sent = true
	now := time.Now()
	r.Header().Set(HandlerMsHeader, strconv.FormatInt(now.Sub(r.started).Milliseconds(), 10))
	r.Header().Set(ServerTimeHeader, strconv.FormatInt(now.UnixMilli(), 10))
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.stamp()
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(data []byte) (int, error) {
	r.stamp()
	return r.ResponseWriter.Write(data)
}
