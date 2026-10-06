package acornapi

import (
	"encoding/base64"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/account"
	"github.com/sid0709/OpenSeat/acorn-backend/resume"
)

func (s *Server) identity(session account.Session, extra *resume.Identity) resume.Identity {
	out := resume.Identity{FullName: session.User.Name, Email: session.User.Email}
	if extra == nil {
		return out
	}
	if extra.FullName != "" {
		out.FullName = extra.FullName
	}
	if extra.Email != "" {
		out.Email = extra.Email
	}
	out.Location = extra.Location
	out.Phone = extra.Phone
	out.Linkedin = extra.Linkedin
	out.Careers = extra.Careers
	out.Education = extra.Education
	return out
}

func (s *Server) getConfig(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "config": s.resumes.Config(session.User.ID)})
}

func (s *Server) putConfig(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body map[string]any
	if !decode(w, r, &body) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "config": s.resumes.SaveConfig(session.User.ID, body)})
}

func (s *Server) previewResume(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		Identity *resume.Identity `json:"identity"`
		Sections map[string]any   `json:"sections"`
		Config   map[string]any   `json:"config"`
	}
	if !decode(w, r, &body) {
		return
	}
	html := s.resumes.Preview(session.User.ID, s.identity(session, body.Identity), body.Sections, body.Config)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "html": html})
}

func (s *Server) listTemplates(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	rows := s.resumes.Templates(session.User.ID)
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, resume.PublicTemplate(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "templates": out})
}

func (s *Server) uploadTemplate(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		Name          string `json:"name"`
		FileName      string `json:"fileName"`
		ContentBase64 string `json:"contentBase64"`
	}
	if !decode(w, r, &body) {
		return
	}
	data, err := base64.StdEncoding.DecodeString(body.ContentBase64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "file must be base64")
		return
	}
	row, err := s.resumes.UploadTemplate(session.User.ID, body.Name, body.FileName, data)
	if err != nil {
		s.writeResumeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"success": true, "template": resume.PublicTemplate(row)})
}

func (s *Server) deleteTemplate(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	if err := s.resumes.DeleteTemplate(session.User.ID, r.PathValue("templateId")); err != nil {
		s.writeResumeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) startGenerate(w http.ResponseWriter, r *http.Request) {
	s.startGenerateFor(w, r, "")
}

func (s *Server) generateForJob(w http.ResponseWriter, r *http.Request) {
	s.startGenerateFor(w, r, r.PathValue("jobId"))
}

func (s *Server) startGenerateFor(w http.ResponseWriter, r *http.Request, jobID string) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		JobDescription string           `json:"jobDescription"`
		JobID          string           `json:"jobId"`
		Identity       *resume.Identity `json:"identity"`
		Checkpoint     map[string]any   `json:"checkpoint"`
	}
	if !decode(w, r, &body) {
		return
	}
	if jobID == "" {
		jobID = body.JobID
	}
	task, err := s.resumes.Enqueue(session.User.ID, s.identity(session, body.Identity), body.JobDescription, jobID, body.Checkpoint)
	if err != nil {
		s.writeResumeErr(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "inputId": task.ID})
}

func (s *Server) continueGenerate(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		JobDescription string           `json:"jobDescription"`
		JobID          string           `json:"jobId"`
		Identity       *resume.Identity `json:"identity"`
		Checkpoint     map[string]any   `json:"checkpoint"`
	}
	if !decode(w, r, &body) {
		return
	}
	task, err := s.resumes.Continue(session.User.ID, r.PathValue("inputId"), s.identity(session, body.Identity), body.JobDescription, body.JobID, body.Checkpoint)
	if err != nil {
		s.writeResumeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "inputId": task.ID, "recovered": true})
}

func (s *Server) pollGenerate(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	task, err := s.resumes.Poll(session.User.ID, r.PathValue("inputId"))
	if err != nil {
		s.writeResumeErr(w, err)
		return
	}
	status := task.Status
	if status == "" {
		status = "queued"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": status, "generationId": emptyNil(task.GenerationID), "resumeId": emptyNil(task.ResumeID),
		"error": emptyNil(task.Error), "partialSections": task.Partial, "progress": task.Progress,
		"result": map[string]any{"generationId": emptyNil(task.GenerationID), "resumeId": emptyNil(task.ResumeID)},
	})
}

func (s *Server) listGenerations(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	query := resume.HistoryQuery{
		Search: q.Get("search"), SearchIn: q.Get("searchIn"), Status: q.Get("status"),
		Model: q.Get("model"), Provider: q.Get("provider"), TemplateID: q.Get("templateId"),
		From: parseQueryDay(q.Get("from")), To: endOfDay(parseQueryDay(q.Get("to"))),
		Sort: q.Get("sort"), Limit: limit, Offset: offset, Facets: q.Get("includeFacets") == "1",
	}
	if query.Search == "" {
		query.Search = q.Get("q")
	}
	runs, total, facets := s.resumes.History(session.User.ID, query)
	out := make([]map[string]any, 0, len(runs))
	for _, row := range runs {
		out = append(out, resume.PublicRun(row))
	}
	body := map[string]any{"success": true, "runs": out, "total": total, "limit": limitOrDefault(limit), "offset": offset}
	if facets != nil {
		body["facets"] = facets
	}
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) getGeneration(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	row, err := s.resumes.Generation(session.User.ID, r.PathValue("generationId"))
	if err != nil {
		s.writeResumeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "run": resume.PublicRun(row)})
}

func (s *Server) deleteGeneration(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	if err := s.resumes.DeleteGeneration(session.User.ID, r.PathValue("generationId")); err != nil {
		s.writeResumeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "deleted": true})
}

func (s *Server) generationDocx(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	data, name, err := s.resumes.GenerationDocx(session.User.ID, r.PathValue("generationId"))
	if err != nil {
		s.writeResumeErr(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *Server) generationPreview(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	html, err := s.resumes.GenerationPreview(session.User.ID, r.PathValue("generationId"))
	if err != nil {
		s.writeResumeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "html": html})
}

func (s *Server) listLibrary(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	rows := s.resumes.Library(session.User.ID)
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, resume.PublicRow(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "resumes": out})
}

func (s *Server) uploadLibrary(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		FileName      string `json:"fileName"`
		Title         string `json:"title"`
		ContentBase64 string `json:"contentBase64"`
	}
	if !decode(w, r, &body) {
		return
	}
	data, err := base64.StdEncoding.DecodeString(body.ContentBase64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "file must be base64")
		return
	}
	row, err := s.resumes.UploadLibrary(session.User.ID, body.FileName, body.Title, data)
	if err != nil {
		s.writeResumeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"success": true, "resume": resume.PublicRow(row)})
}

func (s *Server) deleteLibrary(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	if err := s.resumes.DeleteLibrary(session.User.ID, r.PathValue("resumeId")); err != nil {
		s.writeResumeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) analyzeLibrary(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	row, err := s.resumes.AnalyzeLibrary(session.User.ID, r.PathValue("resumeId"))
	if err != nil {
		s.writeResumeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "resume": resume.PublicRow(row)})
}

func (s *Server) primaryLibrary(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	row, err := s.resumes.SetPrimary(session.User.ID, r.PathValue("resumeId"))
	if err != nil {
		s.writeResumeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "resume": resume.PublicRow(row)})
}

func (s *Server) libraryFile(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	file, err := s.resumes.LibraryFile(session.User.ID, r.PathValue("resumeId"))
	if err != nil {
		s.writeResumeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "file": file, "resumeId": file.ResumeID, "stack": file.Label})
}

func (s *Server) libraryPreview(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	html, err := s.resumes.LibraryPreview(session.User.ID, r.PathValue("resumeId"))
	if err != nil {
		s.writeResumeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "html": html})
}

func (s *Server) customLibraryResume(w http.ResponseWriter, r *http.Request) {
	s.libraryFile(w, r)
}

func (s *Server) customLibraryPreview(w http.ResponseWriter, r *http.Request) {
	s.libraryPreview(w, r)
}

func (s *Server) customGeneratedResume(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	file, err := s.resumes.GeneratedFile(session.User.ID, r.PathValue("generationId"))
	if err != nil {
		s.writeResumeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true, "file": file, "generationId": r.PathValue("generationId"), "resumeId": file.ResumeID, "stack": file.Label,
	})
}

func (s *Server) customGeneratedPreview(w http.ResponseWriter, r *http.Request) {
	s.generationPreview(w, r)
}

func (s *Server) recommendLibrary(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		JobDescription string `json:"jobDescription"`
		JobID          string `json:"jobId"`
	}
	if !decode(w, r, &body) {
		return
	}
	id, stack, reason, err := s.resumes.Recommend(session.User.ID, body.JobDescription, body.JobID)
	if err != nil {
		s.writeResumeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"recommendedResumeId": id, "recommendedResumeStack": stack, "recommendedResumeReason": reason, "warning": nil,
	})
}

func (s *Server) jobRecommendedResume(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	file, resumeID, stack, err := s.resumes.JobResume(session.User.ID, r.PathValue("jobId"))
	if errors.Is(err, resume.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "jobId": r.PathValue("jobId"), "resumeId": nil, "stack": nil})
		return
	}
	if err != nil {
		s.writeResumeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "file": file, "jobId": r.PathValue("jobId"), "resumeId": resumeID, "stack": stack})
}

func (s *Server) jobResumePreview(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	html, err := s.resumes.JobPreview(session.User.ID, r.PathValue("jobId"))
	if errors.Is(err, resume.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "html": ""})
		return
	}
	if err != nil {
		s.writeResumeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "html": html})
}

func (s *Server) writeResumeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, resume.ErrInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, resume.ErrNotFound), errors.Is(err, resume.ErrNoLibrary):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, resume.ErrUnavailable):
		writeError(w, http.StatusServiceUnavailable, err.Error())
	default:
		writeError(w, http.StatusBadGateway, err.Error())
	}
}

func emptyNil(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func parseQueryDay(value string) time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}
	}
	if day, err := time.Parse("2006-01-02", value); err == nil {
		return day
	}
	t, _ := time.Parse(time.RFC3339, value)
	return t
}

func endOfDay(day time.Time) time.Time {
	if day.IsZero() {
		return day
	}
	return day.Add(24*time.Hour - time.Nanosecond)
}

func limitOrDefault(limit int) int {
	if limit <= 0 {
		return 15
	}
	return limit
}
