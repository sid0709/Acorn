package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/sid0709/OpenSeat/acorn-agent/applicant"
	"github.com/sid0709/OpenSeat/backend-core/jev"
)

// The résumé is chosen from the whole job description, read as text. A screenshot may never show
// it (clicking Apply scrolls straight to the form), so the extension sends the page's text when
// the page changes, and the decision model that reads text (Jev) says whether it holds a job
// description. When the agent reaches a résumé upload without one it does not guess: it asks the
// person, every time, whether to upload their default résumé (the one marked default in their
// Acorn Library, or the DEFAULT_FALLBACK_RESUME folder in development). A file is only ever uploaded from this computer: never from an online source.

const (
	askJobDescription = "job_description"
	// minPageTextChars is the least text worth asking about; a page with less has no description.
	minPageTextChars = 400
	// maxJDChecks bounds how many pages one run has judged for a description.
	maxJDChecks = 6
	// maxJDChars bounds the description kept for the run, and maxJDNoteChars what the model is told.
	maxJDChars     = 12_000
	maxJDNoteChars = 6_000
	// jdAbove is how sure the decision model must be that a page holds a job description.
	jdAbove = 0.8
)

// ErrFallbackResume is returned when DEFAULT_FALLBACK_RESUME names a folder that does not exist.
var ErrFallbackResume = errors.New("DEFAULT_FALLBACK_RESUME names a résumé folder that is not in data/resumes")

// fallbackFor is the résumé to offer when there is no job description, or "" when none is. For one
// person's own folder (FallbackStrict) it is the folder named in the setting, and a name that is
// not there stops the run. Otherwise it is the applicant's default résumé, the one they marked
// "default" in their Acorn Library, so nothing is set on the server.
func (a *Agent) fallbackFor(resumes []applicant.Resume) (string, error) {
	if a.cfg.FallbackStrict {
		name := strings.TrimSpace(a.cfg.FallbackResume)
		if name == "" {
			return "", nil
		}
		stacks := stackNames(resumes)
		for _, stack := range stacks {
			if strings.EqualFold(stack, name) {
				return stack, nil
			}
		}
		return "", fmt.Errorf("%w: %q (folders: %s)", ErrFallbackResume, name, strings.Join(stacks, ", "))
	}
	for _, resume := range resumes {
		if resume.Stack != "" && resume.Primary {
			return resume.Stack, nil
		}
	}
	return "", nil
}

// learnJD reads the page's text for the job description. The first page the decision model
// accepts becomes the run's description; the model is told it once.
func (a *Agent) learnJD(ctx context.Context, s *session, obs Observation) {
	text := strings.TrimSpace(obs.PageText)
	if s.jd != "" || len([]rune(text)) < minPageTextChars || s.jdChecks >= maxJDChecks {
		return
	}
	key := obs.URL + "\n" + obs.Title
	if s.jdSeen[key] {
		return
	}
	if s.jdSeen == nil {
		s.jdSeen = map[string]bool{}
	}
	s.jdSeen[key] = true
	s.jdChecks++
	res, err := a.newDecider(s.key).Decide(ctx, jev.Request{
		State: "Page: " + orNone(obs.Title) + " (" + orNone(obs.URL) + ")\n\n" + clipText(text, maxJDNoteChars),
		Questions: map[string]jev.Question{askJobDescription: {
			Type: jev.TypeNoul,
			Instructions: "Does this page text contain the description of a specific job: what the work is, or what the role requires or asks for? " +
				"A sign-in page, a bare application form, a company home page or a list of jobs does not.",
			Criteria: map[string]string{"true": "it describes a specific job", "false": "it does not"},
		}},
	})
	s.usage.Checks++
	s.usage.CheckCost += res.Usage.Cost
	s.usage.Cost += res.Usage.Cost
	answer, ok := res.Answers[askJobDescription]
	if err != nil || !ok || answer.Noul == nil {
		slog.Warn("job description check failed", "session", s.id, "error", err)
		return
	}
	if *answer.Noul < jdAbove {
		// A long page that is not a job posting is usually an application form or account
		// flow; do not auto-scroll down hunting for Apply (that skips unfilled sections).
		if len([]rune(text)) >= minPageTextChars {
			s.formReady = true
		}
		return
	}
	s.jd = clipText(text, maxJDChars)
	s.notes = append(s.notes, "The job description, read from the page text ("+orNone(obs.Title)+"):\n"+clipText(text, maxJDNoteChars))
}

// needsAsk is whether choosing a résumé now would be a guess the person should confirm: a résumé
// is wanted (the model named no other document), there is a choice of them, no job description
// was found, and a default résumé is set to offer.
func (a *Agent) needsAsk(s *session, requested string) bool {
	if s.fallback == "" || s.jd != "" {
		return false
	}
	resumes := s.snap.Resumes
	if found, ok := resolve(resumes, requested); ok && found.Stack == "" {
		return false // a loose document such as a cover letter is not a résumé
	}
	return len(stackNames(resumes)) > 1
}

// askStep waits on the person: an upload at a point is held until they say which résumé.
func (a *Agent) askStep(s *session, obs Observation, results []ActionResult, sig []uint8, held Action) Step {
	s.pendingUpload = &held
	s.plan, s.verify = nil, ""
	s.carried = results
	s.stale, s.lastSig = 0, sig
	question := fmt.Sprintf("Acorn found no job description, so it can't tell which résumé fits. Upload your default résumé (%s)?", s.fallback)
	step := Step{
		Status: StatusAsk, Message: question, Number: s.step, Usage: s.usage,
		Ask: &Ask{ID: AskResume, Question: question, Options: []AskOption{
			{ID: AnswerUseFallback, Label: "Yes, upload " + s.fallback},
			{ID: AnswerChooseOwn, Label: "I'll choose"},
		}},
	}
	a.record(s, stepTrace{
		Seq: s.seq, Step: s.step, At: a.now(), Source: sourceAsk, URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport,
		Focus: obs.Focus, Notes: obs.Notes, Results: obs.Results, Memo: s.memo, Job: s.job,
		Status: StatusAsk, Message: question, Usage: s.usage,
	}, obs.Screenshot, nil)
	return step
}

// answerPending handles a step while an upload waits on the person's answer.
func (a *Agent) answerPending(s *session, obs Observation, results []ActionResult, sig []uint8) (Step, error) {
	held := *s.pendingUpload
	switch obs.Answer {
	case "":
		// Nothing answered yet: this is the first look after the actions before the upload, or a retry.
		return a.askStep(s, obs, results, sig, held), nil
	case AnswerChooseOwn:
		s.pendingUpload = nil
		stop := &StopInfo{
			Reason:  StopResumeChoice,
			Problem: "Acorn found no job description, so it doesn't know which résumé fits.",
			Action:  "Upload the résumé you want on the page yourself, then press Continue.",
		}
		s.finished, s.stoppedFor = true, stop.Problem
		a.record(s, stepTrace{
			Seq: s.seq, Step: s.step, At: a.now(), Source: sourceAsk, URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport,
			Status: StatusNeedPerson, Message: stop.Problem, Stop: stop, Usage: s.usage,
		}, obs.Screenshot, nil)
		return Step{Status: StatusNeedPerson, Message: stop.Problem, Stop: stop, Number: s.step, Usage: s.usage}, nil
	case AnswerUseFallback:
		file, ok := resolve(s.snap.Resumes, s.fallback)
		if !ok {
			return Step{}, fmt.Errorf("%w: %q", ErrFallbackResume, s.fallback)
		}
		s.pendingUpload = nil
		upload := held
		upload.ID = fmt.Sprintf("s%dq%d", s.step, s.seq)
		upload.Kind, upload.Resume, upload.FileName = KindUpload, file.ID, file.FileName
		s.carried = results
		s.stale, s.lastSig = 0, sig
		s.notes = append(s.notes, fmt.Sprintf("No job description was found, so the applicant chose to upload their default résumé; Acorn uploaded %s at %.0f,%.0f. Any actions you planned after the upload did not run: look again and plan from here.", file.FileName, *held.X, *held.Y))
		step := Step{Status: StatusWorking, Message: s.message, Actions: []Action{upload}, Number: s.step, Usage: s.usage}
		a.record(s, stepTrace{
			Seq: s.seq, Step: s.step, At: a.now(), Source: sourceAsk, URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport,
			Memo: s.memo, Job: s.job, Status: step.Status, Message: step.Message, Actions: step.Actions, Usage: s.usage,
		}, obs.Screenshot, nil)
		return step, nil
	}
	return Step{}, fmt.Errorf("%w: %q is not an answer to the question asked", ErrBadObservation, obs.Answer)
}
