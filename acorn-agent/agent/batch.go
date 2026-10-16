package agent

import "strings"

// minFieldInteractionsForBatch is how many fill-related actions a plan needs before the
// server runs them all and checks once, instead of checking after each chunk.
const minFieldInteractionsForBatch = 2

// fieldInteractions counts actions that fill or commit a form field on the current screen.
func fieldInteractions(actions []Action) int {
	n := 0
	for _, action := range actions {
		switch action.Kind {
		case KindType, KindUpload:
			n++
		}
	}
	return n
}

// batchExpect is what the checker reads after a batched fill: every check the model set
// on those actions, combined into one sentence.
func batchExpect(actions []Action) string {
	var parts []string
	for _, action := range actions {
		if c := strings.TrimSpace(action.Check); c != "" {
			parts = append(parts, c)
		}
	}
	switch len(parts) {
	case 0:
		return ""
	case 1:
		return parts[0]
	default:
		return "The screen shows all of the following after the last actions: " + strings.Join(parts, "; ")
	}
}

// splitPlanForSession cuts a plan into runs. When batching is allowed and the plan fills
// at least two fields, the whole plan is one run and one check. Otherwise the plan is cut
// by limit, or by one action at a time when granularChecks is set.
func splitPlanForSession(actions []Action, limit int, batch, granular bool) []chunk {
	if batch && !granular && !planHasScrollOrUpload(actions) && fieldInteractions(actions) >= minFieldInteractionsForBatch {
		if expect := batchExpect(actions); expect != "" {
			return []chunk{{actions: actions, expect: expect}}
		}
	}
	if granular {
		return splitPlan(actions, 1)
	}
	return splitPlan(actions, limit)
}
