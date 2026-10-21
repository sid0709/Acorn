package agent

// A plan whose every action failed, the same way, step after step is a loop the model cannot see out of:
// the page refused the same thing each time and the model planned it again each time. The screen changes
// a little between such steps (a list opens, a cursor moves), so the unchanged-screen count (MaxStale)
// never trips. A recorded Greenhouse run planned the same refused click 33 times over 854 s, with the
// fields below it skipped each time, until the person stopped it; the run now ends as stuck after
// MaxFailedSteps such steps, naming the failure, so the person finishes that part by hand.

// firstFailure is the error of the first action of the batch that failed, when nothing in it succeeded;
// "" when something did, or nothing was planned. An action that reached no control is not a failure of
// the batch (ActionResult.Unreached), and what was skipped after a failure says nothing of its own.
func firstFailure(results []ActionResult) string {
	first := ""
	for _, result := range results {
		if result.OK {
			return ""
		}
		if first == "" && !result.Unreached && result.Error != "" {
			first = result.Error
		}
	}
	return first
}

// failedStreakAfter is how many model steps in a row have ended with every action failing the same way,
// the step that ended with this failure included; 0 when it is not a failure.
func (s *session) failedStreakAfter(failure string) int {
	if failure == "" {
		return 0
	}
	if failure == s.lastFailure {
		return s.failedStreak + 1
	}
	return 1
}
