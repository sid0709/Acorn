package agent

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// A point the check refuses is often one on the words of a question, or in the gap round its box,
// instead of on the box: the model aimed at the text it read. A click there would often work (a label
// passes the click on to its control), but the check says no, and the plan lost the field and a model
// call to plan it again. So when the refused point is in the field of a control (marks.go) and on none,
// it is moved onto that control and checked once more, the same way. A point that then passes is acted
// on; one that does not is dropped as before.

// reaimed is the action with its point moved onto the control whose field it is in: the control's
// middle, at the point's own x when the control reaches it. It is not moved when it is on a control
// already (the label is what is wrong then, not the place), when no control's field holds it, or when
// the control lies on another screen of the survey.
func reaimed(action Action, obs Observation) (Action, bool) {
	if len(obs.Marks) == 0 || action.X == nil || action.Y == nil {
		return action, false
	}
	x, y := pageX(action, obs), pageY(action, obs)
	for _, mark := range obs.Marks {
		if mark.Rect.contains(x, y, markSlackPx) {
			return action, false
		}
	}
	mark, ok := markAt(obs.Marks, x, y)
	if !ok {
		return action, false
	}
	top := obs.Viewport.ScrollY
	if action.ScrollTo != nil {
		top = *action.ScrollTo
	}
	newY := mark.centerY() - top
	if newY < 0 || newY >= float64(obs.Viewport.Height) {
		return action, false
	}
	reach := mark.Rect
	if mark.Box != nil {
		reach = *mark.Box
	}
	newX := *action.X
	if x < reach.X || x > reach.X+reach.W {
		newX = mark.X + mark.W/2 - obs.Viewport.ScrollX
	}
	moved := action
	moved.X, moved.Y = &newX, &newY
	return moved, true
}

// reaimWrongPoints moves the refused points that can be moved onto their controls and checks them again, the
// screens side by side. It returns the plan with the points that passed in place of the ones that were
// refused, and the refusals that stand.
func (a *Agent) reaimWrongPoints(ctx context.Context, s *session, planned []Action, wrong map[string]pointVerdict, obs Observation) ([]Action, map[string]pointVerdict, []modelCall) {
	moved := map[string]Action{}
	byZone := map[int][]Action{}
	var zones []int
	for _, action := range planned {
		if _, refused := wrong[action.ID]; !refused {
			continue
		}
		fixed, ok := reaimed(action, obs)
		if !ok {
			continue
		}
		moved[action.ID] = fixed
		if _, seen := byZone[fixed.Zone]; !seen {
			zones = append(zones, fixed.Zone)
		}
		byZone[fixed.Zone] = append(byZone[fixed.Zone], fixed)
	}
	if len(moved) == 0 {
		return planned, wrong, nil
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
			one := a.checkZonePoints(ctx, s, zone, byZone[zone], obs)
			results[i] = result{verdicts: one.verdicts, call: one.call}
		}()
	}
	wg.Wait()

	var calls []modelCall
	var cost float64
	passed := map[string]Action{}
	for _, one := range results {
		calls = append(calls, one.call)
		cost += one.call.Usage.Cost
		for _, verdict := range one.verdicts {
			if verdict.Matches >= a.cfg.PointMatch {
				passed[verdict.Action.ID] = verdict.Action
			}
		}
	}
	s.usage.Checks += len(zones)
	s.usage.CheckCost += cost
	s.usage.Cost += cost
	if len(passed) == 0 {
		return planned, wrong, calls
	}
	remaining := map[string]pointVerdict{}
	for id, verdict := range wrong {
		if _, ok := passed[id]; !ok {
			remaining[id] = verdict
		}
	}
	out := make([]Action, len(planned))
	for i, action := range planned {
		fixed, ok := passed[action.ID]
		if !ok {
			out[i] = action
			continue
		}
		out[i] = fixed
		s.rebindPoint(fixed, obs)
	}
	slog.Info(fmt.Sprintf("%s: %s of the plan were on the words of a question, not on its control, and were moved onto it.",
		runName(s.id), plainlog.Count(len(passed), "point")))
	return out, remaining, calls
}

// rebindPoint gives a point that was moved the picture and the control of its new place.
func (s *session) rebindPoint(action Action, obs Observation) {
	if s.anchors == nil {
		s.anchors = map[string]anchor{}
	}
	if s.marks == nil {
		s.marks = map[string]MarkRef{}
	}
	if found, ok := buildAnchors([]Action{action}, obs)[action.ID]; ok {
		s.anchors[action.ID] = found
	} else {
		delete(s.anchors, action.ID)
	}
	if found, ok := bindMarks([]Action{action}, obs)[action.ID]; ok {
		s.marks[action.ID] = found
	} else {
		delete(s.marks, action.ID)
	}
}
