package acornapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
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

// Limits on what the Gmail read routes accept from the query string.
const (
	maxGmailQuery     = 500
	maxGmailPageToken = 512
	maxGmailLabelID   = 256
)

// gmailAccess resolves the request's mailbox to its refresh token, so a person
// only ever reads mailboxes they connected.
func (s *Server) gmailAccess(w http.ResponseWriter, r *http.Request) (mailboxID, token string, ok bool) {
	session, ok := s.session(w, r)
	if !ok {
		return "", "", false
	}
	if !s.gmailReady() {
		writeError(w, http.StatusServiceUnavailable, "Gmail is not set up")
		return "", "", false
	}
	mailboxID = strings.TrimSpace(r.URL.Query().Get("mailboxId"))
	if mailboxID == "" {
		writeError(w, http.StatusBadRequest, "mailboxId is required")
		return "", "", false
	}
	token, err := s.gmail.RefreshToken(r.Context(), session.User.ID, mailboxID)
	if err != nil {
		writeGmailError(w, err)
		return "", "", false
	}
	return mailboxID, token, true
}

func (s *Server) listGmailMessages(w http.ResponseWriter, r *http.Request) {
	mailboxID, token, ok := s.gmailAccess(w, r)
	if !ok {
		return
	}
	params := r.URL.Query()
	query := mailbox.ListQuery{
		LabelID:   strings.TrimSpace(params.Get("labelId")),
		Query:     strings.TrimSpace(params.Get("q")),
		PageToken: strings.TrimSpace(params.Get("pageToken")),
		Fresh:     params.Get("fresh") == "1",
	}
	if len(query.LabelID) > maxGmailLabelID || len(query.Query) > maxGmailQuery || len(query.PageToken) > maxGmailPageToken {
		writeError(w, http.StatusBadRequest, "query is too long")
		return
	}
	if size, err := strconv.Atoi(params.Get("pageSize")); err == nil {
		query.PageSize = size
	}
	ctx, cancel := contextWithGmailTimeout(r.Context())
	defer cancel()
	page, err := s.gmailGoogle.ListMessages(ctx, mailboxID, token, query)
	if err != nil {
		writeGmailReadError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, gmailPagePayload(page))
}

func (s *Server) getGmailOverview(w http.ResponseWriter, r *http.Request) {
	mailboxID, token, ok := s.gmailAccess(w, r)
	if !ok {
		return
	}
	ctx, cancel := contextWithGmailTimeout(r.Context())
	defer cancel()
	overview, err := s.gmailGoogle.Overview(ctx, mailboxID, token, r.URL.Query().Get("fresh") == "1")
	if err != nil {
		writeGmailReadError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, gmailOverviewPayload(overview))
}

func (s *Server) getGmailMessage(w http.ResponseWriter, r *http.Request) {
	mailboxID, token, ok := s.gmailAccess(w, r)
	if !ok {
		return
	}
	id := strings.TrimSpace(r.PathValue("messageId"))
	if id == "" || len(id) > maxGmailLabelID {
		writeError(w, http.StatusBadRequest, "messageId is required")
		return
	}
	ctx, cancel := contextWithGmailTimeout(r.Context())
	defer cancel()
	message, err := s.gmailGoogle.Message(ctx, mailboxID, token, id)
	if err != nil {
		writeGmailReadError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"message": gmailFullMessagePayload(message)})
}

func contextWithGmailTimeout(ctx context.Context) (context.Context, func()) {
	return context.WithTimeout(ctx, googleTimeout)
}

type gmailMailboxJSON struct {
	ID                  string `json:"id"`
	Email               string `json:"email"`
	Name                string `json:"name"`
	Picture             string `json:"picture"`
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
			Name:                box.Name,
			Picture:             box.Picture,
			Label:               box.Label,
			IsDefault:           box.IsDefault,
			WatchesApplications: box.WatchesApplications,
			ConnectedAt:         box.ConnectedAt.UTC().Format(time.RFC3339),
		}
	}
	return out
}

type gmailMessageJSON struct {
	ID          string   `json:"id"`
	ThreadID    string   `json:"threadId"`
	Sender      string   `json:"sender"`
	SenderEmail string   `json:"senderEmail"`
	Subject     string   `json:"subject"`
	Snippet     string   `json:"snippet"`
	LabelIDs    []string `json:"labelIds"`
	IsUnread    bool     `json:"isUnread"`
	ReceivedAt  string   `json:"receivedAt"`
}

type gmailPageJSON struct {
	Messages           []gmailMessageJSON `json:"messages"`
	NextPageToken      string             `json:"nextPageToken"`
	ResultSizeEstimate int                `json:"resultSizeEstimate"`
}

func gmailPagePayload(page mailbox.Page) gmailPageJSON {
	out := gmailPageJSON{
		Messages:           make([]gmailMessageJSON, len(page.Messages)),
		NextPageToken:      page.NextPageToken,
		ResultSizeEstimate: page.ResultSizeEstimate,
	}
	for i, message := range page.Messages {
		out.Messages[i] = gmailMessageJSON{
			ID:          message.ID,
			ThreadID:    message.ThreadID,
			Sender:      message.Sender,
			SenderEmail: message.SenderEmail,
			Subject:     message.Subject,
			Snippet:     message.Snippet,
			LabelIDs:    nonNil(message.LabelIDs),
			IsUnread:    slices.Contains(message.LabelIDs, mailbox.LabelUnread),
			ReceivedAt:  message.ReceivedAt.UTC().Format(time.RFC3339),
		}
	}
	return out
}

type gmailLabelJSON struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Type   string `json:"type"`
	Unread int    `json:"unread"`
	Total  int    `json:"total"`
	Color  string `json:"color"`
}

func gmailOverviewPayload(overview mailbox.Overview) map[string]any {
	labels := make([]gmailLabelJSON, len(overview.Labels))
	for i, label := range overview.Labels {
		labels[i] = gmailLabelJSON(label)
	}
	return map[string]any{
		"profile": map[string]string{
			"email":   overview.Profile.Email,
			"name":    overview.Profile.Name,
			"picture": overview.Profile.Picture,
		},
		"labels": labels,
	}
}

type gmailAttachmentJSON struct {
	Filename string `json:"filename"`
	MimeType string `json:"mimeType"`
	Size     int    `json:"size"`
}

func gmailFullMessagePayload(message mailbox.FullMessage) map[string]any {
	attachments := make([]gmailAttachmentJSON, len(message.Attachments))
	for i, file := range message.Attachments {
		attachments[i] = gmailAttachmentJSON(file)
	}
	return map[string]any{
		"id":          message.ID,
		"threadId":    message.ThreadID,
		"subject":     message.Subject,
		"from":        map[string]string{"name": message.From.Name, "email": message.From.Email},
		"to":          message.To,
		"cc":          message.Cc,
		"replyTo":     message.ReplyTo,
		"labelIds":    nonNil(message.LabelIDs),
		"isUnread":    slices.Contains(message.LabelIDs, mailbox.LabelUnread),
		"receivedAt":  message.ReceivedAt.UTC().Format(time.RFC3339),
		"html":        message.HTML,
		"text":        message.Text,
		"attachments": attachments,
	}
}

func nonNil(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

// writeGmailReadError answers a failed read from Gmail itself.
func writeGmailReadError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, mailbox.ErrGmailAuth):
		writeError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, mailbox.ErrNotFound):
		writeError(w, http.StatusNotFound, "message not found")
	case errors.Is(err, context.DeadlineExceeded):
		writeError(w, http.StatusGatewayTimeout, "Gmail took too long; try again")
	default:
		slog.Error("gmail read", "error", err)
		writeError(w, http.StatusBadGateway, "could not read Gmail; try reconnecting")
	}
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
