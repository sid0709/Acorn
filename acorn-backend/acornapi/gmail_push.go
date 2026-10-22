package acornapi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/sid0709/acorn/acorn-backend/mailwatch"
)

// pushGmail is where a Pub/Sub push subscription delivers Gmail's change notifications. It is not
// behind a session: the call is trusted only when it carries the OIDC token Google signs for the
// configured service account and audience.
//
//	POST /acorn/gmail/push   Authorization: Bearer <OIDC token>
//	{"message": {"data": base64({"emailAddress", "historyId"}), "messageId": "…"}, "subscription": "…"}
//
// The answer is 204 as soon as the mailbox's sync is queued; a 5xx makes Pub/Sub deliver again.
func (s *Server) pushGmail(w http.ResponseWriter, r *http.Request) {
	if !s.mailwatch.Push() {
		writeError(w, http.StatusNotFound, "Gmail push is not set up")
		return
	}
	switch err := s.mailwatch.VerifyPush(r.Context(), r.Header.Get("Authorization")); {
	case errors.Is(err, mailwatch.ErrUnauthorized):
		slog.Warn("gmail push call refused", "remote", r.RemoteAddr)
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	case err != nil:
		slog.Error("gmail push token could not be checked", "error", err)
		writeError(w, http.StatusServiceUnavailable, "could not check the push token")
		return
	}
	var envelope struct {
		Message struct {
			Data      string `json:"data"`
			MessageID string `json:"messageId"`
		} `json:"message"`
	}
	if !decode(w, r, &envelope) {
		return
	}
	address, ok := pushedAddress(envelope.Message.Data)
	if !ok {
		// A message that is not a Gmail notification will never become one: drop it, do not retry.
		slog.Warn("gmail push message dropped: not a Gmail notification", "pubsubMessage", envelope.Message.MessageID)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := s.mailwatch.Notify(r.Context(), address); err != nil {
		slog.Error("gmail push could not be queued", "error", err)
		writeError(w, http.StatusServiceUnavailable, "could not queue the sync")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// pushedAddress is the Gmail address a notification names.
func pushedAddress(data string) (string, bool) {
	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return "", false
	}
	var payload struct {
		EmailAddress string `json:"emailAddress"`
	}
	if json.Unmarshal(raw, &payload) != nil || !strings.Contains(payload.EmailAddress, "@") {
		return "", false
	}
	return payload.EmailAddress, true
}
