package acornapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/account"
	"github.com/sid0709/OpenSeat/acorn-backend/aiusage"
)

const (
	// adminUserPage and adminUsagePage are the support console's page sizes.
	adminUserPage  = 25
	adminUsagePage = 50
	// adminUsageWindow is the span the user list totals each account's use over.
	adminUsageWindow = 30 * 24 * time.Hour
)

// accountStore is the concrete account store; admin views need more than Accounts offers.
func (s *Server) accountStore(w http.ResponseWriter) (*account.Store, bool) {
	accounts, ok := s.accounts.(*account.Store)
	if !ok || accounts == nil {
		writeError(w, http.StatusServiceUnavailable, "accounts are not available")
		return nil, false
	}
	return accounts, true
}

func pageParam(r *http.Request) int {
	page, err := strconv.Atoi(r.URL.Query().Get("page"))
	if err != nil || page < 1 {
		return 1
	}
	return page
}

func (s *Server) adminListUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok {
		return
	}
	accounts, ok := s.accountStore(w)
	if !ok {
		return
	}
	page := pageParam(r)
	rows, total, err := accounts.SearchAccounts(r.Context(), r.URL.Query().Get("q"), page, adminUserPage)
	if err != nil {
		slog.Error("acorn admin users", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	usage, err := s.usage.UsageByAccount(r.Context(), ids, time.Now().Add(-adminUsageWindow))
	if err != nil {
		slog.Error("acorn admin users usage", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load usage")
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		item := accountRow(row)
		item["usage"] = usage[row.ID]
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"users": out, "total": total, "page": page, "pageSize": adminUserPage,
	})
}

func (s *Server) adminGetUser(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok {
		return
	}
	accounts, ok := s.accountStore(w)
	if !ok {
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
	filter := statsFilter(r)
	filter.AccountID = row.ID
	stats, err := s.usage.Statistics(r.Context(), filter, time.Now())
	if err != nil {
		slog.Error("acorn admin user statistics", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load usage statistics")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": accountRow(row), "statistics": stats})
}

func (s *Server) adminListUserUsage(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok {
		return
	}
	page := pageParam(r)
	entries, total, err := s.usage.ListByAccount(r.Context(), r.PathValue("id"), page, adminUsagePage)
	if err != nil {
		slog.Error("acorn admin usage", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load usage")
		return
	}
	out := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		out = append(out, usageEntryRow(entry))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"entries": out, "total": total, "page": page, "pageSize": adminUsagePage,
	})
}

func accountRow(row account.AccountRow) map[string]any {
	return map[string]any{
		"id": row.ID, "name": row.Name, "email": row.Email, "createdAt": row.CreatedAt,
	}
}

// usageEntryRow is one call for the support console: the user row plus where it came from.
func usageEntryRow(entry aiusage.Entry) map[string]any {
	row := usageRow(entry)
	row["tabKey"] = entry.TabKey
	row["route"] = entry.Route
	row["client"] = entry.Client
	row["clientVersion"] = entry.ClientVersion
	row["supportBy"] = entry.SupportBy
	row["httpStatus"] = entry.HTTPStatus
	row["finishReason"] = entry.FinishReason
	return row
}
