package acornapi

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/account"
	"github.com/sid0709/OpenSeat/acorn-backend/aiusage"
)

// statsFilter reads the statistics filters from the query string.
func statsFilter(r *http.Request) aiusage.Filter {
	q := r.URL.Query()
	return aiusage.Filter{
		Range:          strings.TrimSpace(q.Get("range")),
		AccountID:      strings.TrimSpace(q.Get("accountId")),
		Model:          strings.TrimSpace(q.Get("model")),
		Feature:        strings.TrimSpace(q.Get("feature")),
		Client:         strings.TrimSpace(q.Get("client")),
		IncludeSupport: q.Get("includeSupport") == "true",
	}
}

// growth is sign-ups in the period and how many of them have used AI at all.
type growth struct {
	Signups        int64   `json:"signups"`
	Activated      int64   `json:"activated"`
	ActivationRate float64 `json:"activationRate"`
}

type accountName struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

func (s *Server) adminStatistics(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok {
		return
	}
	accounts, ok := s.accountStore(w)
	if !ok {
		return
	}
	ctx := r.Context()
	stats, err := s.usage.Statistics(ctx, statsFilter(r), time.Now())
	if err != nil {
		slog.Error("acorn admin statistics", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load statistics")
		return
	}

	signups, err := accounts.CreatedBetween(ctx, stats.Current.From, stats.Current.To)
	if err != nil {
		slog.Error("acorn admin statistics signups", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load statistics")
		return
	}
	activated, err := s.usage.ActiveAmong(ctx, signups)
	if err != nil {
		slog.Error("acorn admin statistics activation", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load statistics")
		return
	}
	g := growth{Signups: int64(len(signups)), Activated: activated}
	if g.Signups > 0 {
		g.ActivationRate = float64(activated) / float64(g.Signups)
	}

	names, err := accountNames(ctx, accounts, stats)
	if err != nil {
		slog.Error("acorn admin statistics names", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load statistics")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"statistics": stats, "growth": g, "accounts": names})
}

// accountNames names every account the top-user and hot-tab lists mention.
func accountNames(ctx context.Context, accounts *account.Store, stats aiusage.Statistics) (map[string]accountName, error) {
	ids := make([]string, 0, len(stats.TopUsers)+len(stats.HotTabs))
	for _, group := range stats.TopUsers {
		ids = append(ids, group.Key)
	}
	for _, tab := range stats.HotTabs {
		ids = append(ids, tab.AccountID)
	}
	rows, err := accounts.AccountsByID(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[string]accountName, len(rows))
	for id, row := range rows {
		out[id] = accountName{Name: row.Name, Email: row.Email}
	}
	return out, nil
}
