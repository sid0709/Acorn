package agent

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// A click that lands beside its control (in the gap of a bordered box, on the wrapper a page draws round
// an input) gives nothing focus, and what was to be typed is refused by the extension (focus-guard.ts).
// Told only that nothing had focus, a model plans the same point again a few pixels off: a recorded run
// did so nine times on a phone box, with a survey and a model call each time. So when typing or a key
// failed after a click that went through, the model is told where the page says the control the click
// named lies from the point it gave (which edge, how far), and when the page names no such control,
// which controls lie near the point. The note is measured against the plan's own point, so it holds
// whatever the next look's screens are scrolled to.

// nearControls is how many of the page's controls are named beside a point when none carries the model's label.
const nearControls = 3

// unreachedNotes tells the model, for each typed action or key that failed after a click that went
// through, where the control the click named really is. byID is the plan by action id, bound what each
// point was bound to, and obs the look after the batch, whose controls say where things are now.
func unreachedNotes(results []ActionResult, byID map[string]Action, bound map[string]MarkRef, obs Observation) []string {
	if len(obs.Marks) == 0 {
		return nil
	}
	var notes []string
	var reached *Action
	for _, result := range results {
		action, ok := byID[result.ID]
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
		if result.OK || reached == nil || (action.Kind != KindType && action.Kind != KindKey) {
			continue
		}
		notes = append(notes, unreachedNote(*reached, action, bound, obs))
		reached = nil
	}
	return notes
}

// unreachedNote is the note for one click that reached no control.
func unreachedNote(click, failed Action, bound map[string]MarkRef, obs Observation) string {
	var out strings.Builder
	fmt.Fprintf(&out, "Acorn clicked %s at (%.0f, %.0f)%s, but no control took focus there, so %s was not done.",
		forLabel(click.Label), *click.X, *click.Y, atScreen(click), whatFailed(failed))
	x, y := pageX(click, obs), pageY(click, obs)
	if ref, ok := bound[click.ID]; ok {
		fmt.Fprintf(&out, " The point is on the control the page names %q, so that control may be disabled, or covered by something: look at it before you try again.", ref.Label)
		return out.String()
	}
	if mark, ok := markByLabel(obs.Marks, click.Label, x, y); ok {
		fmt.Fprintf(&out, " The control the page names %q %s: aim inside its edges, at the middle of its value line.", mark.Label, fromPoint(mark.entryOf(), x, y))
		return out.String()
	}
	near := nearestMarks(obs.Marks, x, y, nearControls)
	if len(near) == 0 {
		out.WriteString(" The page reports no control near that point: look again and aim at a control.")
		return out.String()
	}
	parts := make([]string, len(near))
	for i, mark := range near {
		parts[i] = fmt.Sprintf("%q %s", orUnlabelled(mark.Label), fromPoint(mark.entryOf(), x, y))
	}
	fmt.Fprintf(&out, " The page's controls near that point: %s. Aim inside the edges of the one you mean.", strings.Join(parts, "; "))
	return out.String()
}

// fromPoint says where a box lies from a point: which of its edges is how far off, or that it lies round
// the point. It reads as a verb phrase: "has its top edge 9 px below the point".
func fromPoint(box Rect, x, y float64) string {
	var parts []string
	switch {
	case y < box.Y:
		parts = append(parts, fmt.Sprintf("its top edge %.0f px below the point", box.Y-y))
	case y > box.Y+box.H:
		parts = append(parts, fmt.Sprintf("its bottom edge %.0f px above the point", y-box.Y-box.H))
	}
	switch {
	case x < box.X:
		parts = append(parts, fmt.Sprintf("its left edge %.0f px right of the point", box.X-x))
	case x > box.X+box.W:
		parts = append(parts, fmt.Sprintf("its right edge %.0f px left of the point", x-box.X-box.W))
	}
	if len(parts) == 0 {
		return "lies round the point"
	}
	return "has " + strings.Join(parts, " and ")
}

// nearestMarks are up to n controls on the row of the point (the point lies within a row's height of
// their field, above or below), nearest first.
func nearestMarks(marks []ControlMark, x, y float64, n int) []ControlMark {
	type near struct {
		mark ControlMark
		far  float64
	}
	var found []near
	for _, mark := range marks {
		field := mark.fieldOf()
		if y < field.Y-field.H-markSlackPx || y > field.Y+2*field.H+markSlackPx {
			continue
		}
		found = append(found, near{mark, distance(mark.entryOf(), x, y)})
	}
	sort.SliceStable(found, func(i, j int) bool { return found[i].far < found[j].far })
	if len(found) > n {
		found = found[:n]
	}
	out := make([]ControlMark, len(found))
	for i, one := range found {
		out[i] = one.mark
	}
	return out
}

// distance is how far a point is from a box: 0 inside it.
func distance(box Rect, x, y float64) float64 {
	dx := math.Max(0, math.Max(box.X-x, x-box.X-box.W))
	dy := math.Max(0, math.Max(box.Y-y, y-box.Y-box.H))
	return math.Hypot(dx, dy)
}

func forLabel(label string) string {
	if label = strings.TrimSpace(label); label != "" {
		return fmt.Sprintf("for %q", label)
	}
	return "a control"
}

func atScreen(action Action) string {
	if action.Zone > 0 {
		return fmt.Sprintf(" on screen %d", action.Zone)
	}
	return ""
}

func whatFailed(action Action) string {
	if action.Kind == KindKey {
		return "pressing " + action.Keys
	}
	if action.Secret {
		return "the typing"
	}
	return fmt.Sprintf("typing %q", action.Text)
}

func orUnlabelled(label string) string {
	if label == "" {
		return "(no label)"
	}
	return label
}
