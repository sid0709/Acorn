package agent

import (
	"context"
	"encoding/base64"
	"fmt"
	"log/slog"
	"math"

	"github.com/sid0709/acorn/acorn-agent/decide"
	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// A file button clicked with a plain click opens the browser's file picker. The extension
// intercepts it so no operating-system dialog appears, which also means nothing is attached
// and the screenshot shows nothing: only the upload action puts a file there. When the
// extension reports that a click opened a picker, the model is told so in its next look, and,
// when the control takes the applicant's résumé, the agent uploads it at that point itself
// instead of spending a model call on the same discovery.

// What a file control asks for, as the decision model names it.
const (
	askFileKind = "file_kind"
	fileResume  = "resume"
	fileCover   = "cover_letter"
	fileOther   = "other"
)

// pickerPoint is a click of the model's that opened a file picker, and the result that said so.
func (s *session) pickerPoint(results []ActionResult) (Action, string, bool) {
	for _, result := range results {
		if result.Opened != OpenedFilePicker || s.pickerSeen[result.ID] {
			continue
		}
		action, ok := s.byID[result.ID]
		if !ok || action.X == nil || action.Y == nil {
			continue
		}
		switch action.Kind {
		case KindClick, KindDoubleClick, KindTripleClick:
			return action, result.ID, true
		}
	}
	return Action{}, "", false
}

func pointKey(action Action) [2]int {
	return [2]int{int(math.Round(*action.X)), int(math.Round(*action.Y))}
}

// fileKindQuestion asks what the marked control takes. The point is drawn on the screenshot,
// since a decision model reads the picture but cannot be given coordinates.
func fileKindQuestion() map[string]decide.Question {
	return map[string]decide.Question{askFileKind: {
		Type: decide.TypeChoice,
		Instructions: "A red ring and cross on this page mark a control that was just clicked and opened a file picker. " +
			"What kind of file does that control take? Read the label above or beside it.",
		Criteria: map[string]string{
			fileResume: "a résumé or CV, or a general file with no other kind named",
			fileCover:  "a cover letter",
			fileOther:  "any other document: a transcript, a certificate, an ID, a portfolio, writing samples",
		},
	}}
}

// handlePicker deals with a click that opened a file picker. It reports true when it sent the
// upload itself. Otherwise the model is told, in its next look, to use upload.
func (a *Agent) handlePicker(ctx context.Context, s *session, obs Observation, results []ActionResult, sig []uint8) (Step, bool) {
	click, id, ok := s.pickerPoint(results)
	if !ok {
		return Step{}, false
	}
	if s.pickerSeen == nil {
		s.pickerSeen, s.pickerTried = map[string]bool{}, map[[2]int]bool{}
	}
	s.pickerSeen[id] = true
	// Whatever was planned after the click was planned for a page the click did not change.
	s.plan, s.verify = nil, ""
	tell := "A click of yours opened a file picker, which you cannot see, so no file was attached. Use upload at that point: leave resume null for your résumé, or name another listed file."
	key := pointKey(click)
	if s.pickerTried[key] || !a.checksOn(s) {
		s.notes = append(s.notes, tell)
		return Step{}, false
	}
	s.pickerTried[key] = true

	marked, err := markScreenshot(obs.Screenshot, []Action{click})
	if err != nil {
		s.notes = append(s.notes, tell)
		return Step{}, false
	}
	state := []decide.Part{
		decide.Text("A screenshot of a web page, with the control that was clicked marked."),
		decide.Image("data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(marked)),
	}
	response, err := a.newScreen(s.keys()).Decide(ctx, decide.Request{State: state, Questions: fileKindQuestion()})
	check := verdict{response: response, prompt: "what file the control marked on the page takes"}
	s.usage.Checks++
	s.usage.CheckCost += response.Usage.Cost
	s.usage.Cost += response.Usage.Cost
	entry := stepTrace{
		Seq: s.seq, Step: s.step, At: a.now(), Source: sourcePicker, URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport,
		Focus: obs.Focus, Notes: obs.Notes, Results: obs.Results, Memo: s.memo, Job: s.job, Usage: s.usage,
	}
	answer := response.Answers[askFileKind]
	if err != nil || answer.Probabilities[fileResume] < a.cfg.CheckMatch {
		kind := answer.Choice
		if err != nil {
			slog.Warn(runName(s.id)+": could not tell what the file picker takes, so the model decides.", plainlog.ErrorKey, err)
			kind = ""
		}
		a.record(s, entry, obs.Screenshot, []modelCall{check.call(err)})
		if kind == fileCover || kind == fileOther {
			s.notes = append(s.notes, tell+" That control looks like it takes "+map[string]string{fileCover: "a cover letter", fileOther: "another document"}[kind]+", not your résumé.")
		} else {
			s.notes = append(s.notes, tell)
		}
		return Step{}, false
	}

	// Without a job description the résumé is not chosen here: the person is asked.
	if a.needsAsk(s, "") {
		a.record(s, entry, obs.Screenshot, []modelCall{check.call(nil)})
		s.seq++
		return a.askStep(s, obs, results, sig, Action{Kind: KindUpload, X: click.X, Y: click.Y}), true
	}
	resume, note, err := a.pickResume(ctx, s, "")
	if err != nil {
		a.record(s, entry, obs.Screenshot, []modelCall{check.call(nil)})
		s.notes = append(s.notes, tell)
		return Step{}, false
	}
	upload := Action{
		ID: fmt.Sprintf("s%dp%d", s.step, len(s.pickerTried)), Kind: KindUpload,
		X: click.X, Y: click.Y, Resume: resume.ID, FileName: resume.FileName,
	}
	s.carried = results
	s.notes = append(s.notes, fmt.Sprintf("Your click at %.0f,%.0f opened a file picker, which you cannot see, so Acorn uploaded %s there for you. Next time use upload.", *click.X, *click.Y, resume.FileName))
	step := Step{Status: StatusWorking, Message: s.message, Actions: []Action{upload}, Number: s.step, Usage: s.usage, Survey: a.surveyNext(s, []Action{upload}, false)}
	if note != "" {
		step.Dropped = []string{"note: " + note}
	}
	entry.Status, entry.Message, entry.Actions, entry.Dropped = step.Status, step.Message, step.Actions, step.Dropped
	a.record(s, entry, obs.Screenshot, []modelCall{check.call(nil)})
	return step, true
}
