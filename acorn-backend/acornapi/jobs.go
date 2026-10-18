package acornapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/sid0709/OpenSeat/acorn-backend/internal/jobs"
)

const notSpecified = "Not specified"

// workerJob is the catalog row Fill loads for a tab's job.
type workerJob struct {
	ID                      string  `json:"id"`
	Title                   string  `json:"title"`
	Company                 string  `json:"company"`
	CompanyLogoURL          string  `json:"companyLogoUrl"`
	Location                string  `json:"location"`
	WorkMode                string  `json:"workMode"`
	ApplyURL                string  `json:"applyUrl"`
	JobDescription          string  `json:"jobDescription"`
	HasJobDescription       bool    `json:"hasJobDescription"`
	WorkerPoolAt            *string `json:"workerPoolAt"`
	GeneratedResume         bool    `json:"generatedResume"`
	RecommendedResumeStack  *string `json:"recommendedResumeStack"`
	RecommendedResumeID     *string `json:"recommendedResumeId"`
	RecommendedResumeReason *string `json:"recommendedResumeReason"`
	RecommendWarning        *string `json:"recommendWarning"`
	RecommendedAt           *string `json:"recommendedAt"`
}

func (s *Server) workerJob(ctx context.Context, id string) (workerJob, error) {
	job, err := s.listings.GetCatalogJob(ctx, id)
	if err != nil {
		return workerJob{}, err
	}
	description := strings.TrimSpace(job.Description)
	return workerJob{
		ID:                job.ID,
		Title:             orDefault(job.Title, "Untitled role"),
		Company:           orDefault(job.Company, "Unknown company"),
		CompanyLogoURL:    httpURL(job.CompanyLogo),
		Location:          orDefault(job.Location, notSpecified),
		WorkMode:          workMode(job.Workplace),
		ApplyURL:          httpURL(job.ApplyLink),
		JobDescription:    description,
		HasJobDescription: description != "",
	}, nil
}

func (s *Server) getJob(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.session(w, r); !ok {
		return
	}
	id := r.PathValue("jobId")
	row, err := s.workerJob(r.Context(), id)
	if errors.Is(err, jobs.ErrNotFound) {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}
	if err != nil {
		slog.Error("acorn job", "job", id, "error", err)
		writeError(w, http.StatusInternalServerError, "could not load the job")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "job": row})
}

func orDefault(value, fallback string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return fallback
}

func httpURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.HasPrefix(raw, "//") {
		raw = "https:" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	return parsed.String()
}

func workMode(value string) string {
	displayed := strings.TrimSpace(value)
	lower := strings.ToLower(displayed)
	switch {
	case strings.Contains(lower, "remote"):
		return "Remote"
	case strings.Contains(lower, "hybrid"):
		return "Hybrid"
	case strings.Contains(lower, "on-site"), strings.Contains(lower, "onsite"), strings.Contains(lower, "office"):
		return "On-site"
	}
	return orDefault(displayed, notSpecified)
}
