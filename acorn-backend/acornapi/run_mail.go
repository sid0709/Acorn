package acornapi

import (
	"context"
	"errors"
	"fmt"
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
	// maxSeen bounds the list name the extension hands back.
	maxSeen = 64
	// statusNoMailbox means the account has no connected Gmail to read.
	statusNoMailbox = "no_mailbox"
)

// gmailReader reads one connected mailbox for a mail search.
type gmailReader struct {
	google    *mailbox.Google
	mailboxID string
	token     string
	// address is the mailbox's email, for the capture of each look.
	address string
}

// errLoadMailboxes is a failure to list the account's connected mailboxes.
var errLoadMailboxes = errors.New("could not load mailboxes")

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
		RunID string `json:"runId"`
		Step  int    `json:"step"`
		Kind  string `json:"kind"`
		URL   string `json:"url"`
		Title string `json:"title"`
		Text  string `json:"text"`
		Since int64  `json:"since"`
		Seen  string `json:"seen"`
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
	// Every look is captured for the tab session: which mailbox, what it listed,
	// how Jev ranked it, and what failed (never the code or link).
	record := func(data map[string]any) {
		data["kind"] = body.Kind
		s.recordRunStep(r, session.User.ID, runID, body.Step, "mail-verification", data)
	}
	if !s.gmailReady() {
		record(map[string]any{"status": statusNoMailbox, "why": "gmail is not configured on this server"})
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": statusNoMailbox})
		return
	}
	reader, err := s.verificationMailbox(r.Context(), session.User.ID, session.User.Email)
	if err != nil {
		record(map[string]any{"status": "mailbox_failed", "error": err.Error()})
		if errors.Is(err, errLoadMailboxes) {
			slog.Error("list gmail mailboxes", "error", err)
			writeError(w, http.StatusInternalServerError, "could not load mailboxes")
			return
		}
		writeGmailError(w, err)
		return
	}
	if reader == nil {
		log.Info("acorn run mail-verification: no mailbox")
		record(map[string]any{"status": statusNoMailbox, "why": "no connected Gmail receives the profile's email"})
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
	ctx, cancel := context.WithTimeout(s.traceContext(r, session.User.ID), mailVerificationTimeout)
	defer cancel()
	started := time.Now()
	result, err := mailcode.Find(ctx, gateway, *reader, mailcode.Query{
		Ask: selector.MailAsk{
			Kind: body.Kind, URL: body.URL, Title: body.Title, PageText: string(text), Now: started,
		},
		Since: since, Seen: clipField(body.Seen, maxSeen),
	})
	elapsed := time.Since(started)
	record(map[string]any{
		"mailbox": reader.address, "status": result.Status, "messageId": result.MessageID,
		"unchanged": result.Unchanged, "emails": result.Emails, "judged": result.Judged, "opened": result.Opened,
		"error": errText(err), "ms": elapsed.Milliseconds(),
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
	log.Info("acorn run mail-verification", "status", result.Status, "unchanged", result.Unchanged, "opened", len(result.Opened),
		"calls", result.Calls, "ms", elapsed.Milliseconds(), "costUsd", result.Usage.Cost)
	usage := decisionUsage(gateway.Model(), result.Usage)
	usage["calls"] = result.Calls
	out := map[string]any{
		"ok": true, "status": result.Status, "kind": body.Kind, "seen": result.Seen, "unchanged": result.Unchanged,
		"emails": mailRows(result.Emails),
		"model":  gateway.Model(), "usage": usage,
	}
	if result.Status == mailcode.StatusFound {
		out["value"] = result.Value
	}
	writeJSON(w, http.StatusOK, out)
}

// verificationMailbox is the connected mailbox that receives the profile's
// email (the address the run signs up with). Nil when none is connected.
func (s *Server) verificationMailbox(ctx context.Context, accountID, accountEmail string) (*gmailReader, error) {
	boxes, err := s.gmail.List(ctx, accountID)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", errLoadMailboxes, err)
	}
	email := accountEmail
	if doc, stored, err := s.profiles.Load(ctx, accountID); err == nil && stored && strings.TrimSpace(doc.Email) != "" {
		email = doc.Email
	}
	box, found := mailbox.ForAddress(boxes, email)
	if !found {
		return nil, nil
	}
	token, err := s.gmail.RefreshToken(ctx, accountID, box.ID)
	if err != nil {
		return nil, err
	}
	return &gmailReader{google: s.gmailGoogle, mailboxID: box.ID, token: token, address: email}, nil
}

// mailRow is one email as the sidebar lists it while the run reads the mail.
type mailRow struct {
	From        string  `json:"from"`
	Subject     string  `json:"subject"`
	Probability float64 `json:"probability"`
}

func mailRows(emails []mailcode.Judged) []mailRow {
	rows := make([]mailRow, len(emails))
	for i, email := range emails {
		rows[i] = mailRow{From: email.From, Subject: email.Subject, Probability: email.Probability}
	}
	return rows
}
