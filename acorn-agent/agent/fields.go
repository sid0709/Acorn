package agent

import (
	"fmt"
	"log/slog"
	"strings"

	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// The form's to-do list comes from the pictures. On every survey the model lists each question it sees,
// where it is and whether it is answered (reply.Fields); the run keeps that list for the page, the reviews
// of the zones (the decision model reading the photo of each part right after it was filled) tick a field
// off or put it back, and the next survey replaces the list with what the model reads then. The page's own
// list of controls (marks) says where things are, never whether they are answered: it lies for a dropdown
// the page draws itself, and the sidebar listed answered boxes as needing an answer because of it. What the
// list says drives the gates too: a stop or a send is held for the fields the model read as empty. Each
// survey the model is shown carries the list back to it, every field with the screen of that survey it lies
// on (the number written on the screenshot), so it sees what is left and where, and puts its reading right.

// What the model says of a field's state.
const (
	FieldFilled      = "filled"
	FieldEmpty       = "empty"
	FieldNeedsPerson = "needs_person"
)

// FieldState is one question of the form: its label as the page writes it, where it is (screenshot pixels
// from the page's top), and its state.
type FieldState struct {
	Label string  `json:"label"`
	Y     float64 `json:"y"`
	State string  `json:"state"`
}

// noteFields replaces the page's list with what the model read on this survey.
func (s *session) noteFields(answer reply, obs Observation) {
	if answer.Fields == nil || len(obs.Survey) == 0 {
		return
	}
	var fields []FieldState
	for _, f := range answer.Fields {
		label := strings.TrimSpace(f.Label)
		if label == "" || f.Screen == nil || f.Y == nil || *f.Screen < 1 || *f.Screen > len(obs.Survey) {
			continue
		}
		state := f.State
		if state != FieldFilled && state != FieldNeedsPerson {
			state = FieldEmpty
		}
		fields = append(fields, FieldState{Label: label, Y: obs.Survey[*f.Screen-1].ScrollY + *f.Y, State: state})
	}
	s.fields, s.fieldsURL, s.fieldsChanged = fields, withoutFragment(obs.URL), true
	slog.Info(fmt.Sprintf("%s: the model read %s on the page, %d of them empty.", runName(s.id), plainlog.Count(len(fields), "field"), len(s.emptyFieldsOn(s.fieldsURL))))
}

// fieldsOn is the list for the page being looked at; nil for another page.
func (s *session) fieldsOn(url string) []FieldState {
	if s.fieldsURL != withoutFragment(url) {
		return nil
	}
	return s.fields
}

// emptyFieldsOn names the fields the model read as empty on the page.
func (s *session) emptyFieldsOn(url string) []string {
	var out []string
	for _, f := range s.fieldsOn(url) {
		if f.State == FieldEmpty {
			out = append(out, f.Label)
		}
	}
	return out
}

// setField puts a field of the list in a state, by the label the model used for it, when a review found it
// showing what was planned (filled) or not (empty).
func (s *session) setField(label, state string) {
	for i := range s.fields {
		if labelsAgree(s.fields[i].Label, label) && s.fields[i].State != state {
			s.fields[i].State, s.fieldsChanged = state, true
		}
	}
}

// takeFields is the list to send with the answer when it changed, and forgets that it changed.
func (s *session) takeFields() []FieldState {
	if !s.fieldsChanged {
		return nil
	}
	s.fieldsChanged = false
	return append([]FieldState{}, s.fields...)
}

// emptyFieldNear is whether a field the model read as empty lies in a stretch of the page.
func (s *session) emptyFieldNear(url string, from, to float64) bool {
	for _, f := range s.fieldsOn(url) {
		if f.State == FieldEmpty && f.Y >= from && f.Y <= to {
			return true
		}
	}
	return false
}

// screenOf is the number (from 1) of the survey screen a place on the page lies on, the one it lies most
// inside of where screens overlap; 0 when no screen of the survey holds it.
func screenOf(y float64, obs Observation) int {
	best, room := 0, -1.0
	height := float64(obs.Viewport.Height)
	for i, screen := range obs.Survey {
		if y < screen.ScrollY || y > screen.ScrollY+height {
			continue
		}
		if inside := min(y-screen.ScrollY, screen.ScrollY+height-y); inside > room {
			best, room = i+1, inside
		}
	}
	return best
}

// fieldsNote tells the model its own to-do list of the page with a survey: each field, the screen it lies on
// (or that it lies in a part it settled), and its state as it read it and the reviews of the photos corrected
// it. Empty when there is no list for the page, or the look is no survey.
func (s *session) fieldsNote(obs Observation) string {
	fields := s.fieldsOn(obs.URL)
	if len(fields) == 0 || len(obs.Survey) == 0 {
		return ""
	}
	parts := make([]string, len(fields))
	for i, f := range fields {
		where := "not in this survey"
		switch n := screenOf(f.Y, obs); {
		case n > 0:
			where = fmt.Sprintf("screen %d", n)
		case s.inSettled(f.Y, 0):
			where = "settled"
		}
		parts[i] = fmt.Sprintf("[%s] %q: %s", where, f.Label, f.State)
	}
	return fmt.Sprintf("Your to-do list of this page, as you read it on your last survey and the photos of each part corrected it: %s. "+
		"It is your last reading, not the page: judge each field by the screenshots you are given now, fill what is empty, and list every field "+
		"in \"fields\" as you read it now. A field is filled when its box shows an answer, whatever message lies beside it.", strings.Join(parts, "; "))
}
