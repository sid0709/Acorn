package acornapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/sid0709/OpenSeat/acorn-backend/mailbox"
	"github.com/sid0709/OpenSeat/acorn-backend/maillabel"
	"github.com/sid0709/OpenSeat/backend-core/jev"
	"github.com/sid0709/OpenSeat/backend-core/openai"
)

const (
	autolabelTimeout = 90 * time.Second
	maxAutolabelID   = 256
	maxIncomingText  = 2000
)

type gmailApplier struct {
	google    *mailbox.Google
	mailboxID string
	token     string
}

func (a gmailApplier) AddLabel(ctx context.Context, messageID, labelID string) error {
	return a.google.AddLabel(ctx, a.mailboxID, a.token, messageID, labelID)
}

func (s *Server) listLabelGuides(w http.ResponseWriter, r *http.Request) {
	accountID, mailboxID, ok := s.ownedMailbox(w, r, r.URL.Query().Get("mailboxId"))
	if !ok {
		return
	}
	guides, err := s.gmail.ListGuides(r.Context(), accountID, mailboxID)
	if err != nil {
		slog.Error("list label guides", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load label descriptions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"guides": guidePayload(guides)})
}

func (s *Server) saveLabelGuides(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MailboxID string `json:"mailboxId"`
		Guides    []struct {
			LabelID     string `json:"labelId"`
			Description string `json:"description"`
		} `json:"guides"`
	}
	if !decode(w, r, &body) {
		return
	}
	accountID, mailboxID, ok := s.ownedMailbox(w, r, body.MailboxID)
	if !ok {
		return
	}
	token, err := s.gmail.RefreshToken(r.Context(), accountID, mailboxID)
	if err != nil {
		writeGmailError(w, err)
		return
	}
	ctx, cancel := contextWithGmailTimeout(r.Context())
	defer cancel()
	overview, err := s.gmailGoogle.Overview(ctx, mailboxID, token, false)
	if err != nil {
		writeGmailReadError(w, err)
		return
	}
	allowed := mailbox.UserLabelIDs(overview.Labels)
	guides := make([]mailbox.LabelGuide, 0, len(body.Guides))
	for _, guide := range body.Guides {
		labelID := strings.TrimSpace(guide.LabelID)
		description := strings.TrimSpace(guide.Description)
		if labelID == "" && description == "" {
			continue
		}
		if !allowed[labelID] {
			writeError(w, http.StatusBadRequest, "that label is not on this mailbox")
			return
		}
		guides = append(guides, mailbox.LabelGuide{LabelID: labelID, Description: description})
	}
	if err := s.gmail.SaveGuides(r.Context(), accountID, mailboxID, guides); err != nil {
		writeGmailError(w, err)
		return
	}
	saved, err := s.gmail.ListGuides(r.Context(), accountID, mailboxID)
	if err != nil {
		slog.Error("list label guides", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load label descriptions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"guides": guidePayload(saved)})
}

func (s *Server) autolabelGmail(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MailboxID string `json:"mailboxId"`
		Messages  []struct {
			ID      string `json:"id"`
			From    string `json:"from"`
			Subject string `json:"subject"`
			Snippet string `json:"snippet"`
		} `json:"messages"`
	}
	if !decode(w, r, &body) {
		return
	}
	accountID, mailboxID, ok := s.ownedMailbox(w, r, body.MailboxID)
	if !ok {
		return
	}
	grant, err := s.gmail.Grant(r.Context(), accountID, mailboxID)
	if err != nil {
		writeGmailError(w, err)
		return
	}
	if !grant.CanModify {
		writeGmailError(w, mailbox.ErrGmailScope)
		return
	}
	if len(body.Messages) == 0 {
		writeError(w, http.StatusBadRequest, maillabel.ErrNoMail.Error())
		return
	}
	if len(body.Messages) > maillabel.MaxMessages {
		writeError(w, http.StatusBadRequest, maillabel.ErrTooMany.Error())
		return
	}
	mail := make([]maillabel.Mail, 0, len(body.Messages))
	for _, message := range body.Messages {
		id := strings.TrimSpace(message.ID)
		if id == "" || len(id) > maxAutolabelID {
			writeError(w, http.StatusBadRequest, maillabel.ErrNoMail.Error())
			return
		}
		mail = append(mail, maillabel.Mail{
			ID:      id,
			From:    clipField(message.From, maxIncomingText),
			Subject: clipField(message.Subject, maxIncomingText),
			Snippet: clipField(message.Snippet, maxIncomingText),
		})
	}
	stored, err := s.gmail.ListGuides(r.Context(), accountID, mailboxID)
	if err != nil {
		slog.Error("list label guides", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load label descriptions")
		return
	}
	guides := make([]maillabel.Guide, len(stored))
	for i, guide := range stored {
		guides[i] = maillabel.Guide{LabelID: guide.LabelID, Description: guide.Description}
	}
	key, err := s.openRouterKey(r.Context(), accountID)
	if err != nil {
		s.writeProfileErr(w, err)
		return
	}
	decider := jev.New(key)
	if !decider.Ready() {
		writeError(w, http.StatusServiceUnavailable, openai.ErrMissingOpenRouterKey.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), autolabelTimeout)
	defer cancel()
	summary, err := maillabel.Run(openai.WithCall(ctx, "gmail-autolabel"), decider, gmailApplier{
		google: s.gmailGoogle, mailboxID: mailboxID, token: grant.RefreshToken,
	}, guides, mail)
	if errors.Is(err, mailbox.ErrGmailScope) {
		writeGmailError(w, err)
		return
	}
	if err != nil && summary.Labeled == 0 {
		switch {
		case errors.Is(err, maillabel.ErrNoGuides), errors.Is(err, maillabel.ErrNoMail), errors.Is(err, maillabel.ErrTooMany):
			writeError(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, context.DeadlineExceeded):
			writeError(w, http.StatusGatewayTimeout, "Labeling took too long; try a smaller page")
		default:
			slog.Error("autolabel", "error", err)
			writeError(w, http.StatusBadGateway, "could not label mail")
		}
		return
	}
	writeJSON(w, http.StatusOK, summaryPayload(summary))
}

// ownedMailbox checks the mailbox belongs to the signed-in account.
func (s *Server) ownedMailbox(w http.ResponseWriter, r *http.Request, mailboxID string) (string, string, bool) {
	session, ok := s.session(w, r)
	if !ok {
		return "", "", false
	}
	if !s.gmailReady() {
		writeError(w, http.StatusServiceUnavailable, "Gmail is not set up")
		return "", "", false
	}
	mailboxID = strings.TrimSpace(mailboxID)
	if mailboxID == "" || len(mailboxID) > maxGmailLabelID {
		writeError(w, http.StatusBadRequest, "mailboxId is required")
		return "", "", false
	}
	if _, err := s.gmail.RefreshToken(r.Context(), session.User.ID, mailboxID); err != nil {
		writeGmailError(w, err)
		return "", "", false
	}
	return session.User.ID, mailboxID, true
}

type guideJSON struct {
	LabelID     string `json:"labelId"`
	Description string `json:"description"`
}

func guidePayload(guides []mailbox.LabelGuide) []guideJSON {
	out := make([]guideJSON, len(guides))
	for i, guide := range guides {
		out[i] = guideJSON{LabelID: guide.LabelID, Description: guide.Description}
	}
	if out == nil {
		return []guideJSON{}
	}
	return out
}

type autolabelResultJSON struct {
	MessageID string `json:"messageId"`
	LabelID   string `json:"labelId"`
	Applied   bool   `json:"applied"`
}

func summaryPayload(summary maillabel.Summary) map[string]any {
	results := make([]autolabelResultJSON, len(summary.Results))
	for i, result := range summary.Results {
		results[i] = autolabelResultJSON{MessageID: result.MessageID, LabelID: result.LabelID, Applied: result.Applied}
	}
	return map[string]any{
		"results":   results,
		"labeled":   summary.Labeled,
		"unmatched": summary.Unmatched,
		"failed":    summary.Failed,
	}
}

func clipField(text string, max int) string {
	text = strings.TrimSpace(text)
	if utf8.RuneCountInString(text) <= max {
		return text
	}
	return string([]rune(text)[:max])
}
