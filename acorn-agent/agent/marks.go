package agent

import "math"

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

// center is the middle of the box.
func (r Rect) center() (x, y float64) { return r.X + r.W/2, r.Y + r.H/2 }

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
		if mark, ok := markAt(obs.Marks, pageX(action, obs), pageY(action, obs)); ok {
			out[action.ID] = MarkRef{ID: mark.ID, Rect: mark.Rect, Label: mark.Label, Kind: mark.Kind}
		}
	}
	return out
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
