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
