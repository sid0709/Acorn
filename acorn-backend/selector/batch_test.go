package selector

import (
	"context"
	"testing"

	"github.com/sid0709/OpenSeat/backend-core/jev"
)

func TestPickBatchLeavesButtonsThatActOnTheForm(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{
		"f1": {Choice: actsKey, Probabilities: map[string]float64{"option_0": 0.3, actsKey: 0.7}},
		"f2": {Choice: "option_1"},
	}}
	picks, _, err := New(decider).PickBatch(context.Background(), "{}", []ChoiceItem{
		{ID: 1, Field: "Uber 01/2022 - Present", Intended: "from the profile", Options: []string{"Edit", "Delete"}, MayAct: true},
		{ID: 2, Field: "Title", Intended: "from the profile", Options: []string{"Mrs.", "Mr."}, MayAct: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(picks) != 1 || picks[0].ID != 2 || picks[0].Options[0] != "Mr." {
		t.Fatalf("picks = %+v, want only the title answered", picks)
	}
	if _, offered := decider.last.Questions["f1"].Criteria[actsKey]; !offered {
		t.Fatal("a field of buttons is not offered the acts-on-the-form answer")
	}
}

func TestPickBatchOffersActsOnlyForButtons(t *testing.T) {
	decider := &scriptedDecider{answers: map[string]jev.Answer{"f3": {Choice: "option_0"}}}
	if _, _, err := New(decider).PickBatch(context.Background(), "{}", []ChoiceItem{
		{ID: 3, Field: "Country", Intended: "from the profile", Options: []string{"United States", "Canada"}},
	}); err != nil {
		t.Fatal(err)
	}
	if _, offered := decider.last.Questions["f3"].Criteria[actsKey]; offered {
		t.Fatal("a radio or select field is offered the acts-on-the-form answer")
	}
}
