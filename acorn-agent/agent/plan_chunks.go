package agent

// splitPlan cuts a plan into runs. A run ends at an action the model put a check on, after
// limit actions when it did not, and always before or after uploads and scrolls so the screen
// is verified before the page moves and coordinates stay valid.
func splitPlan(actions []Action, limit int) []chunk {
	var out []chunk
	var current []Action
	flush := func(expect string) {
		if len(current) == 0 {
			return
		}
		out = append(out, chunk{actions: append([]Action(nil), current...), expect: expect})
		current = nil
	}
	for _, action := range actions {
		if action.Kind == KindScroll && len(current) > 0 {
			flush(current[len(current)-1].Check)
		}
		current = append(current, action)
		if action.Kind == KindUpload {
			flush(action.Check)
			continue
		}
		if action.Check != "" || (limit > 0 && len(current) == limit) {
			flush(action.Check)
			continue
		}
		if action.Kind == KindScroll {
			flush(action.Check)
		}
	}
	if len(current) > 0 {
		out = append(out, chunk{actions: current})
	}
	return out
}
