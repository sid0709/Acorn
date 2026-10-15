package acorn

import (
	"context"
	"log/slog"
	"math/rand/v2"
)

// commonSelectionIntent is what the decision model is asked when the profile did not
// settle a choice the form requires: the answer most people give.
const commonSelectionIntent = "The profile does not settle this question. Pick the option most applicants select for it: the most common choice."

// mustAnswer says a choice field has to end with a selection: the page requires it
// (markup or its required mark) and its options are answers a person picks. A field
// the page leaves optional may stay blank, and a single box is a consent, never a pick.
func mustAnswer(field FormField) bool {
	if !field.Required || len(field.Options) == 0 {
		return false
	}
	switch field.Kind {
	case fieldRadio, fieldSelect, fieldCheckbox, fieldButtons:
		return true
	}
	return false
}

// settleChoices gives every required choice field a selection when the decision model
// picked none: first by asking it again for the most common selection, then, for what
// is still blank, by taking any one option, because a required choice left empty only
// stops the form. It runs only when the model answered (a failed call leaves the fields
// to the runtime) and never for an optional field.
func (s *Service) settleChoices(ctx context.Context, applicant string, choices []FormField, picks map[int][]string, pickErr error) map[int][]string {
	if pickErr != nil || s.picker == nil {
		return picks
	}
	var open []FormField
	for _, field := range choices {
		if len(picks[field.ElementIndex]) == 0 && mustAnswer(field) {
			open = append(open, field)
		}
	}
	if len(open) == 0 {
		return picks
	}
	settled := make(map[int][]string, len(picks)+len(open))
	for index, chosen := range picks {
		settled[index] = chosen
	}
	questions := choiceQuestions(open)
	for i := range questions {
		questions[i].Intended = commonSelectionIntent
		// The field is a question to answer, not buttons that might act on the form.
		questions[i].MayAct = false
	}
	common, err := s.picker.PickChoices(ctx, applicant, questions)
	if err != nil {
		slog.Warn("acorn fast plan: the most common selection was not asked for", "error", err)
		return picks
	}
	for index, chosen := range common {
		if len(chosen) > 0 {
			settled[index] = chosen
		}
	}
	for _, field := range open {
		if len(settled[field.ElementIndex]) > 0 {
			slog.Info("acorn fast plan: a required choice took the most common selection", "field", field.Label)
			continue
		}
		settled[field.ElementIndex] = []string{field.Options[rand.IntN(len(field.Options))]}
		slog.Info("acorn fast plan: a required choice took any option", "field", field.Label)
	}
	return settled
}
