package acornapi

import (
	"archive/zip"
	"fmt"
	"log/slog"
	"net/http"
	"path"
	"strings"

	"github.com/sid0709/OpenSeat/acorn-backend/support"
)

// storeClaimDebugLog copies the tab's whole captured session onto the claim: every
// run folder kept for it (pages, trees, decisions, prompts, plans, step traces,
// screenshots). messageID is empty for the opening report. A report still succeeds
// when nothing was captured or the copy fails; the count is how many files were stored.
func (s *Server) storeClaimDebugLog(r *http.Request, claimID, accountID, messageID string) int {
	if s.debug == nil || s.claims == nil || claimID == "" || accountID == "" {
		return 0
	}
	artifacts, err := s.debug.Session(r.Context(), debugKey(r, accountID), support.MaxDebugFileBytes)
	if err != nil {
		slog.Error("acorn support debug log", "error", err, "claimId", claimID)
		return 0
	}
	if len(artifacts) == 0 {
		return 0
	}
	blobs := make([]support.DebugBlob, 0, len(artifacts))
	for _, artifact := range artifacts {
		blobs = append(blobs, support.DebugBlob{Name: artifact.Name, Data: artifact.Data})
	}
	stored, err := s.claims.SaveDebugLog(r.Context(), claimID, messageID, blobs)
	if err != nil {
		slog.Error("acorn support debug log", "error", err, "claimId", claimID)
	}
	return stored
}

// adminClaimDebugLog downloads the debug-run files stored with a claim.
func (s *Server) adminClaimDebugLog(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminSession(w, r); !ok || !s.claimsReady(w) {
		return
	}
	id := r.PathValue("id")
	files, err := s.claims.DebugLog(r.Context(), id)
	if err != nil {
		slog.Error("acorn admin claim debug log", "error", err)
		writeError(w, http.StatusInternalServerError, "could not load the debug log")
		return
	}
	if len(files) == 0 {
		writeError(w, http.StatusNotFound, "debug log not found")
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", "acorn-debug-log-"+id+".zip"))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	zw := zip.NewWriter(w)
	for _, file := range files {
		writer, createErr := zw.Create(debugZipPath(file))
		if createErr != nil {
			slog.Error("acorn admin claim debug log", "error", createErr)
			_ = zw.Close()
			return
		}
		if _, writeErr := writer.Write(file.Data); writeErr != nil {
			slog.Error("acorn admin claim debug log", "error", writeErr)
			_ = zw.Close()
			return
		}
	}
	if err := zw.Close(); err != nil {
		slog.Error("acorn admin claim debug log", "error", err)
	}
}

// debugZipPath files a stored debug file under the report or follow-up it came
// with, keeping its run folder. Nothing climbs out of that folder.
func debugZipPath(file support.DebugFile) string {
	dir := "report"
	if file.MessageID != "" {
		dir = "follow-up-" + file.MessageID
	}
	name := strings.TrimPrefix(path.Clean("/"+file.Name), "/")
	if name == "" || name == "." {
		name = "file"
	}
	return dir + "/" + name
}
