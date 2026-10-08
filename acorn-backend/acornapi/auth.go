package acornapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/account"
)

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	// Liveness only: it must not disclose who is connected.
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) signUp(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decode(w, r, &body) {
		return
	}
	token, user, err := s.accounts.SignUp(r.Context(), body.Name, body.Email, body.Password, time.Now())
	if err != nil {
		writeAccountError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, sessionBody(token, account.Session{User: user}))
}

func (s *Server) signIn(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decode(w, r, &body) {
		return
	}
	token, user, err := s.accounts.SignIn(r.Context(), body.Email, body.Password, time.Now())
	if err != nil {
		writeAccountError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sessionBody(token, account.Session{User: user}))
}

// me is how the extension and acorn-frontend learn who the Acorn session belongs to.
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, sessionBody("", session))
}

// signOut ends this Acorn session. acorn-frontend and the extension both drop the cookie.
func (s *Server) signOut(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.session(w, r); !ok {
		return
	}
	if err := s.accounts.Revoke(r.Context(), s.token(r)); err != nil {
		writeError(w, http.StatusInternalServerError, "could not sign out")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// deleteAccount deactivates the signed-in account and ends its sessions.
// The account row, profile, and résumés stay.
func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	if session.SupportBy != "" {
		writeError(w, http.StatusForbidden, "a support session cannot delete the account")
		return
	}
	if err := s.accounts.Delete(r.Context(), session.User.ID); err != nil {
		if errors.Is(err, account.ErrNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		if errors.Is(err, account.ErrInvalid) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "could not delete the account")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// sessionBody is the session as the site and the extension read it. A support
// session also says which admin opened it and when it ends.
func sessionBody(token string, session account.Session) map[string]any {
	user := session.User
	info := map[string]any{
		"accountId":   user.ID,
		"profileId":   user.ID,
		"applierName": user.Name,
		"username":    user.Email,
		"displayName": user.Name,
		"email":       user.Email,
	}
	if session.SupportBy != "" {
		info["supportBy"] = session.SupportBy
		info["expiresAt"] = session.ExpiresAt
	}
	body := map[string]any{"success": true, "session": info}
	if token != "" {
		body["token"] = token
	}
	return body
}

func writeAccountError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, account.ErrEmailTaken):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, account.ErrWeakPassword), errors.Is(err, account.ErrInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, account.ErrInvalidLogin):
		writeError(w, http.StatusUnauthorized, err.Error())
	case errors.Is(err, account.ErrDeactivated):
		writeError(w, http.StatusForbidden, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "could not sign in")
	}
}
