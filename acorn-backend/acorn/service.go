package acorn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/backend-core/openai"
)

const (
	proseTimeout = 20 * time.Second
	maxQuestion  = 8000
)

// ErrModelUnavailable is returned when no model key is configured.
var ErrModelUnavailable = errors.New("the AI model is not configured")

// ErrInvalid is a request the extension should fix, not retry.
var ErrInvalid = errors.New("invalid request")

// Model is the language model behind Acorn: one JSON object per request, matching a schema.
type Model interface {
	JSON(ctx context.Context, system, user string, schema json.RawMessage) ([]byte, error)
	Model() string
	Ready() bool
}

// Purpose names what a model call is for, so a trace can tell the calls apart.
type Purpose string

// PurposeAnswer is a written answer to one free-text question.
const PurposeAnswer Purpose = "qa"

// Call is one model request and what came back, handed to a Tracer.
type Call struct {
	Purpose  Purpose
	Model    string
	System   string
	User     string
	Schema   json.RawMessage
	Output   []byte
	Err      error
	Duration time.Duration
}

// Tracer sees every model call. It must not block or fail the request.
type Tracer func(ctx context.Context, call Call)

type Service struct {
	model  Model
	tracer Tracer
}

func New(model Model) *Service { return &Service{model: model} }

// Bound is the model this service was built with, when that model can answer.
// Production leaves it unset and resolves a profile key per request.
func (s *Service) Bound() (Model, bool) {
	if s == nil || s.model == nil || !s.model.Ready() {
		return nil, false
	}
	return s.model, true
}

// WithModel returns a copy that calls model and keeps this service's tracer.
func (s *Service) WithModel(model Model) *Service {
	if s == nil {
		return &Service{model: model}
	}
	next := *s
	next.model = model
	return &next
}

// SetTracer records every model call (local debug capture). Nil turns it off.
func (s *Service) SetTracer(tracer Tracer) { s.tracer = tracer }

func (s *Service) ask(ctx context.Context, purpose Purpose, system, user string, schema json.RawMessage) (string, error) {
	if s.model == nil || !s.model.Ready() {
		return "", ErrModelUnavailable
	}
	started := time.Now()
	ctx = openai.WithCall(ctx, string(purpose))
	raw, err := s.model.JSON(ctx, system, user, schema)
	if s.tracer != nil {
		s.tracer(ctx, Call{
			Purpose: purpose, Model: s.model.Model(), System: system, User: user, Schema: schema,
			Output: raw, Err: err, Duration: time.Since(started),
		})
	}
	return string(raw), err
}

// QAResult is a written answer to one free-text question.
type QAResult struct {
	OK     bool   `json:"ok"`
	Answer string `json:"answer"`
	Model  string `json:"model"`
}

// Answer writes the applicant's answer to a question that Fill left blank.
func (s *Service) Answer(ctx context.Context, applicant, question string, page map[string]any) (QAResult, error) {
	question = strings.TrimSpace(question)
	if question == "" || len([]rune(question)) > maxQuestion {
		return QAResult{}, fmt.Errorf("%w: question must be 1-%d characters", ErrInvalid, maxQuestion)
	}
	ctx, cancel := context.WithTimeout(ctx, proseTimeout)
	defer cancel()
	fields := []typingField{{ElementIndex: qaFieldIndex, Question: question, Role: "textarea"}}
	text, err := s.ask(ctx, PurposeAnswer, proseSystem, proseUserPrompt(applicant, fields, page), proseAnswersSchema())
	if err != nil {
		return QAResult{}, err
	}
	answers, err := parseProseAnswers(text, map[int]bool{qaFieldIndex: true})
	if err != nil {
		return QAResult{}, err
	}
	answer := strings.TrimSpace(answers[qaFieldIndex])
	if answer == "" {
		return QAResult{}, errors.New("writer returned no answer")
	}
	return QAResult{OK: true, Answer: answer, Model: s.model.Model()}, nil
}
