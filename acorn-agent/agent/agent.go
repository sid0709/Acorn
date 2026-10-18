package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/sid0709/acorn/acorn-agent/applicant"
	"github.com/sid0709/acorn/acorn-agent/llm"
)

// sizeTolerance is how many pixels a screenshot may differ from the viewport it is sent with
// (a rounding of the page's size).
const sizeTolerance = 1

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// Errors a caller can tell apart.
var (
	// ErrNoSession is a session id that is unknown or has expired.
	ErrNoSession = errors.New("no such session: it ended or expired")
	// ErrSessionOver is a step sent after the run already ended.
	ErrSessionOver = errors.New("this run has already ended")
	// ErrBadObservation is a step the agent cannot read.
	ErrBadObservation = errors.New("the observation is not usable")
)

// Config bounds one run. Every field has a default in DefaultConfig.
type Config struct {
	// MaxSteps is the most steps one run may take.
	MaxSteps int
	// MaxActions is the most actions one answer may plan when a decision model checks the
	// screen between runs of them; UncheckedActions is the most when none does.
	MaxActions       int
	UncheckedActions int
	// ChunkActions is the most actions that run before the screen is checked.
	ChunkActions int
	// CheckMatch is how sure the checker must be that the screen shows what the model
	// expected, and CheckBlocked and CheckLoading how unsure it must be that something is in
	// the way or the page is still loading, for the plan to go on (probabilities, 0 to 1).
	CheckMatch, CheckBlocked, CheckLoading float64
	// CheckLoadingWait is how sure the checker must be that the page is loading for the agent
	// to wait and look again instead of asking the model; it waits LoadWait, at most
	// MaxLoadWaits times in a row.
	CheckLoadingWait float64
	// OptionMatch is how sure the checker must be of which option of an open dropdown answers a
	// choose action (a probability) for the agent to pick it.
	OptionMatch  float64
	LoadWait     time.Duration
	MaxLoadWaits int
	// DonePasses is how many times a "done" the screen does not confirm (no thank-you or confirmation) is
	// sent back to the model before the run is reported as one that could not confirm (donegate.go);
	// negative accepts every "done". DoneConfirm is how sure the checker must be that the screen shows a
	// sent application (a probability).
	DonePasses  int
	DoneConfirm float64
	// StopPasses is how many times a run's stop for the applicant is sent back, to finish
	// everything that does not need them first (stopgate.go); 0 accepts every stop at once.
	StopPasses int
	// KeepTurns is how many recent steps stay in full when the history is compacted; older
	// ones are folded into one line each.
	KeepTurns int
	// KeepImages is how many of the newest steps keep their screenshot through a compaction.
	KeepImages int
	// HistoryTokens is the estimated size the model's history may grow to, every screenshot
	// included, before it is compacted (session.history).
	HistoryTokens int
	// MaxStale is how many steps in a row the screen may stay the same before the run is
	// declared stuck without asking the model again.
	MaxStale int
	// SessionTTL is how long an untouched session is kept.
	SessionTTL time.Duration
	// TraceDir, when set, records every step to disk.
	TraceDir string
	// VetBlock is the probability, from the decision model, at which a control, window or frame
	// is blocked as an online file source (0 means 0.3).
	VetBlock float64
	// SingleSignOnBlock is the probability, from the decision model, at which a control, window
	// or frame is blocked as a sign-in through another service's account (0 means 0.5).
	SingleSignOnBlock float64
	// AccountAttempts is how many steps may type the account password, across sign-in, sign-up
	// and password reset, before the run ends as rejected by the site (0 means 8).
	AccountAttempts int
	// FallbackStrict is for one person's own folder: FallbackResume names the résumé offered, and
	// one that is not among the applicant's résumés stops the run. Without it the offer is the
	// applicant's default résumé (the one they marked default on their Acorn Library) and
	// FallbackResume is not used.
	FallbackStrict bool
	// FallbackResume is the résumé folder offered to the person when a résumé is wanted and no
	// job description was found ("" turns the question off). Used with FallbackStrict only.
	FallbackResume string
}

// DefaultConfig is the bounds a run has when nothing else is set.
func DefaultConfig() Config {
	return Config{
		MaxSteps:          150,
		MaxActions:        12,
		UncheckedActions:  6,
		ChunkActions:      6,
		CheckMatch:        0.9,
		CheckBlocked:      0.2,
		CheckLoading:      0.3,
		CheckLoadingWait:  0.7,
		OptionMatch:       0.7,
		LoadWait:          time.Second,
		MaxLoadWaits:      4,
		StopPasses:        2,
		DonePasses:        2,
		DoneConfirm:       0.7,
		SingleSignOnBlock: 0.5,
		AccountAttempts:   8,
		KeepTurns:         8,
		KeepImages:        3,
		HistoryTokens:     30_000,
		MaxStale:          6,
		SessionTTL:        time.Hour,
	}
}

// Agent runs applications. It holds no state beyond its live sessions, so any number of
// runs go at once, each on its own session and its own model calls.
type Agent struct {
	cfg        Config
	applicants applicant.Source
	newModel   func(key string) llm.Model
	newDecider func(key string) Decider
	// newScreen builds the decision model that checks the screen; nil means no checks.
	newScreen func(key string) Screen
	sessions  *store
	trace     *tracer
	now       func() time.Time
}

// New is an agent over the applicant's data. newModel builds the model that drives a run,
// newDecider the model that chooses among existing things, and newScreen the decision model
// that checks the screen between runs of actions (nil turns the checks off); each is given
// the run's key.
func New(cfg Config, applicants applicant.Source, newModel func(key string) llm.Model, newDecider func(key string) Decider, newScreen func(key string) Screen) *Agent {
	now := time.Now
	return &Agent{
		cfg:        cfg,
		applicants: applicants,
		newModel:   newModel,
		newDecider: newDecider,
		newScreen:  newScreen,
		sessions:   newStore(cfg.SessionTTL, now),
		trace:      &tracer{dir: cfg.TraceDir},
		now:        now,
	}
}

// Sessions is how many runs are live.
func (a *Agent) Sessions() int { return a.sessions.len() }

// Start opens a run on the page the person is looking at. key is their OpenRouter key, and auth
// is whose profile and files the run reads (the person's Acorn session when they live in the
// backend).
func (a *Agent) Start(ctx context.Context, key string, auth applicant.Auth, start Start) (Started, error) {
	snap, err := a.applicants.SnapshotFor(ctx, auth)
	if err != nil {
		return Started{}, err
	}
	// The server's own key comes first (the caller passes it); the profile's is the last resort.
	if strings.TrimSpace(key) == "" {
		key = strings.TrimSpace(snap.APIKey)
	}
	if key == "" {
		return Started{}, llm.ErrNoKey
	}
	now := a.now()
	checks := a.newScreen != nil && a.cfg.ChunkActions > 0
	maxActions := a.cfg.MaxActions
	if !checks {
		maxActions = min(maxActions, a.cfg.UncheckedActions)
	}
	fallback, err := a.fallbackFor(snap.Resumes)
	if err != nil {
		return Started{}, err
	}
	system, err := systemPrompt(start, snap, maxActions, a.cfg.ChunkActions, checks, now)
	if err != nil {
		return Started{}, err
	}
	id, err := newSessionID()
	if err != nil {
		return Started{}, err
	}
	a.sessions.add(&session{
		id: id, key: key, auth: auth, start: start, snap: snap, system: system, maxActions: maxActions, fallback: fallback,
		created: now, touched: now, wantTrace: start.Trace, stepLimit: a.cfg.MaxSteps,
	})
	stacks, documents := catalog(snap.Resumes)
	startTrace, err := a.trace.recordSession(id, system, sessionTrace{
		Started: now, Start: start, Model: a.modelName(key), ScreenModel: a.screenName(key), Config: a.cfg, Resumes: stacks, Documents: documents,
	}, start.Trace)
	if err != nil {
		slog.Warn("trace not written", "session", id, "error", err)
	}
	slog.Info("run started", "session", id, "url", start.URL, "stopBeforeSubmit", start.StopBeforeSubmit,
		"stacks", len(stacks), "trace", a.trace.enabled())
	infos := make([]ResumeInfo, len(snap.Resumes))
	for i, resume := range snap.Resumes {
		infos[i] = ResumeInfo{ID: resume.ID, FileName: resume.FileName, Size: resume.Size}
	}
	return Started{SessionID: id, Resumes: infos, Trace: startTrace}, nil
}

// End drops a session once the run is over.
func (a *Agent) End(id string) { a.sessions.remove(id) }

// Continue takes a run that stopped back up where it was, with everything the model knows: its
// notes, the job it recorded, the history, the résumé chosen, and the cost so far. The run may have
// ended because it needed the person, got stuck, reached its step limit, or was stopped or cut off
// by the person or the connection; the next step is told which, so the model looks at the screen
// as it is now. A session that expired or was ended is gone (ErrNoSession): the caller starts a new
// run.
func (a *Agent) Continue(id string) (Continued, error) {
	s, ok := a.sessions.get(id)
	if !ok {
		return Continued{}, ErrNoSession
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.touched = a.now()
	note := "The run was paused and the applicant pressed Continue. The actions you last planned may not have run. Judge by the screenshot, not by your memory of the plan."
	if s.finished {
		note = fmt.Sprintf("You stopped the run (%s). The applicant has pressed Continue, so they may have changed the page since. Look at the screen as it is now and carry on from your notes; do not redo what they say is done.", clipText(s.stoppedFor, maxSummaryChars))
	}
	if s.step >= s.stepLimit {
		s.stepLimit += a.cfg.MaxSteps
	}
	s.finished, s.stoppedFor = false, ""
	s.pendingUpload = nil
	s.plan, s.verify, s.planned, s.sent, s.parts = nil, "", 0, 0, 0
	s.stale, s.lastSig, s.loadWaits = 0, nil, 0
	s.script = nil
	s.notes = append(s.notes, note)
	slog.Info("run continued", "session", s.id, "step", s.step, "limit", s.stepLimit)
	return Continued{Number: s.step, Usage: s.usage}, nil
}

// ResumeFile is one résumé file of a live session, for the extension to put in a file input.
func (a *Agent) ResumeFile(ctx context.Context, sessionID, resumeID string) (applicant.Resume, []byte, error) {
	s, ok := a.sessions.get(sessionID)
	if !ok {
		return applicant.Resume{}, nil, ErrNoSession
	}
	// Only a file this run was told about: the run reads the person's files, nobody else's.
	known := false
	for _, resume := range s.snap.Resumes {
		if resume.ID == resumeID {
			known = true
			break
		}
	}
	if !known {
		return applicant.Resume{}, nil, applicant.ErrNoResume
	}
	return a.applicants.ResumeFor(ctx, s.auth, resumeID)
}

// Step reads one observation and answers with what to do next. When the run asked for its trace,
// the answer also carries what was recorded since the last one (a step that failed hands its
// entry on to the retry).
func (a *Agent) Step(ctx context.Context, id string, obs Observation) (Step, error) {
	step, err := a.step(ctx, id, obs)
	if err != nil {
		return step, err
	}
	if s, ok := a.sessions.get(id); ok {
		s.mu.Lock()
		if step.Trace = s.takeTrace(); step.Trace != nil {
			step.Trace.Seq = s.seq
		}
		s.mu.Unlock()
	}
	return step, nil
}

func (a *Agent) step(ctx context.Context, id string, obs Observation) (Step, error) {
	s, ok := a.sessions.get(id)
	if !ok {
		return Step{}, ErrNoSession
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.touched = a.now()
	if s.finished {
		return Step{}, ErrSessionOver
	}
	s.seq++
	if obs.Viewport.Width <= 0 || obs.Viewport.Height <= 0 {
		return Step{}, fmt.Errorf("%w: the viewport has no size", ErrBadObservation)
	}
	sig, width, height, err := signature(obs.Screenshot)
	if err != nil {
		err = fmt.Errorf("%w: %v", ErrBadObservation, err)
		a.record(s, stepTrace{Seq: s.seq, Step: s.step + 1, At: a.now(), URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport, Error: err.Error(), Usage: s.usage}, "", nil)
		return Step{}, err
	}
	// The model measures coordinates in the image it is shown. If the image is not the size
	// the viewport says, every point it gives would land somewhere else on the page.
	if abs(width-obs.Viewport.Width) > sizeTolerance || abs(height-obs.Viewport.Height) > sizeTolerance {
		err = fmt.Errorf("%w: the screenshot is %dx%d pixels but the viewport says %dx%d",
			ErrBadObservation, width, height, obs.Viewport.Width, obs.Viewport.Height)
		a.record(s, stepTrace{Seq: s.seq, Step: s.step + 1, At: a.now(), URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport, Error: err.Error(), Usage: s.usage}, obs.Screenshot, nil)
		return Step{}, err
	}
	s.cover.see(obs.URL, obs.Viewport)
	// What happened to every action sent since the model last looked, which may be several
	// runs of one plan.
	results := withoutChoose(append(append([]ActionResult(nil), s.carried...), obs.Results...))
	a.learnJD(ctx, s, obs)
	if s.pendingUpload != nil {
		return a.answerPending(s, obs, results, sig)
	}
	screens, err := checkSurvey(obs)
	if err != nil {
		a.record(s, stepTrace{Seq: s.seq, Step: s.step + 1, At: a.now(), URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport, Error: err.Error(), Usage: s.usage}, obs.Screenshot, nil)
		return Step{}, err
	}
	if s.step >= s.stepLimit {
		return a.endWithTrace(s, obs, 0, StatusStuck, fmt.Sprintf("The run reached its limit of %d steps.", s.stepLimit), &StopInfo{
			Reason:  StopStepLimit,
			Problem: fmt.Sprintf("This application took more than %d steps, so Acorn stopped.", s.stepLimit),
			Action:  "Finish the rest on the page yourself, or press Continue to give the run more steps.",
		}), nil
	}
	// A page that did not move after actions is evidence the model needs, and a run that
	// never moves is not worth more model calls.
	stale := 0
	// A survey scrolls the page and comes back: the same screen again is expected, not a stall.
	if s.step > 0 && len(screens) == 0 && unchanged(sig, s.lastSig) {
		stale = s.stale + 1
	}
	if stale >= a.cfg.MaxStale {
		return a.endWithTrace(s, obs, stale, StatusStuck, fmt.Sprintf("The page did not change for %d steps in a row.", stale), &StopInfo{
			Reason:  StopNoChange,
			Problem: "The page stopped responding to Acorn's clicks and typing.",
			Action:  "Check the page for anything in the way, then press Continue.",
		}), nil
	}

	if step, ok := a.handlePicker(ctx, s, obs, results, sig); ok {
		return step, nil
	}
	if step, ok := a.continueScript(ctx, s, obs, results, sig); ok {
		return step, nil
	}
	if step, ok := a.continuePlan(ctx, s, obs, results, sig, stale); ok {
		return step, nil
	}
	if step, ok := a.tryNavigate(ctx, s, obs, len(screens), results, sig, stale); ok {
		return step, nil
	}

	// The model looks now, so the form-finding gate has had its turn (the model finds its own way from here).
	s.formReady = true
	s.script = nil
	number := s.step + 1
	notes := append(append([]string(nil), obs.Notes...), s.notes...)
	if line := s.cover.line(obs.Viewport); line != "" {
		notes = append(notes, line)
	}
	if s.parts > 1 && s.sent == s.planned && len(s.notes) == 0 {
		notes = append(notes, fmt.Sprintf("Your plan ran in %d parts. After each part but the last, a checker confirmed the screen showed what you expected.", s.parts))
	}
	images := []string{obs.Screenshot}
	if len(screens) > 0 {
		notes = append(notes, surveyNote(obs))
		images = surveyImages(obs)
	}
	body := observationText(number, s.stepLimit, obs, results, notes, stale)
	messages := append([]llm.Message{{Role: llm.RoleSystem, Text: s.system}},
		s.history(a.cfg.KeepTurns, a.cfg.KeepImages, a.cfg.HistoryTokens)...)
	text := currentText(body, s.memo, s.job)
	messages = append(messages, llm.Message{Role: llm.RoleUser, Text: text, Images: images})

	entry := stepTrace{
		Seq: s.seq, Step: number, At: a.now(), URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport,
		Focus: obs.Focus, Notes: notes, Results: results, Stale: stale, Survey: obs.Survey, SurveyScreens: len(obs.Survey),
	}
	answer, content, usage, calls, err := a.ask(ctx, s, messages)
	s.usage.Calls++
	s.usage.InputTokens += usage.InputTokens
	s.usage.OutputTokens += usage.OutputTokens
	s.usage.CachedTokens += usage.CachedTokens
	s.usage.Cost += usage.Cost
	entry.Usage = s.usage
	if err != nil {
		entry.Error, entry.Memo, entry.Job = err.Error(), s.memo, s.job
		a.record(s, entry, obs.Screenshot, calls)
		return Step{}, err
	}
	// Only a step the model answered counts: a retry of a failed call sends the same screen.
	s.step, s.stale, s.lastSig = number, stale, sig
	s.carried, s.notes = nil, nil
	// A memo of null means the notes did not change.
	if answer.Memo != nil {
		s.memo = clipText(strings.TrimSpace(*answer.Memo), maxMemoChars)
	}
	// A job of null means it did not change.
	if answer.Job != nil {
		if job := strings.TrimSpace(*answer.Job); job != "" {
			s.job = clipText(job, maxJobChars)
		}
	}
	s.message = strings.TrimSpace(answer.Message)

	planned, dropped := checkActions(number, answer.Actions, obs.Viewport, s.maxActions, screens)
	planned = pinFrame(planned, obs.Viewport, len(screens))
	planned, cut := cutAfterUpload(planned)
	if cut > 0 && answer.Status == StatusWorking {
		dropped = append(dropped, fmt.Sprintf("%d planned actions after the upload were not run: the page moves after a file is attached", cut))
		s.notes = append(s.notes, afterUploadNote)
	}
	planned, surveyAsked := withoutSurvey(planned)
	// A run that did not turn surveys on is not told they exist, and one the model asks for anyway is ignored.
	surveyAsked = surveyAsked && s.start.Survey
	typesSecret := entersSecret(planned, s.snap.Secrets)
	planned = fillSecrets(planned, s.snap.Secrets)
	// A site that keeps refusing the account (sign-in, sign-up, password reset) ends the run; it
	// does not go round the same forms until the step limit.
	if typesSecret {
		s.accountSteps++
	}
	if rejected := a.accountRejected(s, &answer); rejected {
		planned = nil
	}
	planned, dropped = a.resolveUploads(ctx, s, planned, dropped)
	status := answer.Status
	// "Done" is the page's confirmation, not the model's word: a done the screen does not show is sent back.
	if note, held := a.holdDone(ctx, s, obs, &answer); held {
		answer.Status, answer.Message = StatusWorking, donePassMessage
		planned = []Action{{ID: fmt.Sprintf("s%da1", number), Kind: KindWait, Ms: stopPassWaitMs}}
		s.notes = append(s.notes, note)
	}
	status = answer.Status
	// The applicant is asked last: a stop is first sent back to finish everything else on the page.
	if note, held := a.holdStop(s, status, answer); held {
		status, answer.Message = StatusWorking, stopPassMessage
		planned = []Action{{ID: fmt.Sprintf("s%da1", number), Kind: KindWait, Ms: stopPassWaitMs}}
		s.notes = append(s.notes, note)
	}
	var actions []Action
	switch {
	case status != StatusWorking:
		s.plan, s.verify, s.planned, s.sent, s.parts = nil, "", 0, 0, 0
		// A run that ends may still scroll what the person must act on into view.
		actions = scrollOnly(planned, maxStopScrolls)
	case len(planned) == 0 && s.pendingUpload == nil && !surveyAsked:
		// A working run with nothing valid to do waits and looks again; the repeat check
		// ends it if the page never changes.
		dropped = append(dropped, "no usable action; waiting before the next look")
		planned = []Action{{ID: fmt.Sprintf("s%da1", number), Kind: KindWait, Ms: 1000}}
		fallthrough
	default:
		actions, dropped = a.takePlan(s, planned, dropped)
	}

	s.turns = append(s.turns, turn{
		number:  number,
		text:    text,
		images:  images,
		answer:  content,
		summary: summaryLine(number, answer, planned),
	})
	step := Step{
		Status: status, Message: strings.TrimSpace(answer.Message), Stop: stopFor(status, answer), Actions: actions,
		Number: number, Usage: s.usage, Dropped: dropped, Survey: surveyAsked && status == StatusWorking,
	}
	entry.Observation, entry.Memo, entry.Job = answer.Observation, s.memo, s.job
	entry.Status, entry.Message, entry.Actions, entry.Dropped = status, step.Message, actions, dropped
	entry.Stop = step.Stop
	a.record(s, entry, obs.Screenshot, calls)
	if status != StatusWorking {
		s.finished, s.stoppedFor = true, step.Message
	}
	if s.pendingUpload != nil && len(step.Actions) == 0 && status == StatusWorking {
		s.seq++
		return a.askStep(s, obs, results, sig, *s.pendingUpload), nil
	}
	return step, nil
}

// record writes one entry of the run to the trace and one line to the server's log.
func (a *Agent) record(s *session, entry stepTrace, screenshot string, calls []modelCall) {
	var latency int64
	for _, call := range calls {
		latency += call.LatencyMs
	}
	level := slog.LevelInfo
	if entry.Error != "" {
		level = slog.LevelWarn
	}
	status := entry.Status
	if entry.Check != nil {
		status = "check:" + entry.Check.Outcome
	}
	slog.Log(context.Background(), level, "step", "session", s.id, "seq", entry.Seq, "number", entry.Step,
		"status", status, "actions", len(entry.Actions), "dropped", len(entry.Dropped),
		"stale", entry.Stale, "ms", latency, "calls", entry.Usage.Calls, "checks", entry.Usage.Checks, "cost", entry.Usage.Cost,
		"message", clipText(entry.Message, 140), "error", entry.Error)
	trace, err := a.trace.record(s.id, entry, screenshot, calls, s.wantTrace)
	if err != nil {
		slog.Warn("trace not written", "session", s.id, "error", err)
	}
	s.addTrace(trace)
}

// endWithTrace finishes a run the agent itself gave up on, and records why.
func (a *Agent) endWithTrace(s *session, obs Observation, stale int, status, message string, stop *StopInfo) Step {
	s.finished, s.stoppedFor = true, message
	a.record(s, stepTrace{
		Seq: s.seq, Step: s.step + 1, At: a.now(), URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport,
		Focus: obs.Focus, Notes: obs.Notes, Results: obs.Results, Stale: stale, Memo: s.memo, Job: s.job,
		Status: status, Message: message, Stop: stop, Usage: s.usage,
	}, obs.Screenshot, nil)
	return Step{Status: status, Message: message, Stop: stop, Number: s.step, Usage: s.usage}
}

// stopFor is why a run that the model ended is over, for the person. Only need_person and
// stuck carry one; when the model left it out, its message stands in.
func stopFor(status string, answer reply) *StopInfo {
	if status != StatusNeedPerson && status != StatusStuck {
		return nil
	}
	stop := StopInfo{Reason: StopOther, Problem: strings.TrimSpace(answer.Message)}
	if answer.Stop != nil {
		stop.Reason = strings.TrimSpace(answer.Stop.Reason)
		stop.Problem = strings.TrimSpace(answer.Stop.Problem)
		stop.Action = strings.TrimSpace(answer.Stop.Action)
	}
	switch stop.Reason {
	case StopCaptcha, StopVerification, StopVerificationLink, StopIdentity, StopDocument, StopSignIn, StopAccountRejected, StopPageProblem, StopOther:
	default:
		stop.Reason = StopOther
	}
	if stop.Problem == "" {
		stop.Problem = strings.TrimSpace(answer.Message)
	}
	return &stop
}

// ask sends the request and reads the answer. An answer that is not the requested JSON is
// sent back to the model once with the reason, as a person would be told what was wrong.
// Every call is returned for the trace, whether or not it was accepted.
func (a *Agent) ask(ctx context.Context, s *session, messages []llm.Message) (reply, string, llm.Usage, []modelCall, error) {
	model := a.newModel(s.key)
	var total llm.Usage
	var calls []modelCall
	var lastErr error
	sent := messages
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := model.Complete(ctx, llm.Request{Messages: messages, SchemaName: replySchemaName, Schema: replySchema})
		total.Add(resp.Usage)
		call := modelCall{
			Repair: attempt > 0, Messages: traceMessages(sent), Content: resp.Content, FinishReason: resp.FinishReason,
			Model: resp.Model, Usage: resp.Usage, LatencyMs: resp.Latency.Milliseconds(), HTTPAttempts: resp.Attempts,
		}
		if err != nil {
			call.Error = err.Error()
			return reply{}, "", total, append(calls, call), err
		}
		parsed, err := parseReply(resp.Content)
		if err == nil {
			return parsed, strings.TrimSpace(resp.Content), total, append(calls, call), nil
		}
		call.Error = "refused: " + err.Error()
		calls = append(calls, call)
		lastErr = err
		if resp.FinishReason == "length" {
			err = fmt.Errorf("%w; the answer was cut off, so keep it shorter", err)
		}
		// The repair call is shown with only what it added to the conversation.
		sent = []llm.Message{
			{Role: llm.RoleAssistant, Text: resp.Content},
			{Role: llm.RoleUser, Text: "That answer was not accepted: " + err.Error() + ". Answer again with only the JSON object."},
		}
		messages = append(messages, sent...)
	}
	return reply{}, "", total, calls, lastErr
}

// modelName is the id of the model a run with this key is driven by.
func (a *Agent) modelName(key string) string {
	if model := a.newModel(key); model != nil {
		return model.Name()
	}
	return ""
}

// resolveUploads chooses the file for each upload action. What it had to say about a choice
// that was not clean goes into dropped, the step's list of things the log should show.
func (a *Agent) resolveUploads(ctx context.Context, s *session, actions []Action, dropped []string) ([]Action, []string) {
	var kept []Action
	for _, action := range actions {
		if action.Kind != KindUpload {
			kept = append(kept, action)
			continue
		}
		if a.needsAsk(s, action.Resume) {
			// Without a job description the résumé is not guessed: the upload waits for the person,
			// and so does everything planned after it.
			held := action
			s.pendingUpload = &held
			dropped = append(dropped, "upload held: no job description was found, so the applicant is asked which résumé to send")
			break
		}
		resume, note, err := a.pickResume(ctx, s, action.Resume)
		if err != nil {
			dropped = append(dropped, fmt.Sprintf("upload %s: %v", action.ID, err))
			continue
		}
		if note != "" {
			dropped = append(dropped, "note: "+note)
		}
		action.Resume, action.FileName = resume.ID, resume.FileName
		kept = append(kept, action)
	}
	return kept, dropped
}

func summaryLine(number int, answer reply, actions []Action) string {
	parts := make([]string, len(actions))
	for i, action := range actions {
		parts[i] = describe(action)
	}
	line := fmt.Sprintf("step %d: %s", number, strings.TrimSpace(answer.Message))
	if len(parts) > 0 {
		line += " [" + strings.Join(parts, "; ") + "]"
	}
	return line
}

// entersSecret says whether any typed text carries a secret's placeholder.
func entersSecret(actions []Action, secrets map[string]string) bool {
	for _, action := range actions {
		if action.Kind != KindType {
			continue
		}
		for token := range secrets {
			if strings.Contains(action.Text, token) {
				return true
			}
		}
	}
	return false
}

// accountRejected ends the run, as stuck, once more steps than AccountAttempts have typed the
// account password: the sign-in, the sign-up and the reset have all been tried and the site
// still does not let the applicant in.
func (a *Agent) accountRejected(s *session, answer *reply) bool {
	if a.cfg.AccountAttempts <= 0 || s.accountSteps <= a.cfg.AccountAttempts {
		return false
	}
	answer.Status = StatusStuck
	answer.Stop = &StopInfo{
		Reason:  StopAccountRejected,
		Problem: "The site did not accept the sign-in, the new account or the password reset.",
		Action:  "Sign in or create the account yourself on the page, then press Continue or Run again.",
	}
	answer.Message = "The site would not accept the account."
	s.stopPasses = a.cfg.StopPasses // this stop is already the end: it is not sent back again
	return true
}

// fillSecrets types a secret in place of its placeholder. The model only ever reads and
// writes the placeholder, so the secret is in no prompt, no history and no trace; an action
// that carries one is marked secret.
func fillSecrets(actions []Action, secrets map[string]string) []Action {
	for i, action := range actions {
		if action.Kind != KindType {
			continue
		}
		for token, value := range secrets {
			if strings.Contains(action.Text, token) {
				actions[i].Text = strings.ReplaceAll(actions[i].Text, token, value)
				actions[i].Secret = true
			}
		}
	}
	return actions
}
