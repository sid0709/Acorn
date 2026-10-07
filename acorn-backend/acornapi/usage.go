package acornapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/sid0709/OpenSeat/acorn-backend/acornapi/gateway"
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

	// clientHeader names the caller as "<client>/<version>", e.g. "extension/1.9.0"
	// or "web". The same string is ACORN_CLIENT_HEADER in @acorn/shared.
	clientHeader     = "X-Acorn-Client"
	maxClientName    = 16
	maxClientVersion = 32

	// usageWriteTimeout bounds one usage insert, which runs after the request may have ended.
	usageWriteTimeout = 10 * time.Second
)

// clientFrom reads the client header. Anything else than a short name and version is dropped.
func clientFrom(raw string) (string, string) {
	name, version, _ := strings.Cut(strings.TrimSpace(raw), "/")
	name = strings.ToLower(strings.TrimSpace(name))
	version = strings.TrimSpace(version)
	if len(name) > maxClientName || !plainToken(name) {
		name = ""
	}
	if len(version) > maxClientVersion || !plainToken(version) {
		version = ""
	}
	return name, version
}

func plainToken(s string) bool {
	for _, r := range s {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '-' && r != '.' && r != '_' {
			return false
		}
	}
	return true
}

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

// withUsage records every model call made with the returned context against
// this account, tab, feature, client and (in a support session) admin.
func (s *Server) withUsage(r *http.Request, accountID string) context.Context {
	if s.usage == nil || accountID == "" {
		return r.Context()
	}
	call := callContext(r, accountID)
	return openai.WithRecorder(r.Context(), func(usage openai.Usage) {
		recordAndPush(s.usage, s.sockets, call, usage)
	})
}

func callContext(r *http.Request, accountID string) aiusage.CallContext {
	client, version := clientFrom(r.Header.Get(clientHeader))
	return aiusage.CallContext{
		AccountID:     accountID,
		TabKey:        tabKey(r.Header.Get(tabHeader)),
		Route:         r.Pattern,
		Feature:       featureForRoute(r.Pattern),
		Client:        client,
		ClientVersion: version,
		SupportBy:     supportByFrom(r.Context()),
	}
}

// usageRecorder keeps one AI call; aiusage.Store is the real one.
type usageRecorder interface {
	Record(ctx context.Context, call aiusage.CallContext, usage openai.Usage) (aiusage.Entry, error)
}

// accountEmitter reaches every connected client of an account; the socket gateway is the real one.
type accountEmitter interface {
	EmitToAccount(accountID, event string, payload any)
}

// recordAndPush stores one call, then pushes it to the account's clients with
// the tab it belongs to, so that tab's list updates the moment the call ends,
// even for work that finishes after its request returned.
func recordAndPush(store usageRecorder, push accountEmitter, call aiusage.CallContext, usage openai.Usage) {
	ctx, cancel := context.WithTimeout(context.Background(), usageWriteTimeout)
	defer cancel()
	entry, err := store.Record(ctx, call, usage)
	if err != nil {
		slog.Error("acorn ai usage not recorded", "error", err, "account", call.AccountID,
			"model", usage.Model, "feature", call.Feature)
		return
	}
	if entry.ID == "" || push == nil {
		return
	}
	push.EmitToAccount(call.AccountID, gateway.UsageRecordedEvent, map[string]any{
		"tab": call.TabKey, "entry": usageRow(entry),
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
		rows = append(rows, usageRow(entry))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"entries":    rows,
		"totalPrice": openai.FormatUSD(total),
		"totalNanos": total,
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
	writeJSON(w, http.StatusOK, map[string]any{"entry": usageRow(entry)})
}

func usageRow(entry aiusage.Entry) map[string]any {
	price := ""
	if entry.Priced {
		price = openai.FormatUSD(entry.CostNanos)
	}
	return map[string]any{
		"id":               entry.ID,
		"model":            entry.Model,
		"feature":          entry.Feature,
		"step":             entry.Step,
		"status":           entry.Status,
		"errorKind":        entry.ErrorKind,
		"promptTokens":     entry.PromptTokens,
		"completionTokens": entry.CompletionTokens,
		"cachedTokens":     entry.CachedTokens,
		"cacheWriteTokens": entry.CacheWriteTokens,
		"totalTokens":      entry.TotalTokens,
		"price":            price,
		"costNanos":        entry.CostNanos,
		"priced":           entry.Priced,
		"durationMs":       entry.DurationMs,
		"attempts":         entry.Attempts,
		"error":            entry.Error,
		"createdAt":        entry.CreatedAt,
	}
}
