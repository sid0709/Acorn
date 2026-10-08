package acorn

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/sid0709/OpenSeat/backend-core/openai"
)

// MaxPlanTurns bounds the plans a Refill replays (MAX_PLAN_TURNS in @acorn/shared/plan-history).
const MaxPlanTurns = 4

// firstPlanAsk stands in for the page's first planning request: the applicant and
// the tree are sent once, in the last message, not again for every turn.
const firstPlanAsk = "Plan the fill of this application page from the applicant data. " +
	"The applicant data and the page's current Pure Tree are in the last message."

// PlanTurn is one plan the extension already ran on the page, as
// @acorn/shared/plan-history sends it. Secrets in the plan are redacted.
type PlanTurn struct {
	Mode string `json:"mode"`
	// FieldIssues is what the page flagged that asked for this plan; nil on the page's first fill.
	FieldIssues *FieldIssueScan `json:"fieldIssues,omitempty"`
	Plan        Plan            `json:"plan"`
	Steps       []StepRecord    `json:"steps"`
}

// StepRecord is how one planned action went on the page (RunStepRecord in @acorn/shared).
type StepRecord struct {
	Index         int     `json:"index"`
	Action        string  `json:"action"`
	ElementIndex  *int    `json:"element_index"`
	ExpectedLabel *string `json:"expected_label"`
	Status        string  `json:"status"`
	Message       string  `json:"message,omitempty"`
}

// ConversationModel is a Model that can answer after earlier turns of the same
// conversation. openai.Client is one; a Model without it gets the turns as text.
type ConversationModel interface {
	Conversation(ctx context.Context, system string, turns []openai.Message, schema json.RawMessage) ([]byte, error)
}

func validateHistory(history []PlanTurn) error {
	if len(history) > MaxPlanTurns {
		return fmt.Errorf("%w: history has %d turns (limit %d)", ErrInvalid, len(history), MaxPlanTurns)
	}
	return nil
}

// refillTurns replays the page's plans as the planner's own answers, each followed
// by what the page did with it, then asks for the next fix. The model sees which
// value it typed next to the message the page answered with.
func refillTurns(history []PlanTurn, current string) []openai.Message {
	turns := make([]openai.Message, 0, 2*len(history)+1)
	var previous []StepRecord
	for i, turn := range history {
		ask := firstPlanAsk
		if i > 0 || turn.FieldIssues != nil {
			ask = outcome(previous) + flaggedBlock(turn.FieldIssues) + "Plan fixes for the fields the page rejected."
		}
		plan, err := json.Marshal(turn.Plan)
		if err != nil {
			continue
		}
		turns = append(turns,
			openai.Message{Role: openai.RoleUser, Content: strings.TrimSpace(ask)},
			openai.Message{Role: openai.RoleAssistant, Content: string(plan)},
		)
		previous = turn.Steps
	}
	last := current
	if len(history) > 0 {
		last = outcome(previous) + "After that, Submit / Next did not move the page on. " +
			"Here is the page now; the flagged fields are its answer to your last plan.\n\n" + current
	}
	return append(turns, openai.Message{Role: openai.RoleUser, Content: last})
}

// outcome is how the previous plan's steps went, one line each.
func outcome(steps []StepRecord) string {
	if len(steps) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("Result of your plan above:\n")
	for _, step := range steps {
		label := "?"
		if step.ExpectedLabel != nil && *step.ExpectedLabel != "" {
			label = *step.ExpectedLabel
		}
		fmt.Fprintf(&b, "- %s %q: %s", step.Action, label, step.Status)
		if step.Message != "" {
			b.WriteString(" (" + step.Message + ")")
		}
		b.WriteString("\n")
	}
	return b.String() + "\n"
}

func flaggedBlock(scan *FieldIssueScan) string {
	if scan == nil || (len(scan.Issues) == 0 && len(scan.PageMessages) == 0) {
		return ""
	}
	return "After Submit / Next the page stayed and flagged:\n" + indentedJSON(scan) + "\n\n"
}

// transcript renders turns as one prompt, for a Model that only takes one user message.
func transcript(turns []openai.Message) string {
	if len(turns) == 1 {
		return turns[0].Content
	}
	var b strings.Builder
	for _, turn := range turns[:len(turns)-1] {
		speaker := "Request"
		if turn.Role == openai.RoleAssistant {
			speaker = "Your earlier plan"
		}
		b.WriteString("[" + speaker + "]\n" + turn.Content + "\n\n")
	}
	b.WriteString("[Now]\n" + turns[len(turns)-1].Content)
	return b.String()
}
