package acornapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/sid0709/OpenSeat/acorn-backend/debugtrace"
)

// analyzeDebug is what a debug build of the extension attaches to Analyze.
// It is ignored unless this server runs with debug capture on.
type analyzeDebug struct {
	HTML     string          `json:"html"`
	DomTree  json.RawMessage `json:"domTree"`
	MetaTree string          `json:"metaTree"`
}

// traceContext attaches the user's current debug run, so model calls land in it.
func (s *Server) traceContext(r *http.Request, userID string) context.Context {
	if s.debug == nil {
		return r.Context()
	}
	return debugtrace.WithRun(r.Context(), s.debug.Latest(userID))
}

// startAnalyzeRun opens a run for this Analyze and saves what the planner is given.
func (s *Server) startAnalyzeRun(r *http.Request, userID, applicant, pureTree string, page map[string]any, debug *analyzeDebug) context.Context {
	if s.debug == nil {
		return r.Context()
	}
	run := s.debug.StartRun(userID, pageLabel(page))
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
	return debugtrace.WithRun(r.Context(), run)
}

// finishAnalyzeRun saves the plan the extension receives, or why there is none.
// recordFieldIssues saves what Refill read from the page next to its plan.
func recordFieldIssues(ctx context.Context, scan any) {
	debugtrace.RunFrom(ctx).WriteJSON("field-issues.json", scan)
}

func finishAnalyzeRun(ctx context.Context, result any, err error) {
	run := debugtrace.RunFrom(ctx)
	if err != nil {
		run.WriteFile("analyze-error.txt", []byte(err.Error()))
		return
	}
	run.WriteJSON("plan.json", result)
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
	s.debug.Latest(session.User.ID).AppendSteps(body.Entries)
	w.WriteHeader(http.StatusNoContent)
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
