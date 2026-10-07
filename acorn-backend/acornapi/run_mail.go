package acornapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/mailbox"
	"github.com/sid0709/OpenSeat/acorn-backend/mailcode"
	"github.com/sid0709/OpenSeat/acorn-backend/selector"
)

const (
	// mailVerificationTimeout bounds one search: a list, up to two opened emails, and three decisions.
	mailVerificationTimeout = 60 * time.Second
	// maxVerificationCode bounds a code the extension sends back to be filled.
	maxVerificationCode = 64
	// maxMailPageText bounds the page copy a mail search reads.
	maxMailPageText = 8000
	// statusNoMailbox means the account has no connected Gmail to read.
	statusNoMailbox = "no_mailbox"
)

// gmailReader reads one connected mailbox for a mail search.
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

// runMailVerification finds the code or link a job site emailed the applicant,
// in the connected Gmail that receives the profile's email. The value goes back
// to the extension only; it is never logged.
func (s *Server) runMailVerification(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		RunID    string   `json:"runId"`
		Step     int      `json:"step"`
		Kind     string   `json:"kind"`
		URL      string   `json:"url"`
		Title    string   `json:"title"`
		Text     string   `json:"text"`
		Since    int64    `json:"since"`
		RuledOut []string `json:"ruledOut"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !selector.IsMailVerification(body.Kind) {
		writeError(w, http.StatusBadRequest, "kind must be "+selector.VerifyEmailCode+" or "+selector.VerifyEmailLink)
		return
	}
	runID := cleanRunID(body.RunID)
	log := slog.With("runId", runID, "step", body.Step, "kind", body.Kind, "page", logPage(body.URL))
	if !s.gmailReady() {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": statusNoMailbox})
		return
	}
	reader, ok := s.verificationMailbox(w, r, session.User.ID, session.User.Email)
	if !ok {
		return
	}
	if reader == nil {
		log.Info("acorn run mail-verification: no mailbox")
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": statusNoMailbox})
		return
	}
	gateway, ok := s.selectorFor(w, r, session.User.ID)
	if !ok {
		return
	}

	text := []rune(body.Text)
	if len(text) > maxMailPageText {
		text = text[:maxMailPageText]
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
			Kind: body.Kind, URL: body.URL, Title: body.Title, PageText: string(text), Now: started,
		},
		Since: since, RuledOut: body.RuledOut,
	})
	elapsed := time.Since(started)
	s.recordRunStep(r, session.User.ID, runID, body.Step, "mail-verification", map[string]any{
		"kind": body.Kind, "status": result.Status, "messageId": result.MessageID, "opened": result.Opened,
		"ruledOut": len(result.RuledOut), "error": errText(err), "ms": elapsed.Milliseconds(),
	})
	if err != nil {
		log.Warn("acorn run mail-verification failed", "error", err, "ms", elapsed.Milliseconds())
		if errors.Is(err, mailbox.ErrGmailAuth) {
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": statusNoMailbox, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	log.Info("acorn run mail-verification", "status", result.Status, "opened", result.Opened,
		"calls", result.Calls, "ms", elapsed.Milliseconds(), "costUsd", result.Usage.Cost)
	usage := decisionUsage(gateway.Model(), result.Usage)
	usage["calls"] = result.Calls
	out := map[string]any{
		"ok": true, "status": result.Status, "kind": body.Kind, "ruledOut": result.RuledOut,
		"model": gateway.Model(), "usage": usage,
	}
	if result.Status == mailcode.StatusFound {
		out["value"] = result.Value
	}
	writeJSON(w, http.StatusOK, out)
}

// verificationMailbox is the connected mailbox that receives the profile's
// email (the address the run signs up with). Nil when none is connected.
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
