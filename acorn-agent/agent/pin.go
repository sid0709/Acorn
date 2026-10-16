package agent

// A plan's points are measured on one screenshot, at one scroll position. Between the look and an
// action the page can move without the plan asking it to: a key that scrolls it (ArrowDown, Home), a
// smooth scroll still running, a list that scrolls itself into view, a field that scrolls to keep
// the caret visible. A click aimed at where a control was then lands on something else, and the
// model is called again to repair what the misses did. So every point of a plan carries the scroll
// position of its screenshot, and the extension puts the page back there before acting (and
// refuses to act when it cannot). The actions after the plan's own scroll are not pinned: they were
// aimed blind, at a page the plan itself moved.

// pinFrame sets the scroll position a plan's point actions were measured at, up to the plan's first
// scroll. A survey sets its own positions, and an action that has one keeps it.
func pinFrame(actions []Action, vp Viewport, surveyScreens int) []Action {
	if surveyScreens > 0 {
		return actions
	}
	scrollY := vp.ScrollY
	for i := range actions {
		if actions[i].Kind == KindScroll {
			break
		}
		switch actions[i].Kind {
		case KindClick, KindDoubleClick, KindTripleClick, KindRightClick, KindHover, KindUpload, KindChoose:
			if actions[i].ScrollTo == nil {
				at := scrollY
				actions[i].ScrollTo = &at
			}
		}
	}
	return actions
}

// afterUploadNote tells the model why what it planned after an upload did not run.
const afterUploadNote = "Your plan ran only as far as the upload. Attaching a file changes the page (a row for the file appears and what is below it moves), so what you planned after it was aimed at the page as it was before. Plan the rest on this look."

// cutAfterUpload keeps a plan only as far as its first upload. The page moves after a file is attached,
// and the points planned after it were measured on the page before, so they land on other controls: a
// recorded run clicked the wrong field, typed into nothing, and lost the rest of its plan. It says
// how many actions were cut.
func cutAfterUpload(actions []Action) ([]Action, int) {
	for i, action := range actions {
		if action.Kind == KindUpload && i+1 < len(actions) {
			return actions[:i+1], len(actions) - (i + 1)
		}
	}
	return actions, 0
}
