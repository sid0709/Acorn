package acornapi

import (
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/account"
	"github.com/sid0709/OpenSeat/acorn-backend/supportaccess"
)

// supportLandingPath is acorn-frontend's route that redeems a support handoff code.
const supportLandingPath = "/auth/support"

func (s *Server) supportReady(w http.ResponseWriter) bool {
	if s.supportAccess == nil || s.webURL == "" {
		writeError(w, http.StatusServiceUnavailable, "support sign-in is not configured (set ACORN_WEB_URL)")
		return false
	}
	return true
}

// adminStartSupportSession hands the admin a one-time link that signs the site in as the user.
func (s *Server) adminStartSupportSession(w http.ResponseWriter, r *http.Request) {
	adminEmail, ok := s.adminSession(w, r)
	if !ok || !s.supportReady(w) {
		return
	}
	accounts, ok := s.accountStore(w)
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if !decode(w, r, &body) {
		return
	}
	reason := strings.TrimSpace(body.Reason)
	if reason == "" || len(reason) > supportaccess.MaxReasonLength {
		writeError(w, http.StatusBadRequest, "give a reason for the support session")
		return
	}
	user, err := accounts.GetAccount(r.Context(), r.PathValue("id"))
	if errors.Is(err, account.ErrNotFound) {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	if err != nil {
		slog.Error("acorn support session", "error", err)
		writeError(w, http.StatusInternalServerError, "could not start the support session")
		return
	}
	now := time.Now()
	code, err := s.supportAccess.CreateHandoff(r.Context(), supportaccess.Handoff{
		UserID: user.ID, AdminEmail: adminEmail, Reason: reason, Purpose: supportaccess.PurposeWeb,
	}, now)
	if err == nil {
		err = s.supportAccess.Record(r.Context(), supportaccess.AuditEntry{
			Admin: adminEmail, Action: supportaccess.ActionSupportStart, UserID: user.ID, Reason: reason, At: now.UTC(),
		})
	}
	if err != nil {
		slog.Error("acorn support session", "error", err)
		writeError(w, http.StatusInternalServerError, "could not start the support session")
		return
	}
	slog.Warn("acorn support session started", "admin", adminEmail, "user", user.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"url": s.webURL + supportLandingPath + "?" + url.Values{"code": {code}}.Encode(),
	})
}

// adminEndSupportSessions signs every support session for the user out, on the site and the extension.
func (s *Server) adminEndSupportSessions(w http.ResponseWriter, r *http.Request) {
	adminEmail, ok := s.adminSession(w, r)
	if !ok || !s.supportReady(w) {
		return
	}
	accounts, ok := s.accountStore(w)
	if !ok {
		return
	}
	userID := r.PathValue("id")
	ended, err := accounts.RevokeSupportSessions(r.Context(), userID)
	if err == nil {
		err = s.supportAccess.Record(r.Context(), supportaccess.AuditEntry{
			Admin: adminEmail, Action: supportaccess.ActionSupportRevoke, UserID: userID,
		})
	}
	if err != nil {
		slog.Error("acorn support session revoke", "error", err)
		writeError(w, http.StatusInternalServerError, "could not end support sessions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "ended": ended})
}

func (s *Server) adminUserAudit(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok || !s.supportReady(w) {
		return
	}
	entries, err := s.supportAccess.AuditFor(r.Context(), r.PathValue("id"))
	if err != nil {
		slog.Error("acorn admin audit", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load the audit trail")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

// redeemSupportCode trades a handoff code for a support session. A site code also
// returns a code for the extension, so the site can hand the same support
// session's sign-in to it without the token ever reaching page script.
func (s *Server) redeemSupportCode(w http.ResponseWriter, r *http.Request) {
	if !s.supportReady(w) {
		return
	}
	accounts, ok := s.accountStore(w)
	if !ok {
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	if !decode(w, r, &body) {
		return
	}
	now := time.Now()
	grant, err := s.supportAccess.Redeem(r.Context(), body.Code, now)
	if errors.Is(err, supportaccess.ErrInvalidCode) {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	if err != nil {
		slog.Error("acorn support redeem", "error", err)
		writeError(w, http.StatusInternalServerError, "could not open the support session")
		return
	}
	token, expires, err := accounts.IssueSupportSession(r.Context(), grant.UserID, grant.AdminEmail, grant.Reason, now)
	if errors.Is(err, account.ErrNotFound) {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	if err != nil {
		slog.Error("acorn support redeem", "error", err)
		writeError(w, http.StatusInternalServerError, "could not open the support session")
		return
	}
	user, err := accounts.GetAccount(r.Context(), grant.UserID)
	if err != nil {
		slog.Error("acorn support redeem", "error", err)
		writeError(w, http.StatusInternalServerError, "could not open the support session")
		return
	}
	session := account.Session{
		User:      account.User{ID: user.ID, Name: user.Name, Email: user.Email},
		SupportBy: grant.AdminEmail, SupportReason: grant.Reason, ExpiresAt: expires,
	}
	out := sessionBody(token, session)
	switch grant.Purpose {
	case supportaccess.PurposeWeb:
		code, err := s.supportAccess.CreateHandoff(r.Context(), supportaccess.Handoff{
			UserID: grant.UserID, AdminEmail: grant.AdminEmail, Reason: grant.Reason, Purpose: supportaccess.PurposeExtension,
		}, now)
		if err != nil {
			slog.Error("acorn support extension code", "error", err)
			writeError(w, http.StatusInternalServerError, "could not open the support session")
			return
		}
		out["extensionCode"] = code
	case supportaccess.PurposeExtension:
		if err := s.supportAccess.Record(r.Context(), supportaccess.AuditEntry{
			Admin: grant.AdminEmail, Action: supportaccess.ActionSupportExtension, UserID: grant.UserID, Reason: grant.Reason,
		}); err != nil {
			slog.Error("acorn support audit", "error", err)
		}
	}
	writeJSON(w, http.StatusOK, out)
}
