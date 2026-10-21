package agent

import (
	"fmt"
	"log/slog"
	"strings"

	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// A model aims at the middle of what it reads as the control. For a bordered field whose question is
// printed inside the box, that middle is on the words, above the line where the value goes; for a
// dropdown with a long question it is on the question, not on the row that opens the list. A click
// there opens nothing (a recorded run lost a field to it, and the check of the point against its label
// refused another), and a person would click the line below the words. So before a fast-fill plan is
// checked or carried out, each point that is in a control's field but not on the control's entry (its
// box less its own label, as the page reports it) is moved onto the entry: at its own x when the entry
// reaches it, else the entry's middle. A choose on a text box is typed into instead of chosen: the
// page says what the control is, and a text box has no list to choose from.

// aimed is what aiming a plan at the page's controls did.
type aimed struct {
	moved int
	typed int
}

// aimAtControls moves the points of a plan onto the entries of the controls they are on, and turns a
// choose on a text box into a click and the typed answer. A look without marks changes nothing.
func aimAtControls(planned []Action, obs Observation) ([]Action, aimed) {
	var did aimed
	if len(obs.Marks) == 0 {
		return planned, did
	}
	out := make([]Action, 0, len(planned))
	for _, action := range planned {
		if !isPointAction(action) {
			out = append(out, action)
			continue
		}
		mark, ok := markAt(obs.Marks, pageX(action, obs), pageY(action, obs))
		if !ok {
			out = append(out, action)
			continue
		}
		if moved, ok := aimedAt(action, mark, obs); ok {
			action = moved
			did.moved++
		}
		if action.Kind == KindChoose && mark.Kind == MarkKindInput {
			out = append(out, typedInstead(action)...)
			did.typed++
			continue
		}
		out = append(out, action)
	}
	return out, did
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

// typedInstead is a choose on a text box as a click on it and the answer typed: there is no list to
// choose from. The click keeps the choose's id, so what is bound to it (its control, its picture) holds,
// and its label, so the review of its zone reads the field.
func typedInstead(choose Action) []Action {
	click := choose
	click.Kind, click.Text = KindClick, ""
	return []Action{click, {ID: choose.ID + "t", Kind: KindType, Text: choose.Text, Zone: choose.Zone}}
}

// typedInsteadNote tells the model that answers were typed into boxes it took for dropdowns.
func typedInsteadNote(typed int) string {
	return fmt.Sprintf("%s you planned as a dropdown (choose) %s a text box, the page says, so Acorn clicked it and typed the answer instead. A box with no dropdown arrow is a text box: click it and type.",
		plainlog.Count(typed, "box"), isOrAre(typed))
}

func isOrAre(n int) string {
	if n == 1 {
		return "is"
	}
	return "are"
}

// aimLine says what aiming did, for the run's story.
func aimLine(id string, did aimed) string {
	var parts []string
	if did.moved > 0 {
		parts = append(parts, plainlog.Count(did.moved, "point")+" moved onto the entry of the control it was on")
	}
	if did.typed > 0 {
		parts = append(parts, plainlog.Count(did.typed, "answer")+" typed into a text box the model took for a dropdown")
	}
	return runName(id) + ": " + strings.Join(parts, "; ") + "."
}

// aimAndLog aims the plan at the page's controls, says what it did, and tells the model of an answer typed
// in place of a choose.
func (s *session) aimAndLog(planned []Action, obs Observation) []Action {
	planned, did := aimAtControls(planned, obs)
	if did.moved > 0 || did.typed > 0 {
		slog.Info(aimLine(s.id, did))
	}
	if did.typed > 0 {
		s.notes = append(s.notes, typedInsteadNote(did.typed))
	}
	return planned
}
