package acornapi

import (
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"time"

	"github.com/sid0709/acorn/acorn-backend/config"
	"github.com/sid0709/acorn/acorn-backend/runs"
)

const (
	jpegContentType = "image/jpeg"
	// screenshotCacheControl lets the browser keep an image for a day; it is private to the account.
	screenshotCacheControl = "private, max-age=86400"
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
	// ScreenshotAt is when the full-page image was stored (ms since epoch); 0 without one, or
	// once it is older than config.RunScreenshotRetention.
	ScreenshotAt int64 `json:"screenshotAt"`
}

func newRunRow(entry runs.Entry, now time.Time) runRow {
	var screenshotAt int64
	if !entry.ScreenshotAt.IsZero() && now.Sub(entry.ScreenshotAt) < config.RunScreenshotRetention {
		screenshotAt = entry.ScreenshotAt.UnixMilli()
	}
	return runRow{
		ID: entry.ID, RunID: entry.RunID, URL: entry.URL, Title: entry.Title,
		Day: entry.Day, Minute: entry.Minute, EndedAt: entry.EndedAt.UnixMilli(),
		DurationMs: entry.DurationMs, CostNanos: entry.CostNanos,
		Steps: entry.Steps, ModelCalls: entry.ModelCalls, ScreenChecks: entry.ScreenChecks,
		ScreenshotAt: screenshotAt,
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
	id, created, err := s.runs.Record(r.Context(), session.User.ID, in, version)
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
	writeJSON(w, status, map[string]any{"success": true, "recorded": created, "id": id})
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
		rows = append(rows, newRunRow(entry, time.Now()))
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

// putRunScreenshot keeps the full-page JPEG of one of the account's Runs, replacing an earlier one.
//
//	PUT /acorn/runs/{id}/screenshot   Content-Type: image/jpeg, body = the file
func (s *Server) putRunScreenshot(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	if mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mediaType != jpegContentType {
		writeError(w, http.StatusUnsupportedMediaType, "the screenshot must be a JPEG")
		return
	}
	body := http.MaxBytesReader(w, r.Body, config.MaxRunScreenshotBytes)
	data, err := io.ReadAll(body)
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeError(w, http.StatusRequestEntityTooLarge, runs.ErrTooLarge.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read the screenshot")
		return
	}
	err = s.runs.SetScreenshot(r.Context(), session.User.ID, r.PathValue("id"), data)
	switch {
	case errors.Is(err, runs.ErrNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, runs.ErrTooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, err.Error())
	case errors.Is(err, runs.ErrNotJPEG):
		writeError(w, http.StatusUnsupportedMediaType, err.Error())
	case err != nil:
		slog.Error("acorn run screenshot not stored", "error", err, "account", session.User.ID)
		writeError(w, http.StatusInternalServerError, "could not store the screenshot")
	default:
		writeJSON(w, http.StatusOK, map[string]any{"success": true})
	}
}

// getRunScreenshot is the full-page JPEG of one of the account's Runs.
//
//	GET /acorn/runs/{id}/screenshot
func (s *Server) getRunScreenshot(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	data, err := s.runs.Screenshot(r.Context(), session.User.ID, r.PathValue("id"))
	if errors.Is(err, runs.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no screenshot for this run")
		return
	}
	if err != nil {
		slog.Error("acorn run screenshot", "error", err, "account", session.User.ID)
		writeError(w, http.StatusInternalServerError, "could not load the screenshot")
		return
	}
	w.Header().Set("Content-Type", jpegContentType)
	w.Header().Set("Cache-Control", screenshotCacheControl)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
