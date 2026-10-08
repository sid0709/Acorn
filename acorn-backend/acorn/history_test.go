package acorn

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/sid0709/OpenSeat/backend-core/openai"
)

// chatModel is a fakeModel that also takes a conversation, recording its turns.
type chatModel struct {
	fakeModel
	turns [][]openai.Message
}

func (c *chatModel) Conversation(ctx context.Context, system string, turns []openai.Message, schema json.RawMessage) ([]byte, error) {
	c.turns = append(c.turns, turns)
	return c.JSON(ctx, system, turns[len(turns)-1].Content, schema)
}

const phonePlan = `{"goal":"g","actions":[
 {"action":"fill","element_index":7,"element_indexes":null,"expected_label":"Phone Number *","expected_role":"textbox","value":"%s","file":null,"reason":null,"ms":null}
],"forbidden_actions":[],"validation":{"required_element_indexes":[7],"stop_before_submit":true},"unresolved_items":[]}`

func phoneTurn(t *testing.T, value string, flagged *FieldIssueScan) PlanTurn {
	t.Helper()
	var plan Plan
	if err := json.Unmarshal([]byte(strings.Replace(phonePlan, "%s", value, 1)), &plan); err != nil {
		t.Fatal(err)
	}
	label := "Phone Number *"
	return PlanTurn{Mode: "fill", FieldIssues: flagged, Plan: plan, Steps: []StepRecord{
		{Index: 0, Action: "fill", ExpectedLabel: &label, Status: "ok"},
	}}
}

var phoneRejected = FieldIssueScan{Issues: []FieldIssue{{
	ElementIndex: 7, Label: "Phone Number *", Role: "textbox", Value: "(424) 320-7354",
	NearbyMessages: []string{"Please, enter a valid phone number"},
}}}

func TestRefillTurnsReplayEarlierPlans(t *testing.T) {
	turns := refillTurns([]PlanTurn{
		phoneTurn(t, "(424) 320-7354", nil),
		phoneTurn(t, "+1 424 320 7354", &phoneRejected),
	}, "CURRENT")

	roles := make([]string, len(turns))
	for i, turn := range turns {
		roles[i] = turn.Role
	}
	if got := strings.Join(roles, ","); got != "user,assistant,user,assistant,user" {
		t.Fatalf("roles = %s", got)
	}
	if turns[0].Content != firstPlanAsk {
		t.Errorf("first ask = %q", turns[0].Content)
	}
	if !strings.Contains(turns[1].Content, "(424) 320-7354") {
		t.Errorf("the first plan is not replayed as the model's answer: %s", turns[1].Content)
	}
	second := turns[2].Content
	if !strings.Contains(second, `fill "Phone Number *": ok`) || !strings.Contains(second, "Please, enter a valid phone number") {
		t.Errorf("the refill ask lacks the outcome and the page's message: %s", second)
	}
	last := turns[len(turns)-1].Content
	if !strings.HasSuffix(last, "CURRENT") || !strings.Contains(last, "Result of your plan above") {
		t.Errorf("last turn = %q", last)
	}
}

func TestRefillTurnsWithoutHistoryIsTheSinglePrompt(t *testing.T) {
	turns := refillTurns(nil, "CURRENT")
	if len(turns) != 1 || turns[0].Content != "CURRENT" || turns[0].Role != openai.RoleUser {
		t.Fatalf("turns = %+v", turns)
	}
}

func TestRefillContinuesTheConversation(t *testing.T) {
	model := &chatModel{fakeModel: fakeModel{replies: []string{strings.Replace(phonePlan, "%s", "4243207354", 1)}}}
	history := []PlanTurn{phoneTurn(t, "(424) 320-7354", nil)}
	if _, err := New(model).Refill(context.Background(), "PROFILE", "tree", phoneRejected, nil, history); err != nil {
		t.Fatal(err)
	}
	if len(model.turns) != 1 || len(model.turns[0]) != 3 {
		t.Fatalf("conversation turns = %d calls, %+v", len(model.turns), model.turns)
	}
}

func TestRefillFlattensHistoryForASingleMessageModel(t *testing.T) {
	model := &fakeModel{replies: []string{strings.Replace(phonePlan, "%s", "4243207354", 1)}}
	history := []PlanTurn{phoneTurn(t, "(424) 320-7354", nil)}
	if _, err := New(model).Refill(context.Background(), "PROFILE", "tree", phoneRejected, nil, history); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(model.calls[0], "[Your earlier plan]") || !strings.Contains(model.calls[0], "(424) 320-7354") {
		t.Errorf("prompt lacks the earlier plan: %s", model.calls[0])
	}
}

func TestRefillRejectsTooMuchHistory(t *testing.T) {
	history := make([]PlanTurn, MaxPlanTurns+1)
	_, err := New(&fakeModel{}).Refill(context.Background(), "PROFILE", "tree", phoneRejected, nil, history)
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
}
