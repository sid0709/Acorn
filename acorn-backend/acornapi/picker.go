package acornapi

import (
	"context"

	"github.com/sid0709/OpenSeat/acorn-backend/acorn"
	"github.com/sid0709/OpenSeat/acorn-backend/selector"
)

// profileAnswer is the intended answer when the decision model reads the profile itself.
const profileAnswer = "Answer from the applicant profile"

// gatewayPicker answers the fast planner's choice fields with the SelectorGateway (Jev).
type gatewayPicker struct{ gateway *selector.Gateway }

func (p gatewayPicker) PickChoices(ctx context.Context, applicant string, questions []acorn.ChoiceQuestion) (map[int][]string, error) {
	if len(questions) == 0 {
		return map[int][]string{}, nil
	}
	items := make([]selector.ChoiceItem, 0, len(questions))
	for _, q := range questions {
		intended := q.Intended
		if intended == "" {
			intended = profileAnswer
		}
		items = append(items, selector.ChoiceItem{
			ID: q.ElementIndex, Field: q.Field, Intended: intended, Options: q.Options, Multiple: q.Multiple,
		})
	}
	picks, _, err := p.gateway.PickBatch(ctx, applicant, items)
	if err != nil {
		return nil, err
	}
	out := make(map[int][]string, len(picks))
	for _, pick := range picks {
		out[pick.ID] = pick.Options
	}
	return out, nil
}
