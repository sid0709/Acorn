package agent

// splitPlan cuts a plan into runs. A run ends at an action the model put a check on, after
// limit actions when it did not, and always before or after scrolls so coordinates stay valid.
// With atUploads, a run also ends after an upload, so the screen is verified before the page moves;
// a fast-fill plan goes on past it, since its points follow the page's controls.
func splitPlan(actions []Action, limit int, atUploads bool) []chunk {
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
		if action.Kind == KindUpload && atUploads {
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
