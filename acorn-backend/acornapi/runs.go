package acornapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/sid0709/acorn/acorn-backend/runs"
)

// runRow is a Run that sent an application, as the extension and the website read it.
type runRow struct {
	ID           string `json:"id"`
	RunID        string `json:"runId"`
	URL          string `json:"url"`
	Title        string `json:"title"`
	Day          string `json:"day"`
	Minute       int    `json:"minute"`
	EndedAt      int64  `json:"endedAt"`
	DurationMs   int64  `json:"durationMs"`
	CostNanos    int64  `json:"costNanos"`
	Steps        int    `json:"steps"`
	ModelCalls   int    `json:"modelCalls"`
	ScreenChecks int    `json:"screenChecks"`
}

func newRunRow(entry runs.Entry) runRow {
	return runRow{
		ID: entry.ID, RunID: entry.RunID, URL: entry.URL, Title: entry.Title,
		Day: entry.Day, Minute: entry.Minute, EndedAt: entry.EndedAt.UnixMilli(),
		DurationMs: entry.DurationMs, CostNanos: entry.CostNanos,
		Steps: entry.Steps, ModelCalls: entry.ModelCalls, ScreenChecks: entry.ScreenChecks,
	}
}

// recordRun keeps a Run that ended with the application sent. The extension sends it once per
// record and again if the answer was lost; the second send is answered 200 and not counted.
func (s *Server) recordRun(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var in runs.Record
	if !decode(w, r, &in) {
		return
	}
	_, version := clientFrom(r.Header.Get(clientHeader))
	created, err := s.runs.Record(r.Context(), session.User.ID, in, version)
	if errors.Is(err, runs.ErrInvalid) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		slog.Error("acorn run not recorded", "error", err, "account", session.User.ID)
		writeError(w, http.StatusInternalServerError, "could not record the run")
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, map[string]any{"success": true, "recorded": created})
}

// listRuns is the account's newest Runs that sent an application.
func (s *Server) listRuns(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	entries, err := s.runs.Recent(r.Context(), session.User.ID, limit)
	if err != nil {
		slog.Error("acorn runs", "error", err, "account", session.User.ID)
		writeError(w, http.StatusInternalServerError, "could not load the runs")
		return
	}
	rows := make([]runRow, 0, len(entries))
	for _, entry := range entries {
		rows = append(rows, newRunRow(entry))
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "runs": rows})
}

// dailyRuns is how many Runs sent an application each day from..to, with the time they took and
// what they cost. Days with none are left out; the page fills them in.
func (s *Server) dailyRuns(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	days, err := s.runs.Daily(r.Context(), session.User.ID, query.Get("from"), query.Get("to"))
	if errors.Is(err, runs.ErrInvalid) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		slog.Error("acorn runs by day", "error", err, "account", session.User.ID)
		writeError(w, http.StatusInternalServerError, "could not load the days")
		return
	}
	if days == nil {
		days = []runs.Day{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "days": days})
}
