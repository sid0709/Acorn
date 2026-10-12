package acornapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"

	"github.com/sid0709/OpenSeat/acorn-backend/acorn"
	"github.com/sid0709/OpenSeat/acorn-backend/debugtrace"
)

// debugShotMaxBytes is a JPEG small enough that its base64 form fits maxBody.
const debugShotMaxBytes = 4 << 20

// analyzeDebug is what a debug build of the extension attaches to Analyze.
// It is ignored unless this server runs with debug capture on.
type analyzeDebug struct {
	HTML     string          `json:"html"`
	DomTree  json.RawMessage `json:"domTree"`
	MetaTree string          `json:"metaTree"`
}

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

// startAnalyzeRun opens a run for this Analyze and saves what the planner is given.
func (s *Server) startAnalyzeRun(r *http.Request, userID, applicant, pureTree string, page map[string]any, debug *analyzeDebug) context.Context {
	ctx := s.withUsage(r, userID)
	if s.debug == nil {
		return ctx
	}
	run := s.debug.StartRun(debugKey(r, userID), pageLabel(page))
	run.WriteJSON("page.json", page)
	if debug != nil && debug.HTML != "" {
		run.WriteFile("page.html", []byte(debug.HTML))
	}
	if debug != nil && len(debug.DomTree) > 0 {
		run.WriteFile("dom-tree.json", debug.DomTree)
	}
	if debug != nil && debug.MetaTree != "" {
		run.WriteFile("meta-tree.txt", []byte(debug.MetaTree))
	}
	run.WriteFile("pure-tree.txt", []byte(pureTree))
	run.WriteFile("applicant.txt", []byte(applicant))
	return debugtrace.WithRun(ctx, run)
}

// finishAnalyzeRun saves the plan the extension receives, or why there is none.
// recordFormFields saves the field list the fast planner read next to its plan.
func recordFormFields(ctx context.Context, fields any) {
	debugtrace.RunFrom(ctx).WriteJSON("form-fields.json", fields)
}

// recordFieldIssues saves what Refill read from the page next to its plan.
func recordFieldIssues(ctx context.Context, scan any) {
	debugtrace.RunFrom(ctx).WriteJSON("field-issues.json", scan)
}

func finishAnalyzeRun(ctx context.Context, result acorn.AnalyzeResult, err error) {
	run := debugtrace.RunFrom(ctx)
	if err != nil {
		run.WriteFile("analyze-error.txt", []byte(err.Error()))
		return
	}
	run.WriteJSON("plan.json", acorn.RedactedResult(result))
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

// debugHTML stores one page's HTML (the extension removed every password first)
// in the tab's capture, next to the screenshot of the same moment.
func (s *Server) debugHTML(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		Label   string `json:"label"`
		FrameID int    `json:"frameId"`
		URL     string `json:"url"`
		HTML    string `json:"html"`
	}
	if !decode(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.HTML) == "" {
		writeError(w, http.StatusBadRequest, "html is required")
		return
	}
	run := s.debug.Latest(debugKey(r, session.User.ID))
	file := run.WriteFile(htmlFileName(body.Label, body.FrameID), []byte(body.HTML))
	if file != "" {
		line, err := json.Marshal(map[string]any{
			"t": time.Now().UnixMilli(), "from": "background", "event": "html",
			"data": map[string]any{"file": file, "label": strings.TrimSpace(body.Label), "frameId": body.FrameID, "url": logPage(body.URL)},
		})
		if err == nil {
			run.AppendSteps([]json.RawMessage{line})
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func jpeg(raw []byte) bool {
	return len(raw) >= 3 && len(raw) <= debugShotMaxBytes && raw[0] == 0xff && raw[1] == 0xd8 && raw[2] == 0xff
}

// shotFileName turns a step label into a filename the run folder can list, like screen-fill-done.jpg.
func shotFileName(label string) string { return captureFileName("screen", label, ".jpg") }

// htmlFileName names a captured page, like page-run-end-frame-12.html.
func htmlFileName(label string, frameID int) string {
	if frameID > 0 {
		label = fmt.Sprintf("%s frame %d", label, frameID)
	}
	return captureFileName("page", label, ".html")
}

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

// pageLabel names a run folder after the page host and title.
func pageLabel(page map[string]any) string {
	label := ""
	if raw, ok := page["url"].(string); ok {
		if parsed, err := url.Parse(raw); err == nil {
			label = parsed.Hostname()
		}
	}
	if title, ok := page["title"].(string); ok && title != "" {
		label += " " + title
	}
	return label
}
