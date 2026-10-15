package acornapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/sid0709/OpenSeat/acorn-backend/support"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

// supportAuthorName is how admin replies are signed to the reporter.
const supportAuthorName = "Acorn Support"

func (s *Server) adminListClaims(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok || !s.claimsReady(w) {
		return
	}
	t := startTiming()
	q := r.URL.Query()
	rows, err := s.claims.List(r.Context(), strings.TrimSpace(q.Get("status")), q.Get("q"))
	t.step(timingList)
	if err != nil {
		slog.Error("acorn admin claims", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load claims")
		return
	}
	open, awaiting, err := s.claims.Counts(r.Context())
	t.step(timingCounts)
	if err != nil {
		slog.Error("acorn admin claim counts", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load claims")
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, claimRow(row, support.AuthorAdmin))
	}
	t.apply(w)
	writeJSON(w, http.StatusOK, map[string]any{"claims": out, "open": open, "awaitingSupport": awaiting})
}

func (s *Server) adminGetClaim(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok || !s.claimsReady(w) {
		return
	}
	t := startTiming()
	claim, ok := s.loadClaim(w, r, "")
	if !ok {
		return
	}
	t.step(timingClaim)
	s.writeThread(w, r, claim, support.AuthorAdmin, t)
}

// adminClaimScreenshot is the claim's full-page screenshot as an image; `?size=thumb` answers
// with the small preview of its top when there is one.
func (s *Server) adminClaimScreenshot(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok || !s.claimsReady(w) {
		return
	}
	t := startTiming()
	id := r.PathValue("id")
	if r.URL.Query().Get(imageSizeParam) == imageSizeThumb {
		preview, ok, err := s.claims.ScreenshotPreview(r.Context(), id)
		t.step(timingImage)
		if err == nil && ok {
			writeImage(w, t, preview.MIME, preview.Data, immutableCacheControl)
			return
		}
		if errors.Is(err, mongo.ErrNoDocuments) {
			writeError(w, http.StatusNotFound, "screenshot not found")
			return
		}
		if err != nil {
			slog.Error("acorn admin claim screenshot preview", "error", err)
		}
		// Anything else falls through to the original.
		t = startTiming()
	}
	claim, err := s.claims.Screenshot(r.Context(), id)
	t.step(timingImage)
	if errors.Is(err, mongo.ErrNoDocuments) || (err == nil && len(claim.Screenshot) == 0) {
		writeError(w, http.StatusNotFound, "screenshot not found")
		return
	}
	if err != nil {
		slog.Error("acorn admin claim screenshot", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load the screenshot")
		return
	}
	writeImage(w, t, claim.ScreenshotMIME, claim.Screenshot, screenshotCacheControl)
}

// screenshotCacheControl is for the original, which the console rarely asks for; its
// copies are the ones kept for good.
const screenshotCacheControl = "private, max-age=3600"

func writeImage(w http.ResponseWriter, t *timing, mime string, data []byte, cacheControl string) {
	h := w.Header()
	h.Set("Content-Type", mime)
	h.Set("Content-Length", strconv.Itoa(len(data)))
	h.Set("Cache-Control", cacheControl)
	t.apply(w)
	_, _ = w.Write(data)
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

// adminPatchClaim resolves or reopens a claim; the conversation records the change.
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
	kind, ok := statusKinds[strings.TrimSpace(body.Status)]
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid status")
		return
	}
	claim, ok := s.loadClaim(w, r, "")
	if !ok {
		return
	}
	if claim.Status == strings.TrimSpace(body.Status) {
		writeJSON(w, http.StatusOK, map[string]any{"claim": claimRow(claim, support.AuthorAdmin)})
		return
	}
	s.postMessage(w, r, claim, support.Draft{Author: support.AuthorAdmin, AuthorName: supportAuthorName, Kind: kind})
}

// statusKinds is the conversation event each status a console may set records.
var statusKinds = map[string]string{
	support.StatusOpen:   support.KindReopened,
	support.StatusClosed: support.KindResolved,
}
