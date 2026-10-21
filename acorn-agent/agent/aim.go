package agent

import (
	"fmt"
	"log/slog"

	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// A model aims at the middle of what it reads as the control. For a bordered field whose question is
// printed inside the box, that middle is on the words, above the line where the value goes; for a
// dropdown with a long question it is on the question, not on the row that opens the list. A click
// there opens nothing (a recorded run lost a field to it, and the check of the point against its label
// refused another), and a person would click the line below the words. So before a fast-fill plan is
// checked or carried out, each point that is in a control's field but not on the control's entry (its
// box less its own label, as the page reports it) is moved onto the entry: at its own x when the entry
// reaches it, else the entry's middle. A point on no control's field is bound by the model's own label
// when one control near it carries that label (boundMark). The page's controls say only where things
// are: what a control is (a dropdown, a text box) is the model's reading of the picture, so a choose stays
// a choose whatever the page calls the control under it. A recorded run's dropdown hid a text input of its
// own under its box; the page called the point a text box, the choose was typed into, and nothing was picked.

// aimAtControls moves the points of a plan onto the entries of the controls they are on, and says how
// many it moved. A look without marks changes nothing.
func aimAtControls(planned []Action, obs Observation) ([]Action, int) {
	moved := 0
	if len(obs.Marks) == 0 {
		return planned, moved
	}
	out := make([]Action, 0, len(planned))
	for _, action := range planned {
		// A point on an option of the open list is the pick itself: it stays where the model put it.
		if !isPointAction(action) || onOpenOption(action, obs) {
			out = append(out, action)
			continue
		}
		mark, ok := boundMark(obs.Marks, action, obs)
		if !ok {
			out = append(out, action)
			continue
		}
		if aimed, ok := aimedAt(action, mark, obs); ok {
			action = aimed
			moved++
		}
		out = append(out, action)
	}
	return out, moved
}

// aimedAt is the action with its point on the control's entry, when it was not there: at the point's
// own x when the entry reaches it, else the entry's middle; its y the entry's middle. Not moved when
// the entry lies off the screen the point was measured on.
func aimedAt(action Action, mark ControlMark, obs Observation) (Action, bool) {
	entry := mark.entryOf()
	x, y := pageX(action, obs), pageY(action, obs)
	if entry.contains(x, y, markSlackPx) {
		return action, false
	}
	top := obs.Viewport.ScrollY
	if action.ScrollTo != nil {
		top = *action.ScrollTo
	}
	cx, cy := entry.center()
	newX, newY := cx-obs.Viewport.ScrollX, cy-top
	if x >= entry.X && x <= entry.X+entry.W {
		newX = *action.X
	}
	if newX < 0 || newY < 0 || newX >= float64(obs.Viewport.Width) || newY >= float64(obs.Viewport.Height) {
		return action, false
	}
	moved := action
	moved.X, moved.Y = &newX, &newY
	return moved, true
}

// aimAndLog aims the plan at the page's controls and says what it did.
func (s *session) aimAndLog(planned []Action, obs Observation) []Action {
	planned, moved := aimAtControls(planned, obs)
	if moved > 0 {
		slog.Info(fmt.Sprintf("%s: %s moved onto the entry of the control it was on.", runName(s.id), plainlog.Count(moved, "point")))
	}
	return planned
}

func isOrAre(n int) string {
	if n == 1 {
		return "is"
	}
	return "are"
}
