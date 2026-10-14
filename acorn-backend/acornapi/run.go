package acornapi

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/sid0709/OpenSeat/acorn-backend/debugtrace"
	"github.com/sid0709/OpenSeat/acorn-backend/selector"
)

const (
	// maxRunControls bounds the controls one read-page request may list.
	maxRunControls = 250
	// maxRunIDLen bounds the run id the extension sends for correlating logs.
	maxRunIDLen = 40
	// diagnoseDetailLines is how many evidence lines a failure report quotes.
	diagnoseDetailLines = 3
	// maxAccountAttempts bounds the account history one read-page request may carry.
	maxAccountAttempts = 12
	// maxAccountMessages bounds the page messages kept per account attempt.
	maxAccountMessages = 3
	// maxNewTextLines bounds the new page lines one read-page request may carry.
	maxNewTextLines = 20
	// maxScopeControls bounds the controls of an opened form one read-page request may name.
	maxScopeControls = 40
)

var unsafeRunID = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)

// runControl is one clickable control the extension read from the pure tree.
type runControl struct {
	ID       int    `json:"id"`
	Tag      string `json:"tag"`
	Text     string `json:"text"`
	Label    string `json:"label"`
	Type     string `json:"type"`
	Href     string `json:"href"`
	Context  string `json:"context"`
	Disabled bool   `json:"disabled"`
	InForm   bool   `json:"inForm"`
	Dialog   string `json:"dialog"`
	Covered  bool   `json:"covered"`
	Near     string `json:"near"`
}

// runAccountAttempt is one account step the run already sent on this site.
type runAccountAttempt struct {
	Mode     string   `json:"mode"`
	Accepted bool     `json:"accepted"`
	Messages []string `json:"messages"`
}

// accountHistory keeps the attempts with a known mode, newest last, within bounds.
func accountHistory(attempts []runAccountAttempt) []selector.AccountAttempt {
	if len(attempts) > maxAccountAttempts {
		attempts = attempts[len(attempts)-maxAccountAttempts:]
	}
	out := make([]selector.AccountAttempt, 0, len(attempts))
	for _, attempt := range attempts {
		if !selector.IsAccountMode(attempt.Mode) || attempt.Mode == selector.AccountNone {
			continue
		}
		messages := attempt.Messages
		if len(messages) > maxAccountMessages {
			messages = messages[:maxAccountMessages]
		}
		out = append(out, selector.AccountAttempt{Mode: attempt.Mode, Accepted: attempt.Accepted, Messages: messages})
	}
	return out
}

// accountGoal keeps a goal the gateway knows; "" otherwise.
func accountGoal(goal string) string {
	if selector.IsAccountGoal(goal) {
		return goal
	}
	return ""
}

// cleanRunID makes a run id safe to log and to put in a file name.
func cleanRunID(id string) string {
	id = unsafeRunID.ReplaceAllString(strings.TrimSpace(id), "")
	if len(id) > maxRunIDLen {
		id = id[:maxRunIDLen]
	}
	return id
}

// logPage is a page address without its query or fragment, which can hold tokens.
func logPage(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return ""
	}
	return parsed.Host + parsed.Path
}

// runReadPage has Jev say what kind of page this is and which control to click.
// A failed decision is data, not an HTTP error: the run decides what to do next.
func (s *Server) runReadPage(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		RunID        string              `json:"runId"`
		Step         int                 `json:"step"`
		Intent       string              `json:"intent"`
		URL          string              `json:"url"`
		Title        string              `json:"title"`
		Text         string              `json:"text"`
		Controls     []runControl        `json:"controls"`
		Fields       []runField          `json:"fields"`
		Flagged      int                 `json:"flagged"`
		PageMessages []string            `json:"pageMessages"`
		Account      []runAccountAttempt `json:"account"`
		AccountGoal  string              `json:"accountGoal"`
		NewText      []string            `json:"newText"`
		LastClick    struct {
			Text       string `json:"text"`
			Role       string `json:"role"`
			SecondsAgo int    `json:"secondsAgo"`
		} `json:"lastClick"`
		// Scope is what a requirement's click opened inside the page and the run filled.
		Scope struct {
			Controls []int  `json:"controls"`
			Title    string `json:"title"`
		} `json:"scope"`
	}
	if !decode(w, r, &body) {
		return
	}
	if len(body.NewText) > maxNewTextLines {
		body.NewText = body.NewText[:maxNewTextLines]
	}
	if len(body.Scope.Controls) > maxScopeControls {
		body.Scope.Controls = body.Scope.Controls[:maxScopeControls]
	}
	if len(body.Controls) > maxRunControls {
		body.Controls = body.Controls[:maxRunControls]
	}
	if strings.TrimSpace(body.Text) == "" && len(body.Controls) == 0 {
		writeError(w, http.StatusBadRequest, "text or controls are required")
		return
	}
	intent := selector.IntentStart
	if body.Intent == selector.IntentAdvance {
		intent = selector.IntentAdvance
	}
	gateway, ok := s.selectorFor(w, r, session.User.ID)
	if !ok {
		return
	}

	runID := cleanRunID(body.RunID)
	log := slog.With("runId", runID, "step", body.Step, "intent", intent, "page", logPage(body.URL))
	controls := make([]selector.Control, 0, len(body.Controls))
	byID := make(map[int]runControl, len(body.Controls))
	for _, c := range body.Controls {
		byID[c.ID] = c
		controls = append(controls, selector.Control{
			ID: c.ID, Tag: c.Tag, Text: c.Text, Label: c.Label, Type: c.Type, Href: c.Href,
			Context: c.Context, Disabled: c.Disabled, InForm: c.InForm,
			Dialog: c.Dialog, Covered: c.Covered, Near: c.Near,
		})
	}
	log.Info("acorn run read-page", "controls", len(controls), "textChars", len([]rune(body.Text)),
		"flagged", body.Flagged, "pageMessages", len(body.PageMessages))

	started := time.Now()
	read, err := gateway.ReadPage(s.traceContext(r, session.User.ID), selector.PageQuery{
		URL: body.URL, Title: body.Title, Text: body.Text, Intent: intent,
		Controls: controls, Fields: pageFields(body.Fields), Flagged: body.Flagged, PageMessages: body.PageMessages,
		Account: accountHistory(body.Account), AccountGoal: accountGoal(body.AccountGoal),
		NewText: body.NewText, LastClick: body.LastClick.Text, LastClickRole: body.LastClick.Role,
		LastClickAgo: body.LastClick.SecondsAgo, Scope: body.Scope.Controls, ScopeTitle: body.Scope.Title,
	})
	elapsed := time.Since(started)
	s.recordRunStep(r, session.User.ID, runID, body.Step, "read-page", map[string]any{
		"request": body, "read": read, "error": errText(err), "ms": elapsed.Milliseconds(),
	})
	if err != nil {
		log.Warn("acorn run read-page failed", "error", err, "ms", elapsed.Milliseconds())
		writeJSON(w, http.StatusOK, errorBody(err))
		return
	}

	out := map[string]any{
		"ok": true, "kind": read.Kind, "kindConfidence": read.KindConfidence, "control": nil, "guest": read.Guest,
		"needsPerson": read.NeedsPerson, "verification": read.Verification, "accountMode": read.AccountMode,
		"alreadyApplied": read.AlreadyApplied,
		"model":          gateway.Model(), "usage": decisionUsage(gateway.Model(), read.Usage),
		// What the extension's log needs to explain the decision on its own: how sure
		// each answer was, and how long the server took. No prompt text.
		"kindProbabilities": read.KindProbs, "verificationProbabilities": read.VerifyProbs,
		"ms": elapsed.Milliseconds(),
	}
	attrs := []any{
		"kind", read.Kind, "kindConfidence", read.KindConfidence,
		"verification", read.Verification, "accountMode", read.AccountMode,
		"kindTop", selector.TopProbabilities(read.KindProbs, 3), "ms", elapsed.Milliseconds(), "costUsd", read.Usage.Cost,
	}
	if read.Kind == selector.KindAccount {
		// The run signs in or signs up only with the profile's default account password.
		password, err := s.accountPassword(r.Context(), session.User.ID)
		if err != nil {
			s.writeProfileErr(w, err)
			return
		}
		out["accountPassword"] = password != ""
		out["accountOffers"] = read.Offers
		attrs = append(attrs, "accountOffers", read.Offers)
	}
	if read.Control != nil {
		picked := byID[read.Control.ID]
		out["control"] = map[string]any{
			"id": read.Control.ID, "role": read.Control.Role, "confidence": read.Control.Confidence,
		}
		attrs = append(attrs, "controlId", read.Control.ID, "controlRole", read.Control.Role,
			"controlConfidence", read.Control.Confidence, "controlText", firstText(picked.Text, picked.Label))
	} else {
		attrs = append(attrs, "controlId", nil)
	}
	if read.Fallback != nil {
		out["fallback"] = map[string]any{
			"id": read.Fallback.ID, "role": read.Fallback.Role, "confidence": read.Fallback.Confidence,
		}
		attrs = append(attrs, "fallbackId", read.Fallback.ID, "fallbackConfidence", read.Fallback.Confidence)
	}
	if read.Requirement != nil {
		picked := byID[read.Requirement.ID]
		out["requirement"] = map[string]any{
			"id": read.Requirement.ID, "role": read.Requirement.Role, "confidence": read.Requirement.Confidence,
		}
		attrs = append(attrs, "requirementId", read.Requirement.ID, "requirementConfidence", read.Requirement.Confidence,
			"requirementText", firstText(picked.Text, picked.Label))
	}
	if read.Commit != nil {
		picked := byID[read.Commit.ID]
		out["commit"] = map[string]any{
			"id": read.Commit.ID, "role": read.Commit.Role, "confidence": read.Commit.Confidence,
		}
		attrs = append(attrs, "commitId", read.Commit.ID, "commitConfidence", read.Commit.Confidence,
			"commitText", firstText(picked.Text, picked.Label))
	}
	if read.GuestControl != nil {
		out["guestControl"] = map[string]any{
			"id": read.GuestControl.ID, "role": read.GuestControl.Role, "confidence": read.GuestControl.Confidence,
		}
		attrs = append(attrs, "guestControlId", read.GuestControl.ID, "guestControlConfidence", read.GuestControl.Confidence)
	}
	log.Info("acorn run read-page decided", attrs...)
	writeJSON(w, http.StatusOK, out)
}

// runDialog has Jev say whether to accept a browser dialog (alert, confirm, prompt,
// leave-page) that opened while a run was applying.
func (s *Server) runDialog(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		RunID       string `json:"runId"`
		Step        int    `json:"step"`
		Kind        string `json:"kind"`
		Message     string `json:"message"`
		URL         string `json:"url"`
		Title       string `json:"title"`
		LastControl string `json:"lastControl"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !selector.IsDialogKind(body.Kind) {
		writeError(w, http.StatusBadRequest, "kind must be alert, confirm, prompt, or beforeunload")
		return
	}
	gateway, ok := s.selectorFor(w, r, session.User.ID)
	if !ok {
		return
	}
	runID := cleanRunID(body.RunID)
	log := slog.With("runId", runID, "step", body.Step, "kind", body.Kind, "page", logPage(body.URL))

	started := time.Now()
	answer, err := gateway.DecideDialog(s.traceContext(r, session.User.ID), selector.DialogQuery{
		Kind: body.Kind, Message: body.Message, URL: body.URL, Title: body.Title, LastControl: body.LastControl,
	})
	elapsed := time.Since(started)
	s.recordRunStep(r, session.User.ID, runID, body.Step, "dialog", map[string]any{
		"request": body, "answer": answer, "error": errText(err), "ms": elapsed.Milliseconds(),
	})
	if err != nil {
		log.Warn("acorn run dialog failed", "error", err, "ms", elapsed.Milliseconds())
		writeJSON(w, http.StatusOK, errorBody(err))
		return
	}
	log.Info("acorn run dialog decided", "accept", answer.Accept, "confidence", answer.Confidence,
		"ms", elapsed.Milliseconds(), "costUsd", answer.Usage.Cost)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "accept": answer.Accept, "confidence": answer.Confidence,
		"model": gateway.Model(), "usage": decisionUsage(gateway.Model(), answer.Usage),
	})
}

// runAccountOutcome has Jev say how a site answered the account step the run just
// sent: took it, refused it, or never got it. The run's account order moves on
// from that answer, never from the page's wording.
func (s *Server) runAccountOutcome(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		RunID        string   `json:"runId"`
		Step         int      `json:"step"`
		Sent         string   `json:"sent"`
		BeforeURL    string   `json:"beforeUrl"`
		BeforeTitle  string   `json:"beforeTitle"`
		URL          string   `json:"url"`
		Title        string   `json:"title"`
		Text         string   `json:"text"`
		NewText      []string `json:"newText"`
		PageMessages []string `json:"pageMessages"`
		Flagged      int      `json:"flagged"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !selector.IsAccountGoal(body.Sent) {
		writeError(w, http.StatusBadRequest, "sent must be "+selector.AccountSignIn+", "+selector.AccountCreate+", or "+selector.AccountReset)
		return
	}
	gateway, ok := s.selectorFor(w, r, session.User.ID)
	if !ok {
		return
	}
	runID := cleanRunID(body.RunID)
	log := slog.With("runId", runID, "step", body.Step, "sent", body.Sent, "page", logPage(body.URL))

	started := time.Now()
	answer, err := gateway.JudgeAccountOutcome(s.traceContext(r, session.User.ID), selector.AccountOutcomeQuery{
		Sent: body.Sent, BeforeURL: body.BeforeURL, BeforeTitle: body.BeforeTitle, URL: body.URL, Title: body.Title,
		Text: body.Text, NewText: body.NewText, PageMessages: body.PageMessages, Flagged: body.Flagged,
	})
	elapsed := time.Since(started)
	s.recordRunStep(r, session.User.ID, runID, body.Step, "account-outcome", map[string]any{
		"request": body, "answer": answer, "error": errText(err), "ms": elapsed.Milliseconds(),
	})
	if err != nil {
		log.Warn("acorn run account-outcome failed", "error", err, "ms", elapsed.Milliseconds())
		writeJSON(w, http.StatusOK, errorBody(err))
		return
	}
	log.Info("acorn run account-outcome decided", "outcome", answer.Outcome, "confidence", answer.Confidence,
		"ms", elapsed.Milliseconds(), "costUsd", answer.Usage.Cost)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "outcome": answer.Outcome, "confidence": answer.Confidence,
		"model": gateway.Model(), "usage": decisionUsage(gateway.Model(), answer.Usage),
	})
}

// runDiagnose has Jev name why a run could not finish, then pairs the reason
// with the page's own words so the report says what to fix.
func (s *Server) runDiagnose(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		RunID    string   `json:"runId"`
		Step     int      `json:"step"`
		Stage    string   `json:"stage"`
		Attempts int      `json:"attempts"`
		URL      string   `json:"url"`
		Title    string   `json:"title"`
		Text     string   `json:"text"`
		Evidence []string `json:"evidence"`
	}
	if !decode(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.Text) == "" && len(body.Evidence) == 0 {
		writeError(w, http.StatusBadRequest, "text or evidence is required")
		return
	}
	gateway, ok := s.selectorFor(w, r, session.User.ID)
	if !ok {
		return
	}
	runID := cleanRunID(body.RunID)
	log := slog.With("runId", runID, "step", body.Step, "stage", body.Stage, "page", logPage(body.URL))
	log.Info("acorn run diagnose", "evidence", len(body.Evidence), "attempts", body.Attempts)

	started := time.Now()
	failure, err := gateway.Diagnose(s.traceContext(r, session.User.ID), selector.FailureQuery{
		URL: body.URL, Title: body.Title, Stage: body.Stage, Attempts: body.Attempts,
		Evidence: body.Evidence, Text: body.Text,
	})
	elapsed := time.Since(started)
	s.recordRunStep(r, session.User.ID, runID, body.Step, "diagnose", map[string]any{
		"request": body, "failure": failure, "error": errText(err), "ms": elapsed.Milliseconds(),
	})
	if err != nil {
		log.Warn("acorn run diagnose failed", "error", err, "ms", elapsed.Milliseconds())
		writeJSON(w, http.StatusOK, errorBody(err))
		return
	}
	detail := body.Evidence
	if len(detail) > diagnoseDetailLines {
		detail = detail[:diagnoseDetailLines]
	}
	log.Info("acorn run diagnosed", "reason", failure.Reason, "confidence", failure.Confidence,
		"top", selector.TopProbabilities(failure.Probabilities, 3), "ms", elapsed.Milliseconds(), "costUsd", failure.Usage.Cost)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "reason": failure.Reason, "label": selector.FailureLabels[failure.Reason],
		"detail": strings.Join(detail, " · "), "confidence": failure.Confidence,
		"model": gateway.Model(), "usage": decisionUsage(gateway.Model(), failure.Usage),
	})
}

// recordRunStep saves one orchestrator decision in the user's debug run folder.
func (s *Server) recordRunStep(r *http.Request, userID, runID string, step int, name string, data any) {
	if s.debug == nil {
		return
	}
	debugtrace.RunFrom(s.traceContext(r, userID)).WriteJSON(fmt.Sprintf("run-%s-%02d-%s.json", runID, step, name), data)
}

func errText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func firstText(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

const (
	// maxRunLogEvents bounds one log request from the extension.
	maxRunLogEvents = 50
	// maxRunLogData bounds one event's data once encoded.
	maxRunLogData = 2048
	// maxRunEventName bounds an event name.
	maxRunEventName = 48
)

// runLog writes the extension's run timeline (clicks, fills, refills, page changes)
// into the server log under the run id, beside the decisions this server made.
// Events carry labels and counts, never field values.
func (s *Server) runLog(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		RunID  string `json:"runId"`
		Events []struct {
			T     int64          `json:"t"`
			Step  int            `json:"step"`
			Event string         `json:"event"`
			Data  map[string]any `json:"data"`
		} `json:"events"`
	}
	if !decode(w, r, &body) {
		return
	}
	if len(body.Events) > maxRunLogEvents {
		body.Events = body.Events[:maxRunLogEvents]
	}
	runID := cleanRunID(body.RunID)
	for _, event := range body.Events {
		name := event.Event
		if len(name) > maxRunEventName {
			name = name[:maxRunEventName]
		}
		attrs := []any{"runId", runID, "step", event.Step, "event", name, "at", time.UnixMilli(event.T).UTC().Format(time.RFC3339Nano)}
		if len(event.Data) > 0 {
			encoded, err := json.Marshal(event.Data)
			if err == nil {
				if len(encoded) > maxRunLogData {
					encoded = append(encoded[:maxRunLogData], []byte("…")...)
				}
				attrs = append(attrs, "data", string(encoded))
			}
		}
		level := slog.LevelInfo
		if strings.HasSuffix(name, ":failed") || name == "run:stop" || strings.HasPrefix(name, "diagnose:failed") {
			level = slog.LevelWarn
		}
		slog.Log(r.Context(), level, "acorn run event", attrs...)
	}
	if s.debug != nil && len(body.Events) > 0 {
		s.recordRunStep(r, session.User.ID, runID, body.Events[0].Step, "events", body.Events)
	}
	w.WriteHeader(http.StatusNoContent)
}

// runField is one field of the page as the extension lists it for a page read.
type runField struct {
	Label    string `json:"label"`
	Kind     string `json:"kind"`
	Required bool   `json:"required"`
	Options  int    `json:"options"`
}

func pageFields(fields []runField) []selector.PageField {
	out := make([]selector.PageField, 0, len(fields))
	for _, field := range fields {
		if strings.TrimSpace(field.Label) == "" {
			continue
		}
		out = append(out, selector.PageField{Label: field.Label, Kind: field.Kind, Required: field.Required, Options: field.Options})
	}
	return out
}
