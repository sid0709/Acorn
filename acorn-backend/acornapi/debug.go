package acornapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/sid0709/OpenSeat/acorn-backend/debugtrace"
)

// debugShotMaxBytes is a JPEG small enough that its base64 form fits maxBody.
const debugShotMaxBytes = 4 << 20

// debugKey names whose debug run a request belongs to: the user, and the Chrome
// tab it came from, so runs going on in several tabs each keep their own folder.
func debugKey(r *http.Request, userID string) string {
	if tab := tabKey(r.Header.Get(tabHeader)); tab != "" {
		return userID + "/" + tab
	}
	return userID
}

// traceContext attaches the current debug run of the request's tab, so model calls land in it.
func (s *Server) traceContext(r *http.Request, userID string) context.Context {
	ctx := s.withUsage(r, userID)
	if s.debug == nil {
		return ctx
	}
	return debugtrace.WithRun(ctx, s.debug.Latest(debugKey(r, userID)))
}

// debugLog appends the extension's step trace to the user's current run.
func (s *Server) debugLog(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		Entries []json.RawMessage `json:"entries"`
	}
	if !decode(w, r, &body) {
		return
	}
	s.debug.Latest(debugKey(r, session.User.ID)).AppendSteps(body.Entries)
	w.WriteHeader(http.StatusNoContent)
}

// debugShot stores one JPEG in the user's current run and notes the file in steps.ndjson.
func (s *Server) debugShot(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		Image string `json:"image"`
		Label string `json:"label"`
	}
	if !decode(w, r, &body) {
		return
	}
	raw, err := base64.StdEncoding.DecodeString(body.Image)
	if err != nil || !jpeg(raw) {
		writeError(w, http.StatusBadRequest, "screenshot must be a JPEG")
		return
	}
	run := s.debug.Latest(debugKey(r, session.User.ID))
	if run == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	file := run.WriteFile(shotFileName(body.Label), raw)
	if file == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	line, err := json.Marshal(map[string]any{
		"t":     time.Now().UnixMilli(),
		"from":  "background",
		"event": "screen",
		"data":  map[string]string{"file": file, "label": strings.TrimSpace(body.Label)},
	})
	if err == nil {
		run.AppendSteps([]json.RawMessage{line})
	}
	w.WriteHeader(http.StatusNoContent)
}

func jpeg(raw []byte) bool {
	return len(raw) >= 3 && len(raw) <= debugShotMaxBytes && raw[0] == 0xff && raw[1] == 0xd8 && raw[2] == 0xff
}

// shotFileName turns a step label into a filename the run folder can list, like screen-fill-done.jpg.
func shotFileName(label string) string { return captureFileName("screen", label, ".jpg") }

// captureFileName joins a prefix and a step label into a short, safe filename.
func captureFileName(prefix, label, ext string) string {
	var b strings.Builder
	b.WriteString(prefix)
	lastDash := true
	for _, r := range strings.ToLower(strings.TrimSpace(label)) {
		if b.Len() >= 48 {
			break
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	name := strings.Trim(b.String(), "-")
	if name == "" {
		name = prefix
	}
	return name + ext
}
