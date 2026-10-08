package acornapi

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/sid0709/OpenSeat/acorn-backend/acorn"
	"github.com/sid0709/OpenSeat/acorn-backend/resume"
	"github.com/sid0709/OpenSeat/acorn-backend/selector"
	"github.com/sid0709/OpenSeat/backend-core/jev"
	"github.com/sid0709/OpenSeat/backend-core/openai"
)

// openRouterKey is the signed-in account's OpenRouter key; "" when the profile has none.
func (s *Server) openRouterKey(ctx context.Context, accountID string) (string, error) {
	doc, stored, err := s.profiles.Load(ctx, accountID)
	if err != nil || !stored {
		return "", err
	}
	return doc.OpenrouterApiKey, nil
}

// accountPassword is the profile's default password for job-site accounts; "" when it has none.
func (s *Server) accountPassword(ctx context.Context, accountID string) (string, error) {
	doc, stored, err := s.profiles.Load(ctx, accountID)
	if err != nil || !stored {
		return "", err
	}
	return doc.DefaultAccountPassword, nil
}

// openRouter is the signed-in account's model. An empty profile key is not ready.
func (s *Server) openRouter(ctx context.Context, accountID string) (*openai.Client, error) {
	key, err := s.openRouterKey(ctx, accountID)
	if err != nil {
		return nil, err
	}
	return openai.OpenRouter(key), nil
}

// selectorFor is the SelectorGateway for this request: the bound test gateway, or
// Jev on the account's OpenRouter key.
func (s *Server) selectorFor(w http.ResponseWriter, r *http.Request, accountID string) (*selector.Gateway, bool) {
	if s.selector != nil {
		return s.selector, true
	}
	key, err := s.openRouterKey(r.Context(), accountID)
	if err != nil {
		s.writeProfileErr(w, err)
		return nil, false
	}
	return selector.New(jev.New(key)), true
}

func (s *Server) writeProfileErr(w http.ResponseWriter, err error) {
	slog.Error("acorn profile", "error", err)
	writeError(w, http.StatusInternalServerError, "could not load the profile")
}

// acornFor runs this request on the bound test model, or on the profile's OpenRouter
// key: the text model writes, and Jev (the SelectorGateway) classifies questions.
func (s *Server) acornFor(w http.ResponseWriter, r *http.Request, accountID string) (*acorn.Service, bool) {
	if _, ok := s.acorn.Bound(); ok {
		return s.acorn, true
	}
	key, err := s.openRouterKey(r.Context(), accountID)
	if err != nil {
		s.writeProfileErr(w, err)
		return nil, false
	}
	gateway := selector.New(jev.New(key))
	return s.acorn.WithModel(openai.OpenRouter(key)).WithClassifier(gateway).WithPicker(gatewayPicker{gateway}), true
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
