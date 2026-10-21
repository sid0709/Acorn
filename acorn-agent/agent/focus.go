package agent

import (
	"math"
	"sort"
	"strings"
)

// A fill can miss for many reasons: the form moved, something covered the box, the box sat at the edge of
// the screen it was planned on. The to-do list is what counts (fields.go): a field whose fill did not
// verify (the review of its zone's photo found it not showing the answer, or the typing after its click
// found nothing to type into) is filled again from the next survey. Nothing is scrolled for it on its own:
// the page stays still while it is filled and photographed. What the next survey owes it is a screen where it
// is whole: the step names where the fields still to fill lie (Step.SurveyFocus), and the extension adds a
// screen centred on one that no screen of its survey shows clear of the window's edges. Where a field lies is
// the page position of its own planned click, else the model's reading of it in the list.

// focusTarget is a field whose fill did not verify: its label, as the plan named it, and where it lies on
// the page (screenshot pixels from its top).
type focusTarget struct {
	label string
	y     float64
}

// unverified records a field whose fill did not verify. A place it does not know (0) is taken from the
// to-do list. What was settled round it is not settled any more, and the next look is a survey. The session
// is locked.
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
	half := float64(s.viewport.Height) / 2
	s.unsettle(y-half, y+half)
	s.surveyAgain = true
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

// surveyFocusPx is how close (screenshot pixels) two places to keep whole may be and count as one.
const surveyFocusPx = 24

// surveyFocus is where the fields still to fill lie on the page (screenshot pixels from its top), top to
// bottom, for the survey that follows to show each whole: the fields whose fill did not verify since the model
// last looked, and the fields the to-do list has empty. Nothing on another page than the plan's.
func (s *session) surveyFocus(obs Observation) []float64 {
	url := withoutFragment(obs.URL)
	var ys []float64
	if s.expectURL == url {
		for _, target := range s.retry {
			ys = append(ys, target.y)
		}
	}
	s.retry = nil
	for _, f := range s.fieldsOn(obs.URL) {
		if f.State == FieldEmpty {
			ys = append(ys, f.Y)
		}
	}
	sort.Float64s(ys)
	var out []float64
	for _, y := range ys {
		if len(out) > 0 && math.Abs(y-out[len(out)-1]) <= surveyFocusPx {
			continue
		}
		out = append(out, y)
	}
	return out
}
