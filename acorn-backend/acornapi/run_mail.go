package acornapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/sid0709/acorn/acorn-backend/mailbox"
	"github.com/sid0709/acorn/acorn-backend/mailcode"
	"github.com/sid0709/acorn/acorn-backend/selector"
)

const (
	mailVerificationTimeout = 60 * time.Second
	maxMailPageText         = 8000
	statusNoMailbox         = "no_mailbox"
)

type gmailReader struct {
	google    *mailbox.Google
	mailboxID string
	token     string
}

func (g gmailReader) Recent(ctx context.Context, n int) ([]mailbox.Message, error) {
	page, err := g.google.ListMessages(ctx, g.mailboxID, g.token, mailbox.ListQuery{
		LabelID: mailbox.LabelInbox, PageSize: n, Fresh: true,
	})
	return page.Messages, err
}

func (g gmailReader) Open(ctx context.Context, id string) (mailbox.FullMessage, error) {
	return g.google.Message(ctx, g.mailboxID, g.token, id)
}

func (s *Server) runMailVerification(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		RunID string `json:"runId"`
		Step  int    `json:"step"`
		Kind  string `json:"kind"`
		URL   string `json:"url"`
		Title string `json:"title"`
		Text  string `json:"text"`
		Since int64  `json:"since"`
		Seen  string `json:"seen"`
		// Exclude are the ids of emails already used for this step.
		Exclude []string `json:"exclude"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !selector.IsMailVerification(body.Kind) {
		writeError(w, http.StatusBadRequest, "kind must be "+selector.VerifyEmailCode+" or "+selector.VerifyEmailLink)
		return
	}
	log := slog.With("runId", body.RunID, "step", body.Step, "kind", body.Kind)
	if !s.gmailReady() {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": statusNoMailbox})
		return
	}
	reader, ok := s.verificationMailbox(w, r, session.User.ID, session.User.Email)
	if !ok {
		return
	}
	if reader == nil {
		log.Info("mail-verification: no mailbox")
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": statusNoMailbox})
		return
	}
	gateway, ok := s.selectorFor(w, r, session.User.ID)
	if !ok {
		return
	}
	text := body.Text
	if runes := []rune(text); len(runes) > maxMailPageText {
		text = string(runes[:maxMailPageText])
	}
	var since time.Time
	if body.Since > 0 {
		since = time.UnixMilli(body.Since)
	}
	ctx, cancel := context.WithTimeout(s.withUsage(r, session.User.ID), mailVerificationTimeout)
	defer cancel()
	started := time.Now()
	result, err := mailcode.Find(ctx, gateway, *reader, mailcode.Query{
		Ask: selector.MailAsk{
			Kind: body.Kind, URL: body.URL, Title: body.Title, PageText: text, Now: started,
		},
		Since:   since,
		Seen:    body.Seen,
		Exclude: body.Exclude,
	})
	elapsed := time.Since(started)
	if err != nil {
		log.Warn("mail-verification failed", "error", err, "ms", elapsed.Milliseconds())
		if errors.Is(err, mailbox.ErrGmailAuth) {
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": statusNoMailbox, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	log.Info("mail-verification", "status", result.Status, "opened", len(result.Opened),
		"calls", result.Calls, "ms", elapsed.Milliseconds(), "costUsd", result.Usage.Cost)
	out := map[string]any{
		"ok": true, "status": result.Status, "kind": body.Kind,
		"seen": result.Seen, "unchanged": result.Unchanged,
		"emails": result.Emails, "opened": result.Opened, "model": gateway.Model(),
		"usage": map[string]any{
			"inputTokens":  result.Usage.InputTokens,
			"outputTokens": result.Usage.OutputTokens,
			"cost":         result.Usage.Cost,
			"calls":        result.Calls,
		},
	}
	if result.Status == mailcode.StatusFound {
		out["value"] = result.Value
		out["messageId"] = result.MessageID
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) verificationMailbox(w http.ResponseWriter, r *http.Request, accountID, accountEmail string) (*gmailReader, bool) {
	boxes, err := s.gmail.List(r.Context(), accountID)
	if err != nil {
		slog.Error("list gmail mailboxes", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load mailboxes")
		return nil, false
	}
	email := accountEmail
	if doc, stored, err := s.profiles.Load(r.Context(), accountID); err == nil && stored && strings.TrimSpace(doc.Email) != "" {
		email = doc.Email
	}
	box, found := mailbox.ForAddress(boxes, email)
	if !found {
		return nil, true
	}
	token, err := s.gmail.RefreshToken(r.Context(), accountID, box.ID)
	if err != nil {
		writeGmailError(w, err)
		return nil, false
	}
	return &gmailReader{google: s.gmailGoogle, mailboxID: box.ID, token: token}, true
}
