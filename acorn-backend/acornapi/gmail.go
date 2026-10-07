package acornapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/mailbox"
	"github.com/sid0709/OpenSeat/backend-core/google"
)

func (s *Server) gmailReady() bool {
	return s.gmail != nil && s.gmail.Ready() && s.gmailGoogle != nil
}

func (s *Server) listGmailMailboxes(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	if !s.gmailReady() {
		writeJSON(w, http.StatusOK, map[string]any{"mailboxes": []mailbox.Mailbox{}})
		return
	}
	boxes, err := s.gmail.List(r.Context(), session.User.ID)
	if err != nil {
		slog.Error("list gmail mailboxes", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load mailboxes")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mailboxes": mailboxPayload(boxes)})
}

func (s *Server) startGmailConnect(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	if !s.gmailReady() {
		writeError(w, http.StatusServiceUnavailable, "Gmail is not set up")
		return
	}
	var body struct {
		Email string `json:"email"`
		Label string `json:"label"`
	}
	if !decode(w, r, &body) {
		return
	}
	state, err := google.NewState()
	if err != nil {
		slog.Error("gmail state", "error", err)
		writeError(w, http.StatusInternalServerError, "could not start Gmail connection")
		return
	}
	verifier, challenge, err := google.NewVerifier()
	if err != nil {
		slog.Error("gmail verifier", "error", err)
		writeError(w, http.StatusInternalServerError, "could not start Gmail connection")
		return
	}
	url, err := s.gmail.StartConnect(r.Context(), session.User.ID, body.Email, body.Label, s.gmailRedirect, verifier, challenge, state, time.Now())
	if err != nil {
		writeGmailError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": url, "state": state})
}

func (s *Server) finishGmailConnect(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	if !s.gmailReady() {
		writeError(w, http.StatusServiceUnavailable, "Gmail is not set up")
		return
	}
	var body struct {
		Code  string `json:"code"`
		State string `json:"state"`
	}
	if !decode(w, r, &body) {
		return
	}
	box, err := s.gmail.FinishConnect(r.Context(), session.User.ID, body.State, body.Code, time.Now())
	if err != nil {
		writeGmailError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mailbox": mailboxPayload([]mailbox.Mailbox{box})[0]})
}

func (s *Server) deleteGmailMailbox(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	if !s.gmailReady() {
		writeError(w, http.StatusServiceUnavailable, "Gmail is not set up")
		return
	}
	id := strings.TrimSpace(r.PathValue("mailboxId"))
	if err := s.gmail.Disconnect(r.Context(), session.User.ID, id); err != nil {
		writeGmailError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (s *Server) patchGmailMailbox(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	if !s.gmailReady() {
		writeError(w, http.StatusServiceUnavailable, "Gmail is not set up")
		return
	}
	var body struct {
		IsDefault           *bool `json:"isDefault"`
		WatchesApplications *bool `json:"watchesApplications"`
	}
	if !decode(w, r, &body) {
		return
	}
	id := strings.TrimSpace(r.PathValue("mailboxId"))
	box, err := s.gmail.Patch(r.Context(), session.User.ID, id, body.IsDefault, body.WatchesApplications)
	if err != nil {
		writeGmailError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mailbox": mailboxPayload([]mailbox.Mailbox{box})[0]})
}

func (s *Server) listGmailMessages(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	if !s.gmailReady() {
		writeError(w, http.StatusServiceUnavailable, "Gmail is not set up")
		return
	}
	mailboxID := strings.TrimSpace(r.URL.Query().Get("mailboxId"))
	if mailboxID == "" {
		writeError(w, http.StatusBadRequest, "mailboxId is required")
		return
	}
	token, err := s.gmail.RefreshToken(r.Context(), session.User.ID, mailboxID)
	if err != nil {
		writeGmailError(w, err)
		return
	}
	ctx, cancel := contextWithGmailTimeout(r.Context())
	defer cancel()
	messages, err := s.gmailGoogle.ListInbox(ctx, token, 0)
	if err != nil {
		slog.Error("gmail inbox", "user", session.User.ID, "error", err)
		writeError(w, http.StatusBadGateway, "could not read Gmail; try reconnecting")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": gmailMessagesPayload(messages)})
}

func contextWithGmailTimeout(ctx context.Context) (context.Context, func()) {
	return context.WithTimeout(ctx, googleTimeout)
}

type gmailMailboxJSON struct {
	ID                  string `json:"id"`
	Email               string `json:"email"`
	Label               string `json:"label"`
	IsDefault           bool   `json:"isDefault"`
	WatchesApplications bool   `json:"watchesApplications"`
	ConnectedAt         string `json:"connectedAt"`
}

func mailboxPayload(boxes []mailbox.Mailbox) []gmailMailboxJSON {
	out := make([]gmailMailboxJSON, len(boxes))
	for i, box := range boxes {
		out[i] = gmailMailboxJSON{
			ID:                  box.ID,
			Email:               box.Email,
			Label:               box.Label,
			IsDefault:           box.IsDefault,
			WatchesApplications: box.WatchesApplications,
			ConnectedAt:         box.ConnectedAt.UTC().Format(time.RFC3339),
		}
	}
	return out
}

type gmailMessageJSON struct {
	ID            string   `json:"id"`
	ApplicationID string   `json:"applicationId"`
	Sender        string   `json:"sender"`
	SenderEmail   string   `json:"senderEmail"`
	Company       string   `json:"company"`
	Role          string   `json:"role"`
	Subject       string   `json:"subject"`
	Snippet       string   `json:"snippet"`
	Body          []string `json:"body"`
	Label         string   `json:"label"`
	ReceivedOn    string   `json:"receivedOn"`
	ReceivedAt    int      `json:"receivedAt"`
}

func gmailMessagesPayload(messages []mailbox.Message) []gmailMessageJSON {
	out := make([]gmailMessageJSON, len(messages))
	for i, message := range messages {
		out[i] = gmailMessageJSON{
			ID:            message.ID,
			ApplicationID: "",
			Sender:        message.Sender,
			SenderEmail:   message.SenderEmail,
			Company:       message.Sender,
			Role:          "",
			Subject:       message.Subject,
			Snippet:       message.Snippet,
			Body:          message.Body,
			Label:         "received",
			ReceivedOn:    message.ReceivedOn,
			ReceivedAt:    message.ReceivedAt,
		}
	}
	return out
}

func writeGmailError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, mailbox.ErrInvalid), errors.Is(err, mailbox.ErrOAuthState):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, mailbox.ErrEmailMismatch), errors.Is(err, mailbox.ErrDuplicate):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, mailbox.ErrNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, mailbox.ErrNotConfigured):
		writeError(w, http.StatusServiceUnavailable, err.Error())
	default:
		slog.Error("gmail", "error", err)
		writeError(w, http.StatusInternalServerError, "could not complete Gmail request")
	}
}
