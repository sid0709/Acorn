package agent

import (
	"fmt"
	"math"
)

// A control pressed again and again, step after step, is the slow way to a result that another way
// reaches at once (a heading that lists the years, a value that can be typed, a key). Nothing here
// knows what the control is: the model is told what it has been doing and chooses another way.

// repeatPointSlackPx is how far apart two clicks may land and still be the same spot, in screenshot pixels.
const repeatPointSlackPx = 8

// repeatPoint is the one spot every action of a step clicks, and how many clicks that is; ok is false
// for a step that did anything else.
func repeatPoint(actions []Action) (x, y float64, clicks int, ok bool) {
	for i, action := range actions {
		if action.Kind != KindClick || action.X == nil || action.Y == nil {
			return 0, 0, 0, false
		}
		if i == 0 {
			x, y = *action.X, *action.Y
		} else if math.Hypot(*action.X-x, *action.Y-y) > repeatPointSlackPx {
			return 0, 0, 0, false
		}
	}
	return x, y, len(actions), len(actions) > 0
}

// noteRepeat counts the steps in a row that only pressed one spot, and once they reach RepeatSteps tells
// the model on its next look. A step that did anything else, or pressed elsewhere, starts the count again.
func (a *Agent) noteRepeat(s *session, planned []Action) {
	x, y, clicks, ok := repeatPoint(planned)
	if !ok {
		s.repeatSteps, s.repeatClicks = 0, 0
		return
	}
	if s.repeatSteps > 0 && math.Hypot(x-s.repeatX, y-s.repeatY) <= repeatPointSlackPx {
		s.repeatSteps++
		s.repeatClicks += clicks
	} else {
		s.repeatSteps, s.repeatClicks = 1, clicks
	}
	s.repeatX, s.repeatY = x, y
	if a.cfg.RepeatSteps > 0 && s.repeatSteps >= a.cfg.RepeatSteps {
		s.notes = append(s.notes, fmt.Sprintf("Your last %d steps each only pressed the same spot (%d presses in all). Pressing one control again and again costs a step each time: look for a way that gets there at once, such as a heading or label that opens a list, a value you can type, or a key, or move on and say what is left.", s.repeatSteps, s.repeatClicks))
	}
}
