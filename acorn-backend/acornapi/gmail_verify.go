package acornapi

import (
	"context"
	"log/slog"
	"net/http"
	"slices"
	"sort"
	"strings"
	"sync"

	"github.com/sid0709/acorn/acorn-backend/config"
	"github.com/sid0709/acorn/acorn-backend/mailbox"
)

// verifyMailLimit is the most messages the verification list returns, across all mailboxes.
const verifyMailLimit = 50

type verifyMailRow struct {
	MailboxID    string `json:"mailboxId"`
	MailboxEmail string `json:"mailboxEmail"`
	ID           string `json:"id"`
	From         string `json:"from"`
	Subject      string `json:"subject"`
	Snippet      string `json:"snippet"`
	ReceivedAt   int64  `json:"receivedAt"`
	Unread       bool   `json:"unread"`
}

// listVerifyMail is the mail carrying the oak-verify-email label, across every mailbox of the
// account, newest first. A mailbox without the label yet adds nothing.
//
//	GET /acorn/gmail/verify-mail   → {"success": true, "messages": [verifyMailRow…]}
func (s *Server) listVerifyMail(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	if !s.gmailReady() {
		writeError(w, http.StatusServiceUnavailable, "Gmail is not set up")
		return
	}
	boxes, err := s.gmail.List(r.Context(), session.User.ID)
	if err != nil {
		slog.Error("list gmail mailboxes", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load mailboxes")
		return
	}
	ctx, cancel := contextWithGmailTimeout(r.Context())
	defer cancel()

	var (
		mu      sync.Mutex
		wg      sync.WaitGroup
		rows    = []verifyMailRow{}
		failed  int
		lastErr error
	)
	for _, box := range boxes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			found, err := s.verifyMailOf(ctx, session.User.ID, box)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				failed++
				lastErr = err
				slog.Warn("verification mail not read", "account", session.User.ID, "mailbox", box.ID, "error", err)
				return
			}
			rows = append(rows, found...)
		}()
	}
	wg.Wait()
	if len(boxes) > 0 && failed == len(boxes) {
		writeGmailReadError(w, lastErr)
		return
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].ReceivedAt > rows[j].ReceivedAt })
	if len(rows) > verifyMailLimit {
		rows = rows[:verifyMailLimit]
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "messages": rows})
}

func (s *Server) verifyMailOf(ctx context.Context, accountID string, box mailbox.Mailbox) ([]verifyMailRow, error) {
	token, err := s.gmail.RefreshToken(ctx, accountID, box.ID)
	if err != nil {
		return nil, err
	}
	labelID, found, err := s.gmailGoogle.LabelID(ctx, token, config.VerifyMailLabel)
	if err != nil || !found {
		return nil, err
	}
	page, err := s.gmailGoogle.ListMessages(ctx, box.ID, token, mailbox.ListQuery{LabelID: labelID, PageSize: verifyMailLimit})
	if err != nil {
		return nil, err
	}
	rows := make([]verifyMailRow, len(page.Messages))
	for i, message := range page.Messages {
		rows[i] = verifyMailRow{
			MailboxID: box.ID, MailboxEmail: box.Email, ID: message.ID,
			From:       formatAddress(message.Sender, message.SenderEmail),
			Subject:    message.Subject,
			Snippet:    message.Snippet,
			ReceivedAt: message.ReceivedAt.UnixMilli(),
			Unread:     slices.Contains(message.LabelIDs, mailbox.LabelUnread),
		}
	}
	return rows, nil
}

// getVerifyMail is one message with the oak-verify-email label, in full. A message without the
// label is not served through this route.
//
//	GET /acorn/gmail/verify-mail/{mailboxId}/{id}   → {"success": true, "message": {…}}
func (s *Server) getVerifyMail(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	if !s.gmailReady() {
		writeError(w, http.StatusServiceUnavailable, "Gmail is not set up")
		return
	}
	mailboxID := strings.TrimSpace(r.PathValue("mailboxId"))
	id := strings.TrimSpace(r.PathValue("id"))
	if mailboxID == "" || id == "" || len(id) > maxGmailLabelID {
		writeError(w, http.StatusBadRequest, "mailboxId and id are required")
		return
	}
	token, err := s.gmail.RefreshToken(r.Context(), session.User.ID, mailboxID)
	if err != nil {
		writeGmailError(w, err)
		return
	}
	ctx, cancel := contextWithGmailTimeout(r.Context())
	defer cancel()
	labelID, found, err := s.gmailGoogle.LabelID(ctx, token, config.VerifyMailLabel)
	if err != nil {
		writeGmailReadError(w, err)
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	message, err := s.gmailGoogle.Message(ctx, mailboxID, token, id)
	if err != nil {
		writeGmailReadError(w, err)
		return
	}
	if !slices.Contains(message.LabelIDs, labelID) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	attachments := make([]gmailAttachmentJSON, len(message.Attachments))
	for i, file := range message.Attachments {
		attachments[i] = gmailAttachmentJSON(file)
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": map[string]any{
		"mailboxId":   mailboxID,
		"id":          message.ID,
		"from":        formatAddress(message.From.Name, message.From.Email),
		"to":          message.To,
		"cc":          message.Cc,
		"subject":     message.Subject,
		"date":        message.ReceivedAt.UnixMilli(),
		"html":        message.HTML,
		"text":        message.Text,
		"attachments": attachments,
	}})
}

// formatAddress is "Name <email>", or whichever of the two there is.
func formatAddress(name, email string) string {
	name, email = strings.TrimSpace(name), strings.TrimSpace(email)
	switch {
	case email == "":
		return name
	case name == "" || name == email:
		return email
	}
	return name + " <" + email + ">"
}
