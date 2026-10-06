package acornapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"unicode"

	"github.com/sid0709/OpenSeat/acorn-backend/aiusage"
	"github.com/sid0709/OpenSeat/backend-core/openai"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

const (
	// tabHeader is the extension's per-Chrome-tab key. The same string is
	// ACORN_TAB_HEADER in the extension.
	tabHeader = "X-Acorn-Tab"
	maxTabKey = 64
	minTabKey = 8
)

func tabKey(raw string) string {
	key := strings.TrimSpace(raw)
	if len(key) < minTabKey || len(key) > maxTabKey {
		return ""
	}
	for _, r := range key {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '-' {
			return ""
		}
	}
	return key
}

func (s *Server) withUsage(r *http.Request, accountID string) context.Context {
	key := tabKey(r.Header.Get(tabHeader))
	if s.usage == nil || key == "" || accountID == "" {
		return r.Context()
	}
	return openai.WithRecorder(r.Context(), func(usage openai.Usage) {
		if err := s.usage.Record(context.Background(), accountID, key, usage); err != nil {
			slog.Error("acorn ai usage", "error", err)
		}
	})
}

func (s *Server) listAIUsage(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	key := tabKey(r.URL.Query().Get("tab"))
	if key == "" {
		writeError(w, http.StatusBadRequest, "tab is required")
		return
	}
	if s.usage == nil {
		writeJSON(w, http.StatusOK, map[string]any{"entries": []any{}, "totalPrice": openai.FormatUSD(0)})
		return
	}
	entries, total, err := s.usage.List(r.Context(), session.User.ID, key)
	if err != nil {
		slog.Error("acorn ai usage", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load AI usage")
		return
	}
	rows := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		rows = append(rows, usageRow(entry, false))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"entries":    rows,
		"totalPrice": openai.FormatUSD(total),
	})
}

func (s *Server) getAIUsage(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	if s.usage == nil {
		writeError(w, http.StatusNotFound, "AI usage not found")
		return
	}
	entry, err := s.usage.Get(r.Context(), session.User.ID, r.PathValue("id"))
	if errors.Is(err, mongo.ErrNoDocuments) {
		writeError(w, http.StatusNotFound, "AI usage not found")
		return
	}
	if err != nil {
		slog.Error("acorn ai usage", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load AI usage")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entry": usageRow(entry, true)})
}

func usageRow(entry aiusage.Entry, withRequest bool) map[string]any {
	price := ""
	if entry.Priced {
		price = openai.FormatUSD(entry.CostNanos)
	}
	row := map[string]any{
		"id":               entry.ID,
		"model":            entry.Model,
		"promptTokens":     entry.PromptTokens,
		"completionTokens": entry.CompletionTokens,
		"cachedTokens":     entry.CachedTokens,
		"cacheWriteTokens": entry.CacheWriteTokens,
		"totalTokens":      entry.TotalTokens,
		"price":            price,
		"priced":           entry.Priced,
		"durationMs":       entry.DurationMs,
		"error":            entry.Error,
		"createdAt":        entry.CreatedAt,
	}
	if withRequest {
		row["request"] = entry.Request
	}
	return row
}
