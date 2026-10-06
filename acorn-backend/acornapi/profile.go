package acornapi

import (
	"encoding/base64"
	"errors"
	"net/http"

	"github.com/sid0709/OpenSeat/acorn-backend/account"
	"github.com/sid0709/OpenSeat/acorn-backend/profile"
)

func (s *Server) getProfile(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	doc, stored, err := s.profiles.Load(r.Context(), session.User.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the profile")
		return
	}
	if !stored {
		doc = profile.Blank(session.User.Name, session.User.Email)
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "stored": stored, "profile": doc})
}

func (s *Server) putProfile(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var doc profile.Document
	if !decode(w, r, &doc) {
		return
	}
	saved, err := s.profiles.Save(r.Context(), session.User.ID, doc)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save the profile")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "stored": true, "profile": saved})
}

func (s *Server) fillProfile(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		FileName      string            `json:"fileName"`
		ContentBase64 string            `json:"contentBase64"`
		Text          string            `json:"text"`
		Profile       *profile.Document `json:"profile"`
	}
	if !decode(w, r, &body) {
		return
	}
	var (
		filled profile.Filled
		err    error
	)
	switch {
	case body.Text != "":
		filled, err = s.profiles.FillText(s.withUsage(r, session.User.ID), session.User.ID, session.User.Name, session.User.Email, body.Text, body.Profile)
	case body.ContentBase64 != "":
		data, decErr := base64.StdEncoding.DecodeString(body.ContentBase64)
		if decErr != nil {
			writeError(w, http.StatusBadRequest, "invalid résumé file")
			return
		}
		filled, err = s.profiles.FillFile(s.withUsage(r, session.User.ID), session.User.ID, session.User.Name, session.User.Email, body.FileName, data, body.Profile)
	default:
		writeError(w, http.StatusBadRequest, "add a résumé file")
		return
	}
	if err != nil {
		writeProfileError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "stored": true, "profile": filled.Profile, "reader": filled.Reader})
}

func writeProfileError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, profile.ErrInvalid), errors.Is(err, profile.ErrUnreadable):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "could not update the profile")
	}
}

func (s *Server) storedIdentity(r *http.Request, session account.Session) (profile.Document, bool) {
	doc, ok, err := s.profiles.Load(r.Context(), session.User.ID)
	if err != nil || !ok {
		return profile.Document{}, false
	}
	return doc, true
}
