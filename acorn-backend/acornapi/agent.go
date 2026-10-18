package acornapi

import (
	"encoding/base64"
	"net/http"

	"github.com/sid0709/acorn/acorn-backend/profile"
	"github.com/sid0709/acorn/acorn-backend/resume"
)

// What acorn-agent reads about the signed-in person. The agent holds no database: it asks for
// the account's profile and Library on each run, with the person's own session token, and
// fetches a file only when it is about to upload it.
//
//	GET /acorn/agent/applicant        the profile and the Library's uploaded files, named and typed
//	GET /acorn/agent/resumes/{id}     one Library file's bytes

// agentApplicant answers with the stored profile (null when the person has not saved one: the
// agent will not apply with a blank form) and the files they uploaded, résumés and cover
// letters, without their text.
func (s *Server) agentApplicant(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	doc, stored, err := s.profiles.Load(r.Context(), session.User.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the profile")
		return
	}
	var held *profile.Document
	if stored {
		held = &doc
	}
	files := []map[string]any{}
	for _, row := range s.resumes.Library(session.User.ID) {
		if resume.IsUploaded(row) {
			files = append(files, resume.AgentRow(row))
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "profile": held, "files": files})
}

// agentResume answers with one Library file's bytes, typed and named as it was uploaded.
func (s *Server) agentResume(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	id := r.PathValue("resumeId")
	payload, _, err := s.resumes.LibraryFileVersioned(session.User.ID, id)
	if err != nil {
		s.writeResumeErr(w, err)
		return
	}
	file := payload
	for _, variant := range payload.Variants {
		if variant.ResumeID == id {
			file = variant
		}
	}
	if file.ResumeID != id {
		// The id belongs to another version of this stack than the lead, and no variant is it.
		writeError(w, http.StatusNotFound, "no such file")
		return
	}
	data, err := base64.StdEncoding.DecodeString(file.Base64)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not read the file")
		return
	}
	contentType := file.MimeType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-File-Name", file.Name)
	w.Header().Set("Cache-Control", "private, no-store")
	_, _ = w.Write(data)
}
