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
		case KindType, KindUpload, KindChoose:
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

// fillBatchPrefix is the start of a plan that may be batched: everything before the first
// scroll or upload. Scrolling belongs on the next look after a check, not in a multi-field run.
func fillBatchPrefix(actions []Action) (prefix, rest []Action) {
	for i, action := range actions {
		switch action.Kind {
		case KindScroll, KindUpload:
			return actions[:i], actions[i:]
		}
	}
	return actions, nil
}

// splitPlanForSession cuts a plan into runs. When batching is allowed and the prefix before
// any scroll or upload fills at least two fields, that prefix is one run and one check; the
// rest of the plan is split normally. Otherwise the plan is cut by limit.
func splitPlanForSession(actions []Action, limit int, batch bool) []chunk {
	if batch {
		prefix, rest := fillBatchPrefix(actions)
		if fieldInteractions(prefix) >= minFieldInteractionsForBatch {
			if expect := batchExpect(prefix); expect != "" {
				out := []chunk{{actions: prefix, expect: expect}}
				if len(rest) > 0 {
					out = append(out, splitPlan(rest, limit)...)
				}
				return out
			}
		}
	}
	return splitPlan(actions, limit)
}
