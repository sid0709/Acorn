package acornapi

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/account"
)

func (s *Server) signInExtension(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decode(w, r, &body) {
		return
	}
	email := strings.TrimSpace(body.Email)
	password := body.Password
	if email == "" || password == "" {
		writeError(w, http.StatusBadRequest, "email and password are required")
		return
	}
	now := time.Now()
	user, err := s.accounts.UserByEmail(r.Context(), email)
	if errors.Is(err, account.ErrInvalidLogin) {
		accountID, ok, err := s.profiles.AccountIDByProfileEmail(r.Context(), email)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not sign in")
			return
		}
		if !ok {
			writeAccountError(w, account.ErrInvalidLogin)
			return
		}
		user, err = s.accounts.UserByID(r.Context(), accountID)
		if err != nil {
			writeAccountError(w, err)
			return
		}
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "could not sign in")
		return
	}
	doc, _, err := s.profiles.Load(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not sign in")
		return
	}
	if !extensionEmailMatches(email, user.Email, doc.Email) {
		writeAccountError(w, account.ErrInvalidLogin)
		return
	}
	if !extensionPasswordMatches(password, doc.ExtensionPassword) {
		writeAccountError(w, account.ErrInvalidLogin)
		return
	}
	token, user, err := s.accounts.StartSession(r.Context(), user.ID, now)
	if err != nil {
		writeAccountError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sessionBody(token, account.Session{User: user}))
}

func extensionEmailMatches(input, accountEmail, profileEmail string) bool {
	normalized := normalizeSignInEmail(input)
	if normalized == normalizeSignInEmail(accountEmail) {
		return true
	}
	profile := normalizeSignInEmail(profileEmail)
	return profile != "" && normalized == profile
}

func extensionPasswordMatches(got, want string) bool {
	want = strings.TrimSpace(want)
	if want == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func normalizeSignInEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
