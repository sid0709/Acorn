package acornapi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/support"
)

func (s *Server) createSupportClaim(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	if s.claims == nil {
		writeError(w, http.StatusServiceUnavailable, "support reports are not available")
		return
	}
	body, err := readBody(r, 6<<20)
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read the report")
		return
	}
	var input struct {
		PageURL          string `json:"pageUrl"`
		PageTitle        string `json:"pageTitle"`
		ExtensionVersion string `json:"extensionVersion"`
		TabKey           string `json:"tabKey"`
		ScreenshotBase64 string `json:"screenshotBase64"`
		ScreenshotMIME   string `json:"screenshotMime"`
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
	if mime == "" {
		mime = "image/png"
	}
	if mime != "image/png" && mime != "image/jpeg" {
		writeError(w, http.StatusBadRequest, "screenshot must be PNG or JPEG")
		return
	}
	claim := support.Claim{
		AccountID:        session.User.ID,
		UserEmail:        session.User.Email,
		UserName:         session.User.Name,
		PageURL:          pageURL,
		PageTitle:        strings.TrimSpace(input.PageTitle),
		ExtensionVersion: strings.TrimSpace(input.ExtensionVersion),
		TabKey:           tabKey(input.TabKey),
		ScreenshotPNG:    raw,
		ScreenshotMIME:   mime,
		CreatedAt:        time.Now().UTC(),
	}
	saved, err := s.claims.Create(r.Context(), claim)
	if errors.Is(err, support.ErrRateLimited) {
		writeError(w, http.StatusTooManyRequests, err.Error())
		return
	}
	if err != nil {
		slog.Error("acorn support claim", "error", err)
		writeError(w, http.StatusInternalServerError, "could not save the report")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"claim": claimRow(saved, false)})
}

func claimRow(claim support.Claim, withScreenshot bool) map[string]any {
	row := map[string]any{
		"id":               claim.ID,
		"accountId":        claim.AccountID,
		"userEmail":        claim.UserEmail,
		"userName":         claim.UserName,
		"pageUrl":          claim.PageURL,
		"pageTitle":        claim.PageTitle,
		"extensionVersion": claim.ExtensionVersion,
		"tabKey":           claim.TabKey,
		"status":           claim.Status,
		"screenshotMime":   claim.ScreenshotMIME,
		"createdAt":        claim.CreatedAt,
	}
	if withScreenshot && len(claim.ScreenshotPNG) > 0 {
		row["screenshotBase64"] = base64.StdEncoding.EncodeToString(claim.ScreenshotPNG)
	}
	return row
}

func readBody(r *http.Request, max int64) ([]byte, error) {
	defer r.Body.Close()
	return io.ReadAll(io.LimitReader(r.Body, max))
}
