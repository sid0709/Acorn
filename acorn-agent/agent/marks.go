package agent

import (
	"fmt"
	"math"
	"strings"
)

// The extension keeps a list of the page's controls and where each one sits on the page, and sends it with
// a survey. A point of a plan is measured on a picture; when it is made, the control it is on is looked up
// in that list, and the plan keeps the control's ID and place with the point (MarkRef). The page can
// change shape between the survey and the action: a message appears under a field and everything below
// it moves. The extension then finds the same control by its ID and moves the point by the difference of
// its two places, instead of searching a picture for a target whose surroundings the plan itself has
// just filled in (docs 19.4m). A point that is on no control is acted on as before.

const (
	// maxMarks bounds how many controls one look may carry: the list is the extension's, not trusted.
	maxMarks = 600
	// markSlackPx is how far outside a box a point may lie and still be on it: a point is a whole pixel
	// of a screenshot that was made smaller.
	markSlackPx = 1.5
	// markTieAreaPx is how close in area two boxes are to be as small as each other.
	markTieAreaPx = 0.5
)

// contains is whether the point (x, y) is in the box, give or take the slack.
func (r Rect) contains(x, y, slack float64) bool {
	return x >= r.X-slack && x <= r.X+r.W+slack && y >= r.Y-slack && y <= r.Y+r.H+slack
}

func (r Rect) area() float64 { return r.W * r.H }

func (r Rect) centerY() float64 { return r.Y + r.H/2 }

// finite is whether every number of the box is a real one and the box has a size.
func (r Rect) finite() bool {
	for _, n := range []float64{r.X, r.Y, r.W, r.H} {
		if math.IsNaN(n) || math.IsInf(n, 0) {
			return false
		}
	}
	return r.W > 0 && r.H > 0
}

// acceptMarks keeps the marks of a look that can be used: an ID, a box with a size, at most maxMarks.
func acceptMarks(marks []ControlMark) []ControlMark {
	var kept []ControlMark
	for _, mark := range marks {
		if len(kept) == maxMarks {
			break
		}
		if mark.ID == "" || !mark.Rect.finite() {
			continue
		}
		if mark.Box != nil && !mark.Box.finite() {
			mark.Box = nil
		}
		if mark.Entry != nil && !mark.Entry.finite() {
			mark.Entry = nil
		}
		kept = append(kept, mark)
	}
	return kept
}

// entryOf is where a control is clicked or typed at: the part of its box that is not its label when the
// label is printed inside the box, else the box itself.
func (m ControlMark) entryOf() Rect {
	if m.Entry != nil {
		return *m.Entry
	}
	return m.Rect
}

// fieldOf is the field round a control (its label, the gap round it) as the page reports it, else the
// control's own box.
func (m ControlMark) fieldOf() Rect {
	if m.Box != nil {
		return *m.Box
	}
	return m.Rect
}

// center is the middle of the box.
func (r Rect) center() (x, y float64) { return r.X + r.W/2, r.Y + r.H/2 }

// grown is the box with a margin of `by` on every side.
func (r Rect) grown(by float64) Rect {
	return Rect{X: r.X - by, Y: r.Y - by, W: r.W + 2*by, H: r.H + 2*by}
}

// pageY is the place on the page (screenshot pixels from its top) of the point of an action: it is
// measured on the screen the page is scrolled to for it.
func pageY(action Action, obs Observation) float64 {
	top := obs.Viewport.ScrollY
	if action.ScrollTo != nil {
		top = *action.ScrollTo
	}
	return top + *action.Y
}

// pageX is the place on the page (screenshot pixels from its left) of the point of an action.
func pageX(action Action, obs Observation) float64 {
	return obs.Viewport.ScrollX + *action.X
}

// markAt is the control a point of the page is on: the one whose own box holds it, else the one whose
// field holds it (its label, the gap round it). A point that two controls hold alike, or that none
// holds, is on no control.
func markAt(marks []ControlMark, x, y float64) (ControlMark, bool) {
	if mark, ok := smallestHolding(marks, func(m ControlMark) *Rect { return &m.Rect }, x, y); ok {
		return mark, true
	}
	return smallestHolding(marks, func(m ControlMark) *Rect { return m.Box }, x, y)
}

// smallestHolding is the mark whose box (as boxOf gives it) holds the point and is the smallest such;
// it is not found when a second mark's box is as small, since which of them the point is on is not known.
func smallestHolding(marks []ControlMark, boxOf func(ControlMark) *Rect, x, y float64) (ControlMark, bool) {
	var best ControlMark
	bestArea := math.Inf(1)
	found, tied := false, false
	for _, mark := range marks {
		box := boxOf(mark)
		if box == nil || !box.contains(x, y, markSlackPx) {
			continue
		}
		switch area := box.area(); {
		case !found || area < bestArea-markTieAreaPx:
			best, bestArea, found, tied = mark, area, true, false
		case math.Abs(area-bestArea) <= markTieAreaPx:
			tied = true
		}
	}
	return best, found && !tied
}

// boundMark is the control a point of a plan is on: the one that holds the point (markAt), else the one
// the plan's label names when that is the only such control and the point lies within a row of it. The box
// a model aims at the middle of can be larger than what the page reports as the control (a phone box whose
// input shares its wrapper with a flag button, a bordered box drawn round an input), and the model's own
// label then says which control it meant: a recorded run clicked beside a phone box nine times.
func boundMark(marks []ControlMark, action Action, obs Observation) (ControlMark, bool) {
	x, y := pageX(action, obs), pageY(action, obs)
	if mark, ok := markAt(marks, x, y); ok {
		return mark, true
	}
	return markByLabel(marks, action.Label, x, y)
}

// markByLabel is the one control the page calls what the model called it (labels.go) that the point lies
// within a row of: its field grown by its own height on every side. None when no label agrees, when two
// do, or when the point lies further away.
func markByLabel(marks []ControlMark, label string, x, y float64) (ControlMark, bool) {
	var found ControlMark
	n := 0
	for _, mark := range marks {
		if !labelsAgree(label, mark.Label) {
			continue
		}
		field := mark.fieldOf()
		if !field.grown(field.H).contains(x, y, markSlackPx) {
			continue
		}
		found, n = mark, n+1
	}
	return found, n == 1
}

// bindMarks binds the point of every point action of a plan to the control it is on, by action id. A
// look without marks (no survey) binds nothing, and a point on no control is left out.
func bindMarks(planned []Action, obs Observation) map[string]MarkRef {
	if len(obs.Marks) == 0 {
		return nil
	}
	out := map[string]MarkRef{}
	for _, action := range planned {
		if !isPointAction(action) {
			continue
		}
		if mark, ok := boundMark(obs.Marks, action, obs); ok {
			out[action.ID] = MarkRef{ID: mark.ID, Rect: mark.Rect, Label: mark.Label, Kind: mark.Kind}
		}
	}
	return out
}

// withoutMisaimedCommits takes out of a plan a click the model says sends the page or goes on to the next
// (Action.Commit) whose point is bound to a control that is filled rather than pressed: the model's point
// missed the button and landed on a field (a recorded run's "Submit" click was bound to the LinkedIn box
// above it, and clicked into it). The page's own word on what is at the point is already known, so no
// checker is asked; the plan loses the click, the send is held with it (holdCommits), and the model is told
// to aim again. It says how many were taken out.
func (s *session) withoutMisaimedCommits(planned []Action) ([]Action, int) {
	var kept []Action
	taken := 0
	for _, action := range planned {
		ref, bound := s.marks[action.ID]
		if action.Commit != "" && bound && isField(ref.Kind) {
			taken++
			delete(s.marks, action.ID)
			s.notes = append(s.notes, misaimedCommitNote(action, ref))
			continue
		}
		kept = append(kept, action)
	}
	return kept, taken
}

// misaimedCommitNote tells the model that its click to send the page was on a field, and which.
func misaimedCommitNote(action Action, ref MarkRef) string {
	what := "the click that sends the page or goes on"
	if label := strings.TrimSpace(action.Label); label != "" {
		what = fmt.Sprintf("your click on %q", label)
	}
	where := "a field"
	if label := strings.TrimSpace(ref.Label); label != "" {
		where = fmt.Sprintf("the field %q", label)
	}
	return fmt.Sprintf("Acorn did not make %s: its point was on %s, not on a button. Find the button on the screens and plan the click on it, with the right screen number.", what, where)
}

// boundLines says which control each point of a plan is bound to, for the trace: "s3a1 input:text:first".
func boundLines(planned []Action, marks map[string]MarkRef) []string {
	var out []string
	for _, action := range planned {
		if ref, ok := marks[action.ID]; ok {
			out = append(out, action.ID+" "+ref.ID)
		}
	}
	return out
}

// carryMark gives an action the agent made the control of the model's action it came from, as carryAnchor
// does the picture.
func (s *session) carryMark(fromID, toID string) {
	if found, ok := s.marks[fromID]; ok {
		s.marks[toID] = found
	}
}

// attachMarks sets the control on each point action that goes out, from what the plan bound.
func (s *session) attachMarks(actions []Action) {
	for i := range actions {
		ref, ok := s.marks[actions[i].ID]
		if !ok || !isPointAction(actions[i]) {
			continue
		}
		bound := ref
		actions[i].Mark = &bound
	}
}
