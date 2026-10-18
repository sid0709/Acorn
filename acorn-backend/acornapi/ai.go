package acornapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/sid0709/acorn/acorn-backend/account"
	"github.com/sid0709/acorn/acorn-backend/acorn"
	"github.com/sid0709/acorn/acorn-backend/internal/candidate"
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
	status := http.StatusBadGateway
	switch {
	case errors.Is(err, acorn.ErrInvalid):
		status = http.StatusBadRequest
	case errors.Is(err, acorn.ErrModelUnavailable):
		status = http.StatusServiceUnavailable
	}
	code := modelErrorCode(err)
	status = statusForCode(code, status)
	slog.Warn("acorn route failed", "route", route, "status", status, "code", code, "error", err)
	writeCodedError(w, status, code, err.Error())
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
