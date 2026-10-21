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
// list says drives the gates too: a stop or a send is held for the fields the model read as empty.

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
