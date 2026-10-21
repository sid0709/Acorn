package agent

import (
	"context"
	"encoding/base64"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/sid0709/acorn/acorn-agent/decide"
	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// A model that plans a whole page names the survey screen of every point, and sometimes names the
// wrong one: a recorded run put the first name field on screen 7 when it was on screen 6, and typed
// the applicant's name into another question. So before a fast-fill plan is carried out, each point
// that has a label is checked against it: the survey screen is drawn with the points numbered on it,
// and the decision model is asked, for each point, whether it is on the control that belongs to its
// label. The screens are checked side by side, so it costs about one check. A point that is not
// on its control is not acted on, and neither is what was typed into it; the rest of
// the plan runs, except the click that sends the page (the plan lost something, so it is held back),
// and the model is told which points to plan again. Before the check, each point is moved onto the entry
// of the control it is on (aim.go), and a point on a control the page calls what the model called it
// is not checked at all (labels.go).

// askPointPrefix starts the key of the question about a numbered point: "p1", "p2", ...
const askPointPrefix = "p"

// pointVerdict is what the check said about one point.
type pointVerdict struct {
	Action  Action
	Matches float64
}

// pointQuestionKey is the question key of the n-th (from 1) point marked on a screen.
func pointQuestionKey(n int) string { return fmt.Sprintf("%s%d", askPointPrefix, n) }

// pointQuestion asks whether the point marked n is on the control the label belongs to.
func pointQuestion(n int, label string) decide.Question {
	return decide.YesNo(fmt.Sprintf("The red ring and cross numbered %d marks a point where something is about to be clicked or typed. "+
		"Is that point on the control (the box, dropdown, checkbox or button) that belongs to the label %q, or on that label itself? "+
		"Answer no if it is on another question, on a heading, on plain text, or on empty space.", n, label))
}

// checkedPoints are the point actions of a plan that can be checked, by zone: they have a label and
// an anchor (the survey screen they were measured on is readable). A point bound to a control the page
// calls what the model called it is not checked: the page has answered (labels.go). Zones come in the
// order of their first action; trusted counts the points the page answered for.
func (s *session) checkedPoints(planned []Action) (zones []int, byZone map[int][]Action, trusted int) {
	byZone = map[int][]Action{}
	for _, action := range planned {
		if !isPointAction(action) || strings.TrimSpace(action.Label) == "" {
			continue
		}
		if _, ok := s.anchors[action.ID]; !ok {
			continue
		}
		if ref, bound := s.marks[action.ID]; bound && labelsAgree(action.Label, ref.Label) {
			trusted++
			continue
		}
		if _, seen := byZone[action.Zone]; !seen {
			zones = append(zones, action.Zone)
		}
		byZone[action.Zone] = append(byZone[action.Zone], action)
	}
	return zones, byZone, trusted
}

// zoneImage is the survey screen of a zone (the single screenshot when there is no survey).
func zoneImage(obs Observation, zone int) string {
	if zone >= 1 && zone <= len(obs.Survey) {
		return obs.Survey[zone-1].Screenshot
	}
	return obs.Screenshot
}

// checkPlanPoints checks every labelled point of a fast-fill plan against the screen the model said
// it is on, and returns the plan without the points that are not on their controls (and what was
// typed into them) and the checks as model calls for the trace. A check that cannot be made leaves
// its points as they are: the plan is not held up by a checker that is down.
func (a *Agent) checkPlanPoints(ctx context.Context, s *session, planned []Action, obs Observation) ([]Action, []modelCall) {
	if !s.start.FastFill || !a.checksOn(s) || a.cfg.PointMatch <= 0 {
		return planned, nil
	}
	zones, byZone, trusted := s.checkedPoints(planned)
	if trusted > 0 {
		slog.Info(fmt.Sprintf("%s: %s of the plan %s on a control the page calls what the model called it, and %s not checked against a picture.",
			runName(s.id), plainlog.Count(trusted, "point"), isOrAre(trusted), isOrAre(trusted)))
	}
	if len(zones) == 0 {
		return planned, nil
	}
	type result struct {
		verdicts []pointVerdict
		call     modelCall
	}
	results := make([]result, len(zones))
	var wg sync.WaitGroup
	for i, zone := range zones {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i] = a.checkZonePoints(ctx, s, zone, byZone[zone], obs)
		}()
	}
	wg.Wait()

	wrong := map[string]pointVerdict{}
	var calls []modelCall
	var cost float64
	for _, one := range results {
		calls = append(calls, one.call)
		cost += one.call.Usage.Cost
		for _, verdict := range one.verdicts {
			if verdict.Matches < a.cfg.PointMatch {
				wrong[verdict.Action.ID] = verdict
			}
		}
	}
	s.usage.Checks += len(zones)
	s.usage.CheckCost += cost
	s.usage.Cost += cost
	if len(wrong) == 0 {
		return planned, calls
	}
	kept := withoutWrongPoints(planned, wrong)
	s.notes = append(s.notes, wrongPointsNote(planned, wrong))
	s.surveyAgain = true
	slog.Warn(fmt.Sprintf("%s: %s of the plan were not on the control they name, so they were not carried out (%d of %d actions kept).",
		runName(s.id), plainlog.Count(len(wrong), "point"), len(kept), len(planned)))
	return kept, calls
}

// checkZonePoints asks the decision model about the labelled points on one survey screen.
func (a *Agent) checkZonePoints(ctx context.Context, s *session, zone int, actions []Action, obs Observation) (out struct {
	verdicts []pointVerdict
	call     modelCall
}) {
	started := time.Now()
	marked, err := markScreenshot(zoneImage(obs, zone), actions)
	if err != nil {
		out.call = modelCall{Kind: "decision", Error: "the points could not be drawn: " + err.Error()}
		return out
	}
	questions := map[string]decide.Question{}
	for i, action := range actions {
		questions[pointQuestionKey(i+1)] = pointQuestion(i+1, action.Label)
	}
	state := []decide.Part{
		decide.Text("A screenshot of a web page, with the points that are about to be clicked or typed at marked by numbered red rings."),
		decide.Image("data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(marked)),
	}
	response, err := a.newScreen(s.key).Decide(ctx, decide.Request{State: state, Questions: questions})
	prompt := fmt.Sprintf("points on screen %d: %s", zone, pointLabels(actions))
	out.call = verdict{response: response, prompt: prompt}.call(err)
	if out.call.LatencyMs == 0 {
		out.call.LatencyMs = time.Since(started).Milliseconds()
	}
	if err != nil {
		slog.Warn(runName(s.id)+": could not check the points of screen "+fmt.Sprint(zone)+", so they are acted on as planned.", plainlog.ErrorKey, err)
		return out
	}
	for i, action := range actions {
		answer, ok := response.Answers[pointQuestionKey(i+1)]
		if !ok || answer.Noul == nil {
			continue
		}
		out.verdicts = append(out.verdicts, pointVerdict{Action: action, Matches: *answer.Noul})
	}
	return out
}

// pointLabels lists the labels of some actions, for the trace.
func pointLabels(actions []Action) string {
	labels := make([]string, len(actions))
	for i, action := range actions {
		labels[i] = fmt.Sprintf("%d %q", i+1, action.Label)
	}
	return strings.Join(labels, ", ")
}

// withoutWrongPoints is the plan without the points that failed and what follows each of them up to
// the next point (the text typed into it, the keys pressed there): those were meant for a control
// that was not the one aimed at.
func withoutWrongPoints(planned []Action, wrong map[string]pointVerdict) []Action {
	var kept []Action
	dropping := false
	for _, action := range planned {
		if isPointAction(action) {
			_, dropping = wrong[action.ID]
		}
		if dropping {
			continue
		}
		kept = append(kept, action)
	}
	return kept
}

// wrongPointsNote tells the model which points were not carried out, in its own words, so it plans
// them again on the next survey.
func wrongPointsNote(planned []Action, wrong map[string]pointVerdict) string {
	var lines []string
	for _, action := range planned {
		if _, bad := wrong[action.ID]; !bad {
			continue
		}
		lines = append(lines, fmt.Sprintf("%q on screen %d", action.Label, action.Zone))
	}
	return fmt.Sprintf("Acorn did not carry out %s because the point was not on the control with that label: %s. The rest of your plan ran. "+
		"Look at the screens again, find where each of them really is by its label, and plan them again with the right screen number. "+
		"A box with no dropdown arrow is a text box: click it and type, do not choose it.",
		plainlog.Count(len(lines), "action"), strings.Join(lines, "; "))
}

// withoutCommits is the plan without the clicks the model named as the one that sends the page or goes on
// to the next (and what follows each up to the next point), and those clicks.
func withoutCommits(planned []Action) (kept, held []Action) {
	dropping := false
	for _, action := range planned {
		if isPointAction(action) {
			dropping = action.Commit != ""
			if dropping {
				held = append(held, action)
			}
		}
		if dropping {
			continue
		}
		kept = append(kept, action)
	}
	return kept, held
}

// holdCommits takes the click that sends the page out of a fast-fill plan that lost part of itself: a
// recorded run pressed Submit with a required field it had not filled, which turned every unanswered
// question red and cost the rounds to read them. The model is told, and presses the click on the look
// after, when the page is complete. It reports the clicks it held.
func (a *Agent) holdCommits(s *session, planned *[]Action, lost int) []Action {
	if lost <= 0 || !s.start.FastFill {
		return nil
	}
	kept, held := withoutCommits(*planned)
	if len(held) == 0 {
		return nil
	}
	*planned = kept
	s.notes = append(s.notes, commitHeldNote(held, lost))
	s.surveyAgain = true
	slog.Warn(fmt.Sprintf("%s: %s of the plan could not be carried out, so the click that sends the page was held back.", runName(s.id), plainlog.Count(lost, "action")))
	return held
}

// commitHeldNote tells the model that the click that sends the page was not made, and why.
func commitHeldNote(held []Action, lost int) string {
	var names []string
	for _, action := range held {
		if label := strings.TrimSpace(action.Label); label != "" {
			names = append(names, fmt.Sprintf("%q on screen %d", label, action.Zone))
		}
	}
	what := "the click that sends the page"
	if len(names) > 0 {
		what = strings.Join(names, "; ")
	}
	return fmt.Sprintf("Acorn did not press %s because %s of your plan could not be carried out, and the page is not complete. "+
		"Plan what is left, and press it when nothing on the page is empty or wrong.", what, plainlog.Count(lost, "action"))
}
