package acornapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/admin"
	"github.com/sid0709/OpenSeat/backend-core/httpkit"
)

const DefaultAdminSessionCookie = "acorn_admin_session"

func (s *Server) adminToken(r *http.Request) string {
	if token := httpkit.BearerToken(r); token != "" {
		return token
	}
	if cookie, err := r.Cookie(s.adminCookie); err == nil {
		return strings.TrimSpace(cookie.Value)
	}
	return ""
}

func (s *Server) adminSession(w http.ResponseWriter, r *http.Request) (string, bool) {
	if s.admins == nil || !s.admins.Ready() {
		writeError(w, http.StatusServiceUnavailable, "admin sign-in is not configured")
		return "", false
	}
	email, err := s.admins.Session(r.Context(), s.adminToken(r), time.Now())
	if errors.Is(err, admin.ErrInvalidLogin) {
		writeError(w, http.StatusUnauthorized, "admin sign-in required")
		return "", false
	}
	if err != nil {
		slog.Error("acorn admin session", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load admin session")
		return "", false
	}
	return email, true
}

func (s *Server) adminSignIn(w http.ResponseWriter, r *http.Request) {
	if s.admins == nil || !s.admins.Ready() {
		writeError(w, http.StatusServiceUnavailable, "admin sign-in is not configured")
		return
	}
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decode(w, r, &body) {
		return
	}
	token, err := s.admins.SignIn(r.Context(), body.Email, body.Password, time.Now())
	if errors.Is(err, admin.ErrInvalidLogin) {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	if err != nil {
		slog.Error("acorn admin sign-in", "error", err)
		writeError(w, http.StatusInternalServerError, "could not sign in")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"token":   token,
		"session": map[string]any{"email": strings.ToLower(strings.TrimSpace(body.Email))},
	})
}

func (s *Server) adminMe(w http.ResponseWriter, r *http.Request) {
	email, ok := s.adminSession(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"session": map[string]any{"email": email},
	})
}

func (s *Server) adminSignOut(w http.ResponseWriter, r *http.Request) {
	if s.admins == nil {
		writeJSON(w, http.StatusOK, map[string]bool{"success": true})
		return
	}
	if err := s.admins.Revoke(r.Context(), s.adminToken(r)); err != nil {
		writeError(w, http.StatusInternalServerError, "could not sign out")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}
