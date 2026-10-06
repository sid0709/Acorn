package acornapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/sid0709/OpenSeat/acorn-backend/account"
	"github.com/sid0709/OpenSeat/acorn-backend/acorn"
	"github.com/sid0709/OpenSeat/acorn-backend/selector"
	"github.com/sid0709/OpenSeat/backend-core/candidate"
	"github.com/sid0709/OpenSeat/backend-core/jev"
)

func decode(w http.ResponseWriter, r *http.Request, dest any) bool {
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(dest)
	if err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid request")
		return false
	}
	return true
}

// writeAcornError answers a failed model call: the caller's mistake, a missing
// model key, or the model itself failing.
func writeAcornError(w http.ResponseWriter, route string, err error) {
	switch {
	case errors.Is(err, acorn.ErrInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, acorn.ErrModelUnavailable):
		writeError(w, http.StatusServiceUnavailable, err.Error())
	default:
		slog.Warn("acorn route failed", "route", route, "error", err)
		writeError(w, http.StatusBadGateway, err.Error())
	}
}

// applicant renders the signed-in account for the model. A saved profile supplies
// the answers; otherwise only the account name and email are known.
func (s *Server) applicant(w http.ResponseWriter, r *http.Request, session account.Session) (string, bool) {
	doc, stored, err := s.profiles.Load(r.Context(), session.User.ID)
	if err != nil {
		slog.Error("acorn profile", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load the profile")
		return "", false
	}
	if !stored {
		return acorn.ApplicantProfileText(session.User.ID, candidate.Profile{Name: session.User.Name, Email: session.User.Email}), true
	}
	return acorn.ApplicantProfileTextWith(session.User.ID, doc.Candidate(session.User.Name, session.User.Email), doc.PlannerExtra()), true
}

func (s *Server) aiAnalyze(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		PureTree    string               `json:"pureTree"`
		MetaTree    string               `json:"metaTree"` // accepted from older extensions, never sent to the model
		Mode        string               `json:"mode"`
		FieldIssues acorn.FieldIssueScan `json:"fieldIssues"`
		Page        map[string]any       `json:"page"`
		Debug       *analyzeDebug        `json:"debug"`
	}
	if !decode(w, r, &body) {
		return
	}
	applicant, ok := s.applicant(w, r, session)
	if !ok {
		return
	}
	brain, ok := s.acornFor(w, r, session.User.ID)
	if !ok {
		return
	}
	ctx := s.startAnalyzeRun(r, session.User.ID, applicant, body.PureTree, body.Page, body.Debug)
	var result acorn.AnalyzeResult
	var err error
	if body.Mode == acorn.ModeRefill {
		recordFieldIssues(ctx, body.FieldIssues)
		result, err = brain.Refill(ctx, applicant, body.PureTree, body.FieldIssues, body.Page)
	} else {
		result, err = brain.Analyze(ctx, applicant, body.PureTree, body.Page)
	}
	finishAnalyzeRun(ctx, result, err)
	if err != nil {
		writeAcornError(w, "ai-analyze", err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// matchOption picks a dropdown option through the SelectorGateway (TypeSafe Jev).
// A failed decision is data, not an HTTP error: the extension falls back to its own matching.
func (s *Server) matchOption(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		IntendedValue  string   `json:"intendedValue"`
		Options        []string `json:"options"`
		FieldLabel     string   `json:"fieldLabel"`
		TypedQuery     string   `json:"typedQuery"`
		AllowNotListed bool     `json:"allowNotListed"`
	}
	if !decode(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.IntendedValue) == "" || len(body.Options) == 0 {
		writeError(w, http.StatusBadRequest, "intendedValue and options are required")
		return
	}
	applicant, ok := s.applicant(w, r, session)
	if !ok {
		return
	}
	gateway, ok := s.selectorFor(w, r, session.User.ID)
	if !ok {
		return
	}
	pick, err := gateway.PickOption(r.Context(), selector.OptionQuery{
		Field: body.FieldLabel, Intended: body.IntendedValue, Typed: body.TypedQuery,
		Options: body.Options, AllowNotListed: body.AllowNotListed, Applicant: applicant,
	})
	if err != nil {
		slog.Warn("acorn match-option failed", "error", err)
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "matched_option": nil, "fallback_option": nil, "confidence": 0, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "matched_option": emptyNil(pick.Option), "fallback_option": emptyNil(pick.Fallback),
		"confidence": pick.Confidence, "model": gateway.Model(), "usage": decisionUsage(gateway.Model(), pick.Usage),
	})
}

// decisionUsage is a Jev call in the extension's AiUsageSummary shape.
func decisionUsage(model string, usage jev.Usage) map[string]any {
	return map[string]any{
		"model": model, "inputTokens": usage.InputTokens, "outputTokens": usage.OutputTokens,
		"cachedInputTokens": 0, "totalTokens": usage.InputTokens + usage.OutputTokens,
		"costUsd": usage.Cost, "priced": true, "calls": 1,
	}
}

func (s *Server) qa(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		Question string         `json:"question"`
		Page     map[string]any `json:"page"`
	}
	if !decode(w, r, &body) {
		return
	}
	applicant, ok := s.applicant(w, r, session)
	if !ok {
		return
	}
	brain, ok := s.acornFor(w, r, session.User.ID)
	if !ok {
		return
	}
	result, err := brain.Answer(s.traceContext(r, session.User.ID), applicant, body.Question, body.Page)
	if err != nil {
		writeAcornError(w, "qa", err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) extractJD(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		PageText string `json:"pageText"`
		Meta     any    `json:"meta"`
	}
	if !decode(w, r, &body) {
		return
	}
	s.writeJD(w, r, session.User.ID, body.PageText, body.Meta)
}

func (s *Server) analyzeMeta(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		Meta any `json:"meta"`
	}
	if !decode(w, r, &body) {
		return
	}
	s.writeJD(w, r, session.User.ID, "", body.Meta)
}

func (s *Server) writeJD(w http.ResponseWriter, r *http.Request, accountID, pageText string, meta any) {
	if len([]rune(pageText)) > acorn.PageTextMaxChars {
		writeError(w, http.StatusBadRequest, "pageText is too long")
		return
	}
	brain, ok := s.acornFor(w, r, accountID)
	if !ok {
		return
	}
	result, err := brain.ExtractJD(r.Context(), pageText, meta)
	if err != nil {
		writeAcornError(w, "extract-jd", err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
