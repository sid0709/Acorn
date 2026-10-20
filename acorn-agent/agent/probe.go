package agent

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/sid0709/acorn/acorn-backend/plainlog"
)

// Dropdowns that the page draws itself are set one at a time by a script (choose.go): open it, look, type
// to narrow it, look, pick, and only then the next one, a round trip to the agent for every look. A fast-fill
// run probes them together instead. For every dropdown of a run of them the extension opens it, waits a
// moment and takes a picture (a snap action), and closes it, all in one batch with no look between; the
// agent reads the pictures side by side, and the next batch picks the answer in every dropdown:
//
//   - a good answer is among the options on the picture: it is picked by the keys, with no more looking;
//   - the list is too long to count, is not open yet, or the answer is not in it (a list that is searched,
//     or that loads as one types): the dropdown is opened again, the answer typed and a picture taken,
//     and read again, still in this batch;
//   - a native list reports its options as text, and the answer is picked from them as before;
//   - a dropdown that still could not be read after that typed picture, or whose picture never came, goes
//     back to the script, which has ways of its own (clicking again a little lower, clearing what was
//     typed, telling the model).
//
// Nothing checks a pick afterwards: that is the survey that follows the plan.

const (
	// probeOpenWaitMs is how long an opened list is given to draw before its picture is taken.
	probeOpenWaitMs = 500
	// probeTypedWaitMs is how long a list is given to narrow, or to load from a server, after the answer is typed.
	probeTypedWaitMs = 800
	// probeSelectWaitMs is how long a list is given to draw before the keys that pick from it.
	probeSelectWaitMs = 250
	// directMaxPosition is the furthest down an unnarrowed list an option is picked by its place: a model
	// counts three options reliably and ten not, so anything further is narrowed by typing first.
	directMaxPosition = 6
	// probeEscape is the key that closes an opened list.
	probeEscape = "Escape"
)

// What a probe is waiting for.
const (
	probeStageOpen  = "open"
	probeStageTyped = "typed"
)

// probeItem is one dropdown of the run being probed.
type probeItem struct {
	choose Action
	// snapID is the snap action whose picture is this dropdown's; typed is that the picture is of the list
	// after the answer was typed.
	snapID string
	typed  bool
	// What the reading of the picture decided: a place in a custom list, the text of an option of a native
	// list, or that the list needs the answer typed (the rest zero).
	pick   int
	native string
	needs  bool
}

// probeRun is the run of the model's actions with dropdowns in it, being carried out.
type probeRun struct {
	// queue is what is left of the run, in order; items the dropdowns waiting on their pictures.
	queue []Action
	items []*probeItem
	stage string
	made  int
	// deferred are the dropdowns that could not be read from a picture: when the others are done they go
	// back to the script with what is left of the run.
	deferred []*probeItem
}

// nextID is a fresh id for an action the agent makes for a dropdown.
func (pr *probeRun) nextID(seq int) string {
	pr.made++
	return fmt.Sprintf("s%d%s%d", seq, choosePrefix, pr.made)
}

// probing is whether fast-fill runs probe their dropdowns together.
func (a *Agent) probing(s *session) bool {
	return s.start.FastFill && a.cfg.ProbeDropdowns && a.checksOn(s)
}

// startProbe begins carrying out a run with dropdowns in it: what comes before the first run of them goes
// as it is, then every dropdown of that run is opened and photographed.
func (a *Agent) startProbe(s *session, actions []Action) []Action {
	s.probe = &probeRun{queue: bottomUp(actions)}
	return a.probeNext(s, nil)
}

// probeNext builds the next batch: prefix, the plan's actions up to the next run of dropdowns, and the
// probe of every dropdown of that run. When none is left the run is over.
func (a *Agent) probeNext(s *session, prefix []Action) []Action {
	pr := s.probe
	batch := append([]Action(nil), prefix...)
	for len(pr.queue) > 0 {
		next := pr.queue[0]
		if next.Kind != KindChoose {
			batch = append(batch, next)
			pr.queue = pr.queue[1:]
			continue
		}
		var items []*probeItem
		for len(pr.queue) > 0 && pr.queue[0].Kind == KindChoose {
			items = append(items, &probeItem{choose: pr.queue[0]})
			pr.queue = pr.queue[1:]
		}
		// The lists are opened and photographed from the top down: that changes nothing on the page, and it
		// ends at the bottom, where the pass that picks in them (from the bottom up) begins.
		for i := len(items) - 1; i >= 0; i-- {
			batch = append(batch, a.probeOpen(s, items[i])...)
		}
		pr.items, pr.stage = items, probeStageOpen
		return batch
	}
	s.probe = nil
	return batch
}

// helper is an action of the agent's own for a dropdown, aimed where the model aimed. It carries the
// dropdown's anchor, so its point is found again if the page changes shape.
func (a *Agent) helper(s *session, choose Action, id string, kind string) Action {
	action := Action{ID: id, Kind: kind}
	if kind == KindClick {
		action.X, action.Y, action.ScrollTo, action.PageHeight = choose.X, choose.Y, choose.ScrollTo, choose.PageHeight
		s.carryAnchor(choose.ID, id)
	}
	return action
}

// probeOpen opens a dropdown, waits for its list to draw, takes its picture and closes it.
func (a *Agent) probeOpen(s *session, item *probeItem) []Action {
	pr := s.probe
	seq := s.seq
	item.snapID = pr.nextID(seq)
	return []Action{
		a.helper(s, item.choose, pr.nextID(seq), KindClick),
		{ID: pr.nextID(seq), Kind: KindWait, Ms: probeOpenWaitMs},
		{ID: item.snapID, Kind: KindSnap},
		{ID: pr.nextID(seq), Kind: KindKey, Keys: probeEscape},
	}
}

// probeTyped opens a dropdown again, types the answer so that the list narrows (or loads), waits and takes
// its picture. The list is left open: the next dropdown's click closes it.
func (a *Agent) probeTyped(s *session, item *probeItem) []Action {
	pr := s.probe
	seq := s.seq
	item.typed, item.snapID = true, pr.nextID(seq)
	return []Action{
		a.helper(s, item.choose, pr.nextID(seq), KindClick),
		{ID: pr.nextID(seq), Kind: KindType, Text: item.choose.Text},
		{ID: pr.nextID(seq), Kind: KindWait, Ms: probeTypedWaitMs},
		{ID: item.snapID, Kind: KindSnap},
	}
}

// probeSelect picks the answer in a dropdown that was resolved: the same keys the script would send.
func (a *Agent) probeSelect(s *session, item *probeItem) []Action {
	pr := s.probe
	seq := s.seq
	open := a.helper(s, item.choose, pr.nextID(seq), KindClick)
	switch {
	case item.native != "":
		// A native list matches what is typed to its options as it goes, so the whole text selects that one.
		return []Action{open,
			{ID: pr.nextID(seq), Kind: KindType, Text: item.native},
			{ID: pr.nextID(seq), Kind: KindKey, Keys: "Enter"}}
	case item.typed:
		return []Action{open,
			{ID: pr.nextID(seq), Kind: KindType, Text: item.choose.Text},
			{ID: pr.nextID(seq), Kind: KindWait, Ms: probeTypedWaitMs},
			{ID: pr.nextID(seq), Kind: KindKey, Keys: optionKeys(item.pick)}}
	}
	return []Action{open,
		{ID: pr.nextID(seq), Kind: KindWait, Ms: probeSelectWaitMs},
		{ID: pr.nextID(seq), Kind: KindKey, Keys: optionKeys(item.pick)}}
}

// readProbes reads the picture of every dropdown being probed, side by side, and says what was decided
// for each. It also returns the decisions as model calls for the trace. The session is locked.
func (a *Agent) readProbes(ctx context.Context, s *session) []modelCall {
	pr := s.probe
	type reading struct {
		call    modelCall
		asked   bool
		cost    float64
		failure error
	}
	readings := make([]reading, len(pr.items))
	snaps := make([]ShotUpload, len(pr.items))
	for i, item := range pr.items {
		snaps[i] = s.snaps[item.snapID]
		delete(s.snaps, item.snapID)
	}
	var wg sync.WaitGroup
	for i, item := range pr.items {
		wg.Add(1)
		go func() {
			defer wg.Done()
			snap := snaps[i]
			if snap.Screenshot == "" {
				return // no picture came: the script takes this dropdown
			}
			answer := item.choose.Text
			if options := nativeList(snap.Focus); options != nil && !item.typed {
				index, check, asked, err := a.decideNative(ctx, s, answer, options, snap.Focus)
				if index >= 0 && err == nil {
					item.native = options[index]
				}
				readings[i] = reading{asked: asked, cost: check.response.Usage.Cost, failure: err}
				if asked {
					readings[i].call = check.call(err)
				}
				return
			}
			position, listOpen, check, err := a.pickOptionFrom(ctx, s, snap.Screenshot, answer)
			readings[i] = reading{asked: true, cost: check.response.Usage.Cost, failure: err, call: check.call(err)}
			if err != nil {
				return
			}
			limit := directMaxPosition
			if item.typed {
				limit = maxOptionPosition
			}
			switch {
			case listOpen && position >= 1 && position <= limit:
				item.pick = position
			case !item.typed:
				// Not a short list that can be counted: a search box (no list until the answer is typed),
				// a list that has not drawn, or one too long. Type the answer in this batch and look again.
				item.needs = true
			}
		}()
	}
	wg.Wait()
	var calls []modelCall
	for _, one := range readings {
		if one.failure != nil {
			slog.Warn(runName(s.id)+": could not read the picture of a dropdown.", plainlog.ErrorKey, one.failure)
		}
		if one.asked {
			s.usage.Checks++
			s.usage.CheckCost += one.cost
			s.usage.Cost += one.cost
			calls = append(calls, one.call)
		}
	}
	return calls
}

// resolved is whether a dropdown's reading says how to pick its answer.
func (item *probeItem) resolved() bool { return item.pick > 0 || item.native != "" }

// continueProbe carries on a run whose dropdowns were just probed: it reads the pictures, and sends the
// batch that picks in the dropdowns that are resolved and probes again, with the answer typed, those that
// need it. Dropdowns that could not be read go back to the script when the rest are done. It reports false
// when the model must look instead.
func (a *Agent) continueProbe(ctx context.Context, s *session, obs Observation, results []ActionResult, sig []uint8) (Step, bool) {
	pr := s.probe
	if pr == nil || len(pr.items) == 0 {
		return Step{}, false
	}
	entry := stepTrace{
		Seq: s.seq, Step: s.step, At: a.now(), Source: sourceChoose, URL: obs.URL, Title: obs.Title, Viewport: obs.Viewport,
		Focus: obs.Focus, Notes: obs.Notes, Results: obs.Results, Memo: s.memo, Job: s.job,
	}
	if failed := failedResults(obs.Results); failed != "" {
		s.probe = nil
		a.abandon(s, "The last actions failed: "+failed+".")
		return Step{}, false
	}
	calls := a.readProbes(ctx, s)
	entry.Usage = s.usage
	s.carried = withoutChoose(results)
	s.stale, s.lastSig = 0, sig

	var batch []Action
	// A list left open by the typed pictures would be closed by the click that opens a dropdown to pick in
	// it, so the batch starts by closing it.
	if pr.stage == probeStageTyped {
		batch = append(batch, Action{ID: pr.nextID(s.seq), Kind: KindKey, Keys: probeEscape})
	}
	var typing []*probeItem
	for _, item := range pr.items {
		switch {
		case item.resolved():
			batch = append(batch, a.probeSelect(s, item)...)
		case item.needs && !item.typed:
			typing = append(typing, item)
		default:
			pr.deferred = append(pr.deferred, item)
		}
	}
	if len(typing) > 0 {
		// After the picks (which end at the top of the run) from the top down.
		for i := len(typing) - 1; i >= 0; i-- {
			batch = append(batch, a.probeTyped(s, typing[i])...)
		}
		pr.items, pr.stage = typing, probeStageTyped
		return a.probeStep(s, entry, obs, batch, calls), true
	}
	if len(pr.deferred) > 0 {
		return a.handBack(s, entry, obs, batch, calls), true
	}
	return a.probeStep(s, entry, obs, a.probeNext(s, batch), calls), true
}

// handBack gives the dropdowns that could not be read from a picture back to the script, with the rest of
// the run: it sets them one at a time and has ways of its own when a list does not answer (clicking again a
// little lower, clearing what was typed, telling the model).
func (a *Agent) handBack(s *session, entry stepTrace, obs Observation, batch []Action, calls []modelCall) Step {
	pr := s.probe
	queue := make([]Action, 0, len(pr.deferred)+len(pr.queue))
	for _, item := range pr.deferred {
		queue = append(queue, item.choose)
	}
	queue = append(queue, pr.queue...)
	s.script = &script{queue: queue, made: pr.made}
	s.probe = nil
	slog.Info(fmt.Sprintf("%s: %s could not be read from a picture, so they are set one at a time.", runName(s.id), plainlog.Count(len(pr.deferred), "dropdown")))
	return a.probeStep(s, entry, obs, a.dispatch(s, batch), calls)
}

// probeStep sends a batch of a probed run.
func (a *Agent) probeStep(s *session, entry stepTrace, obs Observation, batch []Action, calls []modelCall) Step {
	step := Step{Status: StatusWorking, Message: s.message, Actions: batch, Number: s.step, Usage: s.usage}
	// The run's last batch is followed by a survey of the whole page, to finish and to check what is left.
	step.Survey = s.probe == nil && s.script == nil && len(batch) > 0
	if step.Survey {
		s.surveyAgain = false
	}
	entry.Usage = s.usage
	entry.Status, entry.Message, entry.Actions = step.Status, step.Message, step.Actions
	a.record(s, entry, obs.Screenshot, calls)
	return step
}
