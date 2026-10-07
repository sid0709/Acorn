package acorn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/sid0709/OpenSeat/backend-core/openai"
)

const (
	proseTimeout = 20 * time.Second
	// writerConcurrency caps the writer calls one request keeps in flight: each
	// field is written by its own call, so the slowest answer, not the sum of
	// every answer, sets how long writing takes.
	writerConcurrency = 8
	identityTimeout   = 8 * time.Second
	extractTimeout    = 25 * time.Second
	// fieldsTimeout bounds field discovery: one read of the whole planner tree.
	fieldsTimeout = 45 * time.Second
	maxQuestion   = 8000
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

const (
	PurposeAnalyze   Purpose = "analyze"
	PurposeIdentity  Purpose = "identity"
	PurposeTyping    Purpose = "typing-rewrite"
	PurposeAnswer    Purpose = "qa"
	PurposeExtractJD Purpose = "extract-jd"
	PurposeRefill    Purpose = "refill"
	PurposeFields    Purpose = "fields"
)

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

// Classifier answers "which of these kinds is each question?" with a decision
// model. The SelectorGateway (TypeSafe Jev) is the real one.
type Classifier interface {
	ClassifyEach(ctx context.Context, instructions string, kinds map[string]string, items map[int]string) (map[int]string, error)
	// PickOne compares the items side by side and returns the id of the one that fits.
	PickOne(ctx context.Context, instructions string, items map[int]string) (int, error)
}

type Service struct {
	model      Model
	tracer     Tracer
	classifier Classifier
	picker     ChoicePicker
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

// WithClassifier returns a copy that classifies identity questions with the
// decision model instead of the text model, in parallel with the writer.
func (s *Service) WithClassifier(classifier Classifier) *Service {
	next := *s
	next.classifier = classifier
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

// AnalyzeResult is what the extension runs: a plan of form actions.
type AnalyzeResult struct {
	OK         bool    `json:"ok"`
	Plan       Plan    `json:"plan"`
	Model      string  `json:"model"`
	ResponseID *string `json:"responseId"`
	// Mode echoes ModeRefill on a Refill plan, so the extension knows the backend honored it.
	Mode string `json:"mode,omitempty"`
	// Fields are the questions a fast plan found in the planner tree, answered or not.
	Fields []FormField `json:"fields,omitempty"`
}

// Analyze plans a fill of every answerable control in the pure tree from the
// applicant's profile, then classifies identity questions and rewrites typed answers.
func (s *Service) Analyze(ctx context.Context, applicant, pureTree string, page map[string]any) (AnalyzeResult, error) {
	if strings.TrimSpace(pureTree) == "" {
		return AnalyzeResult{}, fmt.Errorf("%w: pureTree is required", ErrInvalid)
	}
	// Generate and Recommend can attach a résumé, so the planner may emit resume_upload.
	page = withResumeAvailable(page)

	text, err := s.ask(ctx, PurposeAnalyze, analyzeSystem, analyzeUserPrompt(applicant, pureTree, page), actionPlanSchema())
	if err != nil {
		return AnalyzeResult{}, err
	}
	var plan Plan
	if err := decodeModelJSON(text, &plan); err != nil {
		return AnalyzeResult{}, err
	}
	if err := validatePlan(plan); err != nil {
		return AnalyzeResult{}, err
	}

	plan = s.finishPlan(ctx, plan, applicant, page, nil)
	return AnalyzeResult{OK: true, Plan: plan, Model: s.model.Model()}, nil
}

// finishPlan flips answers to "did you use AI to apply" questions to No and has
// the writer rewrite prose drafts. With a decision-model classifier the two run
// at the same time; the text-model classifier runs first, as before.
func (s *Service) finishPlan(ctx context.Context, plan Plan, applicant string, page map[string]any, notes map[int]string) Plan {
	fields := collectIdentityQuestions(plan)
	if s.classifier == nil {
		identity := s.classifyIdentity(ctx, fields)
		plan = applyApplicantIdentity(plan, identity)
		plan = s.rewriteTyping(ctx, plan, applicant, page, notes)
		return applyApplicantIdentity(plan, identity)
	}
	identityDone := make(chan map[int]bool, 1)
	go func() { identityDone <- s.classifyIdentityByDecision(ctx, fields) }()
	plan = s.rewriteTyping(ctx, plan, applicant, page, notes)
	return applyApplicantIdentity(plan, <-identityDone)
}

func withResumeAvailable(page map[string]any) map[string]any {
	next := make(map[string]any, len(page)+1)
	for key, value := range page {
		next[key] = value
	}
	next["recommendedResumeAvailable"] = true
	return next
}

// classifyIdentity finds the questions about the applicant being an AI. It fails open.
func (s *Service) classifyIdentity(ctx context.Context, fields []identityQuestion) map[int]bool {
	if len(fields) == 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, identityTimeout)
	defer cancel()
	text, err := s.ask(ctx, PurposeIdentity, identitySystem, identityUserPrompt(fields), identitySchema())
	if err == nil {
		var indexes map[int]bool
		if indexes, err = parseApplicationAI(text, fields); err == nil {
			return indexes
		}
	}
	slog.Warn("acorn identity classify skipped", "error", err)
	return nil
}

// rewriteTyping has the writer replace planner drafts in typed fields. It fails open.
// notes carries the page's error per element_index, so the rewrite still passes it.
func (s *Service) rewriteTyping(ctx context.Context, plan Plan, applicant string, page map[string]any, notes map[int]string) Plan {
	fields := proseFields(typingFields(plan))
	if len(fields) == 0 {
		return plan
	}
	for i := range fields {
		fields[i].Note = notes[fields[i].ElementIndex]
	}
	answers, err := s.writeAnswers(ctx, applicant, page, fields)
	if err != nil {
		slog.Warn("acorn typing-field rewrite skipped", "error", err)
		return plan
	}
	return overlayTypingFills(plan, answers)
}

// writeAnswers has the writer answer typed fields, keyed by element index. Each
// field is its own call, run in parallel; every call also lists the form's other
// questions so answers do not repeat one another. A field whose call fails is
// left out; the error returns only when no field got an answer.
func (s *Service) writeAnswers(ctx context.Context, applicant string, page map[string]any, fields []typingField) (map[int]string, error) {
	if len(fields) <= 1 {
		return s.writeBatch(ctx, applicant, page, fields, nil)
	}
	var (
		mu       sync.Mutex
		wg       sync.WaitGroup
		out      = make(map[int]string, len(fields))
		firstErr error
		slots    = make(chan struct{}, writerConcurrency)
	)
	for i, field := range fields {
		others := make([]string, 0, len(fields)-1)
		for j, other := range fields {
			if j != i {
				others = append(others, other.Question)
			}
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			answers, err := s.writeBatch(ctx, applicant, page, []typingField{field}, others)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				if firstErr == nil {
					firstErr = err
				}
				return
			}
			for index, answer := range answers {
				out[index] = answer
			}
		}()
	}
	wg.Wait()
	if len(out) == 0 && firstErr != nil {
		return nil, firstErr
	}
	return out, nil
}

// writeBatch is one writer call answering fields; others are the form's other
// questions, answered separately, named so this answer does not repeat them.
func (s *Service) writeBatch(ctx context.Context, applicant string, page map[string]any, fields []typingField, others []string) (map[int]string, error) {
	ctx, cancel := context.WithTimeout(ctx, proseTimeout)
	defer cancel()
	text, err := s.ask(ctx, PurposeTyping, proseSystem, proseUserPrompt(applicant, fields, page, others...), proseAnswersSchema())
	if err != nil {
		return nil, err
	}
	allowed := map[int]bool{}
	for _, field := range fields {
		allowed[field.ElementIndex] = true
	}
	return parseProseAnswers(text, allowed)
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

// JDResult says whether a page holds a job posting and, if so, its text.
type JDResult struct {
	OK                bool    `json:"ok"`
	HasJobDescription bool    `json:"hasJobDescription"`
	JobDescription    *string `json:"jobDescription"`
	Reason            string  `json:"reason"`
	Model             string  `json:"model"`
}

const noJDReason = "No job description on this page"

// ExtractJD reads the posting out of page text captured from a browser tab.
func (s *Service) ExtractJD(ctx context.Context, pageText string, meta any) (JDResult, error) {
	pageText = strings.TrimSpace(pageText)
	if pageText == "" {
		pageText = MetaToPageText(meta)
	}
	if pageText == "" {
		return JDResult{}, fmt.Errorf("%w: pageText or meta is required", ErrInvalid)
	}
	ctx, cancel := context.WithTimeout(ctx, extractTimeout)
	defer cancel()
	text, err := s.ask(ctx, PurposeExtractJD, extractJDSystem, "Page text:\n\n"+pageText, extractJDSchema())
	if err != nil {
		return JDResult{}, err
	}
	var parsed struct {
		HasJobDescription bool    `json:"hasJobDescription"`
		JobDescription    *string `json:"jobDescription"`
		Reason            string  `json:"reason"`
	}
	if err := decodeObject(text, &parsed); err != nil {
		return JDResult{}, errors.New("JD extract returned invalid JSON")
	}
	reason := strings.TrimSpace(parsed.Reason)
	extracted := ""
	if parsed.JobDescription != nil {
		extracted = strings.TrimSpace(*parsed.JobDescription)
	}
	result := JDResult{OK: true, Model: s.model.Model()}
	if !parsed.HasJobDescription || extracted == "" {
		if reason == "" {
			reason = noJDReason
		}
		result.Reason = reason
		return result, nil
	}
	if reason == "" {
		reason = "Job description found"
	}
	result.HasJobDescription, result.JobDescription, result.Reason = true, &extracted, reason
	return result, nil
}
