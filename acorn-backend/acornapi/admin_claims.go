package acornapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/sid0709/OpenSeat/acorn-backend/acornapi/gateway"
	"github.com/sid0709/OpenSeat/acorn-backend/support"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

// supportAuthorName is how admin replies are signed to the reporter.
const supportAuthorName = "Acorn Support"

func (s *Server) adminListClaims(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok || !s.claimsReady(w) {
		return
	}
	q := r.URL.Query()
	rows, err := s.claims.List(r.Context(), strings.TrimSpace(q.Get("status")), q.Get("q"))
	if err != nil {
		slog.Error("acorn admin claims", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load claims")
		return
	}
	open, awaiting, err := s.claims.Counts(r.Context())
	if err != nil {
		slog.Error("acorn admin claim counts", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load claims")
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, claimRow(row, support.AuthorAdmin))
	}
	writeJSON(w, http.StatusOK, map[string]any{"claims": out, "open": open, "awaitingSupport": awaiting})
}

func (s *Server) adminGetClaim(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok || !s.claimsReady(w) {
		return
	}
	claim, ok := s.loadClaim(w, r, "")
	if !ok {
		return
	}
	s.writeThread(w, r, claim, support.AuthorAdmin)
}

// adminClaimScreenshot is the claim's full-page screenshot as an image.
func (s *Server) adminClaimScreenshot(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok || !s.claimsReady(w) {
		return
	}
	claim, err := s.claims.Screenshot(r.Context(), r.PathValue("id"))
	if errors.Is(err, mongo.ErrNoDocuments) || (err == nil && len(claim.Screenshot) == 0) {
		writeError(w, http.StatusNotFound, "screenshot not found")
		return
	}
	if err != nil {
		slog.Error("acorn admin claim screenshot", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load the screenshot")
		return
	}
	w.Header().Set("Content-Type", claim.ScreenshotMIME)
	w.Header().Set("Content-Length", strconv.Itoa(len(claim.Screenshot)))
	w.Header().Set("Cache-Control", "private, max-age=3600")
	_, _ = w.Write(claim.Screenshot)
}

func (s *Server) adminPostClaimMessage(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok || !s.claimsReady(w) {
		return
	}
	claim, ok := s.loadClaim(w, r, "")
	if !ok {
		return
	}
	s.addClaimMessage(w, r, claim, support.AuthorAdmin, supportAuthorName)
}

func (s *Server) adminReadClaim(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok || !s.claimsReady(w) {
		return
	}
	s.markClaimRead(w, r, r.PathValue("id"), support.AuthorAdmin)
}

func (s *Server) adminPatchClaim(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok || !s.claimsReady(w) {
		return
	}
	var body struct {
		Status string `json:"status"`
	}
	if !decode(w, r, &body) {
		return
	}
	status := strings.TrimSpace(body.Status)
	if status != support.StatusOpen && status != support.StatusClosed {
		writeError(w, http.StatusBadRequest, "invalid status")
		return
	}
	claim, err := s.claims.SetStatus(r.Context(), r.PathValue("id"), status)
	if errors.Is(err, mongo.ErrNoDocuments) {
		writeError(w, http.StatusNotFound, "claim not found")
		return
	}
	if err != nil {
		slog.Error("acorn admin claim", "error", err)
		writeError(w, http.StatusInternalServerError, "could not update claim")
		return
	}
	if s.sockets != nil {
		s.sockets.EmitToAccount(claim.AccountID, gateway.SupportClaimEvent, map[string]any{
			"claim": claimRow(claim, support.AuthorUser),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "claim": claimRow(claim, support.AuthorAdmin)})
}
