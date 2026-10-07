package acornapi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/sid0709/OpenSeat/acorn-backend/acornapi/gateway"
	"github.com/sid0709/OpenSeat/acorn-backend/support"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

const (
	// claimBodyLimit fits the largest screenshot as base64 plus the claim's text.
	claimBodyLimit = support.MaxScreenshotBytes*4/3 + 64<<10
	// maxScreenshotSide bounds the screenshot size the extension reports.
	maxScreenshotSide = 100_000
)

var screenshotTypes = map[string]bool{"image/png": true, "image/jpeg": true}

func (s *Server) claimsReady(w http.ResponseWriter) bool {
	if s.claims == nil {
		writeError(w, http.StatusServiceUnavailable, "support reports are not available")
		return false
	}
	return true
}

// createSupportClaim files a report: the page, a full-page screenshot, and the reporter's notes.
func (s *Server) createSupportClaim(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok || !s.claimsReady(w) {
		return
	}
	body, err := readBody(r, claimBodyLimit)
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read the report")
		return
	}
	var input struct {
		PageURL          string `json:"pageUrl"`
		PageTitle        string `json:"pageTitle"`
		Notes            string `json:"notes"`
		ExtensionVersion string `json:"extensionVersion"`
		TabKey           string `json:"tabKey"`
		ScreenshotBase64 string `json:"screenshotBase64"`
		ScreenshotMIME   string `json:"screenshotMime"`
		ScreenshotWidth  int    `json:"screenshotWidth"`
		ScreenshotHeight int    `json:"screenshotHeight"`
	}
	if err := json.Unmarshal(body, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid report")
		return
	}
	pageURL := strings.TrimSpace(input.PageURL)
	if pageURL == "" || len(pageURL) > support.MaxPageURLLen {
		writeError(w, http.StatusBadRequest, "page URL is required")
		return
	}
	notes := strings.TrimSpace(input.Notes)
	if len(notes) > support.MaxNotesLen {
		writeError(w, http.StatusBadRequest, "notes are too long")
		return
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(input.ScreenshotBase64))
	if err != nil || len(raw) == 0 {
		writeError(w, http.StatusBadRequest, "screenshot is required")
		return
	}
	if len(raw) > support.MaxScreenshotBytes {
		writeError(w, http.StatusBadRequest, "screenshot is too large")
		return
	}
	mime := strings.TrimSpace(input.ScreenshotMIME)
	if !screenshotTypes[mime] || http.DetectContentType(raw) != mime {
		writeError(w, http.StatusBadRequest, "screenshot must be PNG or JPEG")
		return
	}
	saved, err := s.claims.Create(r.Context(), support.Claim{
		AccountID:        session.User.ID,
		UserEmail:        session.User.Email,
		UserName:         session.User.Name,
		PageURL:          pageURL,
		PageTitle:        strings.TrimSpace(input.PageTitle),
		Notes:            notes,
		ExtensionVersion: strings.TrimSpace(input.ExtensionVersion),
		TabKey:           tabKey(input.TabKey),
		Screenshot:       raw,
		ScreenshotMIME:   mime,
		ScreenshotWidth:  clampSide(input.ScreenshotWidth),
		ScreenshotHeight: clampSide(input.ScreenshotHeight),
	})
	if errors.Is(err, support.ErrRateLimited) {
		writeError(w, http.StatusTooManyRequests, err.Error())
		return
	}
	if err != nil {
		slog.Error("acorn support claim", "error", err)
		writeError(w, http.StatusInternalServerError, "could not save the report")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"claim": claimRow(saved, support.AuthorUser)})
}

func clampSide(n int) int {
	return max(0, min(n, maxScreenshotSide))
}

// listMyClaims is the reporter's own claims, with which ones have unread replies.
func (s *Server) listMyClaims(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok || !s.claimsReady(w) {
		return
	}
	rows, err := s.claims.ListForAccount(r.Context(), session.User.ID)
	if err != nil {
		slog.Error("acorn support claims", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load your reports")
		return
	}
	out := make([]map[string]any, 0, len(rows))
	unread := 0
	for _, row := range rows {
		if row.UnreadFor(support.AuthorUser) {
			unread++
		}
		out = append(out, claimRow(row, support.AuthorUser))
	}
	writeJSON(w, http.StatusOK, map[string]any{"claims": out, "unread": unread})
}

// myClaim loads the session's own claim named in the path, answering 404 otherwise.
func (s *Server) myClaim(w http.ResponseWriter, r *http.Request) (support.Claim, string, bool) {
	session, ok := s.session(w, r)
	if !ok || !s.claimsReady(w) {
		return support.Claim{}, "", false
	}
	claim, ok := s.loadClaim(w, r, session.User.ID)
	return claim, session.User.Name, ok
}

func (s *Server) loadClaim(w http.ResponseWriter, r *http.Request, accountID string) (support.Claim, bool) {
	claim, err := s.claims.Get(r.Context(), r.PathValue("id"), accountID)
	if errors.Is(err, mongo.ErrNoDocuments) {
		writeError(w, http.StatusNotFound, "report not found")
		return support.Claim{}, false
	}
	if err != nil {
		slog.Error("acorn support claim", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load the report")
		return support.Claim{}, false
	}
	return claim, true
}

func (s *Server) getMyClaim(w http.ResponseWriter, r *http.Request) {
	claim, _, ok := s.myClaim(w, r)
	if !ok {
		return
	}
	s.writeThread(w, r, claim, support.AuthorUser)
}

// writeThread answers with the claim and its conversation as reader sees them.
func (s *Server) writeThread(w http.ResponseWriter, r *http.Request, claim support.Claim, reader string) {
	messages, err := s.claims.Messages(r.Context(), claim.ID)
	if err != nil {
		slog.Error("acorn support messages", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load the conversation")
		return
	}
	out := make([]map[string]any, 0, len(messages))
	for _, msg := range messages {
		out = append(out, messageRow(msg))
	}
	writeJSON(w, http.StatusOK, map[string]any{"claim": claimRow(claim, reader), "messages": out})
}

func (s *Server) postMyClaimMessage(w http.ResponseWriter, r *http.Request) {
	claim, name, ok := s.myClaim(w, r)
	if !ok {
		return
	}
	s.addClaimMessage(w, r, claim, support.AuthorUser, name)
}

// addClaimMessage appends one message and tells the reporter's clients when support wrote it.
func (s *Server) addClaimMessage(w http.ResponseWriter, r *http.Request, claim support.Claim, author, authorName string) {
	var body struct {
		Body string `json:"body"`
	}
	if !decode(w, r, &body) {
		return
	}
	msg, updated, err := s.claims.AddMessage(r.Context(), claim, author, authorName, body.Body)
	switch {
	case errors.Is(err, support.ErrInvalidMessage):
		writeError(w, http.StatusBadRequest, err.Error())
		return
	case errors.Is(err, support.ErrRateLimited):
		writeError(w, http.StatusTooManyRequests, err.Error())
		return
	case err != nil:
		slog.Error("acorn support message", "error", err)
		writeError(w, http.StatusInternalServerError, "could not send the message")
		return
	}
	row := messageRow(msg)
	if author == support.AuthorAdmin && s.sockets != nil {
		s.sockets.EmitToAccount(claim.AccountID, gateway.SupportMessageEvent, map[string]any{
			"claim": claimRow(updated, support.AuthorUser), "message": row,
		})
	}
	writeJSON(w, http.StatusCreated, map[string]any{"message": row, "claim": claimRow(updated, author)})
}

func (s *Server) readMyClaim(w http.ResponseWriter, r *http.Request) {
	claim, _, ok := s.myClaim(w, r)
	if !ok {
		return
	}
	s.markClaimRead(w, r, claim.ID, support.AuthorUser)
}

func (s *Server) markClaimRead(w http.ResponseWriter, r *http.Request, claimID, reader string) {
	if err := s.claims.MarkRead(r.Context(), claimID, reader); err != nil {
		slog.Error("acorn support read", "error", err)
		writeError(w, http.StatusInternalServerError, "could not mark the report read")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// claimRow is a claim as reader sees it; unread is from reader's side.
func claimRow(claim support.Claim, reader string) map[string]any {
	return map[string]any{
		"id":               claim.ID,
		"accountId":        claim.AccountID,
		"userEmail":        claim.UserEmail,
		"userName":         claim.UserName,
		"pageUrl":          claim.PageURL,
		"pageTitle":        claim.PageTitle,
		"notes":            claim.Notes,
		"extensionVersion": claim.ExtensionVersion,
		"tabKey":           claim.TabKey,
		"status":           claim.Status,
		"screenshotMime":   claim.ScreenshotMIME,
		"screenshotWidth":  claim.ScreenshotWidth,
		"screenshotHeight": claim.ScreenshotHeight,
		"messageCount":     claim.MessageCount,
		"lastMessageAt":    claim.LastMessageAt,
		"lastMessageBy":    claim.LastMessageBy,
		"unread":           claim.UnreadFor(reader),
		"createdAt":        claim.CreatedAt,
	}
}

func messageRow(msg support.Message) map[string]any {
	return map[string]any{
		"id":         msg.ID,
		"author":     msg.Author,
		"authorName": msg.AuthorName,
		"body":       msg.Body,
		"createdAt":  msg.CreatedAt,
	}
}

func readBody(r *http.Request, max int64) ([]byte, error) {
	defer r.Body.Close()
	return io.ReadAll(io.LimitReader(r.Body, max))
}
