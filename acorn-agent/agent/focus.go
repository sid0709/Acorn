package agent

import (
	"fmt"
	"log/slog"
	"math"
	"sort"
	"strings"
)

// A fill can miss for many reasons: the form moved, something covered the box, the box sat at the edge of
// the screen it was planned on. The to-do list is what counts (fields.go): a field whose fill did not
// verify (the review of its zone's photo found it not showing the answer, or the typing after its click
// found nothing to type into) is gone back to. Before the model plans again, the agent scrolls the page so
// that field is in the middle of the window, where nothing at an edge covers it, and the model's next look
// is that one screenshot, with a note naming the field: it fills it from the picture. Each field is gone back
// to once on its page; after that, the survey and the hold on the send (sendgate.go) take over. Where the
// field lies is the page position of its own planned click, else the model's reading of it in the list.

// focusTarget is a field to go back to: its label, as the plan named it, and where it lies on the page.
type focusTarget struct {
	label string
	y     float64
}

// unverified records a field whose fill did not verify. A place it does not know (0) is taken from the
// to-do list. The session is locked.
func (s *session) unverified(label string, y float64) {
	label = strings.TrimSpace(label)
	if label == "" {
		return
	}
	if y <= 0 {
		for _, f := range s.fields {
			if labelsAgree(f.Label, label) {
				y = f.Y
				break
			}
		}
	}
	if y <= 0 {
		return
	}
	s.retry = append(s.retry, focusTarget{label: label, y: y})
}

// noteUnreachedFields records the fields whose typing found nothing to type into after their click went
// through: the click missed the box.
func (s *session) noteUnreachedFields(results []ActionResult) {
	var reached *Action
	for _, result := range results {
		action, ok := s.byID[result.ID]
		if !ok {
			continue
		}
		if isPointAction(action) {
			reached = nil
			if result.OK {
				reached = &action
			}
			continue
		}
		if result.OK || reached == nil || action.Kind != KindType {
			continue
		}
		top := s.planScrollY
		if reached.ScrollTo != nil {
			top = *reached.ScrollTo
		}
		s.unverified(reached.Label, top+*reached.Y)
		reached = nil
	}
}

// focusKey is a field of a page, for the once-per-page rule.
func focusKey(url, label string) string { return withoutFragment(url) + "\n" + labelWords(label) }

// takeFocus is the topmost field to go back to on this page that was not gone back to yet, and forgets the
// rest: the model is told of them anyway, and its next survey reads the list again.
func (s *session) takeFocus(url string) (focusTarget, bool) {
	targets := s.retry
	s.retry = nil
	// The places are of the page the plan was made on: on another page they mean nothing.
	if s.expectURL != withoutFragment(url) {
		return focusTarget{}, false
	}
	sort.SliceStable(targets, func(i, j int) bool { return targets[i].y < targets[j].y })
	for _, target := range targets {
		key := focusKey(url, target.label)
		if s.retried[key] {
			continue
		}
		if s.retried == nil {
			s.retried = map[string]bool{}
		}
		s.retried[key] = true
		return target, true
	}
	return focusTarget{}, false
}

// focusNote tells the model the window is on a field whose fill did not take.
func focusNote(label string) string {
	return fmt.Sprintf("Your answer to %q did not take: the field is still empty. Acorn scrolled it to the middle of this screenshot, "+
		"clear of anything at the window's edges. Find it on this screenshot and fill it here (leave \"screen\" null), then go on with the rest of your to-do list.", label)
}

// focusStep answers a look itself when a field's fill did not verify: one scroll that brings the field to the
// middle of the window, no survey after it, and the model is told on that look which field it is. When the
// window is there already, the model looks now, told the same. It reports false when there is nothing to go
// back to.
func (a *Agent) focusStep(s *session, obs Observation, results []ActionResult, sig []uint8) (Step, bool) {
	target, ok := s.takeFocus(obs.URL)
	if !ok {
		return Step{}, false
	}
	height := float64(obs.Viewport.Height)
	top := math.Max(0, math.Min(target.y-height/2, obs.Viewport.PageHeight-height))
	s.notes = append(s.notes, focusNote(target.label))
	// What the run settled around the field is not settled: the scroll goes there, and the survey after shows it.
	s.unsettle(top, top+height)
	dy := top - obs.Viewport.ScrollY
	if math.Abs(dy) < 1 && len(obs.Survey) == 0 {
		return Step{}, false
	}
	x, y := float64(obs.Viewport.Width)/2, height/2
	scroll := Action{ID: fmt.Sprintf("s%d%sf", s.seq, choosePrefix), Kind: KindScroll, X: &x, Y: &y, DY: dy}
	s.carried = withoutChoose(results)
	s.stale, s.lastSig = 0, sig
	step := Step{Status: StatusWorking, Message: s.message, Actions: []Action{scroll}, Number: s.step, Usage: s.usage}
	a.record(s, stepTrace{
		Seq: s.seq, Step: s.step, At: a.now(), Source: sourceFocus, URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport,
		Focus: obs.Focus, Notes: obs.Notes, Results: obs.Results, Memo: s.memo, Job: s.job,
		Status: step.Status, Message: step.Message, Actions: step.Actions, Usage: s.usage,
	}, obs.Screenshot, nil)
	slog.Info(fmt.Sprintf("%s: %q did not take its answer, so the page is scrolled to it (%.0f px from the top) and the model looks there.",
		runName(s.id), target.label, target.y))
	return step, true
}

// sourceFocus marks an entry where the agent scrolled to a field whose fill did not take.
const sourceFocus = "focus"
