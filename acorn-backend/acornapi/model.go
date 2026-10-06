package acornapi

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/sid0709/OpenSeat/acorn-backend/acorn"
	"github.com/sid0709/OpenSeat/acorn-backend/resume"
	"github.com/sid0709/OpenSeat/backend-core/openai"
)

// openRouter is the signed-in account's model. An empty profile key is not ready.
func (s *Server) openRouter(ctx context.Context, accountID string) (*openai.Client, error) {
	doc, stored, err := s.profiles.Load(ctx, accountID)
	if err != nil {
		return nil, err
	}
	key := ""
	if stored {
		key = doc.OpenrouterApiKey
	}
	return openai.OpenRouter(key), nil
}

func (s *Server) writeProfileErr(w http.ResponseWriter, err error) {
	slog.Error("acorn profile", "error", err)
	writeError(w, http.StatusInternalServerError, "could not load the profile")
}

// acornFor runs this request on the bound test model, or on the profile's OpenRouter key.
func (s *Server) acornFor(w http.ResponseWriter, r *http.Request, accountID string) (*acorn.Service, bool) {
	if _, ok := s.acorn.Bound(); ok {
		return s.acorn, true
	}
	client, err := s.openRouter(r.Context(), accountID)
	if err != nil {
		s.writeProfileErr(w, err)
		return nil, false
	}
	return s.acorn.WithModel(client), true
}

// resumeModel is the bound test model, or the profile's OpenRouter client.
func (s *Server) resumeModel(w http.ResponseWriter, r *http.Request, accountID string) (resume.Model, bool) {
	if bound, ok := s.resumes.Bound(); ok {
		return bound, true
	}
	client, err := s.openRouter(r.Context(), accountID)
	if err != nil {
		s.writeProfileErr(w, err)
		return nil, false
	}
	return client, true
}
