package acornapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/account"
	"github.com/sid0709/OpenSeat/acorn-backend/admin"
	"github.com/sid0709/OpenSeat/acorn-backend/aiusage"
	"github.com/sid0709/OpenSeat/acorn-backend/support"
	"github.com/sid0709/OpenSeat/backend-core/httpkit"
	"github.com/sid0709/OpenSeat/backend-core/openai"
	"go.mongodb.org/mongo-driver/v2/mongo"
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

func (s *Server) adminListClaims(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok {
		return
	}
	if s.claims == nil {
		writeJSON(w, http.StatusOK, map[string]any{"claims": []any{}})
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	rows, err := s.claims.List(r.Context(), status, 0)
	if err != nil {
		slog.Error("acorn admin claims", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load claims")
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, claimRow(row, false))
	}
	writeJSON(w, http.StatusOK, map[string]any{"claims": out})
}

func (s *Server) adminGetClaim(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok {
		return
	}
	if s.claims == nil {
		writeError(w, http.StatusNotFound, "claim not found")
		return
	}
	row, err := s.claims.Get(r.Context(), r.PathValue("id"))
	if errors.Is(err, mongo.ErrNoDocuments) {
		writeError(w, http.StatusNotFound, "claim not found")
		return
	}
	if err != nil {
		slog.Error("acorn admin claim", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load claim")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"claim": claimRow(row, true)})
}

func (s *Server) adminPatchClaim(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok {
		return
	}
	if s.claims == nil {
		writeError(w, http.StatusNotFound, "claim not found")
		return
	}
	var body struct {
		Status string `json:"status"`
	}
	if !decode(w, r, &body) {
		return
	}
	status := strings.TrimSpace(body.Status)
	switch status {
	case support.StatusOpen, support.StatusTriaged, support.StatusClosed:
	default:
		writeError(w, http.StatusBadRequest, "invalid status")
		return
	}
	if err := s.claims.SetStatus(r.Context(), r.PathValue("id"), status); errors.Is(err, mongo.ErrNoDocuments) {
		writeError(w, http.StatusNotFound, "claim not found")
		return
	} else if err != nil {
		slog.Error("acorn admin claim", "error", err)
		writeError(w, http.StatusInternalServerError, "could not update claim")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Server) adminListUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok {
		return
	}
	accounts, ok := s.accounts.(*account.Store)
	if !ok || accounts == nil {
		writeJSON(w, http.StatusOK, map[string]any{"users": []any{}})
		return
	}
	rows, err := accounts.ListAccounts(r.Context(), 0, 100)
	if err != nil {
		slog.Error("acorn admin users", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, accountRow(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

func (s *Server) adminGetUser(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok {
		return
	}
	accounts, ok := s.accounts.(*account.Store)
	if !ok || accounts == nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	row, err := accounts.GetAccount(r.Context(), r.PathValue("id"))
	if errors.Is(err, account.ErrNotFound) {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	if err != nil {
		slog.Error("acorn admin user", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load user")
		return
	}
	body := map[string]any{"user": accountRow(row)}
	if s.usage != nil {
		summary, err := s.usage.SummarizeAccount(r.Context(), row.ID)
		if err != nil {
			slog.Error("acorn admin usage", "error", err)
			writeError(w, http.StatusInternalServerError, "could not load usage")
			return
		}
		body["usage"] = usageSummaryRow(summary)
	}
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) adminListUserUsage(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok {
		return
	}
	if s.usage == nil {
		writeJSON(w, http.StatusOK, map[string]any{"entries": []any{}})
		return
	}
	entries, err := s.usage.ListByAccount(r.Context(), r.PathValue("id"), 0)
	if err != nil {
		slog.Error("acorn admin usage", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load usage")
		return
	}
	out := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		out = append(out, usageEntryRow(entry))
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": out})
}

func accountRow(row account.AccountRow) map[string]any {
	return map[string]any{
		"id": row.ID, "name": row.Name, "email": row.Email, "createdAt": row.CreatedAt,
	}
}

func usageSummaryRow(summary aiusage.AccountSummary) map[string]any {
	return map[string]any{
		"accountId":      summary.AccountID,
		"callCount":      summary.CallCount,
		"totalCostNanos": summary.TotalCostNanos,
		"totalTokens":    summary.TotalTokens,
		"totalPrice":     openai.FormatUSD(summary.TotalCostNanos),
		"lastCallAt":     summary.LastCallAt,
	}
}

func usageEntryRow(entry aiusage.Entry) map[string]any {
	price := ""
	if entry.Priced {
		price = openai.FormatUSD(entry.CostNanos)
	}
	return map[string]any{
		"id":               entry.ID,
		"model":            entry.Model,
		"tabKey":           entry.TabKey,
		"promptTokens":     entry.PromptTokens,
		"completionTokens": entry.CompletionTokens,
		"totalTokens":      entry.TotalTokens,
		"price":            price,
		"costNanos":        entry.CostNanos,
		"priced":           entry.Priced,
		"durationMs":       entry.DurationMs,
		"error":            entry.Error,
		"createdAt":        entry.CreatedAt,
	}
}
